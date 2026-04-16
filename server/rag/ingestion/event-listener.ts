/**
 * RAG EventListener — 平台事件监听
 *
 * 监听 task.completed、mission.finished、code.committed、document.uploaded 事件，
 * 将事件数据转换为 IngestionPayload 并调用 ingestion-pipeline。
 *
 * Requirements: 1.3
 */

import type {
  IngestionPayload,
  SourceType,
} from "../../../shared/rag/contracts.js";
import type { IngestionPipeline } from "./ingestion-pipeline.js";

// ---------------------------------------------------------------------------
// 支持的事件类型
// ---------------------------------------------------------------------------

export const RAG_EVENT_TYPES = [
  "task.completed",
  "mission.finished",
  "code.committed",
  "document.uploaded",
] as const;

export type RAGEventType = (typeof RAG_EVENT_TYPES)[number];

/** 事件类型 → SourceType 映射 */
const EVENT_SOURCE_MAP: Record<RAGEventType, SourceType> = {
  "task.completed": "task_result",
  "mission.finished": "mission_log",
  "code.committed": "code_snippet",
  "document.uploaded": "document",
};

// ---------------------------------------------------------------------------
// 事件数据结构
// ---------------------------------------------------------------------------

export interface RAGEventData {
  /** 事件类型 */
  type: RAGEventType;
  /** 数据 ID */
  id: string;
  /** 项目 ID */
  projectId: string;
  /** 内容 */
  content: string;
  /** 附加元数据 */
  metadata?: Record<string, any>;
  /** Agent ID */
  agentId?: string;
  /** 时间戳 */
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// EventListener
// ---------------------------------------------------------------------------

export class RAGEventListener {
  private pipeline: IngestionPipeline | null = null;
  private enabled = true;

  /** 绑定摄入管道 */
  bind(pipeline: IngestionPipeline): void {
    this.pipeline = pipeline;
  }

  /** 启用/禁用 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 处理平台事件。
   * 将事件数据转换为 IngestionPayload 并调用 pipeline.ingest()。
   */
  async handleEvent(event: RAGEventData): Promise<void> {
    if (!this.enabled || !this.pipeline) return;

    const sourceType = EVENT_SOURCE_MAP[event.type];
    if (!sourceType) return;

    const payload: IngestionPayload = {
      sourceType,
      sourceId: event.id,
      projectId: event.projectId,
      content: event.content,
      metadata: event.metadata ?? {},
      timestamp: event.timestamp ?? new Date().toISOString(),
      agentId: event.agentId,
    };

    await this.pipeline.ingest(payload);
  }

  /**
   * 将平台 AgentEvent 转换为 RAGEventData（如果是支持的事件类型）。
   * 返回 null 表示不是 RAG 关注的事件。
   */
  static toRAGEvent(agentEvent: {
    type: string;
    payload?: Record<string, any>;
  }): RAGEventData | null {
    const type = agentEvent.type as RAGEventType;
    if (!RAG_EVENT_TYPES.includes(type)) return null;

    const p = agentEvent.payload ?? {};
    return {
      type,
      id: p.id ?? p.taskId ?? p.sourceId ?? "",
      projectId: p.projectId ?? "",
      content: p.content ?? p.result ?? p.summary ?? "",
      metadata: p.metadata ?? {},
      agentId: p.agentId,
      timestamp: p.timestamp,
    };
  }
}
