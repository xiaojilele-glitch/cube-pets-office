import type { WorkflowOrganizationSnapshot } from "@shared/organization-schema";

/**
 * 演示组织快照 — 手游营销推广方案场景
 *
 * 组织结构：
 * - CEO Gateway（ceo）— 根节点
 *   - Pixel · 游戏部经理（pixel）
 *     - Nova — 游戏策划（nova）
 *     - Blaze — 技术实现（blaze）
 *   - Nexus · AI 部经理（nexus）
 *     - Flux — 模型训练（flux）
 *     - Tensor — 数据工程（tensor）
 */
export const DEMO_ORGANIZATION: WorkflowOrganizationSnapshot = {
  kind: "workflow_organization",
  version: 1,
  workflowId: "demo-workflow-001",
  directive: "设计一个手游营销推广方案",
  generatedAt: "2025-01-01T00:00:00.000Z",
  source: "generated",
  taskProfile: "手游营销推广方案设计",
  reasoning:
    "该任务涉及游戏策划、技术实现、AI 模型训练和数据工程，需要游戏部和 AI 部协同完成。CEO 负责总体协调，两位部门经理分别管理各自团队执行具体任务。",
  rootNodeId: "node-ceo",
  rootAgentId: "ceo",
  departments: [
    {
      id: "dept-game",
      label: "游戏部",
      managerNodeId: "node-pixel",
      direction: "负责手游营销推广方案的策划设计与技术实现",
      strategy: "parallel",
      maxConcurrency: 2,
    },
    {
      id: "dept-ai",
      label: "AI 部",
      managerNodeId: "node-nexus",
      direction: "负责营销推广中的智能推荐模型训练与用户数据工程",
      strategy: "parallel",
      maxConcurrency: 2,
    },
  ],
  nodes: [
    // ── CEO ──
    {
      id: "node-ceo",
      agentId: "ceo",
      parentId: null,
      departmentId: "dept-game",
      departmentLabel: "总部",
      name: "CEO Gateway",
      title: "首席执行官",
      role: "ceo",
      responsibility: "总体协调跨部门方向，将用户指令拆解为可执行的部门目标",
      responsibilities: [
        "分析用户指令并拆解为跨部门方向",
        "协调游戏部与 AI 部的协作",
        "审核最终交付成果并给出反馈",
      ],
      goals: [
        "确保手游营销推广方案覆盖策划、技术和数据三个维度",
        "保证各部门方向明确、可执行、可检查",
      ],
      summaryFocus: ["跨部门协作效果", "整体方案完整性"],
      skills: [],
      mcp: [],
      model: { model: "gpt-4.1-mini", temperature: 0.7, maxTokens: 4096 },
      execution: {
        mode: "orchestrate",
        strategy: "sequential",
        maxConcurrency: 1,
      },
    },
    // ── 游戏部经理 ──
    {
      id: "node-pixel",
      agentId: "pixel",
      parentId: "node-ceo",
      departmentId: "dept-game",
      departmentLabel: "游戏部",
      name: "Pixel · 游戏部经理",
      title: "游戏部经理",
      role: "manager",
      responsibility: "将 CEO 方向拆解为游戏策划和技术实现任务，分配给团队成员",
      responsibilities: [
        "拆解营销推广方案中的策划与技术任务",
        "分配任务给 Nova 和 Blaze",
        "评审团队交付物并给出反馈",
      ],
      goals: [
        "产出可落地的营销活动策划方案",
        "确保技术实现方案可行且成本可控",
      ],
      summaryFocus: ["活动策划质量", "技术方案可行性"],
      skills: [],
      mcp: [],
      model: { model: "gpt-4.1-mini", temperature: 0.7, maxTokens: 4096 },
      execution: {
        mode: "plan",
        strategy: "parallel",
        maxConcurrency: 2,
      },
    },
    // ── 游戏部 Worker: Nova ──
    {
      id: "node-nova",
      agentId: "nova",
      parentId: "node-pixel",
      departmentId: "dept-game",
      departmentLabel: "游戏部",
      name: "Nova",
      title: "游戏策划",
      role: "worker",
      responsibility: "设计手游营销活动的核心玩法、奖励机制和推广节奏",
      responsibilities: [
        "设计营销活动核心玩法和机制",
        "规划活动节奏和奖励结构",
        "分析目标用户动机并设计吸引策略",
      ],
      goals: [
        "产出完整的营销活动策划方案",
        "方案包含具体的活动机制、时间节奏和预期效果",
      ],
      summaryFocus: ["活动创意", "用户吸引力"],
      skills: [],
      mcp: [],
      model: { model: "gpt-4.1-mini", temperature: 0.8, maxTokens: 4096 },
      execution: {
        mode: "execute",
        strategy: "sequential",
        maxConcurrency: 1,
      },
    },
    // ── 游戏部 Worker: Blaze ──
    {
      id: "node-blaze",
      agentId: "blaze",
      parentId: "node-pixel",
      departmentId: "dept-game",
      departmentLabel: "游戏部",
      name: "Blaze",
      title: "技术实现",
      role: "worker",
      responsibility: "设计营销活动的技术架构、实现路径和性能方案",
      responsibilities: [
        "设计营销活动的技术实现方案",
        "评估技术选型和系统架构",
        "分析性能、稳定性和成本风险",
      ],
      goals: [
        "产出可落地的技术实现方案",
        "方案包含技术选型、架构设计和分阶段实施计划",
      ],
      summaryFocus: ["技术可行性", "实施风险"],
      skills: [],
      mcp: [],
      model: { model: "gpt-4.1-mini", temperature: 0.6, maxTokens: 4096 },
      execution: {
        mode: "execute",
        strategy: "sequential",
        maxConcurrency: 1,
      },
    },
    // ── AI 部经理 ──
    {
      id: "node-nexus",
      agentId: "nexus",
      parentId: "node-ceo",
      departmentId: "dept-ai",
      departmentLabel: "AI 部",
      name: "Nexus · AI 部经理",
      title: "AI 部经理",
      role: "manager",
      responsibility: "将 CEO 方向拆解为模型训练和数据工程任务，分配给团队成员",
      responsibilities: [
        "拆解营销推广中的 AI 相关任务",
        "分配任务给 Flux 和 Tensor",
        "评审团队交付物并给出反馈",
      ],
      goals: [
        "产出智能推荐模型的训练方案",
        "确保用户数据工程方案可落地",
      ],
      summaryFocus: ["模型方案质量", "数据工程可行性"],
      skills: [],
      mcp: [],
      model: { model: "gpt-4.1-mini", temperature: 0.7, maxTokens: 4096 },
      execution: {
        mode: "plan",
        strategy: "parallel",
        maxConcurrency: 2,
      },
    },
    // ── AI 部 Worker: Flux ──
    {
      id: "node-flux",
      agentId: "flux",
      parentId: "node-nexus",
      departmentId: "dept-ai",
      departmentLabel: "AI 部",
      name: "Flux",
      title: "模型训练",
      role: "worker",
      responsibility: "设计营销推荐模型的训练策略、评估方法和优化方案",
      responsibilities: [
        "设计用户推荐模型的训练方案",
        "选择合适的模型架构和训练策略",
        "制定模型评估指标和对比基线",
      ],
      goals: [
        "产出完整的推荐模型训练方案",
        "方案包含模型选型、训练策略和效果评估计划",
      ],
      summaryFocus: ["模型选型依据", "训练效果预期"],
      skills: [],
      mcp: [],
      model: { model: "gpt-4.1-mini", temperature: 0.6, maxTokens: 4096 },
      execution: {
        mode: "execute",
        strategy: "sequential",
        maxConcurrency: 1,
      },
    },
    // ── AI 部 Worker: Tensor ──
    {
      id: "node-tensor",
      agentId: "tensor",
      parentId: "node-nexus",
      departmentId: "dept-ai",
      departmentLabel: "AI 部",
      name: "Tensor",
      title: "数据工程",
      role: "worker",
      responsibility: "设计营销数据的采集、清洗和特征工程方案",
      responsibilities: [
        "设计用户行为数据采集方案",
        "规划数据清洗和特征工程流程",
        "建立数据质量检查机制",
      ],
      goals: [
        "产出完整的数据工程方案",
        "方案包含数据来源、处理流程和质量控制措施",
      ],
      summaryFocus: ["数据质量", "流程可复用性"],
      skills: [],
      mcp: [],
      model: { model: "gpt-4.1-mini", temperature: 0.6, maxTokens: 4096 },
      execution: {
        mode: "execute",
        strategy: "sequential",
        maxConcurrency: 1,
      },
    },
  ],
};
