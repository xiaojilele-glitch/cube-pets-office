/**
 * Unit tests for KnowledgeFilters helper functions and constants.
 *
 * Tests the pure logic exported from the component:
 * - CORE_ENTITY_TYPES: 10 core entity types
 * - CORE_RELATION_TYPES: 11 core relation types
 * - STATUS_OPTIONS: status filter options
 * - createDefaultFilterState: default filter state factory
 *
 * Requirements: 9.3
 */
import { describe, it, expect } from "vitest";
import {
  CORE_ENTITY_TYPES,
  CORE_RELATION_TYPES,
  STATUS_OPTIONS,
  createDefaultFilterState,
} from "./KnowledgeFilters";

// ---------------------------------------------------------------------------
// CORE_ENTITY_TYPES
// ---------------------------------------------------------------------------

describe("CORE_ENTITY_TYPES", () => {
  it("contains exactly 10 core entity types", () => {
    expect(CORE_ENTITY_TYPES).toHaveLength(10);
  });

  it("includes all expected types from the ontology", () => {
    const expected = [
      "CodeModule", "API", "BusinessRule", "ArchitectureDecision",
      "TechStack", "Agent", "Role", "Mission", "Bug", "Config",
    ];
    for (const t of expected) {
      expect(CORE_ENTITY_TYPES).toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------
// CORE_RELATION_TYPES
// ---------------------------------------------------------------------------

describe("CORE_RELATION_TYPES", () => {
  it("contains exactly 11 core relation types", () => {
    expect(CORE_RELATION_TYPES).toHaveLength(11);
  });

  it("includes all expected types from the ontology", () => {
    const expected = [
      "DEPENDS_ON", "CALLS", "IMPLEMENTS", "DECIDED_BY", "SUPERSEDES",
      "USES", "CAUSED_BY", "RESOLVED_BY", "BELONGS_TO", "EXECUTED_BY",
      "KNOWS_ABOUT",
    ];
    for (const t of expected) {
      expect(CORE_RELATION_TYPES).toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------
// STATUS_OPTIONS
// ---------------------------------------------------------------------------

describe("STATUS_OPTIONS", () => {
  it("contains all, active, deprecated, archived options", () => {
    const values = STATUS_OPTIONS.map((o) => o.value);
    expect(values).toEqual(["all", "active", "deprecated", "archived"]);
  });
});

// ---------------------------------------------------------------------------
// createDefaultFilterState
// ---------------------------------------------------------------------------

describe("createDefaultFilterState", () => {
  it("enables all 10 entity types by default", () => {
    const state = createDefaultFilterState();
    expect(state.entityTypes.size).toBe(10);
    for (const t of CORE_ENTITY_TYPES) {
      expect(state.entityTypes.has(t)).toBe(true);
    }
  });

  it("enables all 11 relation types by default", () => {
    const state = createDefaultFilterState();
    expect(state.relationTypes.size).toBe(11);
    for (const t of CORE_RELATION_TYPES) {
      expect(state.relationTypes.has(t)).toBe(true);
    }
  });

  it("sets confidenceMin to 0", () => {
    const state = createDefaultFilterState();
    expect(state.confidenceMin).toBe(0);
  });

  it("defaults status to 'active'", () => {
    const state = createDefaultFilterState();
    expect(state.status).toBe("active");
  });

  it("returns independent instances on each call", () => {
    const a = createDefaultFilterState();
    const b = createDefaultFilterState();
    a.entityTypes.delete("Bug");
    expect(b.entityTypes.has("Bug")).toBe(true);
  });
});
