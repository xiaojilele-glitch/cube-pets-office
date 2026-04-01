import type { AgentRecord } from "@shared/workflow-runtime";

/**
 * 演示智能体记录 — 7 个角色（1 CEO、2 Manager、4 Worker）
 *
 * 数据来源：server/db/seed.ts 中对应的 agent 定义
 * soul_md 为简短摘要版本，非完整 seed 文本
 */

const TS = "2025-01-01T00:00:00.000Z";

export const DEMO_AGENTS: AgentRecord[] = [
  {
    id: "ceo",
    name: "CEO Gateway",
    department: "meta",
    role: "ceo",
    manager_id: null,
    model: "gpt-4.1-mini",
    soul_md: "组织最高协调者，负责将用户指令拆解为跨部门可执行方向。",
    heartbeat_config: null,
    is_active: 1,
    created_at: TS,
    updated_at: TS,
  },
  {
    id: "pixel",
    name: "Pixel · 游戏部经理",
    department: "game",
    role: "manager",
    manager_id: "ceo",
    model: "gpt-4.1-mini",
    soul_md: "游戏部经理，负责将 CEO 方向拆解为策划和技术任务并分配给团队。",
    heartbeat_config: null,
    is_active: 1,
    created_at: TS,
    updated_at: TS,
  },
  {
    id: "nexus",
    name: "Nexus · AI 部经理",
    department: "ai",
    role: "manager",
    manager_id: "ceo",
    model: "gpt-4.1-mini",
    soul_md: "AI 部经理，负责将部门方向拆解为模型、数据和算法层面的执行任务。",
    heartbeat_config: null,
    is_active: 1,
    created_at: TS,
    updated_at: TS,
  },
  {
    id: "nova",
    name: "Nova",
    department: "game",
    role: "worker",
    manager_id: "pixel",
    model: "gpt-4.1-mini",
    soul_md: "游戏策划专家，擅长玩法包装、活动方案设计和用户动机分析。",
    heartbeat_config: null,
    is_active: 1,
    created_at: TS,
    updated_at: TS,
  },
  {
    id: "blaze",
    name: "Blaze",
    department: "game",
    role: "worker",
    manager_id: "pixel",
    model: "gpt-4.1-mini",
    soul_md: "技术架构专家，擅长技术选型、实现方案和性能优化。",
    heartbeat_config: null,
    is_active: 1,
    created_at: TS,
    updated_at: TS,
  },
  {
    id: "flux",
    name: "Flux",
    department: "ai",
    role: "worker",
    manager_id: "nexus",
    model: "gpt-4.1-mini",
    soul_md: "模型训练专家，擅长模型选择、训练策略和推理优化。",
    heartbeat_config: null,
    is_active: 1,
    created_at: TS,
    updated_at: TS,
  },
  {
    id: "tensor",
    name: "Tensor",
    department: "ai",
    role: "worker",
    manager_id: "nexus",
    model: "gpt-4.1-mini",
    soul_md: "数据工程专家，擅长数据采集、特征处理和数据质量建设。",
    heartbeat_config: null,
    is_active: 1,
    created_at: TS,
    updated_at: TS,
  },
];
