/*
 * @Author: wangchunji
 * @Date: 2026-04-01 10:14:21
 * @Description: 
 * @LastEditTime: 2026-04-01 10:25:10
 * @LastEditors: wangchunji
 */
/**
 * Demo Data Engine 契约
 *
 * 定义预录演示数据包的完整 schema。
 * demo-guided-experience 消费此 schema 驱动回放引擎。
 * 所有字段复用现有 shared/ 类型，不引入新的数据结构。
 */

import type {
  AgentRecord,
  AgentEvent,
  MessageRecord,
  TaskRecord,
  WorkflowRecord,
  WorkflowStage,
  FinalWorkflowReportRecord,
} from "../workflow-runtime.js";
import type {
  WorkflowOrganizationSnapshot,
} from "../organization-schema.js";

// ---------------------------------------------------------------------------
// 时间线事件：回放引擎按此顺序触发 UI 更新
// ---------------------------------------------------------------------------

export interface DemoTimelineEntry {
  /** 相对于工作流开始的毫秒偏移 */
  offsetMs: number;
  /** 复用现有 AgentEvent 联合类型 */
  event: AgentEvent;
}

// ---------------------------------------------------------------------------
// 进化快照：展示 SOUL.md 补丁和能力注册
// ---------------------------------------------------------------------------

export interface DemoEvolutionPatch {
  agentId: string;
  agentName: string;
  dimension: string;
  oldScore: number;
  newScore: number;
  patchContent: string;
}

export interface DemoCapabilityEntry {
  agentId: string;
  agentName: string;
  capability: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// 演示数据包：一个完整的工作流执行快照
// ---------------------------------------------------------------------------

export interface DemoDataBundle {
  /** schema 版本，用于未来兼容 */
  version: 1;

  /** 数据包元信息 */
  meta: {
    /** 数据包唯一 ID */
    id: string;
    /** 演示标题（如"制定本季度用户增长策略"） */
    title: string;
    /** 演示描述 */
    description: string;
    /** 数据包创建时间 ISO */
    createdAt: string;
    /** 预估回放总时长（毫秒），用于进度条 */
    totalDurationMs: number;
    /** 语言 */
    locale: "zh-CN" | "en-US";
  };

  /** 工作流记录快照 */
  workflow: WorkflowRecord;

  /** 动态组织快照 */
  organization: WorkflowOrganizationSnapshot;

  /** 参与的智能体列表 */
  agents: AgentRecord[];

  /** 所有任务记录（含评分、交付物、修订） */
  tasks: TaskRecord[];

  /** 所有消息记录 */
  messages: MessageRecord[];

  /** 时间线事件序列（回放引擎的核心输入） */
  timeline: DemoTimelineEntry[];

  /** 最终报告快照 */
  finalReport: FinalWorkflowReportRecord;

  /** 进化补丁列表 */
  evolutionPatches: DemoEvolutionPatch[];

  /** 能力注册列表 */
  capabilities: DemoCapabilityEntry[];
}

// ---------------------------------------------------------------------------
// 回放控制
// ---------------------------------------------------------------------------

export type DemoPlaybackSpeed = 1 | 2 | 5 | 10;

export interface DemoPlaybackState {
  /** 当前是否正在回放 */
  playing: boolean;
  /** 当前回放速度 */
  speed: DemoPlaybackSpeed;
  /** 当前回放位置（毫秒偏移） */
  currentOffsetMs: number;
  /** 当前阶段 */
  currentStage: WorkflowStage | null;
  /** 是否已回放完成 */
  finished: boolean;
}

// ---------------------------------------------------------------------------
// 导出索引
// ---------------------------------------------------------------------------

export type { AgentEvent, WorkflowStage } from "../workflow-runtime.js";
