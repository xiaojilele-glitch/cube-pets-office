import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { beforeEach, describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { GraphStore } from "../knowledge/graph-store.js";
import { OntologyRegistry } from "../knowledge/ontology-registry.js";
import {
  AgentKnowledgeSink,
  type AgentSinkLLMProvider,
  type TaskCompletionOutput,
} from "../knowledge/agent-sink.js";
import { KnowledgeReviewQueue } from "../knowledge/review-queue.js";
import type {
  DecisionPayload,
  RulePayload,
  BugfixPayload,
} from "../../shared/knowledge/types.js";

const TEST_PROJECT = "test-project-sink";
const TEST_GRAPH_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/knowledge",
  `graph-${TEST_PROJECT}.json`,
);

function makeDecisionPayload(
  overrides: Partial<DecisionPayload> = {},
): DecisionPayload {
  return {
    context: "We need to choose a database for the new service",
    decision: "Use PostgreSQL for relational data",
    alternatives: ["MongoDB", "MySQL", "SQLite"],
    consequences: "Need to manage schema migrations",
    projectId: TEST_PROJECT,
    ...overrides,
  };
}

function makeRulePayload(overrides: Partial<RulePayload> = {}): RulePayload {
  return {
    name: "Max retry count",
    description: "API calls should retry at most 3 times before failing",
    projectId: TEST_PROJECT,
    ...overrides,
  };
}

function makeBugfixPayload(
  overrides: Partial<BugfixPayload> = {},
): BugfixPayload {
  return {
    bugDescription: "Memory leak in WebSocket handler",
    rootCause: "Event listeners were not cleaned up on disconnect",
    fix: "Added cleanup logic in the disconnect handler",
    relatedModules: ["websocket-handler"],
    projectId: TEST_PROJECT,
    ...overrides,
  };
}

describe("AgentKnowledgeSink", () => {
  let graphStore: GraphStore;
  let ontologyRegistry: OntologyRegistry;
  let sink: AgentKnowledgeSink;

  beforeEach(() => {
    fs.rmSync(TEST_GRAPH_PATH, { force: true });
    graphStore = new GraphStore();
    ontologyRegistry = new OntologyRegistry();
    sink = new AgentKnowledgeSink(graphStore, ontologyRegistry);
  });

  // -------------------------------------------------------------------------
  // recordDecision
  // -------------------------------------------------------------------------

  describe("recordDecision", () => {
    it("creates an ArchitectureDecision entity with correct extendedAttributes", () => {
      const payload = makeDecisionPayload();
      const entity = sink.recordDecision(payload);

      expect(entity.entityId).toBeDefined();
      expect(entity.entityType).toBe("ArchitectureDecision");
      expect(entity.source).toBe("agent_extracted");
      expect(entity.confidence).toBe(0.8);
      expect(entity.projectId).toBe(TEST_PROJECT);
      expect(entity.status).toBe("active");

      const ext = entity.extendedAttributes;
      expect(ext.context).toBe(payload.context);
      expect(ext.decision).toBe(payload.decision);
      expect(ext.alternatives).toEqual(payload.alternatives);
      expect(ext.consequences).toBe(payload.consequences);
    });

    it("throws when context is missing", () => {
      const payload = makeDecisionPayload({ context: "" });
      expect(() => sink.recordDecision(payload)).toThrow("context");
    });

    it("throws when decision is missing", () => {
      const payload = makeDecisionPayload({ decision: "" });
      expect(() => sink.recordDecision(payload)).toThrow("decision");
    });

    it("throws when alternatives is empty", () => {
      const payload = makeDecisionPayload({ alternatives: [] });
      expect(() => sink.recordDecision(payload)).toThrow("alternatives");
    });

    it("throws when consequences is missing", () => {
      const payload = makeDecisionPayload({ consequences: "" });
      expect(() => sink.recordDecision(payload)).toThrow("consequences");
    });

    it("throws listing all missing fields when multiple are absent", () => {
      const payload = makeDecisionPayload({
        context: "",
        decision: "",
        alternatives: [],
        consequences: "",
      });
      expect(() => sink.recordDecision(payload)).toThrow(
        /context.*decision.*alternatives.*consequences/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // recordRule
  // -------------------------------------------------------------------------

  describe("recordRule", () => {
    it("creates a BusinessRule entity", () => {
      const payload = makeRulePayload();
      const entity = sink.recordRule(payload);

      expect(entity.entityId).toBeDefined();
      expect(entity.entityType).toBe("BusinessRule");
      expect(entity.name).toBe(payload.name);
      expect(entity.description).toBe(payload.description);
      expect(entity.source).toBe("agent_extracted");
      expect(entity.confidence).toBe(0.8);
      expect(entity.projectId).toBe(TEST_PROJECT);
      expect(entity.status).toBe("active");
    });
  });

  // -------------------------------------------------------------------------
  // recordBugfix
  // -------------------------------------------------------------------------

  describe("recordBugfix", () => {
    it("creates a Bug entity with correct extendedAttributes", () => {
      const payload = makeBugfixPayload();
      const entity = sink.recordBugfix(payload);

      expect(entity.entityId).toBeDefined();
      expect(entity.entityType).toBe("Bug");
      expect(entity.source).toBe("agent_extracted");
      expect(entity.confidence).toBe(0.8);
      expect(entity.projectId).toBe(TEST_PROJECT);

      const ext = entity.extendedAttributes;
      expect(ext.rootCause).toBe(payload.rootCause);
      expect(ext.fix).toBe(payload.fix);
      expect(ext.severity).toBeDefined();
    });

    it("creates CAUSED_BY relations for each relatedModule", () => {
      const payload = makeBugfixPayload({
        relatedModules: ["module-a", "module-b"],
      });
      const entity = sink.recordBugfix(payload);

      const causedByRelations = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter(
          (r) =>
            r.relationType === "CAUSED_BY" &&
            r.sourceEntityId === entity.entityId,
        );

      expect(causedByRelations).toHaveLength(2);
    });

    it("creates RESOLVED_BY relation when fix is provided", () => {
      const payload = makeBugfixPayload({ fix: "Applied the patch" });
      const entity = sink.recordBugfix(payload);

      const resolvedByRelations = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter(
          (r) =>
            r.relationType === "RESOLVED_BY" &&
            r.sourceEntityId === entity.entityId,
        );

      expect(resolvedByRelations).toHaveLength(1);
    });

    it("does not create RESOLVED_BY relation when fix is empty", () => {
      const payload = makeBugfixPayload({ fix: "" });
      const entity = sink.recordBugfix(payload);

      const resolvedByRelations = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter(
          (r) =>
            r.relationType === "RESOLVED_BY" &&
            r.sourceEntityId === entity.entityId,
        );

      expect(resolvedByRelations).toHaveLength(0);
    });

    it("reuses existing CodeModule entities for relatedModules", () => {
      // Pre-create a CodeModule
      graphStore.createEntity({
        entityType: "CodeModule",
        name: "websocket-handler",
        description: "WS handler module",
        source: "code_analysis",
        confidence: 0.9,
        projectId: TEST_PROJECT,
        needsReview: false,
        linkedMemoryIds: [],
        extendedAttributes: {},
      });

      const payload = makeBugfixPayload({
        relatedModules: ["websocket-handler"],
      });
      sink.recordBugfix(payload);

      // Should not create a duplicate CodeModule
      const codeModules = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
        name: "websocket-handler",
      });
      expect(codeModules).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Validates all required fields for DecisionPayload
  // -------------------------------------------------------------------------

  describe("DecisionPayload validation edge cases", () => {
    it("accepts a valid payload without throwing", () => {
      const payload = makeDecisionPayload();
      expect(() => sink.recordDecision(payload)).not.toThrow();
    });

    it("rejects alternatives that is not an array", () => {
      const payload = makeDecisionPayload();
      // Force invalid type
      (payload as any).alternatives = "not-an-array";
      expect(() => sink.recordDecision(payload)).toThrow("alternatives");
    });
  });

  // -------------------------------------------------------------------------
  // autoLinkRelations (Requirement 3.5)
  // -------------------------------------------------------------------------

  describe("autoLinkRelations", () => {
    it("creates EXECUTED_BY relation when missionId is provided", () => {
      const payload = makeDecisionPayload({ missionId: "mission-42" });
      const entity = sink.recordDecision(payload);

      const relations = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter(
          (r) =>
            r.relationType === "EXECUTED_BY" &&
            r.sourceEntityId === entity.entityId,
        );

      expect(relations).toHaveLength(1);
      expect(relations[0].source).toBe("agent_extracted");
      expect(relations[0].confidence).toBe(0.8);

      // Mission entity should exist
      const missions = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "Mission",
        name: "mission-42",
      });
      expect(missions).toHaveLength(1);
    });

    it("creates KNOWS_ABOUT relation when agentId is provided", () => {
      const payload = makeRulePayload({ agentId: "agent-alpha" });
      const entity = sink.recordRule(payload);

      const relations = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter(
          (r) =>
            r.relationType === "KNOWS_ABOUT" &&
            r.targetEntityId === entity.entityId,
        );

      expect(relations).toHaveLength(1);
      expect(relations[0].source).toBe("agent_extracted");
      expect(relations[0].confidence).toBe(0.8);

      // Agent entity should exist
      const agents = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "Agent",
        name: "agent-alpha",
      });
      expect(agents).toHaveLength(1);
    });

    it("creates both EXECUTED_BY and KNOWS_ABOUT when both ids are provided", () => {
      const payload = makeBugfixPayload({
        missionId: "mission-99",
        agentId: "agent-beta",
      });
      const entity = sink.recordBugfix(payload);

      const executedBy = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter(
          (r) =>
            r.relationType === "EXECUTED_BY" &&
            r.sourceEntityId === entity.entityId,
        );
      const knowsAbout = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter(
          (r) =>
            r.relationType === "KNOWS_ABOUT" &&
            r.targetEntityId === entity.entityId,
        );

      expect(executedBy).toHaveLength(1);
      expect(knowsAbout).toHaveLength(1);
    });

    it("creates no auto-relations when neither missionId nor agentId is provided", () => {
      const payload = makeRulePayload();
      sink.recordRule(payload);

      const autoRelations = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter(
          (r) =>
            r.relationType === "EXECUTED_BY" ||
            r.relationType === "KNOWS_ABOUT",
        );

      expect(autoRelations).toHaveLength(0);
    });

    it("reuses existing Mission entity instead of creating a duplicate", () => {
      const payload1 = makeDecisionPayload({ missionId: "mission-shared" });
      const payload2 = makeRulePayload({ missionId: "mission-shared" });

      sink.recordDecision(payload1);
      sink.recordRule(payload2);

      const missions = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "Mission",
        name: "mission-shared",
      });
      expect(missions).toHaveLength(1);
    });

    it("reuses existing Agent entity instead of creating a duplicate", () => {
      const payload1 = makeDecisionPayload({ agentId: "agent-shared" });
      const payload2 = makeRulePayload({ agentId: "agent-shared" });

      sink.recordDecision(payload1);
      sink.recordRule(payload2);

      const agents = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "Agent",
        name: "agent-shared",
      });
      expect(agents).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // extractFromTaskCompletion (Requirement 3.2, 3.3, 3.6)
  // -------------------------------------------------------------------------

  describe("extractFromTaskCompletion", () => {
    function makeTaskOutput(
      overrides: Partial<TaskCompletionOutput> = {},
    ): TaskCompletionOutput {
      return {
        taskId: "task-001",
        missionId: "mission-extract",
        agentId: "agent-extractor",
        projectId: TEST_PROJECT,
        output:
          "Refactored the authentication module to use JWT tokens instead of session cookies.",
        ...overrides,
      };
    }

    function makeMockLLMProvider(
      response: string,
    ): AgentSinkLLMProvider {
      return {
        generate: async (_prompt: string) => response,
      };
    }

    const VALID_LLM_RESPONSE = JSON.stringify({
      entities: [
        {
          entityType: "CodeModule",
          name: "auth-module",
          description: "Authentication module using JWT",
          confidence: 0.8,
          extendedAttributes: { language: "typescript" },
        },
        {
          entityType: "ArchitectureDecision",
          name: "Use JWT tokens",
          description: "Switched from session cookies to JWT",
          confidence: 0.9,
        },
      ],
      relations: [
        {
          relationType: "DEPENDS_ON",
          sourceEntityName: "auth-module",
          targetEntityName: "Use JWT tokens",
          confidence: 0.85,
          evidence: "Auth module implements JWT decision",
        },
      ],
    });

    const LOW_CONFIDENCE_RESPONSE = JSON.stringify({
      entities: [
        {
          entityType: "BusinessRule",
          name: "Maybe a rule",
          description: "Uncertain extraction",
          confidence: 0.3,
        },
        {
          entityType: "CodeModule",
          name: "solid-module",
          description: "Clearly identified module",
          confidence: 0.9,
        },
      ],
      relations: [
        {
          relationType: "USES",
          sourceEntityName: "Maybe a rule",
          targetEntityName: "solid-module",
          confidence: 0.4,
          evidence: "Uncertain relation",
        },
      ],
    });

    it("creates entities from LLM output", async () => {
      sink.llmProvider = makeMockLLMProvider(VALID_LLM_RESPONSE);
      const taskOutput = makeTaskOutput();

      const summary = await sink.extractFromTaskCompletion(taskOutput);

      expect(summary.entitiesCreated).toBe(2);
      expect(summary.relationsCreated).toBe(1);

      // Verify entities exist in graph
      const authModule = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
        name: "auth-module",
      });
      expect(authModule).toHaveLength(1);
      expect(authModule[0].source).toBe("llm_inferred");
      expect(authModule[0].confidence).toBe(0.8);

      const decision = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "ArchitectureDecision",
        name: "Use JWT tokens",
      });
      expect(decision).toHaveLength(1);
    });

    it("marks low confidence entities with needsReview: true", async () => {
      sink.llmProvider = makeMockLLMProvider(LOW_CONFIDENCE_RESPONSE);
      const taskOutput = makeTaskOutput();

      const summary = await sink.extractFromTaskCompletion(taskOutput);

      expect(summary.pendingReviewCount).toBeGreaterThanOrEqual(1);

      // Low confidence entity should have needsReview
      const lowConfEntity = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "BusinessRule",
        name: "Maybe a rule",
      });
      expect(lowConfEntity).toHaveLength(1);
      expect(lowConfEntity[0].needsReview).toBe(true);
      expect(lowConfEntity[0].confidence).toBe(0.3);

      // High confidence entity should NOT have needsReview
      const highConfEntity = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "CodeModule",
        name: "solid-module",
      });
      expect(highConfEntity).toHaveLength(1);
      expect(highConfEntity[0].needsReview).toBe(false);
    });

    it("returns correct SinkSummary", async () => {
      sink.llmProvider = makeMockLLMProvider(VALID_LLM_RESPONSE);
      const taskOutput = makeTaskOutput();

      const summary = await sink.extractFromTaskCompletion(taskOutput);

      expect(summary).toEqual({
        entitiesCreated: 2,
        relationsCreated: 1,
        pendingReviewCount: 0,
      });
    });

    it("handles missing LLM provider gracefully", async () => {
      // No llmProvider set
      const taskOutput = makeTaskOutput();

      const summary = await sink.extractFromTaskCompletion(taskOutput);

      expect(summary).toEqual({
        entitiesCreated: 0,
        relationsCreated: 0,
        pendingReviewCount: 0,
      });
    });

    it("handles LLM provider error gracefully", async () => {
      sink.llmProvider = {
        generate: async () => {
          throw new Error("LLM service unavailable");
        },
      };
      const taskOutput = makeTaskOutput();

      const summary = await sink.extractFromTaskCompletion(taskOutput);

      expect(summary).toEqual({
        entitiesCreated: 0,
        relationsCreated: 0,
        pendingReviewCount: 0,
      });
    });

    it("handles malformed LLM response gracefully", async () => {
      sink.llmProvider = makeMockLLMProvider("not valid json at all");
      const taskOutput = makeTaskOutput();

      const summary = await sink.extractFromTaskCompletion(taskOutput);

      expect(summary).toEqual({
        entitiesCreated: 0,
        relationsCreated: 0,
        pendingReviewCount: 0,
      });
    });

    it("handles empty output text gracefully", async () => {
      sink.llmProvider = makeMockLLMProvider(VALID_LLM_RESPONSE);
      const taskOutput = makeTaskOutput({ output: "" });

      const summary = await sink.extractFromTaskCompletion(taskOutput);

      expect(summary).toEqual({
        entitiesCreated: 0,
        relationsCreated: 0,
        pendingReviewCount: 0,
      });
    });

    it("updates Mission entity with knowledgeSinkSummary", async () => {
      sink.llmProvider = makeMockLLMProvider(VALID_LLM_RESPONSE);
      const taskOutput = makeTaskOutput({ missionId: "mission-summary-test" });

      await sink.extractFromTaskCompletion(taskOutput);

      // Find the Mission entity
      const missions = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "Mission",
        name: "mission-summary-test",
      });
      expect(missions).toHaveLength(1);

      const sinkSummary = missions[0].extendedAttributes
        .knowledgeSinkSummary as Record<string, number>;
      expect(sinkSummary).toBeDefined();
      expect(sinkSummary.entitiesCreated).toBe(2);
      expect(sinkSummary.relationsCreated).toBe(1);
      expect(sinkSummary.pendingReviewCount).toBe(0);
    });

    it("accumulates knowledgeSinkSummary across multiple extractions", async () => {
      sink.llmProvider = makeMockLLMProvider(VALID_LLM_RESPONSE);
      const taskOutput = makeTaskOutput({ missionId: "mission-accum" });

      await sink.extractFromTaskCompletion(taskOutput);
      await sink.extractFromTaskCompletion(taskOutput);

      const missions = graphStore.findEntities({
        projectId: TEST_PROJECT,
        entityType: "Mission",
        name: "mission-accum",
      });
      expect(missions).toHaveLength(1);

      const sinkSummary = missions[0].extendedAttributes
        .knowledgeSinkSummary as Record<string, number>;
      // Second call merges same entities, but summary accumulates
      expect(sinkSummary.entitiesCreated).toBe(4);
      expect(sinkSummary.relationsCreated).toBe(2);
    });

    it("creates auto-link relations (EXECUTED_BY, KNOWS_ABOUT) for extracted entities", async () => {
      sink.llmProvider = makeMockLLMProvider(
        JSON.stringify({
          entities: [
            {
              entityType: "CodeModule",
              name: "linked-module",
              description: "A module",
              confidence: 0.8,
            },
          ],
          relations: [],
        }),
      );

      const taskOutput = makeTaskOutput({
        missionId: "mission-link",
        agentId: "agent-link",
      });

      await sink.extractFromTaskCompletion(taskOutput);

      // Check EXECUTED_BY relation exists
      const executedBy = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter((r) => r.relationType === "EXECUTED_BY");
      expect(executedBy.length).toBeGreaterThanOrEqual(1);

      // Check KNOWS_ABOUT relation exists
      const knowsAbout = graphStore
        .findRelations({ projectId: TEST_PROJECT })
        .filter((r) => r.relationType === "KNOWS_ABOUT");
      expect(knowsAbout.length).toBeGreaterThanOrEqual(1);
    });

    it("parses LLM response wrapped in markdown code fences", async () => {
      const wrappedResponse = "```json\n" + VALID_LLM_RESPONSE + "\n```";
      sink.llmProvider = makeMockLLMProvider(wrappedResponse);
      const taskOutput = makeTaskOutput();

      const summary = await sink.extractFromTaskCompletion(taskOutput);

      expect(summary.entitiesCreated).toBe(2);
    });

    it("counts low-confidence relations in pendingReviewCount", async () => {
      sink.llmProvider = makeMockLLMProvider(LOW_CONFIDENCE_RESPONSE);
      const taskOutput = makeTaskOutput();

      const summary = await sink.extractFromTaskCompletion(taskOutput);

      // 1 low-confidence entity + 1 low-confidence relation
      expect(summary.pendingReviewCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Feature: knowledge-graph, Property 8: ArchitectureDecision 必填字段验证
  // Validates: Requirements 3.4
  //
  // For any DecisionPayload missing at least one of the required fields
  // (context, decision, alternatives, consequences),
  // AgentKnowledgeSink.recordDecision() SHALL reject the write and return
  // an error.
  // -------------------------------------------------------------------------

  describe("Property 8: ArchitectureDecision 必填字段验证", () => {
    // Generator for a valid base payload (all required fields present)
    const validPayloadArb = fc.record({
      context: fc.string({ minLength: 1 }),
      decision: fc.string({ minLength: 1 }),
      alternatives: fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
      consequences: fc.string({ minLength: 1 }),
      projectId: fc.constant(TEST_PROJECT),
    });

    // The four required fields that can be individually invalidated
    const requiredFields = [
      "context",
      "decision",
      "alternatives",
      "consequences",
    ] as const;

    // Generator that picks a non-empty subset of required fields to invalidate
    const fieldsToInvalidateArb = fc
      .subarray(requiredFields as unknown as string[], { minLength: 1 })
      .filter((arr) => arr.length > 0);

    // Generator for an invalid value for a given field
    const invalidValueForField = (field: string) => {
      if (field === "alternatives") {
        // alternatives: empty array, non-array, undefined, or null
        return fc.oneof(
          fc.constant([]),
          fc.constant(undefined),
          fc.constant(null),
        );
      }
      // string fields: empty string, undefined, or null
      return fc.oneof(
        fc.constant(""),
        fc.constant(undefined),
        fc.constant(null),
      );
    };

    it(
      "rejects when any combination of required fields is missing/invalid (Validates: Requirements 3.4)",
      () => {
        fc.assert(
          fc.property(
            validPayloadArb,
            fieldsToInvalidateArb,
            fc.integer({ min: 0, max: 2 }), // index to pick invalid value variant
            (basePayload, fieldsToBreak, _seed) => {
              // Build a payload with selected fields invalidated
              const broken: Record<string, unknown> = { ...basePayload };

              for (const field of fieldsToBreak) {
                if (field === "alternatives") {
                  broken[field] = [];
                } else {
                  broken[field] = "";
                }
              }

              // recordDecision must throw for the broken payload
              expect(() =>
                sink.recordDecision(broken as DecisionPayload),
              ).toThrow(/Missing required fields/);

              // Verify the error message mentions each broken field
              try {
                sink.recordDecision(broken as DecisionPayload);
              } catch (e: any) {
                for (const field of fieldsToBreak) {
                  expect(e.message).toContain(field);
                }
              }
            },
          ),
          { numRuns: 100 },
        );
      },
    );

    it(
      "accepts when all required fields are present and valid (Validates: Requirements 3.4)",
      () => {
        fc.assert(
          fc.property(validPayloadArb, (payload) => {
            // Should NOT throw when all fields are valid
            const entity = sink.recordDecision(payload as DecisionPayload);
            expect(entity).toBeDefined();
            expect(entity.entityType).toBe("ArchitectureDecision");
            expect(entity.status).toBe("active");
            // Verify the extended attributes match the input
            expect(entity.extendedAttributes.context).toBe(payload.context);
            expect(entity.extendedAttributes.decision).toBe(payload.decision);
            expect(entity.extendedAttributes.alternatives).toEqual(
              payload.alternatives,
            );
            expect(entity.extendedAttributes.consequences).toBe(
              payload.consequences,
            );
          }),
          { numRuns: 100 },
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // Feature: knowledge-graph, Property 9: 低置信度实体进入审核队列
  // Validates: Requirements 3.3, 7.1
  //
  // For any entity with confidence < 0.5 or needsReview: true, the entity
  // SHALL appear in the KnowledgeReviewQueue, and SHALL NOT be included in
  // default graph query results (unless explicitly querying the review queue).
  // -------------------------------------------------------------------------

  describe("Property 9: 低置信度实体进入审核队列", () => {
    /**
     * Generator for a confidence value in [0.0, 1.0].
     * We use double() constrained to this range.
     */
    const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

    /**
     * Generator for a valid entity type from the core ontology.
     */
    const entityTypeArb = fc.constantFrom(
      "CodeModule",
      "API",
      "BusinessRule",
      "ArchitectureDecision",
      "TechStack",
      "Agent",
      "Role",
      "Mission",
      "Bug",
      "Config",
    );

    /**
     * Generator for a non-empty entity name.
     */
    const entityNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
      (s) => s.trim().length > 0,
    );

    it(
      "entities with confidence < 0.5 from passive extraction appear in review queue and are marked needsReview (Validates: Requirements 3.3, 7.1)",
      async () => {
        await fc.assert(
          fc.asyncProperty(
            confidenceArb,
            entityTypeArb,
            entityNameArb,
            async (confidence, entityType, entityName) => {
              // Fresh instances per iteration to avoid cross-contamination
              const gs = new GraphStore();
              const or = new OntologyRegistry();
              const rq = new KnowledgeReviewQueue(gs);
              const s = new AgentKnowledgeSink(gs, or, rq);

              const isLowConfidence = confidence < 0.5;

              // Build an LLM response that returns a single entity with the
              // generated confidence value
              const llmResponse = JSON.stringify({
                entities: [
                  {
                    entityType,
                    name: entityName,
                    description: `Test entity: ${entityName}`,
                    confidence,
                  },
                ],
                relations: [],
              });

              s.llmProvider = {
                generate: async () => llmResponse,
              };

              const summary = await s.extractFromTaskCompletion({
                taskId: "task-prop9",
                missionId: "mission-prop9",
                agentId: "agent-prop9",
                projectId: TEST_PROJECT,
                output: "Some task output for extraction",
              });

              // Find the created entity in the graph
              const entities = gs.findEntities({
                projectId: TEST_PROJECT,
                entityType,
                name: entityName,
              });
              const created = entities.find((e) => e.name === entityName);
              expect(created).toBeDefined();

              if (isLowConfidence) {
                // Low confidence → needsReview must be true
                expect(created!.needsReview).toBe(true);

                // Must appear in the review queue
                const queue = rq.getQueue({ projectId: TEST_PROJECT });
                const inQueue = queue.find(
                  (e) => e.entityId === created!.entityId,
                );
                expect(inQueue).toBeDefined();

                // pendingReviewCount must be >= 1
                expect(summary.pendingReviewCount).toBeGreaterThanOrEqual(1);
              } else {
                // High confidence → needsReview must be false
                expect(created!.needsReview).toBe(false);

                // Must NOT appear in the review queue
                const queue = rq.getQueue({ projectId: TEST_PROJECT });
                const inQueue = queue.find(
                  (e) => e.entityId === created!.entityId,
                );
                expect(inQueue).toBeUndefined();
              }
            },
          ),
          { numRuns: 100 },
        );
      },
    );

    it(
      "directly created entities with needsReview: true appear in review queue regardless of confidence (Validates: Requirements 7.1)",
    
      () => {
        fc.assert(
          fc.property(
            confidenceArb,
            entityTypeArb,
            entityNameArb,
            fc.boolean(),
            (confidence, entityType, entityName, needsReview) => {
              const gs = new GraphStore();
              const rq = new KnowledgeReviewQueue(gs);

              // Directly create an entity in the graph store
              const entity = gs.createEntity({
                entityType,
                name: entityName,
                description: `Direct entity: ${entityName}`,
                source: "agent_extracted",
                confidence,
                projectId: TEST_PROJECT,
                needsReview,
                linkedMemoryIds: [],
                extendedAttributes: {},
              });

              const queue = rq.getQueue({ projectId: TEST_PROJECT });
              const inQueue = queue.find(
                (e) => e.entityId === entity.entityId,
              );

              const shouldBeInQueue = confidence < 0.5 || needsReview;

              if (shouldBeInQueue) {
                // Entity must appear in the review queue
                expect(inQueue).toBeDefined();
              } else {
                // Entity must NOT appear in the review queue
                expect(inQueue).toBeUndefined();
              }
            },
          ),
          { numRuns: 100 },
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // Feature: knowledge-graph, Property 10: 知识写入自动关系建立
  // Validates: Requirements 3.5
  //
  // For any entity written to the graph with a missionId and agentId, the
  // GraphStore SHALL contain EXECUTED_BY relation linking the entity to the
  // Mission, and KNOWS_ABOUT relation linking the Agent to the entity,
  // without explicit specification by the caller.
  // -------------------------------------------------------------------------

  describe("Property 10: 知识写入自动关系建立", () => {
    /**
     * Generator for a non-empty identifier string (missionId / agentId).
     */
    const idArb = fc
      .string({ minLength: 1, maxLength: 40 })
      .filter((s) => s.trim().length > 0);

    /**
     * Generator that picks one of the three write methods to exercise.
     */
    const writeMethodArb = fc.constantFrom(
      "recordDecision" as const,
      "recordRule" as const,
      "recordBugfix" as const,
    );

    /**
     * Helper: invoke the chosen write method with the given missionId and agentId,
     * returning the created entity.
     */
    function writeEntity(
      s: AgentKnowledgeSink,
      method: "recordDecision" | "recordRule" | "recordBugfix",
      missionId: string,
      agentId: string,
    ) {
      switch (method) {
        case "recordDecision":
          return s.recordDecision(
            makeDecisionPayload({ missionId, agentId }),
          );
        case "recordRule":
          return s.recordRule(makeRulePayload({ missionId, agentId }));
        case "recordBugfix":
          return s.recordBugfix(makeBugfixPayload({ missionId, agentId }));
      }
    }

    it(
      "creates EXECUTED_BY and KNOWS_ABOUT relations automatically for any write with missionId and agentId (Validates: Requirements 3.5)",
      () => {
        fc.assert(
          fc.property(
            writeMethodArb,
            idArb,
            idArb,
            (method, missionId, agentId) => {
              // Fresh instances per iteration to avoid cross-contamination
              const gs = new GraphStore();
              const or = new OntologyRegistry();
              const s = new AgentKnowledgeSink(gs, or);

              const entity = writeEntity(s, method, missionId, agentId);

              // --- EXECUTED_BY: entity → Mission ---
              const executedByRels = gs
                .findRelations({ projectId: TEST_PROJECT })
                .filter(
                  (r) =>
                    r.relationType === "EXECUTED_BY" &&
                    r.sourceEntityId === entity.entityId,
                );

              expect(executedByRels).toHaveLength(1);

              // The target must be a Mission entity with the correct name
              const missionTarget = gs.getEntity(
                executedByRels[0].targetEntityId,
              );
              expect(missionTarget).toBeDefined();
              expect(missionTarget!.entityType).toBe("Mission");
              expect(missionTarget!.name).toBe(missionId);

              // --- KNOWS_ABOUT: Agent → entity ---
              const knowsAboutRels = gs
                .findRelations({ projectId: TEST_PROJECT })
                .filter(
                  (r) =>
                    r.relationType === "KNOWS_ABOUT" &&
                    r.targetEntityId === entity.entityId,
                );

              expect(knowsAboutRels).toHaveLength(1);

              // The source must be an Agent entity with the correct name
              const agentSource = gs.getEntity(
                knowsAboutRels[0].sourceEntityId,
              );
              expect(agentSource).toBeDefined();
              expect(agentSource!.entityType).toBe("Agent");
              expect(agentSource!.name).toBe(agentId);
            },
          ),
          { numRuns: 100 },
        );
      },
    );

    it(
      "does NOT create EXECUTED_BY or KNOWS_ABOUT when missionId/agentId are absent (Validates: Requirements 3.5)",
      () => {
        fc.assert(
          fc.property(writeMethodArb, (method) => {
            const gs = new GraphStore();
            const or = new OntologyRegistry();
            const s = new AgentKnowledgeSink(gs, or);

            // Write without missionId or agentId
            let entity;
            switch (method) {
              case "recordDecision":
                entity = s.recordDecision(makeDecisionPayload());
                break;
              case "recordRule":
                entity = s.recordRule(makeRulePayload());
                break;
              case "recordBugfix":
                entity = s.recordBugfix(makeBugfixPayload());
                break;
            }

            const autoRels = gs
              .findRelations({ projectId: TEST_PROJECT })
              .filter(
                (r) =>
                  r.relationType === "EXECUTED_BY" ||
                  r.relationType === "KNOWS_ABOUT",
              );

            expect(autoRels).toHaveLength(0);
          }),
          { numRuns: 100 },
        );
      },
    );
  });
});
