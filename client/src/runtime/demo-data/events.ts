import type { DemoTimedEvent } from "./schema";

/**
 * 演示事件序列 — 手游营销推广方案场景
 *
 * 按 timestampOffset 升序排列，覆盖全部十阶段，总时长 30 秒（0-30000ms）。
 * 事件类型：stage_change、agent_active、message_sent、score_assigned、task_update、workflow_complete
 *
 * 工作流 ID: demo-workflow-001
 * 智能体: ceo, pixel, nexus, nova, blaze, flux, tensor
 * 任务: 1(nova), 2(blaze), 3(flux), 4(tensor)
 */

const WF = "demo-workflow-001";
const T = (s: number) => `2025-01-01T00:00:${String(s).padStart(2, "0")}.000Z`;

export const DEMO_EVENTS: DemoTimedEvent[] = [
  // ── direction 阶段 (0-2000ms): CEO 下发方向 ──
  { timestampOffset: 0, event: { type: "stage_change", workflowId: WF, stage: "direction" } },
  { timestampOffset: 200, event: { type: "agent_active", agentId: "ceo", action: "发布工作流指令", workflowId: WF } },
  { timestampOffset: 500, event: { type: "message_sent", workflowId: WF, from: "ceo", to: "pixel", stage: "direction", preview: "请游戏部围绕手游营销推广方案展开工作", timestamp: T(1) } },
  { timestampOffset: 1000, event: { type: "message_sent", workflowId: WF, from: "ceo", to: "nexus", stage: "direction", preview: "请AI部配合提供用户画像建模和数据方案", timestamp: T(2) } },

  // ── planning 阶段 (2000-5000ms): Manager 拆解任务 ──
  { timestampOffset: 2000, event: { type: "stage_change", workflowId: WF, stage: "planning" } },
  { timestampOffset: 2200, event: { type: "agent_active", agentId: "pixel", action: "拆解任务并分配给Worker", workflowId: WF } },
  { timestampOffset: 2500, event: { type: "message_sent", workflowId: WF, from: "pixel", to: "nova", stage: "planning", preview: "请负责策划手游营销活动方案", timestamp: T(3) } },
  { timestampOffset: 2800, event: { type: "task_update", workflowId: WF, taskId: 1, workerId: "nova", status: "assigned" } },
  { timestampOffset: 3000, event: { type: "message_sent", workflowId: WF, from: "pixel", to: "blaze", stage: "planning", preview: "请设计营销活动的技术实现方案", timestamp: T(4) } },
  { timestampOffset: 3200, event: { type: "task_update", workflowId: WF, taskId: 2, workerId: "blaze", status: "assigned" } },
  { timestampOffset: 3500, event: { type: "agent_active", agentId: "nexus", action: "拆解任务并分配给Worker", workflowId: WF } },
  { timestampOffset: 3800, event: { type: "message_sent", workflowId: WF, from: "nexus", to: "flux", stage: "planning", preview: "请设计用户行为预测模型方案", timestamp: T(5) } },
  { timestampOffset: 4000, event: { type: "task_update", workflowId: WF, taskId: 3, workerId: "flux", status: "assigned" } },
  { timestampOffset: 4300, event: { type: "message_sent", workflowId: WF, from: "nexus", to: "tensor", stage: "planning", preview: "请设计营销数据采集与分析管道", timestamp: T(6) } },
  { timestampOffset: 4600, event: { type: "task_update", workflowId: WF, taskId: 4, workerId: "tensor", status: "assigned" } },

  // ── execution 阶段 (5000-12000ms): Worker 执行任务 ──
  { timestampOffset: 5000, event: { type: "stage_change", workflowId: WF, stage: "execution" } },
  { timestampOffset: 5300, event: { type: "agent_active", agentId: "nova", action: "执行营销策划任务", workflowId: WF } },
  { timestampOffset: 5600, event: { type: "agent_active", agentId: "blaze", action: "执行技术方案设计", workflowId: WF } },
  { timestampOffset: 6000, event: { type: "agent_active", agentId: "flux", action: "执行模型方案设计", workflowId: WF } },
  { timestampOffset: 6400, event: { type: "agent_active", agentId: "tensor", action: "执行数据管道设计", workflowId: WF } },
  { timestampOffset: 7500, event: { type: "message_sent", workflowId: WF, from: "nova", to: "pixel", stage: "execution", preview: "策划方案已完成，首月DAU预计提升15%", timestamp: T(7) } },
  { timestampOffset: 7800, event: { type: "task_update", workflowId: WF, taskId: 1, workerId: "nova", status: "submitted" } },
  { timestampOffset: 8500, event: { type: "message_sent", workflowId: WF, from: "blaze", to: "pixel", stage: "execution", preview: "技术方案已交付，配置化引擎+灰度发布", timestamp: T(8) } },
  { timestampOffset: 8800, event: { type: "task_update", workflowId: WF, taskId: 2, workerId: "blaze", status: "submitted" } },
  { timestampOffset: 9500, event: { type: "message_sent", workflowId: WF, from: "flux", to: "nexus", stage: "execution", preview: "预测模型方案完成，推理延迟<50ms", timestamp: T(9) } },
  { timestampOffset: 9800, event: { type: "task_update", workflowId: WF, taskId: 3, workerId: "flux", status: "submitted" } },
  { timestampOffset: 10500, event: { type: "message_sent", workflowId: WF, from: "tensor", to: "nexus", stage: "execution", preview: "数据管道方案已提交，覆盖42个埋点事件", timestamp: T(10) } },
  { timestampOffset: 10800, event: { type: "task_update", workflowId: WF, taskId: 4, workerId: "tensor", status: "submitted" } },

  // ── review 阶段 (12000-15000ms): Manager 评审打分 ──
  { timestampOffset: 12000, event: { type: "stage_change", workflowId: WF, stage: "review" } },
  { timestampOffset: 12200, event: { type: "agent_active", agentId: "pixel", action: "评审Worker交付物", workflowId: WF } },
  { timestampOffset: 12500, event: { type: "message_sent", workflowId: WF, from: "pixel", to: "nova", stage: "review", preview: "策划方案整体优秀，建议补充预算分配", timestamp: T(12) } },
  { timestampOffset: 12700, event: { type: "score_assigned", workflowId: WF, taskId: 1, workerId: "nova", score: 33 } },
  { timestampOffset: 13000, event: { type: "message_sent", workflowId: WF, from: "pixel", to: "blaze", stage: "review", preview: "技术方案架构清晰，需补充降级策略", timestamp: T(13) } },
  { timestampOffset: 13200, event: { type: "score_assigned", workflowId: WF, taskId: 2, workerId: "blaze", score: 33 } },
  { timestampOffset: 13500, event: { type: "agent_active", agentId: "nexus", action: "评审Worker交付物", workflowId: WF } },
  { timestampOffset: 13800, event: { type: "message_sent", workflowId: WF, from: "nexus", to: "flux", stage: "review", preview: "模型选型合理，建议增加冷启动策略", timestamp: T(14) } },
  { timestampOffset: 14000, event: { type: "score_assigned", workflowId: WF, taskId: 3, workerId: "flux", score: 33 } },
  { timestampOffset: 14300, event: { type: "message_sent", workflowId: WF, from: "nexus", to: "tensor", stage: "review", preview: "数据管道设计全面，需完善数据质量监控", timestamp: T(15) } },
  { timestampOffset: 14600, event: { type: "score_assigned", workflowId: WF, taskId: 4, workerId: "tensor", score: 34 } },
  { timestampOffset: 14800, event: { type: "task_update", workflowId: WF, taskId: 1, workerId: "nova", status: "needs_revision" } },
  { timestampOffset: 14850, event: { type: "task_update", workflowId: WF, taskId: 2, workerId: "blaze", status: "needs_revision" } },
  { timestampOffset: 14900, event: { type: "task_update", workflowId: WF, taskId: 3, workerId: "flux", status: "needs_revision" } },
  { timestampOffset: 14950, event: { type: "task_update", workflowId: WF, taskId: 4, workerId: "tensor", status: "needs_revision" } },

  // ── meta_audit 阶段 (15000-18000ms): 元审计 ──
  { timestampOffset: 15000, event: { type: "stage_change", workflowId: WF, stage: "meta_audit" } },
  { timestampOffset: 15300, event: { type: "agent_active", agentId: "pixel", action: "执行元审计检查", workflowId: WF } },
  { timestampOffset: 15800, event: { type: "agent_active", agentId: "nexus", action: "执行元审计检查", workflowId: WF } },
  { timestampOffset: 16500, event: { type: "message_sent", workflowId: WF, from: "pixel", to: "nova", stage: "meta_audit", preview: "方案覆盖获客留存变现，逻辑闭环完整", timestamp: "2025-01-01T00:00:16.000Z" } },
  { timestampOffset: 17000, event: { type: "message_sent", workflowId: WF, from: "nexus", to: "flux", stage: "meta_audit", preview: "模型指标合理，灰度上线计划稳妥", timestamp: "2025-01-01T00:00:17.000Z" } },

  // ── revision 阶段 (18000-21000ms): Worker 修订 ──
  { timestampOffset: 18000, event: { type: "stage_change", workflowId: WF, stage: "revision" } },
  { timestampOffset: 18200, event: { type: "agent_active", agentId: "nova", action: "修订营销策划方案", workflowId: WF } },
  { timestampOffset: 18400, event: { type: "agent_active", agentId: "blaze", action: "修订技术实现方案", workflowId: WF } },
  { timestampOffset: 18600, event: { type: "agent_active", agentId: "flux", action: "修订模型预测方案", workflowId: WF } },
  { timestampOffset: 18800, event: { type: "agent_active", agentId: "tensor", action: "修订数据管道方案", workflowId: WF } },
  { timestampOffset: 19500, event: { type: "message_sent", workflowId: WF, from: "nova", to: "pixel", stage: "revision", preview: "已补充预算分配表和薅羊毛防控机制", timestamp: "2025-01-01T00:00:19.000Z" } },
  { timestampOffset: 19800, event: { type: "task_update", workflowId: WF, taskId: 1, workerId: "nova", status: "revised" } },
  { timestampOffset: 20000, event: { type: "message_sent", workflowId: WF, from: "blaze", to: "pixel", stage: "revision", preview: "已补充热更新机制和高并发降级策略", timestamp: "2025-01-01T00:00:19.500Z" } },
  { timestampOffset: 20200, event: { type: "task_update", workflowId: WF, taskId: 2, workerId: "blaze", status: "revised" } },
  { timestampOffset: 20400, event: { type: "message_sent", workflowId: WF, from: "flux", to: "nexus", stage: "revision", preview: "已增加冷启动策略和模型可解释性方案", timestamp: "2025-01-01T00:00:20.000Z" } },
  { timestampOffset: 20600, event: { type: "task_update", workflowId: WF, taskId: 3, workerId: "flux", status: "revised" } },
  { timestampOffset: 20800, event: { type: "message_sent", workflowId: WF, from: "tensor", to: "nexus", stage: "revision", preview: "已新增数据质量监控和GDPR合规方案", timestamp: "2025-01-01T00:00:20.500Z" } },
  { timestampOffset: 20900, event: { type: "task_update", workflowId: WF, taskId: 4, workerId: "tensor", status: "revised" } },

  // ── verify 阶段 (21000-23000ms): 验证通过 ──
  { timestampOffset: 21000, event: { type: "stage_change", workflowId: WF, stage: "verify" } },
  { timestampOffset: 21200, event: { type: "agent_active", agentId: "pixel", action: "验证修订交付物", workflowId: WF } },
  { timestampOffset: 21500, event: { type: "message_sent", workflowId: WF, from: "pixel", to: "nova", stage: "verify", preview: "修订版策划方案验证通过", timestamp: "2025-01-01T00:00:22.000Z" } },
  { timestampOffset: 21700, event: { type: "task_update", workflowId: WF, taskId: 1, workerId: "nova", status: "completed" } },
  { timestampOffset: 21900, event: { type: "task_update", workflowId: WF, taskId: 2, workerId: "blaze", status: "completed" } },
  { timestampOffset: 22100, event: { type: "agent_active", agentId: "nexus", action: "验证修订交付物", workflowId: WF } },
  { timestampOffset: 22300, event: { type: "message_sent", workflowId: WF, from: "nexus", to: "flux", stage: "verify", preview: "模型方案修订版验证通过", timestamp: "2025-01-01T00:00:22.500Z" } },
  { timestampOffset: 22500, event: { type: "task_update", workflowId: WF, taskId: 3, workerId: "flux", status: "completed" } },
  { timestampOffset: 22700, event: { type: "task_update", workflowId: WF, taskId: 4, workerId: "tensor", status: "completed" } },

  // ── summary 阶段 (23000-25000ms): 汇总报告 ──
  { timestampOffset: 23000, event: { type: "stage_change", workflowId: WF, stage: "summary" } },
  { timestampOffset: 23200, event: { type: "agent_active", agentId: "pixel", action: "汇总游戏部报告", workflowId: WF } },
  { timestampOffset: 23500, event: { type: "agent_active", agentId: "nexus", action: "汇总AI部报告", workflowId: WF } },
  { timestampOffset: 24000, event: { type: "message_sent", workflowId: WF, from: "pixel", to: "ceo", stage: "summary", preview: "游戏部汇总：策划+技术方案，平均评分8.1", timestamp: "2025-01-01T00:00:24.000Z" } },
  { timestampOffset: 24500, event: { type: "message_sent", workflowId: WF, from: "nexus", to: "ceo", stage: "summary", preview: "AI部汇总：预测模型+数据管道，平均评分8.3", timestamp: "2025-01-01T00:00:24.500Z" } },

  // ── feedback 阶段 (25000-27000ms): CEO 反馈 ──
  { timestampOffset: 25000, event: { type: "stage_change", workflowId: WF, stage: "feedback" } },
  { timestampOffset: 25200, event: { type: "agent_active", agentId: "ceo", action: "审阅汇总报告并反馈", workflowId: WF } },
  { timestampOffset: 26000, event: { type: "message_sent", workflowId: WF, from: "ceo", to: "pixel", stage: "feedback", preview: "游戏部方案质量达标，关注上线后转化数据", timestamp: "2025-01-01T00:00:26.000Z" } },
  { timestampOffset: 26500, event: { type: "message_sent", workflowId: WF, from: "ceo", to: "nexus", stage: "feedback", preview: "AI部方案技术扎实，持续优化模型精度", timestamp: "2025-01-01T00:00:26.500Z" } },

  // ── evolution 阶段 (27000-30000ms): 进化更新 ──
  { timestampOffset: 27000, event: { type: "stage_change", workflowId: WF, stage: "evolution" } },
  { timestampOffset: 27300, event: { type: "agent_active", agentId: "nova", action: "更新SOUL.md能力模型", workflowId: WF } },
  { timestampOffset: 27600, event: { type: "agent_active", agentId: "blaze", action: "更新SOUL.md能力模型", workflowId: WF } },
  { timestampOffset: 27900, event: { type: "agent_active", agentId: "flux", action: "更新SOUL.md能力模型", workflowId: WF } },
  { timestampOffset: 28200, event: { type: "agent_active", agentId: "tensor", action: "更新SOUL.md能力模型", workflowId: WF } },
  { timestampOffset: 29500, event: { type: "workflow_complete", workflowId: WF, status: "completed", summary: "手游营销推广方案设计完成，覆盖策划、技术、AI推荐和数据工程四个维度" } },
];
