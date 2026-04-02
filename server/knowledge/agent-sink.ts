/**
 * AgentKnowledgeSink — Agent 知识沉淀服务
 *
 * 负责将 Agent 执行过程中产生的知识（架构决策、业务规则、缺陷修复经验）写入图谱。
 * 支持主动写入（recordDecision / recordRule / recordBugfix）。
 *
 * Requirements: 3.1, 3.4
 */

import type {
  Entity,
  DecisionPayload,
  RulePayload,
  BugfixPayload,
  SinkSummary,
} from "../../shared/knowledge/types.js";

import type { GraphStore } from "./graph-store.js";
import type { OntologyRegistry } from "./ontology-registry.js";

// ---------------------------------------------------------------------------
// LLM provider interface (mirrors CodeExtractorLLMProvider from code-extractor)
// ---------------------------------------------------------------------------

export interface AgentSinkLLMProvider {
  generate(prompt: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Task completion output — input for passive extraction
// ---------------------------------------------------------------------------

export interface TaskCompletionOutput {
  taskId: string;
  missionId: string;
  agentId: string;
  projectId: string;
  output: string; // Agent's output text (code diff, docs, conversation)
}

// ---------------------------------------------------------------------------
// Minimal review queue interface — the full KnowledgeReviewQueue is Task 9.
// We only need the shape here so the constructor signature is forward-compatible.
// ---------------------------------------------------------------------------

export interface KnowledgeReviewQueueLike {
  getQueueSize?(): number;
}

// ---------------------------------------------------------------------------
// AgentKnowledgeSink
// ---------------------------------------------------------------------------

export class AgentKnowledgeSink {
  private graphStore: GraphStore;
  private ontologyRegistry: OntologyRegistry;
  private reviewQueue?: KnowledgeReviewQueueLike;

  /** Optional LLM provider for passive extraction from task completions */
  llmProvider?: AgentSinkLLMProvider;

  constructor(
    graphStore: GraphStore,
    ontologyRegistry: OntologyRegistry,
    reviewQueue?: KnowledgeReviewQueueLike,
  ) {
    this.graphStore = graphStore;
    this.ontologyRegistry = ontologyRegistry;
    this.reviewQueue = reviewQueue;
  }

  // -----------------------------------------------------------------------
  // recordDecision (Requirement 3.1, 3.4)
  // -----------------------------------------------------------------------

  recordDecision(payload: DecisionPayload): Entity {
    const missing = this.validateDecisionPayload(payload);
    if (missing.length > 0) {
      throw new Error(
        `Missing required fields for ArchitectureDecision: ${missing.join(", ")}`,
      );
    }

    const entity = this.graphStore.createEntity({
      entityType: "ArchitectureDecision",
      name: `Decision: ${payload.decision.slice(0, 80)}`,
      description: payload.context,
      source: "agent_extracted",
      confidence: 0.8,
      projectId: payload.projectId,
      needsReview: false,
      linkedMemoryIds: [],
      extendedAttributes: {
        context: payload.context,
        decision: payload.decision,
        alternatives: payload.alternatives,
        consequences: payload.consequences,
      },
    });

    this.autoLinkRelations(entity, payload.missionId, payload.agentId);
    return entity;
  }

  // -----------------------------------------------------------------------
  // recordRule (Requirement 3.1)
  // -----------------------------------------------------------------------

  recordRule(payload: RulePayload): Entity {
    const entity = this.graphStore.createEntity({
      entityType: "BusinessRule",
      name: payload.name,
      description: payload.description,
      source: "agent_extracted",
      confidence: 0.8,
      projectId: payload.projectId,
      needsReview: false,
      linkedMemoryIds: [],
      extendedAttributes: {},
    });

    this.autoLinkRelations(entity, payload.missionId, payload.agentId);
    return entity;
  }

  // -----------------------------------------------------------------------
  // recordBugfix (Requirement 3.1)
  // -----------------------------------------------------------------------

  recordBugfix(payload: BugfixPayload): Entity {
    // Derive severity from rootCause length as a simple heuristic
    const severity =
      payload.rootCause.length > 200
        ? "high"
        : payload.rootCause.length > 50
          ? "medium"
          : "low";

    const bugEntity = this.graphStore.createEntity({
      entityType: "Bug",
      name: `Bug: ${payload.bugDescription.slice(0, 80)}`,
      description: payload.bugDescription,
      source: "agent_extracted",
      confidence: 0.8,
      projectId: payload.projectId,
      needsReview: false,
      linkedMemoryIds: [],
      extendedAttributes: {
        severity,
        rootCause: payload.rootCause,
        fix: payload.fix,
      },
    });

    // Create CAUSED_BY relations for each related module
    for (const moduleName of payload.relatedModules) {
      // Try to find existing CodeModule entity; if not found, create a placeholder
      const existing = this.graphStore.findEntities({
        projectId: payload.projectId,
        entityType: "CodeModule",
        name: moduleName,
      });

      const targetId =
        existing.length > 0
          ? existing[0].entityId
          : this.graphStore.createEntity({
              entityType: "CodeModule",
              name: moduleName,
              description: `Module referenced by bugfix: ${moduleName}`,
              source: "agent_extracted",
              confidence: 0.6,
              projectId: payload.projectId,
              needsReview: false,
              linkedMemoryIds: [],
              extendedAttributes: {},
            }).entityId;

      this.graphStore.createRelation({
        relationType: "CAUSED_BY",
        sourceEntityId: bugEntity.entityId,
        targetEntityId: targetId,
        weight: 0.8,
        evidence: `Bug caused by module: ${moduleName}`,
        source: "agent_extracted",
        confidence: 0.8,
        needsReview: false,
      });
    }

    // Create RESOLVED_BY relation if fix info is available
    if (payload.fix) {
      // The bug is "resolved by" itself (the fix is embedded in the Bug entity).
      // Create a self-referencing RESOLVED_BY to record the fix relationship.
      this.graphStore.createRelation({
        relationType: "RESOLVED_BY",
        sourceEntityId: bugEntity.entityId,
        targetEntityId: bugEntity.entityId,
        weight: 0.9,
        evidence: `Fix: ${payload.fix.slice(0, 200)}`,
        source: "agent_extracted",
        confidence: 0.8,
        needsReview: false,
      });
    }

    // Auto-link to Mission/Agent (skip BELONGS_TO for bugfix — already handled by CAUSED_BY)
    this.autoLinkRelations(bugEntity, payload.missionId, payload.agentId, true);

    return bugEntity;
  }

  // -----------------------------------------------------------------------
  // extractFromTaskCompletion — Passive extraction (Requirement 3.2, 3.3, 3.6)
  // -----------------------------------------------------------------------

  async extractFromTaskCompletion(
    taskOutput: TaskCompletionOutput,
  ): Promise<SinkSummary> {
    const emptySummary: SinkSummary = {
      entitiesCreated: 0,
      relationsCreated: 0,
      pendingReviewCount: 0,
    };

    if (!this.llmProvider) {
      console.warn(
        "[AgentKnowledgeSink] No LLM provider configured — skipping passive extraction",
      );
      return emptySummary;
    }

    if (!taskOutput.output || taskOutput.output.trim().length === 0) {
      return emptySummary;
    }

    // 1. Build prompt with ontology context and send to LLM
    const ontologyContext = this.buildOntologyPromptContext();
    const prompt = this.buildExtractionPrompt(taskOutput.output, ontologyContext);

    let llmResponse: string;
    try {
      llmResponse = await this.llmProvider.generate(prompt);
    } catch (e) {
      console.warn(
        "[AgentKnowledgeSink] LLM extraction failed:",
        e instanceof Error ? e.message : String(e),
      );
      return emptySummary;
    }

    // 2. Parse LLM response as JSON
    const parsed = this.parseLLMResponse(llmResponse);
    if (!parsed) {
      console.warn(
        "[AgentKnowledgeSink] Failed to parse LLM response as JSON",
      );
      return emptySummary;
    }

    let entitiesCreated = 0;
    let relationsCreated = 0;
    let pendingReviewCount = 0;

    // 3. Process extracted entities
    for (const rawEntity of parsed.entities) {
      if (!rawEntity.entityType || !rawEntity.name) continue;

      const confidence =
        typeof rawEntity.confidence === "number" ? rawEntity.confidence : 0.7;
      const needsReview = confidence < 0.5;

      const entity = this.graphStore.mergeEntity({
        entityType: rawEntity.entityType,
        name: rawEntity.name,
        description:
          rawEntity.description ||
          `${rawEntity.entityType}: ${rawEntity.name}`,
        source: "llm_inferred",
        confidence,
        projectId: taskOutput.projectId,
        needsReview,
        linkedMemoryIds: [],
        extendedAttributes: rawEntity.extendedAttributes || {},
      });

      if (needsReview) {
        pendingReviewCount++;
      }

      // Auto-link relations (EXECUTED_BY, KNOWS_ABOUT)
      this.autoLinkRelations(
        entity,
        taskOutput.missionId,
        taskOutput.agentId,
      );

      entitiesCreated++;
    }

    // 4. Process extracted relations
    for (const rawRelation of parsed.relations) {
      if (
        !rawRelation.relationType ||
        !rawRelation.sourceEntityName ||
        !rawRelation.targetEntityName
      )
        continue;

      const confidence =
        typeof rawRelation.confidence === "number"
          ? rawRelation.confidence
          : 0.7;
      const needsReview = confidence < 0.5;

      // Resolve entity names to IDs by looking up existing entities
      const sourceEntities = this.graphStore.findEntities({
        projectId: taskOutput.projectId,
        name: rawRelation.sourceEntityName,
      });
      const targetEntities = this.graphStore.findEntities({
        projectId: taskOutput.projectId,
        name: rawRelation.targetEntityName,
      });

      const sourceEntity = sourceEntities.find(
        (e) => e.name === rawRelation.sourceEntityName,
      );
      const targetEntity = targetEntities.find(
        (e) => e.name === rawRelation.targetEntityName,
      );

      if (sourceEntity && targetEntity) {
        this.graphStore.createRelation({
          relationType: rawRelation.relationType,
          sourceEntityId: sourceEntity.entityId,
          targetEntityId: targetEntity.entityId,
          weight: confidence,
          evidence:
            rawRelation.evidence ||
            `LLM-inferred from task ${taskOutput.taskId}`,
          source: "llm_inferred",
          confidence,
          needsReview,
        });

        if (needsReview) {
          pendingReviewCount++;
        }
        relationsCreated++;
      }
    }

    const summary: SinkSummary = {
      entitiesCreated,
      relationsCreated,
      pendingReviewCount,
    };

    // 5. Update Mission entity with knowledgeSinkSummary (Req 3.6)
    if (taskOutput.missionId) {
      this.updateMissionSinkSummary(
        taskOutput.missionId,
        taskOutput.projectId,
        summary,
      );
    }

    return summary;
  }

  // -----------------------------------------------------------------------
  // buildOntologyPromptContext — Build ontology context string for LLM prompt
  // -----------------------------------------------------------------------

  private buildOntologyPromptContext(): string {
    const entityTypes = this.ontologyRegistry.getEntityTypes();
    const relationTypes = this.ontologyRegistry.getRelationTypes();

    const entitySection = entityTypes
      .map(
        (et) =>
          `  - ${et.name}: ${et.description} (attributes: ${et.extendedAttributes.join(", ") || "none"})`,
      )
      .join("\n");
    const relationSection = relationTypes
      .map((rt) => `  - ${rt.name}: ${rt.description}`)
      .join("\n");

    return `Entity Types:\n${entitySection}\n\nRelation Types:\n${relationSection}`;
  }

  // -----------------------------------------------------------------------
  // buildExtractionPrompt — Construct the LLM prompt for passive extraction
  // -----------------------------------------------------------------------

  private buildExtractionPrompt(output: string, ontologyContext: string): string {
    return `You are a knowledge extraction assistant. Analyze the following Agent task output and extract structured knowledge entities and relations.

## Ontology Model

${ontologyContext}

## Agent Task Output

${output}

## Instructions

Extract knowledge entities (architecture decisions, business rules, bug fixes, modules, APIs, etc.) and relations from the Agent output above.
For each entity, assign a confidence score between 0.0 and 1.0 based on how certain the extraction is.

Respond with ONLY a JSON object in this exact format:
{
  "entities": [
    {
      "entityType": "<one of the entity types above>",
      "name": "<entity name>",
      "description": "<brief description>",
      "confidence": <0.0-1.0>,
      "extendedAttributes": { <optional key-value pairs> }
    }
  ],
  "relations": [
    {
      "relationType": "<one of the relation types above>",
      "sourceEntityName": "<source entity name>",
      "targetEntityName": "<target entity name>",
      "confidence": <0.0-1.0>,
      "evidence": "<supporting text>"
    }
  ]
}

Focus on meaningful knowledge: architecture decisions, business rules, bug patterns, module dependencies. Do not include trivial details.`;
  }

  // -----------------------------------------------------------------------
  // parseLLMResponse — Parse LLM JSON response with tolerance
  // -----------------------------------------------------------------------

  private parseLLMResponse(
    response: string,
  ): {
    entities: Array<{
      entityType: string;
      name: string;
      description?: string;
      confidence?: number;
      extendedAttributes?: Record<string, unknown>;
    }>;
    relations: Array<{
      relationType: string;
      sourceEntityName: string;
      targetEntityName: string;
      confidence?: number;
      evidence?: string;
    }>;
  } | null {
    try {
      let jsonStr = response.trim();

      // Strip markdown code fences if present
      const jsonBlockMatch = jsonStr.match(
        /```(?:json)?\s*\n?([\s\S]*?)\n?```/,
      );
      if (jsonBlockMatch) {
        jsonStr = jsonBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
      const relations = Array.isArray(parsed.relations)
        ? parsed.relations
        : [];

      return { entities, relations };
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // updateMissionSinkSummary — Write stats to Mission entity (Req 3.6)
  // -----------------------------------------------------------------------

  private updateMissionSinkSummary(
    missionId: string,
    projectId: string,
    summary: SinkSummary,
  ): void {
    const missionEntity = this.findOrCreateAnchorEntity(
      "Mission",
      missionId,
      projectId,
    );

    // Accumulate with any existing summary
    const existing = (missionEntity.extendedAttributes.knowledgeSinkSummary ||
      {}) as Partial<SinkSummary>;

    const accumulated: SinkSummary = {
      entitiesCreated:
        (existing.entitiesCreated || 0) + summary.entitiesCreated,
      relationsCreated:
        (existing.relationsCreated || 0) + summary.relationsCreated,
      pendingReviewCount:
        (existing.pendingReviewCount || 0) + summary.pendingReviewCount,
    };

    this.graphStore.updateEntity(missionEntity.entityId, {
      extendedAttributes: {
        ...missionEntity.extendedAttributes,
        knowledgeSinkSummary: accumulated,
      },
    });
  }

  // -----------------------------------------------------------------------
  // autoLinkRelations (Requirement 3.5)
  // -----------------------------------------------------------------------

  private autoLinkRelations(
    entity: Entity,
    missionId?: string,
    agentId?: string,
    skipBelongsTo = false,
  ): void {
    // 1. EXECUTED_BY: entity → Mission
    if (missionId) {
      const missionEntity = this.findOrCreateAnchorEntity(
        "Mission",
        missionId,
        entity.projectId,
      );
      this.graphStore.createRelation({
        relationType: "EXECUTED_BY",
        sourceEntityId: entity.entityId,
        targetEntityId: missionEntity.entityId,
        weight: 0.8,
        evidence: `Entity created during mission: ${missionId}`,
        source: "agent_extracted",
        confidence: 0.8,
        needsReview: false,
      });
    }

    // 2. KNOWS_ABOUT: Agent → entity
    if (agentId) {
      const agentEntity = this.findOrCreateAnchorEntity(
        "Agent",
        agentId,
        entity.projectId,
      );
      this.graphStore.createRelation({
        relationType: "KNOWS_ABOUT",
        sourceEntityId: agentEntity.entityId,
        targetEntityId: entity.entityId,
        weight: 0.8,
        evidence: `Agent ${agentId} produced this knowledge`,
        source: "agent_extracted",
        confidence: 0.8,
        needsReview: false,
      });
    }

    // 3. BELONGS_TO: entity → CodeModule (skip for bugfix, already handled by CAUSED_BY)
    // For non-bugfix entities we don't have explicit module info, so skip for now.
    // BELONGS_TO relations are created when explicit module context is available.
  }

  // -----------------------------------------------------------------------
  // Helper: find or create an anchor entity (Mission / Agent)
  // -----------------------------------------------------------------------

  private findOrCreateAnchorEntity(
    entityType: string,
    name: string,
    projectId: string,
  ): Entity {
    const existing = this.graphStore.findEntities({
      projectId,
      entityType,
      name,
    });

    // findEntities uses fuzzy (includes) matching, so exact-match filter
    const exact = existing.find((e) => e.name === name);
    if (exact) return exact;

    return this.graphStore.createEntity({
      entityType,
      name,
      description: `${entityType}: ${name}`,
      source: "agent_extracted",
      confidence: 0.8,
      projectId,
      needsReview: false,
      linkedMemoryIds: [],
      extendedAttributes: {},
    });
  }

  // -----------------------------------------------------------------------
  // Validation (Requirement 3.4)
  // -----------------------------------------------------------------------

  private validateDecisionPayload(payload: DecisionPayload): string[] {
    const missing: string[] = [];

    if (!payload.context) missing.push("context");
    if (!payload.decision) missing.push("decision");
    if (
      !payload.alternatives ||
      !Array.isArray(payload.alternatives) ||
      payload.alternatives.length === 0
    ) {
      missing.push("alternatives");
    }
    if (!payload.consequences) missing.push("consequences");

    return missing;
  }
}
