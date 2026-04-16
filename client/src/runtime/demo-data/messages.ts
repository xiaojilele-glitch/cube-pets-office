import type { MessageRecord } from "@shared/workflow-runtime";

/**
 * 演示消息记录 — 手游营销推广方案场景
 *
 * 共 21 条消息，覆盖五种流转模式：
 * 1. CEO → Manager（direction 阶段方向下发）
 * 2. Manager → Worker（planning 阶段任务分配）
 * 3. Worker → Manager（execution 阶段交付提交）
 * 4. Manager → Worker（review 阶段评审反馈）
 * 5. Manager → CEO（summary 阶段汇总报告）
 */

const WF = "demo-workflow-001";

export const DEMO_MESSAGES: MessageRecord[] = [
  // ── direction 阶段：CEO → Manager 方向下发 ──
  {
    id: 1,
    workflow_id: WF,
    from_agent: "ceo",
    to_agent: "pixel",
    stage: "direction",
    content:
      "请游戏部围绕'手游营销推广方案'展开工作，重点覆盖玩法包装、社交裂变和技术落地三个维度。",
    metadata: null,
    created_at: "2025-01-01T00:00:01.000Z",
  },
  {
    id: 2,
    workflow_id: WF,
    from_agent: "ceo",
    to_agent: "nexus",
    stage: "direction",
    content:
      "请 AI 部配合手游营销推广方案，提供用户画像建模、智能推荐算法和数据埋点方案。",
    metadata: null,
    created_at: "2025-01-01T00:00:02.000Z",
  },

  // ── planning 阶段：Manager → Worker 任务分配 ──
  {
    id: 3,
    workflow_id: WF,
    from_agent: "pixel",
    to_agent: "nova",
    stage: "planning",
    content:
      "Nova，请你负责策划一套手游营销活动方案，包括限时活动、社交分享激励和新手引导优化。产出完整策划文档。",
    metadata: null,
    created_at: "2025-01-01T00:00:03.000Z",
  },
  {
    id: 4,
    workflow_id: WF,
    from_agent: "pixel",
    to_agent: "blaze",
    stage: "planning",
    content:
      "Blaze，请你设计营销活动的技术实现方案，涵盖活动配置系统、A/B 测试框架和推送通知架构。",
    metadata: null,
    created_at: "2025-01-01T00:00:04.000Z",
  },
  {
    id: 5,
    workflow_id: WF,
    from_agent: "nexus",
    to_agent: "flux",
    stage: "planning",
    content:
      "Flux，请设计用户行为预测模型方案，用于识别高价值玩家和流失风险用户，输出模型选型和训练策略文档。",
    metadata: null,
    created_at: "2025-01-01T00:00:05.000Z",
  },
  {
    id: 6,
    workflow_id: WF,
    from_agent: "nexus",
    to_agent: "tensor",
    stage: "planning",
    content:
      "Tensor，请设计营销数据采集与分析管道，包括用户行为埋点方案、实时数据流处理和效果归因分析。",
    metadata: null,
    created_at: "2025-01-01T00:00:06.000Z",
  },

  // ── execution 阶段：Worker → Manager 交付提交 ──
  {
    id: 7,
    workflow_id: WF,
    from_agent: "nova",
    to_agent: "pixel",
    stage: "execution",
    content:
      "策划方案已完成。核心亮点：1）首周登录送限定皮肤引导留存；2）组队通关奖励驱动社交裂变；3）赛季排行榜激发竞争消费。预计首月 DAU 提升 15%。",
    metadata: { deliverable_version: 1 },
    created_at: "2025-01-01T00:00:07.000Z",
  },
  {
    id: 8,
    workflow_id: WF,
    from_agent: "blaze",
    to_agent: "pixel",
    stage: "execution",
    content:
      "技术方案已交付。采用配置化活动引擎 + Feature Flag 灰度发布，A/B 测试框架支持多维度分桶，推送系统基于用户活跃时段智能调度。",
    metadata: { deliverable_version: 1 },
    created_at: "2025-01-01T00:00:08.000Z",
  },
  {
    id: 9,
    workflow_id: WF,
    from_agent: "flux",
    to_agent: "nexus",
    stage: "execution",
    content:
      "用户行为预测模型方案完成。选用 LightGBM 做流失预警，XGBoost 做付费倾向预测，线上推理延迟 < 50ms。训练数据需近 90 天用户行为日志。",
    metadata: { deliverable_version: 1 },
    created_at: "2025-01-01T00:00:09.000Z",
  },
  {
    id: 10,
    workflow_id: WF,
    from_agent: "tensor",
    to_agent: "nexus",
    stage: "execution",
    content:
      "数据管道方案已提交。埋点覆盖 42 个关键事件，Kafka 实时流处理，ClickHouse 存储分析，归因模型采用多触点加权。",
    metadata: { deliverable_version: 1 },
    created_at: "2025-01-01T00:00:10.000Z",
  },

  // ── review 阶段：Manager → Worker 评审反馈 ──
  {
    id: 11,
    workflow_id: WF,
    from_agent: "pixel",
    to_agent: "nova",
    stage: "review",
    content:
      "策划方案整体优秀，社交裂变设计有亮点。建议补充：1）预算分配明细；2）不同渠道的 ROI 预估；3）风险预案（如薅羊毛防控）。评分：准确性 8，完整性 7，可执行性 8，格式 9。",
    metadata: {
      scores: { accuracy: 8, completeness: 7, actionability: 8, format: 9 },
    },
    created_at: "2025-01-01T00:00:12.000Z",
  },
  {
    id: 12,
    workflow_id: WF,
    from_agent: "pixel",
    to_agent: "blaze",
    stage: "review",
    content:
      "技术方案架构清晰，A/B 测试设计合理。需补充：1）活动配置热更新机制；2）高并发场景下的降级策略；3）数据一致性保障方案。评分：准确性 9，完整性 7，可执行性 8，格式 8。",
    metadata: {
      scores: { accuracy: 9, completeness: 7, actionability: 8, format: 8 },
    },
    created_at: "2025-01-01T00:00:13.000Z",
  },
  {
    id: 13,
    workflow_id: WF,
    from_agent: "nexus",
    to_agent: "flux",
    stage: "review",
    content:
      "模型方案技术选型合理，延迟指标达标。建议增加：1）冷启动用户的处理策略；2）模型可解释性方案；3）A/B 测试上线计划。评分：准确性 9，完整性 8，可执行性 7，格式 8。",
    metadata: {
      scores: { accuracy: 9, completeness: 8, actionability: 7, format: 8 },
    },
    created_at: "2025-01-01T00:00:14.000Z",
  },
  {
    id: 14,
    workflow_id: WF,
    from_agent: "nexus",
    to_agent: "tensor",
    stage: "review",
    content:
      "数据管道设计全面，埋点覆盖充分。需完善：1）数据质量监控告警；2）GDPR 合规的数据脱敏方案；3）历史数据回填策略。评分：准确性 8，完整性 8，可执行性 8，格式 9。",
    metadata: {
      scores: { accuracy: 8, completeness: 8, actionability: 8, format: 9 },
    },
    created_at: "2025-01-01T00:00:15.000Z",
  },

  // ── revision 阶段：Worker → Manager 修订提交 ──
  {
    id: 15,
    workflow_id: WF,
    from_agent: "nova",
    to_agent: "pixel",
    stage: "revision",
    content:
      "已补充预算分配表和渠道 ROI 预估。新增薅羊毛防控：设备指纹 + 行为频次限制 + 人工审核兜底。修订版策划文档已更新。",
    metadata: { deliverable_version: 2 },
    created_at: "2025-01-01T00:00:19.000Z",
  },
  {
    id: 16,
    workflow_id: WF,
    from_agent: "blaze",
    to_agent: "pixel",
    stage: "revision",
    content:
      "已补充热更新机制（基于远程配置中心）、高并发降级策略（本地缓存 + 限流熔断）和分布式锁保障数据一致性。",
    metadata: { deliverable_version: 2 },
    created_at: "2025-01-01T00:00:19.500Z",
  },

  // ── verify 阶段：Manager → Worker 验证确认 ──
  {
    id: 17,
    workflow_id: WF,
    from_agent: "pixel",
    to_agent: "nova",
    stage: "verify",
    content: "修订版策划方案验证通过，预算和风控补充到位，可进入汇总阶段。",
    metadata: null,
    created_at: "2025-01-01T00:00:22.000Z",
  },
  {
    id: 18,
    workflow_id: WF,
    from_agent: "nexus",
    to_agent: "flux",
    stage: "verify",
    content: "模型方案修订版验证通过，冷启动策略和可解释性方案补充完整。",
    metadata: null,
    created_at: "2025-01-01T00:00:22.500Z",
  },

  // ── summary 阶段：Manager → CEO 汇总报告 ──
  {
    id: 19,
    workflow_id: WF,
    from_agent: "pixel",
    to_agent: "ceo",
    stage: "summary",
    content:
      "游戏部汇总：手游营销推广方案包含策划方案（活动体系 + 社交裂变 + 竞争机制）和技术方案（配置化引擎 + A/B 测试 + 智能推送）。团队平均评分 8.1/10，所有修订已验证通过。",
    metadata: { department: "game", avg_score: 8.1 },
    created_at: "2025-01-01T00:00:24.000Z",
  },
  {
    id: 20,
    workflow_id: WF,
    from_agent: "nexus",
    to_agent: "ceo",
    stage: "summary",
    content:
      "AI 部汇总：完成用户行为预测模型（LightGBM + XGBoost，延迟 < 50ms）和数据采集管道（42 埋点 + Kafka + ClickHouse）。团队平均评分 8.3/10，方案已通过验证。",
    metadata: { department: "ai", avg_score: 8.3 },
    created_at: "2025-01-01T00:00:24.500Z",
  },

  // ── feedback 阶段：CEO → Manager 反馈 ──
  {
    id: 21,
    workflow_id: WF,
    from_agent: "ceo",
    to_agent: "pixel",
    stage: "feedback",
    content:
      "游戏部方案质量达标，社交裂变和技术架构设计值得肯定。后续关注活动上线后的实际转化数据。",
    metadata: null,
    created_at: "2025-01-01T00:00:26.000Z",
  },
];
