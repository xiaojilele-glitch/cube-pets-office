import type { TaskRecord } from "@shared/workflow-runtime";

/**
 * 演示任务记录 — 手游营销推广方案场景
 *
 * 共 4 条任务，对应 4 个 Worker：
 * - nova（游戏策划）→ 营销活动策划方案
 * - blaze（技术实现）→ 技术实现方案
 * - flux（模型训练）→ 用户行为预测模型
 * - tensor（数据工程）→ 数据采集管道
 *
 * 所有任务 status: completed, version: 2（经过修订）
 */

const WF = "demo-workflow-001";
const TS = "2025-01-01T00:00:00.000Z";

export const DEMO_TASKS: TaskRecord[] = [
  {
    id: 1,
    workflow_id: WF,
    worker_id: "nova",
    manager_id: "pixel",
    department: "game",
    description:
      "策划手游营销活动方案，包括限时活动、社交分享激励和新手引导优化",
    deliverable:
      "营销活动策划方案 v1：1）首周登录送限定皮肤引导留存；2）组队通关奖励驱动社交裂变；3）赛季排行榜激发竞争消费。预计首月 DAU 提升 15%。",
    deliverable_v2:
      "营销活动策划方案 v2：在 v1 基础上补充预算分配表（总预算 50 万，渠道占比 40%、活动奖励 35%、运营人力 25%），各渠道 ROI 预估（应用商店 1:3.2、社交媒体 1:2.8、KOL 合作 1:4.1），新增薅羊毛防控机制（设备指纹 + 行为频次限制 + 人工审核兜底）。",
    deliverable_v3: null,
    score_accuracy: 8,
    score_completeness: 8,
    score_actionability: 8,
    score_format: 9,
    total_score: 33,
    manager_feedback:
      "策划方案整体优秀，社交裂变设计有亮点。修订版补充了预算分配和风控方案，完整性显著提升。",
    meta_audit_feedback:
      "方案覆盖获客、留存、变现三个环节，逻辑闭环完整。建议后续补充竞品对标分析。",
    verify_result: { passed: true },
    version: 2,
    status: "completed",
    created_at: TS,
    updated_at: "2025-01-01T00:00:22.000Z",
  },
  {
    id: 2,
    workflow_id: WF,
    worker_id: "blaze",
    manager_id: "pixel",
    department: "game",
    description:
      "设计营销活动的技术实现方案，涵盖活动配置系统、A/B 测试框架和推送通知架构",
    deliverable:
      "技术实现方案 v1：采用配置化活动引擎 + Feature Flag 灰度发布，A/B 测试框架支持多维度分桶，推送系统基于用户活跃时段智能调度。",
    deliverable_v2:
      "技术实现方案 v2：新增热更新机制（基于远程配置中心，变更秒级生效），高并发降级策略（本地缓存兜底 + 令牌桶限流 + 熔断降级），分布式锁保障奖励发放数据一致性，预计支撑 10 万 QPS 峰值。",
    deliverable_v3: null,
    score_accuracy: 9,
    score_completeness: 8,
    score_actionability: 8,
    score_format: 8,
    total_score: 33,
    manager_feedback:
      "技术方案架构清晰，A/B 测试设计合理。修订版补充了热更新和降级策略，工程可落地性强。",
    meta_audit_feedback:
      "架构设计考虑了高可用和可扩展性，降级方案完备。建议补充监控告警阈值配置。",
    verify_result: { passed: true },
    version: 2,
    status: "completed",
    created_at: TS,
    updated_at: "2025-01-01T00:00:22.000Z",
  },
  {
    id: 3,
    workflow_id: WF,
    worker_id: "flux",
    manager_id: "nexus",
    department: "ai",
    description: "设计用户行为预测模型方案，用于识别高价值玩家和流失风险用户",
    deliverable:
      "用户行为预测模型方案 v1：选用 LightGBM 做流失预警（AUC 0.87），XGBoost 做付费倾向预测（AUC 0.82），线上推理延迟 < 50ms。训练数据需近 90 天用户行为日志。",
    deliverable_v2:
      "用户行为预测模型方案 v2：新增冷启动用户处理策略（基于相似用户群协同过滤 + 规则兜底），模型可解释性方案（SHAP 值 Top-5 特征归因报告），A/B 测试上线计划（5% 流量灰度 → 20% → 全量，每阶段观察 3 天）。",
    deliverable_v3: null,
    score_accuracy: 9,
    score_completeness: 8,
    score_actionability: 8,
    score_format: 8,
    total_score: 33,
    manager_feedback:
      "模型方案技术选型合理，延迟指标达标。修订版补充了冷启动策略和可解释性方案，实用性提升。",
    meta_audit_feedback:
      "模型指标合理，灰度上线计划稳妥。建议增加模型漂移监控和自动重训机制。",
    verify_result: { passed: true },
    version: 2,
    status: "completed",
    created_at: TS,
    updated_at: "2025-01-01T00:00:22.500Z",
  },
  {
    id: 4,
    workflow_id: WF,
    worker_id: "tensor",
    manager_id: "nexus",
    department: "ai",
    description:
      "设计营销数据采集与分析管道，包括用户行为埋点方案、实时数据流处理和效果归因分析",
    deliverable:
      "数据采集管道方案 v1：埋点覆盖 42 个关键事件，Kafka 实时流处理（延迟 < 200ms），ClickHouse 存储分析，归因模型采用多触点加权。",
    deliverable_v2:
      "数据采集管道方案 v2：新增数据质量监控告警（缺失率 > 5% 自动告警、异常值检测），GDPR 合规数据脱敏方案（PII 字段哈希脱敏 + 用户删除权 API），历史数据回填策略（T+1 批量回填 + 增量校验）。",
    deliverable_v3: null,
    score_accuracy: 8,
    score_completeness: 9,
    score_actionability: 8,
    score_format: 9,
    total_score: 34,
    manager_feedback:
      "数据管道设计全面，埋点覆盖充分。修订版补充了数据质量监控和合规方案，生产可用度高。",
    meta_audit_feedback:
      "数据链路设计完整，合规方案考虑周全。建议补充数据保留策略和存储成本预估。",
    verify_result: { passed: true },
    version: 2,
    status: "completed",
    created_at: TS,
    updated_at: "2025-01-01T00:00:22.500Z",
  },
];
