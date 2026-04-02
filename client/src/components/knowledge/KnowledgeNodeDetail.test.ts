/**
 * KnowledgeNodeDetail unit tests
 *
 * Validates: Requirements 9.2
 */

import { describe, it, expect, vi } from "vitest";
import type { Entity, Relation } from "@shared/knowledge/types";

// We test the helper logic and component contract without a DOM renderer.
// Import the module to verify it compiles and exports correctly.

describe("KnowledgeNodeDetail", () => {
  // -----------------------------------------------------------------------
  // Factory helpers
  // -----------------------------------------------------------------------

  function makeEntity(overrides: Partial<Entity> = {}): Entity {
    return {
      entityId: "e-1",
      entityType: "CodeModule",
      name: "auth-service",
      description: "Authentication service module",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-06-01T00:00:00Z",
      source: "code_analysis",
      confidence: 0.85,
      projectId: "proj-1",
      status: "active",
      needsReview: false,
      linkedMemoryIds: [],
      extendedAttributes: {
        filePath: "server/auth.ts",
        language: "typescript",
        linesOfCode: 200,
        complexity: 5,
        exports: ["login", "logout"],
      },
      ...overrides,
    };
  }

  function makeRelation(overrides: Partial<Relation> = {}): Relation {
    return {
      relationId: "r-1",
      relationType: "DEPENDS_ON",
      sourceEntityId: "e-1",
      targetEntityId: "e-2",
      weight: 0.8,
      evidence: "import statement",
      createdAt: "2025-01-01T00:00:00Z",
      source: "code_analysis",
      confidence: 0.9,
      needsReview: false,
      ...overrides,
    };
  }

  // -----------------------------------------------------------------------
  // Module export tests
  // -----------------------------------------------------------------------

  it("should export default component and props type", async () => {
    const mod = await import("./KnowledgeNodeDetail");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  // -----------------------------------------------------------------------
  // Props contract tests (type-level validation via factory)
  // -----------------------------------------------------------------------

  it("should accept null entity (renders nothing)", async () => {
    const mod = await import("./KnowledgeNodeDetail");
    const Component = mod.default;
    // Calling with null entity should return null (no crash)
    const result = Component({
      entity: null,
      relatedEntities: [],
      relations: [],
      onClose: vi.fn(),
      onNavigate: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it("should render when given a valid entity", async () => {
    const mod = await import("./KnowledgeNodeDetail");
    const Component = mod.default;
    const entity = makeEntity();
    const result = Component({
      entity,
      relatedEntities: [],
      relations: [],
      onClose: vi.fn(),
      onNavigate: vi.fn(),
    });
    // Should return a JSX element (not null)
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("should render with related entities and relations", async () => {
    const mod = await import("./KnowledgeNodeDetail");
    const Component = mod.default;
    const entity = makeEntity();
    const related = makeEntity({
      entityId: "e-2",
      name: "db-service",
      entityType: "CodeModule",
    });
    const relation = makeRelation();

    const result = Component({
      entity,
      relatedEntities: [related],
      relations: [relation],
      onClose: vi.fn(),
      onNavigate: vi.fn(),
    });
    expect(result).not.toBeNull();
  });

  it("should handle entity with empty extendedAttributes", async () => {
    const mod = await import("./KnowledgeNodeDetail");
    const Component = mod.default;
    const entity = makeEntity({ extendedAttributes: {} });
    const result = Component({
      entity,
      relatedEntities: [],
      relations: [],
      onClose: vi.fn(),
      onNavigate: vi.fn(),
    });
    expect(result).not.toBeNull();
  });

  it("should handle entity with low confidence (< 0.5)", async () => {
    const mod = await import("./KnowledgeNodeDetail");
    const Component = mod.default;
    const entity = makeEntity({ confidence: 0.3 });
    const result = Component({
      entity,
      relatedEntities: [],
      relations: [],
      onClose: vi.fn(),
      onNavigate: vi.fn(),
    });
    expect(result).not.toBeNull();
  });

  it("should handle incoming relation direction", async () => {
    const mod = await import("./KnowledgeNodeDetail");
    const Component = mod.default;
    const entity = makeEntity({ entityId: "e-2" });
    const related = makeEntity({ entityId: "e-1", name: "caller" });
    // Relation goes from e-1 → e-2, so from entity's perspective it's incoming
    const relation = makeRelation({
      sourceEntityId: "e-1",
      targetEntityId: "e-2",
    });

    const result = Component({
      entity,
      relatedEntities: [related],
      relations: [relation],
      onClose: vi.fn(),
      onNavigate: vi.fn(),
    });
    expect(result).not.toBeNull();
  });
});
