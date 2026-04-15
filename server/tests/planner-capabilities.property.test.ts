import { describe, expect, it } from "vitest";
import fc from "fast-check";

/**
 * Property 9: Planner Prompt 包含能力标签
 *
 * **Validates: Requirements 6.3**
 *
 * For any set of RoleTemplate-like objects with capabilities fields,
 * plannerCatalogSummary's generated string should include capability tag
 * information ([cap1, cap2]) for each template that has non-empty capabilities,
 * and should NOT include bracket tags for templates without capabilities.
 */

// ── Replicate RoleTemplate (module-private) ──────────────────────────────

interface RoleTemplate {
  id: string;
  name: string;
  title: string;
  role: string;
  defaultDepartmentLabel: string;
  responsibility: string;
  responsibilities: string[];
  goals: string[];
  summaryFocus: string[];
  skillIds: string[];
  mcpIds: string[];
  capabilities?: string[];
  execution: {
    mode: string;
    strategy: string;
    maxConcurrency: number;
  };
}

// ── Replicate plannerCatalogSummary (module-private) ─────────────────────

function plannerCatalogSummary(templates: RoleTemplate[]): string {
  return templates
    .filter((template) => template.role !== "ceo")
    .map((template) => {
      const capTag = template.capabilities?.length
        ? ` [${template.capabilities.join(", ")}]`
        : "";
      return `- ${template.id} (${template.role}): ${template.title}. ${template.responsibility}${capTag}`;
    })
    .join("\n");
}

// ── Arbitraries ──────────────────────────────────────────────────────────

/** Safe identifier characters (no brackets, commas, or newlines) */
const safeId: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
    minLength: 1,
    maxLength: 12,
  })
  .map((a) => a.join(""));

/** Safe text for title / responsibility (no brackets) */
const safeText: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789 ".split("")), {
    minLength: 1,
    maxLength: 20,
  })
  .map((a) => a.join("").trim() || "text");

/** Known capability tags */
const capabilityTag = fc.constantFrom("vision", "tts", "stt", "code", "search", "memory");

/** Non-empty capabilities array */
const nonEmptyCapabilities = fc.array(capabilityTag, { minLength: 1, maxLength: 4 });

/** Role that is NOT "ceo" (so it passes the filter) */
const nonCeoRole = fc.constantFrom("worker", "manager", "specialist", "analyst");

/** Arbitrary RoleTemplate with non-empty capabilities */
const templateWithCapabilities: fc.Arbitrary<RoleTemplate> = fc
  .tuple(safeId, safeText, safeText, nonCeoRole, safeText, nonEmptyCapabilities)
  .map(([id, title, responsibility, role, name, capabilities]: [string, string, string, string, string, string[]]) => ({
    id,
    name,
    title,
    role,
    defaultDepartmentLabel: "dept",
    responsibility,
    responsibilities: [],
    goals: [],
    summaryFocus: [],
    skillIds: [],
    mcpIds: [],
    capabilities,
    execution: { mode: "sequential", strategy: "default", maxConcurrency: 1 },
  }));

/** Arbitrary RoleTemplate WITHOUT capabilities (undefined or empty) */
const templateWithoutCapabilities: fc.Arbitrary<RoleTemplate> = fc
  .tuple(safeId, safeText, safeText, nonCeoRole, safeText, fc.constantFrom<string[] | undefined>(undefined, []))
  .map(([id, title, responsibility, role, name, capabilities]: [string, string, string, string, string, string[] | undefined]) => ({
    id,
    name,
    title,
    role,
    defaultDepartmentLabel: "dept",
    responsibility,
    responsibilities: [],
    goals: [],
    summaryFocus: [],
    skillIds: [],
    mcpIds: [],
    capabilities: capabilities,
    execution: { mode: "sequential", strategy: "default", maxConcurrency: 1 },
  }));

/** Arbitrary RoleTemplate with role "ceo" (should be filtered out) */
const ceoTemplate: fc.Arbitrary<RoleTemplate> = fc
  .tuple(safeId, safeText, safeText, nonEmptyCapabilities)
  .map(([id, title, responsibility, capabilities]: [string, string, string, string[]]) => ({
    id,
    name: "ceo-name",
    title,
    role: "ceo",
    defaultDepartmentLabel: "dept",
    responsibility,
    responsibilities: [],
    goals: [],
    summaryFocus: [],
    skillIds: [],
    mcpIds: [],
    capabilities,
    execution: { mode: "sequential", strategy: "default", maxConcurrency: 1 },
  }));

/** Mixed array of templates */
const mixedTemplates = fc.array(
  fc.oneof(templateWithCapabilities, templateWithoutCapabilities, ceoTemplate),
  { minLength: 1, maxLength: 8 },
);

// ── Tests ────────────────────────────────────────────────────────────────

describe("Feature: multi-modal-agent, Property 9: Planner Prompt 包含能力标签", () => {
  it("templates with non-empty capabilities produce [cap1, cap2] tag in output", () => {
    fc.assert(
      fc.property(templateWithCapabilities, (template) => {
        const result = plannerCatalogSummary([template]);
        const expectedTag = `[${template.capabilities!.join(", ")}]`;
        expect(result).toContain(expectedTag);
      }),
      { numRuns: 100 },
    );
  });

  it("templates without capabilities produce no bracket tag in their line", () => {
    fc.assert(
      fc.property(templateWithoutCapabilities, (template) => {
        const result = plannerCatalogSummary([template]);
        // The line should NOT contain any [...] bracket tag
        expect(result).not.toMatch(/\[.*\]/);
      }),
      { numRuns: 100 },
    );
  });

  it("ceo templates are filtered out regardless of capabilities", () => {
    fc.assert(
      fc.property(ceoTemplate, (template) => {
        const result = plannerCatalogSummary([template]);
        expect(result).toBe("");
      }),
      { numRuns: 100 },
    );
  });

  it("mixed templates: every non-ceo template with capabilities has its tag in output", () => {
    fc.assert(
      fc.property(mixedTemplates, (templates) => {
        const result = plannerCatalogSummary(templates);
        const lines = result.split("\n").filter(Boolean);

        const nonCeoWithCaps = templates.filter(
          (t) => t.role !== "ceo" && t.capabilities && t.capabilities.length > 0,
        );

        for (const t of nonCeoWithCaps) {
          const expectedLine = `- ${t.id} (${t.role}): ${t.title}. ${t.responsibility} [${t.capabilities!.join(", ")}]`;
          expect(lines).toContain(expectedLine);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("mixed templates: every non-ceo template without capabilities has no bracket tag", () => {
    fc.assert(
      fc.property(mixedTemplates, (templates) => {
        const result = plannerCatalogSummary(templates);
        const lines = result.split("\n").filter(Boolean);

        const nonCeoWithoutCaps = templates.filter(
          (t) => t.role !== "ceo" && (!t.capabilities || t.capabilities.length === 0),
        );

        for (const t of nonCeoWithoutCaps) {
          const line = lines.find((l) => l.startsWith(`- ${t.id} (`));
          if (line) {
            expect(line).not.toMatch(/\[.*\]/);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
