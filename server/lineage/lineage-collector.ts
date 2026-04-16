/**
 * 血缘采集器 (LineageCollector)
 *
 * 核心设计原则：异步采集、不阻塞业务逻辑、失败降级。
 *
 * 采集流程：
 * 1. 调用方调用 recordSource / recordTransformation / recordDecision
 * 2. 生成 DataLineageNode，写入内存缓冲区，立即返回 lineageId
 * 3. 缓冲区满或定时器触发时，批量写入存储
 * 4. 任何异常被 catch 并记录日志，不影响调用方
 */

import crypto from "node:crypto";
import type {
  DataLineageNode,
  ChangeAlert,
  RecordSourceInput,
  RecordTransformationInput,
  RecordDecisionInput,
} from "../../shared/lineage/contracts.js";
import type { LineageStorageAdapter } from "./lineage-store.js";

// ─── Logger（调试日志，可替换） ─────────────────────────────────────────────

export interface LineageLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const defaultLogger: LineageLogger = {
  debug() {},
  warn() {},
  error() {},
};

// ─── 采集器选项 ────────────────────────────────────────────────────────────

export interface LineageCollectorOptions {
  logger?: LineageLogger;
  onNodeCreated?: (node: DataLineageNode) => void;
  onAlertTriggered?: (alert: ChangeAlert) => void;
}

// ─── LineageCollector ──────────────────────────────────────────────────────

export class LineageCollector {
  private buffer: DataLineageNode[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs = 1000;
  private readonly maxBufferSize = 100;
  private readonly logger: LineageLogger;
  private readonly onNodeCreated?: (node: DataLineageNode) => void;
  private readonly onAlertTriggered?: (alert: ChangeAlert) => void;

  constructor(
    private store: LineageStorageAdapter,
    loggerOrOptions?: LineageLogger | LineageCollectorOptions
  ) {
    if (loggerOrOptions && "debug" in loggerOrOptions) {
      // Legacy: plain logger argument
      this.logger = loggerOrOptions;
    } else if (loggerOrOptions) {
      this.logger = loggerOrOptions.logger ?? defaultLogger;
      this.onNodeCreated = loggerOrOptions.onNodeCreated;
      this.onAlertTriggered = loggerOrOptions.onAlertTriggered;
    } else {
      this.logger = defaultLogger;
    }
  }

  // ─── 3.2 recordSource (AC-1.1 ~ AC-1.5) ──────────────────────────────

  /**
   * 记录数据源血缘。
   * 生成 DataLineageNode (type: "source")，写入缓冲区，立即返回 lineageId。
   * 包含 SHA256 哈希计算和调试日志。
   */
  recordSource(input: RecordSourceInput): string {
    try {
      const lineageId = crypto.randomUUID();
      const timestamp = Date.now();

      const node: DataLineageNode = {
        lineageId,
        type: "source",
        timestamp,
        context: input.context ?? {},
        sourceId: input.sourceId,
        sourceName: input.sourceName,
        queryText: input.queryText,
        resultHash: input.resultHash,
        resultSize: input.resultSize,
        metadata: input.metadata,
        complianceTags: input.complianceTags,
      };

      // AC-1.5: 调试日志
      this.logger.debug("recordSource", {
        lineageId,
        sourceId: input.sourceId,
        query: input.queryText,
        resultSize: input.resultSize,
      });

      this.addToBuffer(node);
      return lineageId;
    } catch (err) {
      this.logger.error("recordSource failed", { error: String(err) });
      // 降级：返回一个 UUID 但不记录节点
      return crypto.randomUUID();
    }
  }

  // ─── 3.3 recordTransformation (AC-2.1 ~ AC-2.6) ──────────────────────

  /**
   * 记录 Agent 变换血缘。
   * 包含堆栈跟踪捕获和 dataChanged 检测。
   */
  recordTransformation(input: RecordTransformationInput): string {
    try {
      const lineageId = crypto.randomUUID();
      const timestamp = Date.now();

      // AC-2.2: 自动捕获代码位置
      const codeLocation = LineageCollector.captureCodeLocation(3);

      const node: DataLineageNode = {
        lineageId,
        type: "transformation",
        timestamp,
        context: input.context ?? {},
        agentId: input.agentId,
        operation: input.operation,
        codeLocation,
        parameters: input.parameters,
        inputLineageIds: input.inputLineageIds,
        outputLineageId: lineageId,
        dataChanged: input.dataChanged,
        executionTimeMs: input.executionTimeMs,
        upstream: input.inputLineageIds,
        metadata: input.metadata,
        complianceTags: input.complianceTags,
      };

      this.logger.debug("recordTransformation", {
        lineageId,
        agentId: input.agentId,
        operation: input.operation,
        codeLocation,
        inputCount: input.inputLineageIds.length,
        dataChanged: input.dataChanged,
      });

      this.addToBuffer(node);
      return lineageId;
    } catch (err) {
      this.logger.error("recordTransformation failed", { error: String(err) });
      return crypto.randomUUID();
    }
  }

  // ─── 3.4 recordDecision (AC-3.1 ~ AC-3.5) ───────────────────────────

  /**
   * 记录决策血缘。
   * 包含决策上下文和置信度记录。
   */
  recordDecision(input: RecordDecisionInput): string {
    try {
      const lineageId = crypto.randomUUID();
      const timestamp = Date.now();

      const node: DataLineageNode = {
        lineageId,
        type: "decision",
        timestamp,
        context: input.context ?? {},
        decisionId: input.decisionId,
        agentId: input.agentId,
        inputLineageIds: input.inputLineageIds,
        decisionLogic: input.decisionLogic,
        result: input.result,
        confidence: input.confidence,
        modelVersion: input.modelVersion,
        upstream: input.inputLineageIds,
        metadata: input.metadata,
        complianceTags: input.complianceTags,
      };

      this.logger.debug("recordDecision", {
        lineageId,
        decisionId: input.decisionId,
        agentId: input.agentId,
        confidence: input.confidence,
        modelVersion: input.modelVersion,
        result: input.result,
      });

      this.addToBuffer(node);
      return lineageId;
    } catch (err) {
      this.logger.error("recordDecision failed", { error: String(err) });
      return crypto.randomUUID();
    }
  }

  // ─── 缓冲区管理 ──────────────────────────────────────────────────────

  /** 将节点加入缓冲区，满时触发刷写 */
  private addToBuffer(node: DataLineageNode): void {
    this.buffer.push(node);

    // Socket 广播：通知新节点创建
    if (this.onNodeCreated) {
      try {
        this.onNodeCreated(node);
      } catch {
        // 广播失败不影响采集
      }
    }

    // 启动定时器（如果尚未启动）
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, this.flushIntervalMs);
    }

    // 缓冲区满时立即刷写
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  /** 触发告警广播（供外部变更检测服务调用） */
  emitAlert(alert: ChangeAlert): void {
    if (this.onAlertTriggered) {
      try {
        this.onAlertTriggered(alert);
      } catch {
        // 广播失败不影响业务
      }
    }
  }

  /** 异步刷写缓冲区到存储 */
  private async flush(): Promise<void> {
    // 清除定时器
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0) return;

    // 取出当前缓冲区内容
    const nodes = this.buffer.splice(0);

    try {
      await this.store.batchInsertNodes(nodes);
      this.logger.debug("flush completed", { count: nodes.length });
    } catch (err) {
      // 降级：记录日志但不抛出
      this.logger.error("flush failed", {
        error: String(err),
        droppedCount: nodes.length,
      });
    }
  }

  /** 手动触发刷写（用于测试和优雅关闭） */
  async forceFlush(): Promise<void> {
    await this.flush();
  }

  /** 销毁采集器，清理定时器 */
  destroy(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ─── 3.5 静态工具方法 ────────────────────────────────────────────────

  /**
   * 计算 SHA256 哈希。
   * 对 JSON.stringify(data) 的结果计算 SHA256，返回十六进制字符串。
   */
  static computeHash(data: unknown): string {
    const json = JSON.stringify(data);
    return crypto.createHash("sha256").update(json).digest("hex");
  }

  /**
   * 捕获调用位置。
   * 解析 Error().stack 获取 "filename:line" 格式的代码位置。
   * @param stackDepth 堆栈深度，默认 2（跳过 captureCodeLocation 自身和调用方）
   */
  static captureCodeLocation(stackDepth: number = 2): string {
    const err = new Error();
    const stack = err.stack;
    if (!stack) return "unknown:0";

    const lines = stack.split("\n");
    // lines[0] = "Error", lines[1] = captureCodeLocation, lines[2+] = caller
    const targetLine = lines[stackDepth] ?? lines[lines.length - 1];
    if (!targetLine) return "unknown:0";

    // 匹配常见格式：
    // "    at functionName (filename:line:col)"
    // "    at filename:line:col"
    // "    at functionName (file:///C:/path/file.ts:line:col)"
    // "    at file:///C:/path/file.ts:line:col"
    const match =
      targetLine.match(/\((?:file:\/\/\/)?(.+):(\d+):\d+\)/) ??
      targetLine.match(/at\s+(?:file:\/\/\/)?([^:\s]+(?::[^:\s]+)*):(\d+):\d+/);

    if (match) {
      const rawPath = match[1];
      // Extract just the filename from the path
      const filename = rawPath.replace(/\\/g, "/").split("/").pop() ?? rawPath;
      return `${filename}:${match[2]}`;
    }

    return "unknown:0";
  }
}
