import type {
  AgentRecord,
  WorkflowRecord,
  MessageRecord,
  TaskRecord,
  AgentEvent,
} from "@shared/workflow-runtime";
import type { WorkflowOrganizationSnapshot } from "@shared/organization-schema";

/** 记忆条目类型 */
export type MemoryEntryKind = "short_term" | "medium_term" | "long_term";

/** 记忆条目 */
export interface DemoMemoryEntry {
  agentId: string;
  kind: MemoryEntryKind;
  stage: string;
  content: string;
  /** 相对于演示开始时间的毫秒偏移 */
  timestampOffset: number;
}

/** 进化日志条目 */
export interface DemoEvolutionLog {
  agentId: string;
  dimension: string;
  oldScore: number;
  newScore: number;
  patchContent: string;
  applied: boolean;
}

/** 带时间戳偏移的事件 */
export interface DemoTimedEvent {
  /** 相对于演示开始时间的毫秒偏移 */
  timestampOffset: number;
  event: AgentEvent;
}

/** 演示数据包完整类型 */
export interface DemoDataBundle {
  /** 数据包版本标识 */
  version: 1;
  /** 演示场景名称 */
  scenarioName: string;
  /** 演示场景描述 */
  scenarioDescription: string;
  /** 组织快照 */
  organization: WorkflowOrganizationSnapshot;
  /** 工作流记录 */
  workflow: WorkflowRecord;
  /** 智能体记录列表 */
  agents: AgentRecord[];
  /** 消息记录列表 */
  messages: MessageRecord[];
  /** 任务记录列表 */
  tasks: TaskRecord[];
  /** 记忆条目列表 */
  memoryEntries: DemoMemoryEntry[];
  /** 进化日志列表 */
  evolutionLogs: DemoEvolutionLog[];
  /** 带时间戳的事件序列 */
  events: DemoTimedEvent[];
}
