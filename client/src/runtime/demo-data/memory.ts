import type { DemoMemoryEntry } from "./schema";

/**
 * 演示记忆条目 — 覆盖 short_term / medium_term / long_term 三种类型
 *
 * - 短期记忆（short_term）：execution 阶段，LLM 交互日志片段
 * - 中期记忆（medium_term）：summary 阶段，工作流摘要
 * - 长期记忆（long_term）：evolution 阶段，SOUL.md 补丁内容
 */
export const DEMO_MEMORY_ENTRIES: DemoMemoryEntry[] = [
  // ── short_term × 4（execution 阶段，5000-12000ms）──────────────
  {
    agentId: "nova",
    kind: "short_term",
    stage: "execution",
    content:
      "调用 LLM 生成手游春节限定活动方案，prompt 包含目标用户画像（18-30 岁休闲玩家）和预算约束（50 万以内）。返回 3 套备选方案，token 消耗 1,247。",
    timestampOffset: 5500,
  },
  {
    agentId: "blaze",
    kind: "short_term",
    stage: "execution",
    content:
      "请求 LLM 评估推送系统技术选型，对比 Firebase Cloud Messaging 与自建 WebSocket 方案。模型建议采用 FCM + 本地消息队列混合架构，延迟可控制在 200ms 以内。",
    timestampOffset: 7200,
  },
  {
    agentId: "flux",
    kind: "short_term",
    stage: "execution",
    content:
      "向 LLM 提交用户留存预测模型的特征工程方案，包含 7 日登录频次、付费金额、社交互动次数等 12 个特征。模型反馈建议增加「首次付费时间差」特征以提升 AUC。",
    timestampOffset: 9000,
  },
  {
    agentId: "tensor",
    kind: "short_term",
    stage: "execution",
    content:
      "调用 LLM 生成用户行为数据采集 SQL 脚本，覆盖登录、关卡通过、道具购买三类事件。输出包含分区表设计和增量同步策略，token 消耗 983。",
    timestampOffset: 11000,
  },

  // ── medium_term × 2（summary 阶段，23000-25000ms）─────────────
  {
    agentId: "nova",
    kind: "medium_term",
    stage: "summary",
    content:
      "本轮工作流摘要：完成手游营销推广方案策划，产出春节限定活动策划书（含 3 套备选方案）、用户分层触达策略文档、预算分配表。经理评审评分均值 8.2/10，主要改进建议为细化下沉市场用户触达渠道。",
    timestampOffset: 23500,
  },
  {
    agentId: "flux",
    kind: "medium_term",
    stage: "summary",
    content:
      "本轮工作流摘要：完成用户留存预测模型方案设计，产出特征工程文档、模型训练计划和 A/B 测试方案。评审评分均值 7.8/10，建议补充冷启动场景下的降级策略。",
    timestampOffset: 24500,
  },

  // ── long_term × 2（evolution 阶段，27000-30000ms）──────────────
  {
    agentId: "nova",
    kind: "long_term",
    stage: "evolution",
    content:
      "SOUL.md 补丁：\n- 新增能力标签「下沉市场营销」\n- 更新策划方法论：在活动方案中默认包含三线城市以下用户触达渠道分析\n- 经验沉淀：春节档期活动需提前 45 天启动素材储备",
    timestampOffset: 28000,
  },
  {
    agentId: "tensor",
    kind: "long_term",
    stage: "evolution",
    content:
      "SOUL.md 补丁：\n- 提升「实时数据管道」能力评分 6.5 → 7.2\n- 新增最佳实践：行为事件采集应在客户端做本地聚合后批量上报，降低服务端写入压力\n- 更新工具偏好：优先使用 ClickHouse 替代 MySQL 做行为分析查询",
    timestampOffset: 29500,
  },
];
