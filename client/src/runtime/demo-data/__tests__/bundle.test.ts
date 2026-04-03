import { describe, it, expect } from "vitest";
import { DEMO_BUNDLE } from "../bundle";
import { WORKFLOW_STAGES } from "@shared/workflow-runtime";

/**
 * 数据完整性单元测试 — DEMO_BUNDLE
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6, 1.7
 */

const CEO_ID = "ceo";
const MANAGER_IDS = ["pixel", "nexus"];
const WORKER_IDS = ["nova", "blaze", "flux", "tensor"];

describe("DEMO_BUNDLE data integrity", () => {
  // ── Requirement 1.1: 覆盖全部 10 个工作流阶段 ──
  describe("workflow stage coverage", () => {
    it("events cover all 10 workflow stages via stage_change events", () => {
      const stageChangeEvents = DEMO_BUNDLE.events
        .filter((e) => e.event.type === "stage_change")
        .map((e) => (e.event as { type: "stage_change"; stage: string }).stage);

      for (const stage of WORKFLOW_STAGES) {
        expect(stageChangeEvents).toContain(stage);
      }
    });

    it("workflow record completedStages covers all 10 stages", () => {
      const completedStages = DEMO_BUNDLE.workflow.results?.completedStages as string[];
      expect(completedStages).toBeDefined();
      for (const stage of WORKFLOW_STAGES) {
        expect(completedStages).toContain(stage);
      }
    });
  });

  // ── Requirement 1.2: 组织快照角色数量 ──
  describe("organization snapshot roles", () => {
    it("contains exactly 1 CEO", () => {
      const ceos = DEMO_BUNDLE.organization.nodes.filter((n) => n.role === "ceo");
      expect(ceos).toHaveLength(1);
    });

    it("contains exactly 2 Managers", () => {
      const managers = DEMO_BUNDLE.organization.nodes.filter((n) => n.role === "manager");
      expect(managers).toHaveLength(2);
    });

    it("contains exactly 4 Workers", () => {
      const workers = DEMO_BUNDLE.organization.nodes.filter((n) => n.role === "worker");
      expect(workers).toHaveLength(4);
    });
  });

  // ── Requirement 1.4: 消息数量 ≥ 20 且覆盖三种流转路径 ──
  describe("message records", () => {
    it("contains at least 20 messages", () => {
      expect(DEMO_BUNDLE.messages.length).toBeGreaterThanOrEqual(20);
    });

    it("covers CEO → Manager flow path", () => {
      const ceoToManager = DEMO_BUNDLE.messages.filter(
        (m) => m.from_agent === CEO_ID && MANAGER_IDS.includes(m.to_agent),
      );
      expect(ceoToManager.length).toBeGreaterThan(0);
    });

    it("covers Manager → Worker flow path", () => {
      const managerToWorker = DEMO_BUNDLE.messages.filter(
        (m) => MANAGER_IDS.includes(m.from_agent) && WORKER_IDS.includes(m.to_agent),
      );
      expect(managerToWorker.length).toBeGreaterThan(0);
    });

    it("covers Worker → Manager flow path", () => {
      const workerToManager = DEMO_BUNDLE.messages.filter(
        (m) => WORKER_IDS.includes(m.from_agent) && MANAGER_IDS.includes(m.to_agent),
      );
      expect(workerToManager.length).toBeGreaterThan(0);
    });
  });

  // ── Requirement 1.5: 任务数量 ≥ 4 且包含完整评分 ──
  describe("task records", () => {
    it("contains at least 4 tasks", () => {
      expect(DEMO_BUNDLE.tasks.length).toBeGreaterThanOrEqual(4);
    });

    it("each task has complete scoring fields", () => {
      for (const task of DEMO_BUNDLE.tasks) {
        expect(task.score_accuracy).toBeTypeOf("number");
        expect(task.score_completeness).toBeTypeOf("number");
        expect(task.score_actionability).toBeTypeOf("number");
        expect(task.score_format).toBeTypeOf("number");
      }
    });
  });

  // ── Requirement 1.6: 记忆条目覆盖三级记忆类型 ──
  describe("memory entries", () => {
    it("covers short_term memory type", () => {
      const shortTerm = DEMO_BUNDLE.memoryEntries.filter((m) => m.kind === "short_term");
      expect(shortTerm.length).toBeGreaterThan(0);
    });

    it("covers medium_term memory type", () => {
      const mediumTerm = DEMO_BUNDLE.memoryEntries.filter((m) => m.kind === "medium_term");
      expect(mediumTerm.length).toBeGreaterThan(0);
    });

    it("covers long_term memory type", () => {
      const longTerm = DEMO_BUNDLE.memoryEntries.filter((m) => m.kind === "long_term");
      expect(longTerm.length).toBeGreaterThan(0);
    });
  });

  // ── Requirement 1.7: 进化日志包含评分变化和补丁内容 ──
  describe("evolution logs", () => {
    it("contains at least one evolution log", () => {
      expect(DEMO_BUNDLE.evolutionLogs.length).toBeGreaterThan(0);
    });

    it("each log has score changes (oldScore !== newScore)", () => {
      for (const log of DEMO_BUNDLE.evolutionLogs) {
        expect(log.oldScore).toBeTypeOf("number");
        expect(log.newScore).toBeTypeOf("number");
        expect(log.newScore).not.toBe(log.oldScore);
      }
    });

    it("each log has non-empty patch content", () => {
      for (const log of DEMO_BUNDLE.evolutionLogs) {
        expect(log.patchContent).toBeTypeOf("string");
        expect(log.patchContent.length).toBeGreaterThan(0);
      }
    });
  });
});
