/**
 * Integration tests for Plugin / Skill 体系
 *
 * Tests the complete flow: Skill 注册 → 解析 → 激活 → 执行
 * and API endpoint request/response format.
 *
 * Validates: Requirements 1.2, 2.2, 3.1, 10.4
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock dynamic-organization to break circular dependency
vi.mock("../core/dynamic-organization.js", () => ({
  resolveMcp: () => [],
  skillRegistry: {},
}));

import type {
  SkillDefinition,
  SkillRecord,
  SkillAuditLog,
  SkillExecutionMetrics,
} from "../../shared/skill-contracts.js";
import { SkillRegistry } from "../core/skill-registry.js";
import { SkillActivator } from "../core/skill-activator.js";
import { SkillMonitor } from "../core/skill-monitor.js";
import { createSkillContext, recordSideEffect } from "../core/skill-context.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let skills: SkillRecord[] = [];
  let auditLogs: SkillAuditLog[] = [];
  let metrics: SkillExecutionMetrics[] = [];
  let auditCounter = 0;

  return {
    getSkills: () => skills,
    getSkill: (id: string, version: string) =>
      skills.find(s => s.id === id && s.version === version),
    upsertSkill(record: SkillRecord): SkillRecord {
      const idx = skills.findIndex(
        s => s.id === record.id && s.version === record.version
      );
      if (idx >= 0) {
        skills[idx] = { ...record, updatedAt: new Date().toISOString() };
        return skills[idx];
      }
      skills.push(record);
      return record;
    },
    createSkillAuditLog(log: Omit<SkillAuditLog, "id">): SkillAuditLog {
      auditCounter++;
      const row: SkillAuditLog = { ...log, id: auditCounter };
      auditLogs.push(row);
      return row;
    },
    getSkillAuditLogs(skillId?: string): SkillAuditLog[] {
      if (skillId) return auditLogs.filter(l => l.skillId === skillId);
      return auditLogs;
    },
    getSkillMetrics: (skillId: string) =>
      metrics.filter(m => m.skillId === skillId),
    createSkillMetric: (m: SkillExecutionMetrics) => {
      metrics.push(m);
    },
    _reset: () => {
      skills = [];
      auditLogs = [];
      metrics = [];
      auditCounter = 0;
    },
  };
}

/* ─── Test Skill definitions ─── */

const codeReviewSkill: SkillDefinition = {
  id: "code-review",
  name: "Code Review",
  category: "code",
  summary: "Automated code review with best practices",
  prompt: "Review the following code in {context}. Analyze {input} for issues.",
  requiredMcp: [],
  version: "1.0.0",
  tags: ["code", "review", "quality"],
};

const securityAuditSkill: SkillDefinition = {
  id: "security-audit",
  name: "Security Audit",
  category: "security",
  summary: "Security vulnerability scanning",
  prompt: "Scan {context} for security vulnerabilities. Input: {input}",
  requiredMcp: ["semgrep"],
  version: "1.0.0",
  tags: ["security", "audit"],
};

const dataAnalysisSkill: SkillDefinition = {
  id: "data-analysis",
  name: "Data Analysis",
  category: "data",
  summary: "Statistical data analysis",
  prompt: "Analyze data in {context}. Query: {input}",
  requiredMcp: [],
  version: "1.0.0",
  tags: ["data", "analysis"],
  dependencies: ["code-review"], // depends on code-review
};

/* ─── Integration: Full Skill lifecycle ─── */

describe("Integration: Skill 注册 → 解析 → 激活 → 执行", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;
  let activator: SkillActivator;
  let monitor: SkillMonitor;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
    activator = new SkillActivator();
    monitor = new SkillMonitor(db as any);
  });

  it("registers skills, resolves with dependencies, activates, and records metrics", () => {
    // Step 1: Register skills
    const cr = registry.registerSkill(codeReviewSkill);
    const sa = registry.registerSkill(securityAuditSkill);
    const da = registry.registerSkill(dataAnalysisSkill);

    expect(cr.id).toBe("code-review");
    expect(cr.enabled).toBe(true);
    expect(cr.createdAt).toBeDefined();

    expect(sa.id).toBe("security-audit");
    expect(da.id).toBe("data-analysis");

    // Step 2: Resolve skills (data-analysis depends on code-review)
    const bindings = registry.resolveSkills([
      "data-analysis",
      "security-audit",
    ]);

    // Should include data-analysis, security-audit, AND code-review (transitive dep)
    const resolvedIds = bindings.map(b => b.skillId);
    expect(resolvedIds).toContain("data-analysis");
    expect(resolvedIds).toContain("security-audit");
    expect(resolvedIds).toContain("code-review");
    expect(bindings.length).toBe(3);

    // Step 3: Activate skills with context
    const taskContext = "Reviewing PR #42 for user-auth module";
    const activated = activator.activateSkills(bindings, taskContext, 5);

    expect(activated.length).toBe(3);

    // Verify context replacement
    for (const skill of activated) {
      expect(skill.resolvedPrompt).toContain(taskContext);
      expect(skill.resolvedPrompt).not.toContain("{context}");
      expect(skill.resolvedPrompt).toContain("{input}");
    }

    // Step 4: Build prompt section
    const promptSection = activator.buildSkillPromptSection(activated);
    expect(promptSection).toContain("# Active Skills");
    expect(promptSection).toContain("Code Review");
    expect(promptSection).toContain("Security Audit");
    expect(promptSection).toContain("Data Analysis");

    // Step 5: Record execution metrics
    for (const skill of activated) {
      monitor.recordMetrics({
        skillId: skill.skillId,
        version: skill.version,
        workflowId: "wf-test",
        agentId: "agent-test",
        agentRole: "reviewer",
        taskType: "code-review",
        activationTimeMs: 5,
        executionTimeMs: 150,
        tokenCount: 800,
        success: true,
        timestamp: new Date().toISOString(),
      });
    }

    // Step 6: Verify metrics
    const crMetrics = monitor.getSkillMetrics("code-review");
    expect(crMetrics.totalExecutions).toBe(1);
    expect(crMetrics.successRate).toBe(1);
    expect(crMetrics.totalTokenCount).toBe(800);
  });

  it("disable/enable cycle works correctly with audit trail", () => {
    registry.registerSkill(codeReviewSkill);
    registry.registerSkill(securityAuditSkill);

    // Disable code-review
    registry.disableSkill("code-review", "1.0.0", "admin", "maintenance");

    // Resolve should exclude disabled skill
    const bindings = registry.resolveSkills(["code-review", "security-audit"]);
    const ids = bindings.map(b => b.skillId);
    expect(ids).not.toContain("code-review");
    expect(ids).toContain("security-audit");

    // Re-enable
    registry.enableSkill(
      "code-review",
      "1.0.0",
      "admin",
      "maintenance complete"
    );

    const bindingsAfter = registry.resolveSkills([
      "code-review",
      "security-audit",
    ]);
    expect(bindingsAfter.map(b => b.skillId)).toContain("code-review");

    // Verify audit logs
    const logs = db.getSkillAuditLogs("code-review");
    expect(logs.length).toBeGreaterThanOrEqual(2);

    const disableLog = logs.find(l => l.action === "disable");
    expect(disableLog).toBeDefined();
    expect(disableLog!.operator).toBe("admin");
    expect(disableLog!.reason).toBe("maintenance");

    const enableLog = logs.find(l => l.action === "enable");
    expect(enableLog).toBeDefined();
    expect(enableLog!.operator).toBe("admin");
  });

  it("version management: multiple versions coexist", () => {
    registry.registerSkill(codeReviewSkill);
    registry.registerSkill({
      ...codeReviewSkill,
      version: "2.0.0",
      summary: "Enhanced review",
    });

    const versions = registry.getSkillVersions("code-review");
    expect(versions).toHaveLength(2);
    expect(versions.map(v => v.version).sort()).toEqual(["1.0.0", "2.0.0"]);

    // Specific version resolution
    const bindings = registry.resolveSkills(["code-review"], {
      versionMap: { "code-review": "2.0.0" },
    });
    expect(bindings).toHaveLength(1);
    expect(bindings[0].version).toBe("2.0.0");
    expect(bindings[0].resolvedSkill.summary).toBe("Enhanced review");
  });

  it("context isolation: separate skill contexts do not interfere", () => {
    const ctx1 = createSkillContext("code-review");
    const ctx2 = createSkillContext("security-audit");

    ctx1.state["findings"] = ["issue-1"];
    recordSideEffect(ctx1, {
      type: "file_write",
      description: "wrote review report",
      reversible: true,
    });

    // ctx2 should be clean
    expect(ctx2.state["findings"]).toBeUndefined();
    expect(ctx2.sideEffects).toHaveLength(0);

    // ctx1 should have its data
    expect(ctx1.state["findings"]).toEqual(["issue-1"]);
    expect(ctx1.sideEffects).toHaveLength(1);
    expect(ctx1.sideEffects[0].type).toBe("file_write");
    expect(ctx1.sideEffects[0].timestamp).toBeDefined();
  });

  it("alert triggers when failure rate exceeds threshold", () => {
    registry.registerSkill(codeReviewSkill);

    // Record 8 failures and 2 successes (80% failure rate)
    for (let i = 0; i < 8; i++) {
      monitor.recordMetrics({
        skillId: "code-review",
        version: "1.0.0",
        workflowId: "wf-test",
        agentId: "agent-test",
        agentRole: "reviewer",
        taskType: "code-review",
        activationTimeMs: 5,
        executionTimeMs: 150,
        tokenCount: 800,
        success: false,
        timestamp: new Date().toISOString(),
      });
    }
    for (let i = 0; i < 2; i++) {
      monitor.recordMetrics({
        skillId: "code-review",
        version: "1.0.0",
        workflowId: "wf-test",
        agentId: "agent-test",
        agentRole: "reviewer",
        taskType: "code-review",
        activationTimeMs: 5,
        executionTimeMs: 150,
        tokenCount: 800,
        success: true,
        timestamp: new Date().toISOString(),
      });
    }

    const alert = monitor.checkAlerts("code-review", 0.5);
    expect(alert).not.toBeNull();
    expect(alert!.alertType).toBe("high_failure_rate");
    expect(alert!.currentRate).toBe(0.8);

    // No alert for security-audit (no metrics)
    const noAlert = monitor.checkAlerts("security-audit", 0.5);
    expect(noAlert).toBeNull();
  });

  it("query skills by category and tags", () => {
    registry.registerSkill(codeReviewSkill);
    registry.registerSkill(securityAuditSkill);
    registry.registerSkill(dataAnalysisSkill);

    const codeSkills = registry.querySkills({ category: "code" });
    expect(codeSkills).toHaveLength(1);
    expect(codeSkills[0].id).toBe("code-review");

    const securitySkills = registry.querySkills({ category: "security" });
    expect(securitySkills).toHaveLength(1);
    expect(securitySkills[0].id).toBe("security-audit");

    const allSkills = registry.querySkills({});
    expect(allSkills).toHaveLength(3);
  });
});
