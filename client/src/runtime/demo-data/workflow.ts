import type { WorkflowRecord } from "@shared/workflow-runtime";

/**
 * 演示工作流记录 — 手游营销推广方案场景
 *
 * 状态：completed，覆盖全部十阶段
 * direction → planning → execution → review → meta_audit →
 * revision → verify → summary → feedback → evolution
 */
export const DEMO_WORKFLOW: WorkflowRecord = {
  id: "demo-workflow-001",
  directive: "设计一个手游营销推广方案",
  status: "completed",
  current_stage: null,
  departments_involved: ["game", "ai"],
  started_at: "2025-01-01T00:00:00.000Z",
  completed_at: "2025-01-01T00:00:30.000Z",
  results: {
    completedStages: [
      "direction",
      "planning",
      "execution",
      "review",
      "meta_audit",
      "revision",
      "verify",
      "summary",
      "feedback",
      "evolution",
    ],
    summary: "手游营销推广方案设计完成，覆盖策划、技术、AI 推荐和数据工程四个维度。",
  },
  created_at: "2025-01-01T00:00:00.000Z",
};
