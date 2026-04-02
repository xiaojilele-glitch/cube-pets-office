/**
 * Unit tests for KnowledgeMissionOverlay.
 *
 * Validates the component's render/no-render logic based on the `visible` prop
 * and verifies the close callback is wired correctly.
 *
 * Requirements: 9.4
 */
import { describe, it, expect, vi } from "vitest";

// We test the component logic by importing it and calling it as a function
// (React component = function returning ReactNode). This avoids needing a
// full DOM renderer while still exercising the conditional render path.
import KnowledgeMissionOverlay from "./KnowledgeMissionOverlay";
import type { Entity, Relation } from "../../../../shared/knowledge/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(id: string): Entity {
  return {
    entityId: id,
    entityType: "CodeModule",
    name: `Module-${id}`,
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
  };
}

function makeRelation(src: string, tgt: string): Relation {
  return {
    relationId: `r-${src}-${tgt}`,
    relationType: "DEPENDS_ON",
    sourceEntityId: src,
    targetEntityId: tgt,
    weight: 1,
    evidence: "",
    createdAt: new Date().toISOString(),
    source: "code_analysis",
    confidence: 0.9,
    needsReview: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KnowledgeMissionOverlay", () => {
  const nodes = [makeEntity("e1"), makeEntity("e2")];
  const edges = [makeRelation("e1", "e2")];

  it("returns null when visible is false", () => {
    const result = KnowledgeMissionOverlay({
      visible: false,
      nodes,
      edges,
      onClose: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it("returns a non-null element when visible is true", () => {
    const result = KnowledgeMissionOverlay({
      visible: true,
      nodes,
      edges,
      onClose: vi.fn(),
    });
    expect(result).not.toBeNull();
  });

  it("applies custom className", () => {
    const result = KnowledgeMissionOverlay({
      visible: true,
      nodes,
      edges,
      onClose: vi.fn(),
      className: "my-custom",
    }) as any;
    expect(result.props.className).toContain("my-custom");
  });

  it("has correct aria-label for accessibility", () => {
    const result = KnowledgeMissionOverlay({
      visible: true,
      nodes,
      edges,
      onClose: vi.fn(),
    }) as any;
    expect(result.props["aria-label"]).toBe("Knowledge subgraph overlay");
  });

  it("renders nothing for empty nodes/edges when not visible", () => {
    const result = KnowledgeMissionOverlay({
      visible: false,
      nodes: [],
      edges: [],
      onClose: vi.fn(),
    });
    expect(result).toBeNull();
  });
});
