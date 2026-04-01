import type { DemoEvolutionLog } from "./schema";

/**
 * 演示进化日志 — 手游营销推广方案场景
 *
 * 4 条进化记录，对应 4 个 Worker 在 evolution 阶段的能力提升：
 * - nova（游戏策划）→ 预算规划能力提升
 * - blaze（技术实现）→ 高可用架构设计能力提升
 * - flux（模型训练）→ 冷启动处理能力提升
 * - tensor（数据工程）→ 合规数据治理能力提升
 *
 * 每条包含 oldScore → newScore 变化和 SOUL.md 补丁内容
 */

export const DEMO_EVOLUTION_LOGS: DemoEvolutionLog[] = [
  {
    agentId: "nova",
    dimension: "预算规划与ROI分析",
    oldScore: 6.5,
    newScore: 7.2,
    patchContent: [
      "## SOUL.md 补丁 — Nova",
      "",
      "### 新增能力：预算规划与ROI分析",
      "- 在策划营销活动时，必须同步输出预算分配表和各渠道ROI预估",
      "- 预算拆分粒度应覆盖渠道投放、活动奖励、运营人力三个维度",
      "- 对高投入渠道需附带风控机制说明（如薅羊毛防控）",
    ].join("\n"),
    applied: true,
  },
  {
    agentId: "blaze",
    dimension: "高可用与降级策略设计",
    oldScore: 7.0,
    newScore: 7.8,
    patchContent: [
      "## SOUL.md 补丁 — Blaze",
      "",
      "### 新增能力：高可用与降级策略设计",
      "- 技术方案必须包含高并发场景下的降级策略（缓存兜底、限流、熔断）",
      "- 涉及状态变更的操作需说明分布式一致性保障方案",
      "- 热更新机制应支持秒级配置生效，避免发版依赖",
    ].join("\n"),
    applied: true,
  },
  {
    agentId: "flux",
    dimension: "冷启动与模型可解释性",
    oldScore: 6.8,
    newScore: 7.5,
    patchContent: [
      "## SOUL.md 补丁 — Flux",
      "",
      "### 新增能力：冷启动与模型可解释性",
      "- 预测模型方案必须包含冷启动用户的处理策略（协同过滤+规则兜底）",
      "- 输出模型结果时需附带SHAP值Top-5特征归因报告",
      "- 灰度上线计划应分阶段推进，每阶段设定明确观察指标",
    ].join("\n"),
    applied: true,
  },
  {
    agentId: "tensor",
    dimension: "数据合规与质量监控",
    oldScore: 7.2,
    newScore: 8.0,
    patchContent: [
      "## SOUL.md 补丁 — Tensor",
      "",
      "### 新增能力：数据合规与质量监控",
      "- 数据管道方案必须包含GDPR合规脱敏方案（PII哈希+用户删除权API）",
      "- 需设计数据质量监控告警机制（缺失率阈值、异常值检测）",
      "- 历史数据回填策略应支持增量校验，确保数据一致性",
    ].join("\n"),
    applied: true,
  },
];
