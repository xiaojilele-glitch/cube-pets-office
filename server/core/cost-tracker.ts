/**
 * CostTracker — 服务端成本追踪核心模块
 *
 * 负责 LLM 调用成本的内存采集、多维度聚合、Mission 归档。
 * 预算/预警/降级逻辑在 Task 3.1 / 4.1 中补充实现。
 *
 * @see Requirements 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CostRecord,
  CostSnapshot,
  CostAlert,
  Budget,
  DowngradePolicy,
  DowngradeLevel,
  AgentCostSummary,
  MissionCostSummary,
} from "../../shared/cost.js";

import { DEFAULT_BUDGET, DEFAULT_DOWNGRADE_POLICY } from "../../shared/cost.js";

const __ct_filename = fileURLToPath(import.meta.url);
const __ct_dirname = dirname(__ct_filename);
const DEFAULT_HISTORY_PATH = resolve(
  __ct_dirname,
  "../../data/cost-history.json"
);

/** Persistence file schema */
interface CostHistoryFile {
  version: 1;
  budget: Budget;
  downgradePolicy: DowngradePolicy;
  missions: MissionCostSummary[];
}

class CostTracker {
  /** 当前 Mission 的调用记录 */
  private records: CostRecord[] = [];
  /** 最近 10 次 Mission 历史 */
  private missionHistory: MissionCostSummary[] = [];
  /** 活跃预警列表 */
  private alerts: CostAlert[] = [];
  /** 预算配置 */
  private budget: Budget = { ...DEFAULT_BUDGET };
  /** 降级策略 */
  private downgradePolicy: DowngradePolicy = { ...DEFAULT_DOWNGRADE_POLICY };
  /** 降级状态 */
  private downgradeLevel: DowngradeLevel = "none";
  /** 被暂停的 Agent ID 集合 */
  private pausedAgentIds: Set<string> = new Set();
  /** 当前 Mission ID */
  private currentMissionId: string | null = null;
  /** 持久化文件路径 */
  private readonly historyFilePath: string;

  constructor(historyFilePath?: string) {
    this.historyFilePath = historyFilePath ?? DEFAULT_HISTORY_PATH;
  }

  // ---------------------------------------------------------------------------
  // 核心方法
  // ---------------------------------------------------------------------------

  /**
   * 同步写入一条成本记录。
   * 写入后触发预警检查和广播（Task 9.1 实现）。
   */
  recordCall(record: CostRecord): void {
    this.records.push(record);

    // 跟踪当前 Mission
    if (record.missionId && !this.currentMissionId) {
      this.currentMissionId = record.missionId;
    }

    this.checkAlerts();
    // Broadcast cost update via Socket.IO (throttled 500ms)
    import("./socket.js")
      .then(({ emitCostUpdate }) => {
        emitCostUpdate(this.getSnapshot());
      })
      .catch(() => {
        // socket module not available — skip
      });
  }

  /**
   * 计算当前 Mission 的实时成本快照。
   * 包含预算百分比和预警信息。
   */
  getSnapshot(): CostSnapshot {
    const agentCosts = this.getAgentCosts();

    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCost = 0;

    for (const r of this.records) {
      totalTokensIn += r.tokensIn;
      totalTokensOut += r.tokensOut;
      totalCost += r.actualCost;
    }

    const budgetUsedPercent =
      this.budget.maxCost > 0
        ? Math.min(totalCost / this.budget.maxCost, 1.0)
        : 0;

    const totalTokens = totalTokensIn + totalTokensOut;
    const tokenUsedPercent =
      this.budget.maxTokens > 0
        ? Math.min(totalTokens / this.budget.maxTokens, 1.0)
        : 0;

    return {
      totalTokensIn,
      totalTokensOut,
      totalCost,
      totalCalls: this.records.length,
      budgetUsedPercent,
      tokenUsedPercent,
      agentCosts,
      alerts: [...this.alerts],
      downgradeLevel: this.downgradeLevel,
      budget: { ...this.budget },
      updatedAt: Date.now(),
    };
  }

  /** 返回历史 Mission 成本摘要列表（最近 10 次） */
  getHistory(): MissionCostSummary[] {
    return [...this.missionHistory];
  }

  /**
   * 归档当前 Mission 的成本摘要到历史列表。
   * 保留最近 10 次，超出部分丢弃最旧的。
   */
  finalizeMission(missionId: string, title: string): void {
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCost = 0;

    for (const r of this.records) {
      totalTokensIn += r.tokensIn;
      totalTokensOut += r.tokensOut;
      totalCost += r.actualCost;
    }

    const agentCosts = this.getAgentCosts();
    // 取费用最高的前 5 个 Agent
    const topAgents = agentCosts.slice(0, 5);

    const summary: MissionCostSummary = {
      missionId,
      title,
      completedAt: Date.now(),
      totalTokensIn,
      totalTokensOut,
      totalCost,
      totalCalls: this.records.length,
      topAgents,
    };

    this.missionHistory.push(summary);

    // 保留最近 10 次
    if (this.missionHistory.length > 10) {
      this.missionHistory = this.missionHistory.slice(-10);
    }

    // 归档后清空当前 Mission 记录
    this.records = [];
    this.currentMissionId = null;
    this.alerts = [];
    this.downgradeLevel = "none";
    this.pausedAgentIds.clear();

    // TODO(Task 6.1): this.persistHistory();
    this.persistHistory();
  }

  /**
   * 重置当前 Mission 的成本数据。
   * 可选传入新的 missionId 以开始新 Mission。
   */
  resetCurrentMission(missionId?: string): void {
    this.records = [];
    this.alerts = [];
    this.downgradeLevel = "none";
    this.pausedAgentIds.clear();
    this.currentMissionId = missionId ?? null;
  }

  // ---------------------------------------------------------------------------
  // 聚合方法
  // ---------------------------------------------------------------------------

  /**
   * 按 agent_id 聚合成本，返回按 totalCost 降序排列的摘要列表。
   * 没有 agentId 的记录归入 'unknown' Agent。
   */
  getAgentCosts(): AgentCostSummary[] {
    const map = new Map<string, AgentCostSummary>();

    for (const r of this.records) {
      const agentId = r.agentId ?? "unknown";
      let entry = map.get(agentId);
      if (!entry) {
        entry = {
          agentId,
          agentName: agentId,
          tokensIn: 0,
          tokensOut: 0,
          totalCost: 0,
          callCount: 0,
        };
        map.set(agentId, entry);
      }
      entry.tokensIn += r.tokensIn;
      entry.tokensOut += r.tokensOut;
      entry.totalCost += r.actualCost;
      entry.callCount += 1;
    }

    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * 按 session_id 聚合成本。
   * 没有 sessionId 的记录归入 'unknown' Session。
   */
  getSessionCosts(): Map<
    string,
    { tokensIn: number; tokensOut: number; cost: number }
  > {
    const map = new Map<
      string,
      { tokensIn: number; tokensOut: number; cost: number }
    >();

    for (const r of this.records) {
      const sessionId = r.sessionId ?? "unknown";
      let entry = map.get(sessionId);
      if (!entry) {
        entry = { tokensIn: 0, tokensOut: 0, cost: 0 };
        map.set(sessionId, entry);
      }
      entry.tokensIn += r.tokensIn;
      entry.tokensOut += r.tokensOut;
      entry.cost += r.actualCost;
    }

    return map;
  }

  // ---------------------------------------------------------------------------
  // 预算 — 存根，Task 3.1 实现
  // ---------------------------------------------------------------------------

  getBudget(): Budget {
    return { ...this.budget };
  }

  setBudget(budget: Budget): void {
    this.budget = { ...budget };
    this.checkAlerts();
    this.persistHistory();
  }

  // ---------------------------------------------------------------------------
  // 预警检查 — Requirements 4.2, 4.3, 4.4, 4.5
  // ---------------------------------------------------------------------------

  /**
   * 检查当前成本状态并生成预警。
   * 每种预警类型只生成一次（不重复）。
   */
  /**
   * 检查当前成本状态并生成预警。
   * 每种预警类型只生成一次（不重复）。
   * 新预警通过 Socket.IO 立即广播。
   */
  private checkAlerts(): void {
    let totalCost = 0;
    let totalTokens = 0;

    for (const r of this.records) {
      totalCost += r.actualCost;
      totalTokens += r.tokensIn + r.tokensOut;
    }

    const { maxCost, maxTokens, warningThreshold } = this.budget;
    const existingTypes = new Set(this.alerts.map(a => a.type));
    const newAlerts: CostAlert[] = [];

    // cost_warning: totalCost > maxCost * warningThreshold
    if (
      maxCost > 0 &&
      totalCost > maxCost * warningThreshold &&
      !existingTypes.has("cost_warning")
    ) {
      const alert: CostAlert = {
        id: randomUUID(),
        type: "cost_warning",
        message: `费用已超过预警阈值 (${(warningThreshold * 100).toFixed(0)}%): ${totalCost.toFixed(4)} / ${maxCost.toFixed(2)}`,
        timestamp: Date.now(),
        resolved: false,
      };
      this.alerts.push(alert);
      newAlerts.push(alert);
    }

    // token_warning: totalTokens > maxTokens * warningThreshold
    if (
      maxTokens > 0 &&
      totalTokens > maxTokens * warningThreshold &&
      !existingTypes.has("token_warning")
    ) {
      const alert: CostAlert = {
        id: randomUUID(),
        type: "token_warning",
        message: `Token 已超过预警阈值 (${(warningThreshold * 100).toFixed(0)}%): ${totalTokens} / ${maxTokens}`,
        timestamp: Date.now(),
        resolved: false,
      };
      this.alerts.push(alert);
      newAlerts.push(alert);
    }

    // cost_exceeded: totalCost >= maxCost
    if (
      maxCost > 0 &&
      totalCost >= maxCost &&
      !existingTypes.has("cost_exceeded")
    ) {
      const alert: CostAlert = {
        id: randomUUID(),
        type: "cost_exceeded",
        message: `费用已达到上限: ${totalCost.toFixed(4)} / ${maxCost.toFixed(2)}`,
        timestamp: Date.now(),
        resolved: false,
      };
      this.alerts.push(alert);
      newAlerts.push(alert);
    }

    // token_exceeded: totalTokens >= maxTokens
    if (
      maxTokens > 0 &&
      totalTokens >= maxTokens &&
      !existingTypes.has("token_exceeded")
    ) {
      const alert: CostAlert = {
        id: randomUUID(),
        type: "token_exceeded",
        message: `Token 已达到上限: ${totalTokens} / ${maxTokens}`,
        timestamp: Date.now(),
        resolved: false,
      };
      this.alerts.push(alert);
      newAlerts.push(alert);
    }

    // Broadcast new alerts via Socket.IO immediately (Req 7.4)
    if (newAlerts.length > 0) {
      import("./socket.js")
        .then(({ emitCostAlert }) => {
          for (const alert of newAlerts) {
            emitCostAlert(alert);
          }
        })
        .catch(() => {
          // socket module not available — skip
        });
    }

    this.applyDowngrade();
  }

  /** 获取当前预警列表（供测试使用） */
  getAlerts(): readonly CostAlert[] {
    return this.alerts;
  }

  // ---------------------------------------------------------------------------
  // 降级 — Requirements 5.1, 5.2, 5.3, 5.4, 5.5
  // ---------------------------------------------------------------------------

  getDowngradeLevel(): DowngradeLevel {
    return this.downgradeLevel;
  }

  getDowngradePolicy(): DowngradePolicy {
    return {
      ...this.downgradePolicy,
      criticalAgentIds: [...this.downgradePolicy.criticalAgentIds],
    };
  }

  setDowngradePolicy(policy: DowngradePolicy): void {
    this.downgradePolicy = {
      ...policy,
      criticalAgentIds: [...policy.criticalAgentIds],
    };
    this.persistHistory();
  }

  /**
   * 根据降级状态返回实际使用的模型。
   * soft/hard 降级时返回 lowCostModel，否则返回原始模型。
   * @see Requirement 5.2, 5.4
   */
  getEffectiveModel(originalModel: string): string {
    if (
      this.downgradePolicy.enabled &&
      (this.downgradeLevel === "soft" || this.downgradeLevel === "hard")
    ) {
      return this.downgradePolicy.lowCostModel;
    }
    return originalModel;
  }

  /**
   * 检查 Agent 是否被暂停。
   * hard 降级时，不在 criticalAgentIds 白名单中的 Agent 会被暂停。
   * @see Requirement 5.3
   */
  isAgentPaused(agentId: string): boolean {
    return this.pausedAgentIds.has(agentId);
  }

  /**
   * 手动解除降级：恢复原始模型，取消所有 Agent 暂停。
   * @see Requirement 5.4
   */
  manualReleaseDegradation(): void {
    this.downgradeLevel = "none";
    this.pausedAgentIds.clear();
  }

  /**
   * 根据当前预警状态自动触发降级。
   * 在 checkAlerts() 末尾调用。
   *
   * 降级状态机：
   *   none → soft  (费用或Token达到预警阈值)
   *   soft → hard  (费用或Token达到上限)
   *   hard → none  (用户手动解除 / 新Mission开始)
   *
   * @see Requirement 5.1, 5.3
   */
  private applyDowngrade(): void {
    if (!this.downgradePolicy.enabled) {
      return;
    }

    const alertTypes = new Set(this.alerts.map(a => a.type));

    const hasExceeded =
      alertTypes.has("cost_exceeded") || alertTypes.has("token_exceeded");
    const hasWarning =
      alertTypes.has("cost_warning") || alertTypes.has("token_warning");

    if (hasExceeded) {
      this.downgradeLevel = "hard";
      // Pause all non-critical agents
      this.pauseNonCriticalAgents();
    } else if (hasWarning) {
      // Only escalate to soft if not already hard
      if (this.downgradeLevel !== "hard") {
        this.downgradeLevel = "soft";
      }
    }
  }

  /**
   * 暂停所有非关键 Agent。
   * 遍历当前 Mission 的所有记录，收集唯一 agentId，
   * 将不在 criticalAgentIds 白名单中的 Agent 加入暂停集合。
   */
  private pauseNonCriticalAgents(): void {
    const criticalSet = new Set(this.downgradePolicy.criticalAgentIds);
    const allAgentIds = new Set<string>();

    for (const r of this.records) {
      if (r.agentId) {
        allAgentIds.add(r.agentId);
      }
    }

    this.pausedAgentIds.clear();
    Array.from(allAgentIds).forEach(agentId => {
      if (!criticalSet.has(agentId)) {
        this.pausedAgentIds.add(agentId);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 持久化 — 存根，Task 6.1 实现
  // ---------------------------------------------------------------------------

  /**
   * 从 JSON 文件加载历史数据。
   * 文件不存在或损坏时以空历史启动并记录 console.warn。
   * @see Requirement 11.2, 11.3
   */
  loadHistory(): void {
    if (!existsSync(this.historyFilePath)) {
      console.warn(
        `[CostTracker] 持久化文件不存在，以空历史启动: ${this.historyFilePath}`
      );
      return;
    }

    try {
      const raw = readFileSync(this.historyFilePath, "utf-8");
      const parsed = JSON.parse(raw) as CostHistoryFile;

      // Restore missions (keep last 10)
      if (Array.isArray(parsed.missions)) {
        this.missionHistory = parsed.missions.slice(-10);
      }

      // Restore budget if present
      if (
        parsed.budget &&
        typeof parsed.budget.maxCost === "number" &&
        typeof parsed.budget.maxTokens === "number" &&
        typeof parsed.budget.warningThreshold === "number"
      ) {
        this.budget = { ...parsed.budget };
      }

      // Restore downgrade policy if present
      if (
        parsed.downgradePolicy &&
        typeof parsed.downgradePolicy.enabled === "boolean" &&
        typeof parsed.downgradePolicy.lowCostModel === "string" &&
        Array.isArray(parsed.downgradePolicy.criticalAgentIds)
      ) {
        this.downgradePolicy = {
          ...parsed.downgradePolicy,
          criticalAgentIds: [...parsed.downgradePolicy.criticalAgentIds],
        };
      }
    } catch {
      console.warn(
        `[CostTracker] 持久化文件损坏，以空历史启动: ${this.historyFilePath}`
      );
    }
  }

  /**
   * 将历史数据持久化到 JSON 文件。
   * 写入失败时记录 console.error，不影响内存中的指标。
   * @see Requirement 11.1
   */
  private persistHistory(): void {
    const data: CostHistoryFile = {
      version: 1,
      budget: { ...this.budget },
      downgradePolicy: {
        ...this.downgradePolicy,
        criticalAgentIds: [...this.downgradePolicy.criticalAgentIds],
      },
      missions: [...this.missionHistory],
    };

    try {
      mkdirSync(dirname(this.historyFilePath), { recursive: true });
      writeFileSync(
        this.historyFilePath,
        JSON.stringify(data, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.error("[CostTracker] 持久化写入失败:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // 内部访问器（供测试使用）
  // ---------------------------------------------------------------------------

  /** 获取当前 Mission 的原始记录（只读副本） */
  getRecords(): readonly CostRecord[] {
    return this.records;
  }

  /** 获取当前 Mission ID */
  getCurrentMissionId(): string | null {
    return this.currentMissionId;
  }
}

/** 单例导出 */
export const costTracker = new CostTracker();

/** 导出类型供测试使用 */
export { CostTracker };
