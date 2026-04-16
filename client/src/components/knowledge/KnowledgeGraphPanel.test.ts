/**
 * Unit tests for KnowledgeGraphPanel helper functions.
 *
 * Tests the pure logic exported from the component:
 * - getEntityColor: color mapping per entityType
 * - computeRadius: node size based on relation count
 * - matchesSearch: search term matching against entity name/type
 *
 * Requirements: 9.1, 9.2
 */
import { describe, it, expect } from "vitest";
import {
  getEntityColor,
  computeRadius,
  matchesSearch,
} from "./KnowledgeGraphPanel";
import type { Entity, Relation } from "../../../../shared/knowledge/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entityId: "e-1",
    entityType: "CodeModule",
    name: "TestModule",
    description: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "code_analysis",
    confidence: 0.9,
    projectId: "p1",
    status: "active",
    needsReview: false,
    linkedMemoryIds: [],
    extendedAttributes: {},
    ...overrides,
  };
}

function makeRelation(
  sourceEntityId: string,
  targetEntityId: string,
  overrides: Partial<Relation> = {}
): Relation {
  return {
    relationId: `r-${sourceEntityId}-${targetEntityId}`,
    relationType: "DEPENDS_ON",
    sourceEntityId,
    targetEntityId,
    weight: 1,
    evidence: "",
    createdAt: new Date().toISOString(),
    source: "code_analysis",
    confidence: 0.9,
    needsReview: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getEntityColor
// ---------------------------------------------------------------------------

describe("getEntityColor", () => {
  it("returns distinct colors for all 10 core entity types", () => {
    const types = [
      "CodeModule",
      "API",
      "BusinessRule",
      "ArchitectureDecision",
      "Bug",
      "Agent",
      "Mission",
      "TechStack",
      "Role",
      "Config",
    ];
    const colors = types.map(getEntityColor);
    // All should be non-empty hex strings
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    // All should be unique
    expect(new Set(colors).size).toBe(types.length);
  });

  it("returns a default color for unknown entity types", () => {
    const color = getEntityColor("UnknownType");
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(color).toBe("#95A5A6");
  });
});

// ---------------------------------------------------------------------------
// computeRadius
// ---------------------------------------------------------------------------

describe("computeRadius", () => {
  it("returns minimum radius when entity has no relations", () => {
    const r = computeRadius("e-1", []);
    expect(r).toBe(8); // NODE_MIN_RADIUS
  });

  it("increases radius with more connected relations", () => {
    const edges = [
      makeRelation("e-1", "e-2"),
      makeRelation("e-3", "e-1"),
      makeRelation("e-1", "e-4"),
    ];
    const r = computeRadius("e-1", edges);
    // 8 + 3 * 2 = 14
    expect(r).toBe(14);
  });

  it("caps at maximum radius", () => {
    // Create many relations to exceed max
    const edges = Array.from({ length: 20 }, (_, i) =>
      makeRelation("e-1", `e-${i + 10}`)
    );
    const r = computeRadius("e-1", edges);
    expect(r).toBe(24); // NODE_MAX_RADIUS
  });

  it("does not count relations for other entities", () => {
    const edges = [makeRelation("e-2", "e-3"), makeRelation("e-4", "e-5")];
    const r = computeRadius("e-1", edges);
    expect(r).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// matchesSearch
// ---------------------------------------------------------------------------

describe("matchesSearch", () => {
  const entity = makeEntity({ name: "AuthService", entityType: "API" });

  it("returns false for empty search term", () => {
    expect(matchesSearch(entity, "")).toBe(false);
  });

  it("matches by entity name (case-insensitive)", () => {
    expect(matchesSearch(entity, "auth")).toBe(true);
    expect(matchesSearch(entity, "AUTH")).toBe(true);
    expect(matchesSearch(entity, "Service")).toBe(true);
  });

  it("matches by entity type (case-insensitive)", () => {
    expect(matchesSearch(entity, "api")).toBe(true);
    expect(matchesSearch(entity, "API")).toBe(true);
  });

  it("returns false when no match", () => {
    expect(matchesSearch(entity, "database")).toBe(false);
  });
});
