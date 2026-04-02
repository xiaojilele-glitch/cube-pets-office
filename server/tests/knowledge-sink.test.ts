import { beforeEach, describe, expect, it } from "vitest";

import { GraphStore } from "../knowledge/graph-store.js";
import { OntologyRegistry } from "../knowledge/ontology-registry.js";
import {
  AgentKnowledgeSink,
  type AgentSinkLLMProvider,
  type TaskCompletionOutput,
} from "../knowledge/agent-sink.js";
import type {
  DecisionPayload,
  RulePayload,
  BugfixPayload,
} from "../../shared/knowledge/types.js";

const TEST_PROJECT = "test-project-sink";

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
});
