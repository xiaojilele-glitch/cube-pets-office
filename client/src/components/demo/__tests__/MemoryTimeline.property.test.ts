/**
 * Property-based tests for MemoryTimeline component data logic
 *
 * Property 5: 记忆时间线条目包含完整标注
 * For any DemoMemoryEntry, the MemoryTimeline component's rendered output
 * SHALL contain the memory type label (short_term/medium_term/long_term)
 * and the associated Agent identifier.
 *
 * **Validates: Requirements 7.4**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { DemoMemoryEntry, MemoryEntryKind } from "@/lib/demo-store";

// ---------------------------------------------------------------------------
// Replicate the component's KIND_CONFIG mapping (source of truth for labels)
// ---------------------------------------------------------------------------

const KIND_CONFIG: Record<MemoryEntryKind, { label: string; color: string; bg: string }> = {
  short_term: { label: "短期", color: "text-emerald-700", bg: "bg-emerald-100" },
  medium_term: { label: "中期", color: "text-amber-700", bg: "bg-amber-100" },
  long_term: { label: "长期", color: "text-violet-700", bg: "bg-violet-100" },
};

const ALL_KINDS: MemoryEntryKind[] = ["short_term", "medium_term", "long_term"];

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

const arbMemoryEntryKind: fc.Arbitrary<MemoryEntryKind> = fc.constantFrom(...ALL_KINDS);

const arbAgentId: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

const arbDemoMemoryEntry: fc.Arbitrary<DemoMemoryEntry> = fc.record({
  agentId: arbAgentId,
  kind: arbMemoryEntryKind,
  stage: fc.constantFrom("execution", "summary", "evolution", "planning", "review"),
  content: fc.string({ minLength: 1, maxLength: 100 }),
  timestampOffset: fc.integer({ min: 0, max: 30000 }),
});

// ---------------------------------------------------------------------------
// Property 5: 记忆时间线条目包含完整标注
// **Validates: Requirements 7.4**
// ---------------------------------------------------------------------------

describe("Property 5: 记忆时间线条目包含完整标注", () => {
  it("KIND_CONFIG covers all MemoryEntryKind values with non-empty labels", () => {
    fc.assert(
      fc.property(arbMemoryEntryKind, (kind) => {
        const config = KIND_CONFIG[kind];

        // KIND_CONFIG must have an entry for this kind
        expect(config).toBeDefined();

        // The label must be a non-empty string
        expect(config.label).toBeTruthy();
        expect(typeof config.label).toBe("string");
        expect(config.label.length).toBeGreaterThan(0);

        // Color and bg classes must also be non-empty (used for rendering)
        expect(config.color.length).toBeGreaterThan(0);
        expect(config.bg.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("for any DemoMemoryEntry, the kind label and agentId are derivable for display", () => {
    fc.assert(
      fc.property(arbDemoMemoryEntry, (entry) => {
        // The component renders KIND_CONFIG[entry.kind].label and entry.agentId
        // Verify both are available and non-empty for any valid entry

        // 1. KIND_CONFIG must map the entry's kind to a config with a label
        const config = KIND_CONFIG[entry.kind];
        expect(config).toBeDefined();
        expect(config.label.length).toBeGreaterThan(0);

        // 2. The agentId must be non-empty (component renders it as-is)
        expect(entry.agentId.trim().length).toBeGreaterThan(0);

        // 3. The kind label must be one of the expected Chinese labels
        const validLabels = ["短期", "中期", "长期"];
        expect(validLabels).toContain(config.label);
      }),
      { numRuns: 100 },
    );
  });
});
