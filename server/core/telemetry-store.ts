/**
 * 服务端遥测存储 — TelemetryStore
 *
 * 在内存中聚合 LLM 调用记录和 Agent 计时数据，提供实时快照、
 * 历史归档、预警检查和 JSON 文件持久化。
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  LLMCallRecord,
  AgentTimingRecord,
  TelemetryAlert,
  TelemetrySnapshot,
  AgentTimingSummary,
  MissionTelemetrySummary,
  TelemetryBudget,
} from "../../shared/telemetry.js";
import { DEFAULT_BUDGET } from "../../shared/telemetry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 每个 Agent 保留的最近计时记录数 */
const AGENT_WINDOW_SIZE = 20;

/** 历史 Mission 最大保留数 */
const MAX_HISTORY = 10;

/** Agent 慢响应阈值（ms） */
const SLOW_AGENT_THRESHOLD_MS = 30_000;

/** 持久化文件路径（相对于项目根目录） */
const HISTORY_FILE = path.resolve("data", "telemetry-history.json");

// ---------------------------------------------------------------------------
// Persistence file shape
// ---------------------------------------------------------------------------

interface PersistedHistory {
  version: number;
  missions: MissionTelemetrySummary[];
}

// ---------------------------------------------------------------------------
// TelemetryStore
// ---------------------------------------------------------------------------

export class TelemetryStore {
  // ---- 内存状态 ----
  private callRecords: LLMCallRecord[] = [];
  private agentTimings: Map<string, AgentTimingRecord[]> = new Map();
  private missionHistory: MissionTelemetrySummary[] = [];
  private alerts: TelemetryAlert[] = [];
  private budget: TelemetryBudget;

  constructor(budget?: TelemetryBudget) {
    this.budget = budget ?? { ...DEFAULT_BUDGET };
    this.loadHistory();
  }

  // -----------------------------------------------------------------------
  // recordLLMCall
  // -----------------------------------------------------------------------

  /**
   * 同步写入一条 LLM 调用记录并更新预警。
   */
  recordLLMCall(record: LLMCallRecord): void {
    this.callRecords.push(record);
    this.checkAlerts();
    this.emitUpdate();
  }

  // -----------------------------------------------------------------------
  // recordAgentTiming
  // -----------------------------------------------------------------------

  /**
   * 写入 Agent 计时记录，维护滑动窗口（最近 20 条）。
   */
  recordAgentTiming(record: AgentTimingRecord): void {
    let window = this.agentTimings.get(record.agentId);
    if (!window) {
      window = [];
      this.agentTimings.set(record.agentId, window);
    }
    window.push(record);
    if (window.length > AGENT_WINDOW_SIZE) {
      window.splice(0, window.length - AGENT_WINDOW_SIZE);
    }
    this.checkAlerts();
    this.emitUpdate();
  }

  // -----------------------------------------------------------------------
  // getSnapshot
  // -----------------------------------------------------------------------

  /**
   * 计算并返回当前 Mission 的实时指标快照。
   */
  getSnapshot(): TelemetrySnapshot {
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCost = 0;
    for (const r of this.callRecords) {
      totalTokensIn += r.tokensIn;
      totalTokensOut += r.tokensOut;
      totalCost += r.cost;
    }

    const agentTimings = this.computeAgentSummaries();

    return {
      totalTokensIn,
      totalTokensOut,
      totalCost,
      totalCalls: this.callRecords.length,
      activeAgentCount: this.agentTimings.size,
      agentTimings,
      missionStageTimings: [], // 阶段耗时由 Mission 运行时填充
      alerts: this.alerts.filter((a) => !a.resolved),
      updatedAt: Date.now(),
    };
  }

  // -----------------------------------------------------------------------
  // getHistory
  // -----------------------------------------------------------------------

  /**
   * 返回历史 Mission 摘要列表（最近 10 次）。
   */
  getHistory(): MissionTelemetrySummary[] {
    return this.missionHistory;
  }

  // -----------------------------------------------------------------------
  // finalizeMission
  // -----------------------------------------------------------------------

  /**
   * 归档当前 Mission 指标到历史，然后重置当前状态。
   */
  finalizeMission(missionId: string, title: string): void {
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCost = 0;
    for (const r of this.callRecords) {
      totalTokensIn += r.tokensIn;
      totalTokensOut += r.tokensOut;
      totalCost += r.cost;
    }

    const topAgents = this.computeAgentSummaries().slice(0, 3);

    const summary: MissionTelemetrySummary = {
      missionId,
      title,
      completedAt: Date.now(),
      totalTokensIn,
      totalTokensOut,
      totalCost,
      totalCalls: this.callRecords.length,
      topAgents,
      stageTimings: [],
    };

    this.missionHistory.push(summary);
    if (this.missionHistory.length > MAX_HISTORY) {
      this.missionHistory.splice(0, this.missionHistory.length - MAX_HISTORY);
    }

    this.persistHistory();
    this.resetCurrentMission();
  }

  // -----------------------------------------------------------------------
  // resetCurrentMission
  // -----------------------------------------------------------------------

  /**
   * 清空当前 Mission 的所有运行时数据。
   */
  resetCurrentMission(): void {
    this.callRecords = [];
    this.agentTimings.clear();
    this.alerts = [];
  }

  // -----------------------------------------------------------------------
  // emitUpdate (private)
  // -----------------------------------------------------------------------

  /**
   * 通过 Socket.IO 广播当前快照。
   * 使用动态 import 避免 telemetry-store ↔ socket 循环依赖。
   */
  private emitUpdate(): void {
    import("./socket.js")
      .then(({ emitTelemetryUpdate }) => {
        emitTelemetryUpdate(this.getSnapshot());
      })
      .catch(() => {
        // Socket not initialized yet, ignore
      });
  }

  // -----------------------------------------------------------------------
  // checkAlerts (private)
  // -----------------------------------------------------------------------

  /**
   * 每次记录后检查预警条件：
   * 1. Agent 滑动窗口平均响应 > 30s → agent_slow
   * 2. 累计 Token 超过 budget × threshold → token_over_budget
   */
  private checkAlerts(): void {
    // --- Agent 慢响应 ---
    this.agentTimings.forEach((records, agentId) => {
      const avg =
        records.reduce((s: number, r) => s + r.durationMs, 0) / records.length;
      const existing = this.alerts.find(
        (a) => a.type === "agent_slow" && a.agentId === agentId && !a.resolved,
      );
      if (avg > SLOW_AGENT_THRESHOLD_MS) {
        if (!existing) {
          this.alerts.push({
            id: randomUUID(),
            type: "agent_slow",
            agentId,
            message: `Agent ${agentId} 平均响应时间 ${Math.round(avg)}ms 超过阈值 ${SLOW_AGENT_THRESHOLD_MS}ms`,
            timestamp: Date.now(),
            resolved: false,
          });
        }
      } else if (existing) {
        existing.resolved = true;
      }
    });

    // --- Token 超预算 ---
    let totalTokens = 0;
    for (const r of this.callRecords) {
      totalTokens += r.tokensIn + r.tokensOut;
    }
    const threshold = this.budget.maxTokens * this.budget.warningThreshold;
    const existingBudget = this.alerts.find(
      (a) => a.type === "token_over_budget" && !a.resolved,
    );
    if (totalTokens > threshold) {
      if (!existingBudget) {
        this.alerts.push({
          id: randomUUID(),
          type: "token_over_budget",
          message: `Token 消耗 ${totalTokens} 超过预算阈值 ${threshold}（${this.budget.warningThreshold * 100}%）`,
          timestamp: Date.now(),
          resolved: false,
        });
      }
    } else if (existingBudget) {
      existingBudget.resolved = true;
    }
  }

  // -----------------------------------------------------------------------
  // persistHistory
  // -----------------------------------------------------------------------

  /**
   * 将历史 Mission 摘要持久化到 JSON 文件。
   */
  persistHistory(): void {
    const data: PersistedHistory = {
      version: 1,
      missions: this.missionHistory,
    };
    try {
      const dir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[TelemetryStore] Failed to persist history:", err);
    }
  }

  // -----------------------------------------------------------------------
  // loadHistory
  // -----------------------------------------------------------------------

  /**
   * 从 JSON 文件加载历史 Mission 摘要。
   * 文件不存在或损坏时以空历史启动并记录警告。
   */
  loadHistory(): void {
    try {
      if (!fs.existsSync(HISTORY_FILE)) {
        return;
      }
      const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
      const parsed: PersistedHistory = JSON.parse(raw);
      if (parsed.version === 1 && Array.isArray(parsed.missions)) {
        this.missionHistory = parsed.missions.slice(-MAX_HISTORY);
      } else {
        console.warn(
          "[TelemetryStore] Unknown history file version, starting with empty history",
        );
        this.missionHistory = [];
      }
    } catch (err) {
      console.warn(
        "[TelemetryStore] Failed to load history, starting with empty history:",
        err,
      );
      this.missionHistory = [];
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * 计算所有 Agent 的响应时间摘要，按 avgDurationMs 降序排列。
   */
  private computeAgentSummaries(): AgentTimingSummary[] {
    const summaries: AgentTimingSummary[] = [];
    this.agentTimings.forEach((records, agentId) => {
      if (records.length === 0) return;
      const avg =
        records.reduce((s: number, r) => s + r.durationMs, 0) / records.length;
      summaries.push({
        agentId,
        agentName: records[records.length - 1].agentName,
        avgDurationMs: avg,
        callCount: records.length,
      });
    });
    summaries.sort((a, b) => b.avgDurationMs - a.avgDurationMs);
    return summaries;
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

export const telemetryStore = new TelemetryStore();
