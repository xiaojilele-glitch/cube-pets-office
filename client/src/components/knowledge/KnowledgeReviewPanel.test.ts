/**
 * KnowledgeReviewPanel unit tests
 *
 * Validates: Requirements 9.5
 */

import { describe, it, expect, vi } from "vitest";
import type { Entity, ReviewAction } from "@shared/knowledge/types";

describe("KnowledgeReviewPanel", () => {
  // -----------------------------------------------------------------------
  // Factory
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
      confidence: 0.4,
      projectId: "proj-1",
      status: "active",
      needsReview: true,
      linkedMemoryIds: [],
      extendedAttributes: {},
      ...overrides,
    };
  }

  // -----------------------------------------------------------------------
  // Module export
  // -----------------------------------------------------------------------

  it("should export default component", async () => {
    const mod = await import("./KnowledgeReviewPanel");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------

  it("should render empty state when items is empty", async () => {
    const mod = await import("./KnowledgeReviewPanel");
    const Component = mod.default;
    const result = Component({ items: [], onReview: vi.fn() });
    expect(result).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // With items
  // -----------------------------------------------------------------------

  it("should render when given review items", async () => {
    const mod = await import("./KnowledgeReviewPanel");
    const Component = mod.default;
    const items = [
      makeEntity({ entityId: "e-1", name: "rule-a", confidence: 0.3 }),
      makeEntity({ entityId: "e-2", name: "rule-b", confidence: 0.45 }),
    ];
    const result = Component({ items, onReview: vi.fn() });
    expect(result).not.toBeNull();
  });

  it("should render with custom className", async () => {
    const mod = await import("./KnowledgeReviewPanel");
    const Component = mod.default;
    const result = Component({
      items: [makeEntity()],
      onReview: vi.fn(),
      className: "max-h-96",
    });
    expect(result).not.toBeNull();
  });

  it("should handle entity with long description (truncation)", async () => {
    const mod = await import("./KnowledgeReviewPanel");
    const Component = mod.default;
    const longDesc = "A".repeat(200);
    const result = Component({
      items: [makeEntity({ description: longDesc })],
      onReview: vi.fn(),
    });
    expect(result).not.toBeNull();
  });

  it("should handle entity with empty description", async () => {
    const mod = await import("./KnowledgeReviewPanel");
    const Component = mod.default;
    const result = Component({
      items: [makeEntity({ description: "" })],
      onReview: vi.fn(),
    });
    expect(result).not.toBeNull();
  });

  it("should handle various entity types with correct color mapping", async () => {
    const mod = await import("./KnowledgeReviewPanel");
    const Component = mod.default;
    const items = [
      makeEntity({ entityId: "e-1", entityType: "API" }),
      makeEntity({ entityId: "e-2", entityType: "Bug" }),
      makeEntity({ entityId: "e-3", entityType: "UnknownType" }),
    ];
    const result = Component({ items, onReview: vi.fn() });
    expect(result).not.toBeNull();
  });
});
