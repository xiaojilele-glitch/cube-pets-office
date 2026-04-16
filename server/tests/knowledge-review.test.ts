import { beforeEach, describe, expect, it } from "vitest";

import { GraphStore } from "../knowledge/graph-store.js";
import { KnowledgeReviewQueue } from "../knowledge/review-queue.js";
import type {
  Entity,
  EntitySource,
  ReviewAction,
} from "../../shared/knowledge/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT = "test-project";
let defaultProjectId = PROJECT;

function uniqueProjectId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeEntity(
  store: GraphStore,
  overrides?: Partial<
    Omit<Entity, "entityId" | "createdAt" | "updatedAt" | "status">
  >
): Entity {
  return store.createEntity({
    entityType: overrides?.entityType ?? "CodeModule",
    name: overrides?.name ?? `entity-${Math.random().toString(36).slice(2, 8)}`,
    description: overrides?.description ?? "test entity",
    source: overrides?.source ?? ("code_analysis" as EntitySource),
    confidence: overrides?.confidence ?? 0.8,
    projectId: overrides?.projectId ?? defaultProjectId,
    needsReview: overrides?.needsReview ?? false,
    linkedMemoryIds: overrides?.linkedMemoryIds ?? [],
    extendedAttributes: overrides?.extendedAttributes ?? {},
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let store: GraphStore;
let queue: KnowledgeReviewQueue;

beforeEach(() => {
  defaultProjectId = uniqueProjectId("review-project");
  store = new GraphStore();
  queue = new KnowledgeReviewQueue(store);
});

// -------------------------------------------------------------------------
// getQueue
// -------------------------------------------------------------------------

describe("getQueue", () => {
  it("returns entities needing review (confidence < 0.5 or needsReview)", () => {
    // Should be in queue: low confidence
    const low = makeEntity(store, { confidence: 0.3 });
    // Should be in queue: needsReview flag
    const flagged = makeEntity(store, { confidence: 0.9, needsReview: true });
    // Should NOT be in queue: high confidence, no flag
    makeEntity(store, { confidence: 0.8, needsReview: false });

    const result = queue.getQueue();
    const ids = result.map(e => e.entityId);

    expect(ids).toContain(low.entityId);
    expect(ids).toContain(flagged.entityId);
    expect(result).toHaveLength(2);
  });

  it("filters by projectId", () => {
    const projectA = uniqueProjectId("proj-a");
    const projectB = uniqueProjectId("proj-b");
    makeEntity(store, { confidence: 0.2, projectId: projectA });
    makeEntity(store, { confidence: 0.2, projectId: projectB });

    const result = queue.getQueue({ projectId: projectA });
    expect(result).toHaveLength(1);
    expect(result[0].projectId).toBe(projectA);
  });

  it("filters by entityType", () => {
    makeEntity(store, { confidence: 0.2, entityType: "CodeModule" });
    makeEntity(store, { confidence: 0.2, entityType: "API" });

    const result = queue.getQueue({ entityType: "CodeModule" });
    expect(result).toHaveLength(1);
    expect(result[0].entityType).toBe("CodeModule");
  });

  it("sorts by confidence ascending by default", () => {
    makeEntity(store, { confidence: 0.4 });
    makeEntity(store, { confidence: 0.1 });
    makeEntity(store, { confidence: 0.3 });

    const result = queue.getQueue();
    expect(result[0].confidence).toBe(0.1);
    expect(result[1].confidence).toBe(0.3);
    expect(result[2].confidence).toBe(0.4);
  });

  it("excludes archived entities", () => {
    const entity = makeEntity(store, { confidence: 0.2 });
    // Manually archive it
    store.updateEntity(entity.entityId, { status: "archived" });

    const result = queue.getQueue();
    expect(result).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// review — approve
// -------------------------------------------------------------------------

describe("review — approve", () => {
  it("human approve sets confidence to max(current, 0.8)", () => {
    const entity = makeEntity(store, { confidence: 0.3, needsReview: true });

    const action: ReviewAction = {
      action: "approve",
      reviewedBy: "user-1",
      reviewerType: "human",
    };

    const updated = queue.review(entity.entityId, action);
    expect(updated.confidence).toBe(0.8);
    expect(updated.needsReview).toBe(false);
  });

  it("human approve keeps confidence if already above 0.8", () => {
    const entity = makeEntity(store, { confidence: 0.95, needsReview: true });

    const action: ReviewAction = {
      action: "approve",
      reviewedBy: "user-1",
      reviewerType: "human",
    };

    const updated = queue.review(entity.entityId, action);
    expect(updated.confidence).toBe(0.95);
  });

  it("agent approve sets confidence to max(current, 0.7)", () => {
    const entity = makeEntity(store, { confidence: 0.3, needsReview: true });

    const action: ReviewAction = {
      action: "approve",
      reviewedBy: "agent-1",
      reviewerType: "agent",
    };

    const updated = queue.review(entity.entityId, action);
    expect(updated.confidence).toBe(0.7);
    expect(updated.needsReview).toBe(false);
  });

  it("agent approve keeps confidence if already above 0.7", () => {
    const entity = makeEntity(store, { confidence: 0.85, needsReview: true });

    const action: ReviewAction = {
      action: "approve",
      reviewedBy: "agent-1",
      reviewerType: "agent",
    };

    const updated = queue.review(entity.entityId, action);
    expect(updated.confidence).toBe(0.85);
  });
});

// -------------------------------------------------------------------------
// review — reject
// -------------------------------------------------------------------------

describe("review — reject", () => {
  it("archives the entity with rejection reason", () => {
    const entity = makeEntity(store, { confidence: 0.2, needsReview: true });

    const action: ReviewAction = {
      action: "reject",
      reviewedBy: "user-1",
      reviewerType: "human",
      rejectionReason: "Inaccurate information",
    };

    const updated = queue.review(entity.entityId, action);
    expect(updated.status).toBe("archived");
    expect(updated.needsReview).toBe(false);
    expect(updated.deprecationReason).toBe("Inaccurate information");
  });

  it("uses default rejection reason when none provided", () => {
    const entity = makeEntity(store, { confidence: 0.2, needsReview: true });

    const action: ReviewAction = {
      action: "reject",
      reviewedBy: "user-1",
      reviewerType: "human",
    };

    const updated = queue.review(entity.entityId, action);
    expect(updated.status).toBe("archived");
    expect(updated.deprecationReason).toBe("Rejected during review");
  });
});

// -------------------------------------------------------------------------
// review — edit
// -------------------------------------------------------------------------

describe("review — edit", () => {
  it("updates attributes then approves", () => {
    const entity = makeEntity(store, {
      confidence: 0.3,
      needsReview: true,
      extendedAttributes: { filePath: "/old/path.ts" },
    });

    const action: ReviewAction = {
      action: "edit",
      reviewedBy: "user-1",
      reviewerType: "human",
      editedAttributes: { filePath: "/new/path.ts", language: "typescript" },
    };

    const updated = queue.review(entity.entityId, action);
    expect(updated.confidence).toBe(0.8); // human approve
    expect(updated.needsReview).toBe(false);
    expect(updated.extendedAttributes).toMatchObject({
      filePath: "/new/path.ts",
      language: "typescript",
    });
  });

  it("edit by agent sets confidence to 0.7", () => {
    const entity = makeEntity(store, { confidence: 0.2, needsReview: true });

    const action: ReviewAction = {
      action: "edit",
      reviewedBy: "agent-1",
      reviewerType: "agent",
      editedAttributes: { note: "corrected" },
    };

    const updated = queue.review(entity.entityId, action);
    expect(updated.confidence).toBe(0.7);
  });
});

// -------------------------------------------------------------------------
// review — error cases
// -------------------------------------------------------------------------

describe("review — errors", () => {
  it("throws when entity not found", () => {
    const action: ReviewAction = {
      action: "approve",
      reviewedBy: "user-1",
      reviewerType: "human",
    };

    expect(() => queue.review("nonexistent-id", action)).toThrow(
      "Entity not found"
    );
  });
});

// -------------------------------------------------------------------------
// getQueueSize
// -------------------------------------------------------------------------

describe("getQueueSize", () => {
  it("returns the number of entities in the queue", () => {
    makeEntity(store, { confidence: 0.2 });
    makeEntity(store, { confidence: 0.1 });
    makeEntity(store, { confidence: 0.9 }); // not in queue

    expect(queue.getQueueSize()).toBe(2);
  });
});

// -------------------------------------------------------------------------
// checkBacklogAlert
// -------------------------------------------------------------------------

describe("checkBacklogAlert", () => {
  it("returns true when queue size exceeds threshold", () => {
    // Create entities that will be in the queue
    for (let i = 0; i < 5; i++) {
      makeEntity(store, { confidence: 0.1 });
    }

    // Use a low threshold for testing
    expect(queue.checkBacklogAlert(3)).toBe(true);
  });

  it("returns false when queue size is within threshold", () => {
    makeEntity(store, { confidence: 0.1 });
    makeEntity(store, { confidence: 0.2 });

    expect(queue.checkBacklogAlert(10)).toBe(false);
  });

  it("uses default threshold of 200", () => {
    // With only a few entities, should not trigger
    makeEntity(store, { confidence: 0.1 });
    expect(queue.checkBacklogAlert()).toBe(false);
  });
});

// -------------------------------------------------------------------------
// Property-Based Tests
// -------------------------------------------------------------------------

import fc from "fast-check";

describe("Feature: knowledge-graph, Property 21: 审核操作置信度调整", () => {
  /**
   * Validates: Requirements 7.2, 7.3
   *
   * For any review action "approve" by a human reviewer, the entity confidence
   * SHALL become max(currentConfidence, 0.8); for any review action "approve"
   * by a trusted Agent, the confidence SHALL become max(currentConfidence, 0.7);
   * for any review action "reject", the entity status SHALL become "archived".
   */

  const confidenceArb = fc.double({
    min: 0,
    max: 1,
    noNaN: true,
    noDefaultInfinity: true,
  });

  const reviewerIdArb = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter(s => s.trim().length > 0);

  it("human approve sets confidence to max(currentConfidence, 0.8)", () => {
    fc.assert(
      fc.property(confidenceArb, reviewerIdArb, (confidence, reviewerId) => {
        const entity = makeEntity(store, { confidence, needsReview: true });

        const action: ReviewAction = {
          action: "approve",
          reviewedBy: reviewerId,
          reviewerType: "human",
        };

        const updated = queue.review(entity.entityId, action);

        expect(updated.confidence).toBeCloseTo(Math.max(confidence, 0.8), 10);
        expect(updated.needsReview).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("agent approve sets confidence to max(currentConfidence, 0.7)", () => {
    fc.assert(
      fc.property(confidenceArb, reviewerIdArb, (confidence, reviewerId) => {
        const entity = makeEntity(store, { confidence, needsReview: true });

        const action: ReviewAction = {
          action: "approve",
          reviewedBy: reviewerId,
          reviewerType: "agent",
        };

        const updated = queue.review(entity.entityId, action);

        expect(updated.confidence).toBeCloseTo(Math.max(confidence, 0.7), 10);
        expect(updated.needsReview).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("reject sets entity status to archived", () => {
    fc.assert(
      fc.property(
        confidenceArb,
        reviewerIdArb,
        fc.constantFrom("human" as const, "agent" as const),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), {
          nil: undefined,
        }),
        (confidence, reviewerId, reviewerType, rejectionReason) => {
          const entity = makeEntity(store, { confidence, needsReview: true });

          const action: ReviewAction = {
            action: "reject",
            reviewedBy: reviewerId,
            reviewerType,
            rejectionReason,
          };

          const updated = queue.review(entity.entityId, action);

          expect(updated.status).toBe("archived");
          expect(updated.needsReview).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
