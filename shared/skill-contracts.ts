/**
 * Plugin / Skill 体系 — 共享类型契约
 *
 * 本文件定义 Skill 注册、绑定、监控、审计、上下文隔离等全部类型接口。
 * 与现有 WorkflowSkillBinding（organization-schema.ts）保持兼容，
 * 并扩展 C08 Skill 注册制契约（shared/skill/contracts.ts）的能力。
 *
 * 兼容性说明：
 * - SkillDefinition 是 WorkflowSkillBinding 的超集（包含 id/name/summary/prompt）
 * - SkillBinding.resolvedSkill 可投影为 WorkflowSkillBinding
 * - WorkflowMcpBinding 直接复用 organization-schema.ts 中的定义
 */

import type { WorkflowMcpBinding } from "./organization-schema.js";

// ---------------------------------------------------------------------------
// Skill 定义（注册输入）
// ---------------------------------------------------------------------------

/**
 * Skill 注册时的输入定义。
 * 包含 WorkflowSkillBinding 的所有字段（id/name/summary/prompt），
 * 并扩展 version、category、tags、requiredMcp、dependencies 等字段。
 */
export interface SkillDefinition {
  /** 全局唯一标识符，如 "code-review" */
  id: string;
  /** 可读名称 */
  name: string;
  /** 分类：code | data | security | analysis 等 */
  category: string;
  /** 功能描述 */
  summary: string;
  /** 核心 prompt 模板，包含 {context}、{input} 占位符 */
  prompt: string;
  /** 依赖的 MCP 工具 ID 列表 */
  requiredMcp: string[];
  /** 语义化版本号，如 "1.0.0" */
  version: string;
  /** 标签集合 */
  tags: string[];
  /** 依赖的其他 Skill ID */
  dependencies?: string[];
}

// ---------------------------------------------------------------------------
// Skill 持久化记录
// ---------------------------------------------------------------------------

/** 灰度发布配置 */
export interface CanaryConfig {
  /** 是否启用灰度 */
  enabled: boolean;
  /** 流量百分比 0-100 */
  percentage: number;
  /** 灰度目标版本 */
  targetVersion: string;
}

/**
 * 持久化的 Skill 记录，扩展 SkillDefinition 增加运行时状态。
 */
export interface SkillRecord extends SkillDefinition {
  /** 是否启用 */
  enabled: boolean;
  /** 灰度发布配置 */
  canary?: CanaryConfig;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 更新时间 ISO 8601 */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Skill 运行时绑定
// ---------------------------------------------------------------------------

/** Skill 绑定配置覆盖 */
export interface SkillBindingConfig {
  temperature?: number;
  maxTokens?: number;
  /** 优先级，用于激活排序 */
  priority?: number;
}

/**
 * Skill 与 Agent 节点的运行时绑定关系。
 * 包含解析后的 Skill 定义、MCP 绑定、配置覆盖和启用状态。
 */
export interface SkillBinding {
  skillId: string;
  version: string;
  resolvedSkill: SkillRecord;
  mcpBindings: WorkflowMcpBinding[];
  config?: SkillBindingConfig;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Skill 执行性能指标
// ---------------------------------------------------------------------------

/** Skill 执行性能数据 */
export interface SkillExecutionMetrics {
  skillId: string;
  version: string;
  workflowId: string;
  agentId: string;
  agentRole: string;
  taskType: string;
  /** 激活耗时（毫秒） */
  activationTimeMs: number;
  /** 执行耗时（毫秒） */
  executionTimeMs: number;
  /** token 消耗 */
  tokenCount: number;
  /** 是否成功 */
  success: boolean;
  /** ISO 8601 时间戳 */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Skill 审计日志
// ---------------------------------------------------------------------------

/** 审计日志记录 */
export interface SkillAuditLog {
  id: number;
  skillId: string;
  version: string;
  action: "enable" | "disable" | "register" | "version_switch";
  operator: string;
  reason: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Skill 上下文隔离
// ---------------------------------------------------------------------------

/** 副作用记录 */
export interface SideEffect {
  type: "file_write" | "db_operation" | "api_call";
  description: string;
  timestamp: string;
  reversible: boolean;
}

/** Skill 独立执行上下文，确保 Skill 之间状态隔离 */
export interface SkillContext {
  skillId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  state: Record<string, unknown>;
  sideEffects: SideEffect[];
}

// ---------------------------------------------------------------------------
// SkillActivator 输出
// ---------------------------------------------------------------------------

/** 激活后的 Skill，包含替换占位符后的 prompt */
export interface ActivatedSkill {
  skillId: string;
  version: string;
  name: string;
  /** 替换占位符后的最终 prompt */
  resolvedPrompt: string;
  /** 优先级 */
  priority: number;
  mcpBindings: WorkflowMcpBinding[];
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** 循环依赖错误，包含循环路径信息 */
export class CircularDependencyError extends Error {
  public readonly cyclePath: string[];

  constructor(cyclePath: string[]) {
    super(`Circular dependency detected: ${cyclePath.join(" → ")}`);
    this.name = "CircularDependencyError";
    this.cyclePath = cyclePath;
  }
}

// ---------------------------------------------------------------------------
// 查询与过滤
// ---------------------------------------------------------------------------

/** Skill 查询过滤条件 */
export interface SkillQueryFilter {
  category?: string;
  tags?: string[];
  enabled?: boolean;
}

/** Skill 解析选项 */
export interface ResolveOptions {
  /** 指定版本映射 skillId → version */
  versionMap?: Record<string, string>;
  /** 是否包含禁用的 Skill（默认 false） */
  includeDisabled?: boolean;
}

// ---------------------------------------------------------------------------
// 监控与告警
// ---------------------------------------------------------------------------

/** 时间范围 */
export interface TimeRange {
  start: string;
  end: string;
}

/** 聚合后的性能指标 */
export interface AggregatedMetrics {
  skillId: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgActivationTimeMs: number;
  avgExecutionTimeMs: number;
  totalTokenCount: number;
  successRate: number;
  /** 按维度分组的统计 */
  byVersion?: Record<string, { count: number; successRate: number }>;
  byAgentRole?: Record<string, { count: number; successRate: number }>;
  byTaskType?: Record<string, { count: number; successRate: number }>;
}

/** 告警结果 */
export interface AlertResult {
  skillId: string;
  alertType: "high_failure_rate";
  currentRate: number;
  threshold: number;
  message: string;
  timestamp: string;
}
