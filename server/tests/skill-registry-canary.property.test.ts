/**
 * Property-based tests for SkillRegistry — canary / 灰度发布
 *
 * Properties tested:
 *  17 — 灰度流量分布
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import fc from "fast-check";

import type {
  SkillDefinition,
  SkillRecord,
  SkillAuditLog,
} from "../../shared/skill-contracts.js";
import type { WorkflowMcpBinding } from "../../shared/organization-schema.js";

// ---------------------------------------------------------------------------
// Mock dynamic-organization (same pattern as other test files)
// ---------------------------------------------------------------------------

vi.mock("../core/dynamic-organization.js", () => ({
  resolveMcp: (
    _mcpIds: string[],
    _agentId: string,
    _workflowId: string
  ): WorkflowMcpBinding[] => [],
  skillRegistry: {},
}));

import { SkillRegistry } from "../core/skill-registry.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let skills: SkillRecord[] = [];
  let auditLogs: SkillAuditLog[] = [];
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
    _reset: () => {
      skills = [];
      auditLogs = [];
      auditCounter = 0;
    },
  };
}

/* ─── Helpers ─── */

function makeSkillDef(
  id: string,
  overrides: Partial<SkillDefinition> = {}
): SkillDefinition {
  return {
    id,
    name: `Skill ${id}`,
    category: "code",
    summary: `Summary for ${id}`,
    prompt: `Do {context} with {input} for ${id}`,
    requiredMcp: [],
    version: "1.0.0",
    tags: ["test"],
    ...overrides,
  };
}

/* ─── Arbitraries ─── */

const arbId = fc.string({ minLength: 1, maxLength: 20 }).map(
  s =>
    s
      .replace(/[^a-z0-9-]/gi, "a")
      .toLowerCase()
      .slice(0, 20) || "sk"
);

const arbSemver = fc
  .tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 }))
  .map(([x, y, z]) => `${x}.${y}.${z}`);

/** Canary percentage between 1 and 99 (exclusive boundaries avoid trivial cases) */
const arbCanaryPercentage = fc.integer({ min: 10, max: 90 });

/* ─── Property 17: 灰度流量分布 ─── */
/* **Validates: Requirements 6.4** */

describe("Feature: plugin-skill-system, Property 17: 灰度流量分布", () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createInMemoryDb();
    registry = new SkillRegistry(db as any);
  });

  it("canary traffic distribution approximates configured percentage within statistical tolerance", () => {
    fc.assert(
      fc.property(arbId, arbCanaryPercentage, (skillId, percentage) => {
        db._reset();

        const baseVersion = "1.0.0";
        const canaryVersion = "2.0.0";

        // Register the base version (latest by createdAt) with canary config
        const baseDef = makeSkillDef(skillId, { version: baseVersion });
        registry.registerSkill(baseDef);

        // Register the canary target version
        const canaryDef = makeSkillDef(skillId, { version: canaryVersion });
        registry.registerSkill(canaryDef);

        // Update the base version to have canary config pointing to canaryVersion
        // The base version should be the "latest" (sorted by createdAt desc)
        const baseRecord = db.getSkill(skillId, baseVersion)!;
        baseRecord.canary = {
          enabled: true,
          percentage,
          targetVersion: canaryVersion,
        };
        db.upsertSkill(baseRecord);

        // Also ensure the base version has a later createdAt so it's picked as "latest"
        // (it was registered first, so update its createdAt to be later)
        baseRecord.createdAt = new Date(Date.now() + 1000).toISOString();
        db.upsertSkill(baseRecord);

        // Run many resolves and count canary vs base
        const N = 1000;
        let canaryCount = 0;

        for (let i = 0; i < N; i++) {
          const bindings = registry.resolveSkills([skillId]);
          expect(bindings).toHaveLength(1);
          if (bindings[0].version === canaryVersion) {
            canaryCount++;
          }
        }

        // Check that observed ratio is within ±10% of expected
        const observedRatio = canaryCount / N;
        const expectedRatio = percentage / 100;
        const tolerance = 0.1;

        expect(observedRatio).toBeGreaterThanOrEqual(expectedRatio - tolerance);
        expect(observedRatio).toBeLessThanOrEqual(expectedRatio + tolerance);
      }),
      { numRuns: 100 }
    );
  });

  it("canary at 0% never returns canary version", () => {
    fc.assert(
      fc.property(arbId, skillId => {
        db._reset();

        const baseVersion = "1.0.0";
        const canaryVersion = "2.0.0";

        registry.registerSkill(makeSkillDef(skillId, { version: baseVersion }));
        registry.registerSkill(
          makeSkillDef(skillId, { version: canaryVersion })
        );

        const baseRecord = db.getSkill(skillId, baseVersion)!;
        baseRecord.canary = {
          enabled: true,
          percentage: 0,
          targetVersion: canaryVersion,
        };
        baseRecord.createdAt = new Date(Date.now() + 1000).toISOString();
        db.upsertSkill(baseRecord);

        // With 0%, canary should never be selected
        const N = 200;
        for (let i = 0; i < N; i++) {
          const bindings = registry.resolveSkills([skillId]);
          expect(bindings).toHaveLength(1);
          expect(bindings[0].version).toBe(baseVersion);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("canary at 100% always returns canary version", () => {
    fc.assert(
      fc.property(arbId, skillId => {
        db._reset();

        const baseVersion = "1.0.0";
        const canaryVersion = "2.0.0";

        registry.registerSkill(makeSkillDef(skillId, { version: baseVersion }));
        registry.registerSkill(
          makeSkillDef(skillId, { version: canaryVersion })
        );

        const baseRecord = db.getSkill(skillId, baseVersion)!;
        baseRecord.canary = {
          enabled: true,
          percentage: 100,
          targetVersion: canaryVersion,
        };
        baseRecord.createdAt = new Date(Date.now() + 1000).toISOString();
        db.upsertSkill(baseRecord);

        // With 100%, canary should always be selected
        const N = 200;
        for (let i = 0; i < N; i++) {
          const bindings = registry.resolveSkills([skillId]);
          expect(bindings).toHaveLength(1);
          expect(bindings[0].version).toBe(canaryVersion);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("canary disabled returns base version regardless of percentage", () => {
    fc.assert(
      fc.property(arbId, arbCanaryPercentage, (skillId, percentage) => {
        db._reset();

        const baseVersion = "1.0.0";
        const canaryVersion = "2.0.0";

        registry.registerSkill(makeSkillDef(skillId, { version: baseVersion }));
        registry.registerSkill(
          makeSkillDef(skillId, { version: canaryVersion })
        );

        const baseRecord = db.getSkill(skillId, baseVersion)!;
        baseRecord.canary = {
          enabled: false,
          percentage,
          targetVersion: canaryVersion,
        };
        baseRecord.createdAt = new Date(Date.now() + 1000).toISOString();
        db.upsertSkill(baseRecord);

        // With canary disabled, should always return base version
        const N = 100;
        for (let i = 0; i < N; i++) {
          const bindings = registry.resolveSkills([skillId]);
          expect(bindings).toHaveLength(1);
          expect(bindings[0].version).toBe(baseVersion);
        }
      }),
      { numRuns: 100 }
    );
  });
});
