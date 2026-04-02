/**
 * KnowledgeGraphQuery — 图查询服务
 *
 * 提供多种查询模式供 Agent 获取结构化上下文：
 * - getEntity: 单实体查找
 * - findEntities: 批量过滤查询（按 confidence 降序）
 * - getNeighbors: N 跳图遍历
 * - findPath: 最短路径发现
 * - subgraph: 子图提取
 *
 * 核心行为：
 * - 结果按 confidence 降序排序（Req 4.4）
 * - 项目隔离：强制 projectId 过滤（Req 4.5）
 * - 超时处理：超时返回部分结果 + isPartial: true（Req 4.6）
 * - contextSummary 中标注低置信度实体（confidence < 0.5）
 */

import type { GraphStore } from "./graph-store.js";
import type { OntologyRegistry } from "./ontology-registry.js";
import type { Entity, Relation, EntityFilters, QueryResult, EntityTypeDefinition } from "../../shared/knowledge/types.js";
import type { CodeExtractorLLMProvider } from "./code-extractor.js";

/** Timeout for natural language queries (includes LLM round-trip) — Req 4.6 */
const TIMEOUT_NL_QUERY = 3000;

// ---------------------------------------------------------------------------
// 默认超时（毫秒）
// ---------------------------------------------------------------------------

const TIMEOUT_SIMPLE = 200;   // getEntity, findEntities
const TIMEOUT_TRAVERSE = 200; // getNeighbors
const TIMEOUT_COMPLEX = 1000; // findPath, subgraph

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 按 confidence 降序排序实体（就地排序并返回） */
function sortByConfidenceDesc(entities: Entity[]): Entity[] {
  return entities.sort((a, b) => b.confidence - a.confidence);
}

/**
 * 过滤实体和关系，仅保留属于指定 projectId 的条目。
 * extraEntityIds 允许额外的实体 ID 参与关系过滤（例如查询起点本身不在结果实体列表中）。
 */
function filterByProject(
  entities: Entity[],
  relations: Relation[],
  projectId: string,
  extraEntityIds?: Set<string>,
): { entities: Entity[]; relations: Relation[] } {
  const filtered = entities.filter((e) => e.projectId === projectId);
  const entityIds = new Set(filtered.map((e) => e.entityId));
  if (extraEntityIds) {
    for (const id of Array.from(extraEntityIds)) entityIds.add(id);
  }
  const filteredRelations = relations.filter(
    (r) => entityIds.has(r.sourceEntityId) && entityIds.has(r.targetEntityId),
  );
  return { entities: filtered, relations: filteredRelations };
}

/**
 * 用 Promise.race 实现超时包装。
 * 如果操作在 timeoutMs 内完成，返回其结果；
 * 否则返回 fallback 值。
 */
function withTimeout<T>(
  fn: () => T,
  timeoutMs: number,
  fallback: T,
): Promise<{ result: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ result: fallback, timedOut: true });
    }, timeoutMs);

    try {
      const result = fn();
      clearTimeout(timer);
      resolve({ result, timedOut: false });
    } catch {
      clearTimeout(timer);
      resolve({ result: fallback, timedOut: true });
    }
  });
}

// ---------------------------------------------------------------------------
// KnowledgeGraphQuery
// ---------------------------------------------------------------------------

export class KnowledgeGraphQuery {
  private graphStore: GraphStore;
  private ontologyRegistry: OntologyRegistry;
  llmProvider: CodeExtractorLLMProvider | null;

  constructor(graphStore: GraphStore, ontologyRegistry: OntologyRegistry, llmProvider?: CodeExtractorLLMProvider | null) {
    this.graphStore = graphStore;
    this.ontologyRegistry = ontologyRegistry;
    this.llmProvider = llmProvider ?? null;
  }

  // -------------------------------------------------------------------------
  // getEntity — 单实体查找（Req 4.1）
  // -------------------------------------------------------------------------

  async getEntity(entityId: string): Promise<Entity | undefined> {
    const { result, timedOut } = await withTimeout(
      () => this.graphStore.getEntity(entityId),
      TIMEOUT_SIMPLE,
      undefined,
    );
    // 超时时返回 undefined（单实体无部分结果概念）
    return timedOut ? undefined : result;
  }

  // -------------------------------------------------------------------------
  // findEntities — 批量过滤查询，按 confidence 降序（Req 4.1, 4.4, 4.5）
  // -------------------------------------------------------------------------

  async findEntities(filters: EntityFilters): Promise<Entity[]> {
    const { result, timedOut } = await withTimeout(
      () => {
        const entities = this.graphStore.findEntities(filters);
        return sortByConfidenceDesc(entities);
      },
      TIMEOUT_SIMPLE,
      [] as Entity[],
    );
    if (timedOut) return sortByConfidenceDesc(result);
    return result;
  }

  // -------------------------------------------------------------------------
  // getNeighbors — N 跳图遍历（Req 4.1, 4.4, 4.5, 4.6）
  // -------------------------------------------------------------------------

  async getNeighbors(
    entityId: string,
    relationTypes: string[],
    depth: number,
  ): Promise<QueryResult> {
    // 先获取源实体以确定 projectId（项目隔离）
    const sourceEntity = this.graphStore.getEntity(entityId);
    const projectId = sourceEntity?.projectId;

    const { result, timedOut } = await withTimeout(
      () =>
        this.graphStore.getNeighbors(
          entityId,
          relationTypes.length > 0 ? relationTypes : undefined,
          depth,
        ),
      TIMEOUT_TRAVERSE,
      { entities: [] as Entity[], relations: [] as Relation[] },
    );

    let { entities, relations } = result;

    // 项目隔离：仅保留与源实体同 projectId 的结果
    // 源实体本身不在 neighbors 结果中，但关系可能引用它，所以加入 extraEntityIds
    if (projectId) {
      ({ entities, relations } = filterByProject(
        entities, relations, projectId, new Set([entityId]),
      ));
    }

    sortByConfidenceDesc(entities);

    return {
      entities,
      relations,
      contextSummary: this.buildContextSummary(entities, relations),
      isPartial: timedOut,
    };
  }

  // -------------------------------------------------------------------------
  // findPath — 最短路径发现（Req 4.1, 4.4, 4.5, 4.6）
  // -------------------------------------------------------------------------

  async findPath(
    sourceEntityId: string,
    targetEntityId: string,
  ): Promise<QueryResult> {
    const sourceEntity = this.graphStore.getEntity(sourceEntityId);
    const projectId = sourceEntity?.projectId;

    const { result, timedOut } = await withTimeout(
      () => this.graphStore.findPath(sourceEntityId, targetEntityId),
      TIMEOUT_COMPLEX,
      null,
    );

    if (!result) {
      return {
        entities: [],
        relations: [],
        contextSummary: "No path found between the specified entities.",
        isPartial: timedOut,
      };
    }

    let { entities, relations } = result;

    if (projectId) {
      ({ entities, relations } = filterByProject(entities, relations, projectId));
    }

    sortByConfidenceDesc(entities);

    return {
      entities,
      relations,
      contextSummary: this.buildContextSummary(entities, relations),
      isPartial: timedOut,
    };
  }

  // -------------------------------------------------------------------------
  // subgraph — 子图提取（Req 4.1, 4.4, 4.5, 4.6）
  // -------------------------------------------------------------------------

  async subgraph(entityIds: string[]): Promise<QueryResult> {
    // 确定 projectId：取第一个存在实体的 projectId
    let projectId: string | undefined;
    for (const eid of entityIds) {
      const e = this.graphStore.getEntity(eid);
      if (e) {
        projectId = e.projectId;
        break;
      }
    }

    const { result, timedOut } = await withTimeout(
      () => this.graphStore.getSubgraph(entityIds),
      TIMEOUT_COMPLEX,
      { entities: [] as Entity[], relations: [] as Relation[] },
    );

    let { entities, relations } = result;

    if (projectId) {
      ({ entities, relations } = filterByProject(entities, relations, projectId));
    }

    sortByConfidenceDesc(entities);

    return {
      entities,
      relations,
      contextSummary: this.buildContextSummary(entities, relations),
      isPartial: timedOut,
    };
  }

  // -------------------------------------------------------------------------
  // findArchitectureDecisions — 版本链查询（Req 6.4）
  // -------------------------------------------------------------------------

  async findArchitectureDecisions(
    projectId: string,
    options?: { includeHistory?: boolean },
  ): Promise<QueryResult> {
    const includeHistory = options?.includeHistory ?? false;

    // Step 1: Find all ArchitectureDecision entities for the project
    const allDecisions = this.graphStore.findEntities({
      projectId,
      entityType: "ArchitectureDecision",
    });

    if (allDecisions.length === 0) {
      return {
        entities: [],
        relations: [],
        contextSummary: "No architecture decisions found.",
        isPartial: false,
      };
    }

    // Step 2: Find all SUPERSEDES relations between decisions
    const decisionIds = new Set(allDecisions.map((d) => d.entityId));
    const supersedesRelations = this.graphStore
      .findRelations({ projectId, relationType: "SUPERSEDES" })
      .filter((r) => decisionIds.has(r.sourceEntityId) && decisionIds.has(r.targetEntityId));

    // Step 3: Determine which decisions are superseded
    // SUPERSEDES relation: new → old, so targetEntityId is the superseded one
    const supersededIds = new Set(supersedesRelations.map((r) => r.targetEntityId));

    let resultEntities: Entity[];
    let resultRelations: Relation[];

    if (includeHistory) {
      // Return all decisions, ordered by createdAt ascending
      resultEntities = [...allDecisions].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      resultRelations = supersedesRelations;
    } else {
      // Return only latest (non-superseded) decisions, sorted by confidence desc
      resultEntities = allDecisions.filter((d) => !supersededIds.has(d.entityId));
      sortByConfidenceDesc(resultEntities);
      resultRelations = [];
    }

    return {
      entities: resultEntities,
      relations: resultRelations,
      contextSummary: this.buildContextSummary(resultEntities, resultRelations),
      isPartial: false,
    };
  }

  // -------------------------------------------------------------------------
  // naturalLanguageQuery — 自然语言查询（Req 4.2, 4.3）
  // -------------------------------------------------------------------------

  async naturalLanguageQuery(question: string, projectId: string): Promise<QueryResult> {
    // No LLM provider → return empty result with explanation
    if (!this.llmProvider) {
      return {
        entities: [],
        relations: [],
        contextSummary: "Natural language query requires LLM provider.",
        isPartial: false,
      };
    }

    try {
      // Step 1: Translate question → structured query via LLM
      const filters = await this.translateToStructuredQuery(question, projectId);

      // Step 2: Execute graph query
      const entities = await this.findEntities(filters);

      // Step 3: Build contextSummary from results
      const relations: Relation[] = [];
      const contextSummary = this.buildContextSummary(entities, relations);

      return {
        entities,
        relations,
        contextSummary,
        isPartial: false,
      };
    } catch {
      // LLM translation failed → fallback (Req 4.3)
      return {
        entities: [],
        relations: [],
        contextSummary: "LLM translation failed. Fell back to empty results.",
        isPartial: false,
      };
    }
  }

  // -------------------------------------------------------------------------
  // translateToStructuredQuery — LLM 将自然语言转译为结构化查询参数
  // -------------------------------------------------------------------------

  private async translateToStructuredQuery(
    question: string,
    projectId: string,
  ): Promise<EntityFilters> {
    const entityTypes = this.ontologyRegistry.getEntityTypes();
    const relationTypes = this.ontologyRegistry.getRelationTypes();

    const prompt = [
      "You are a knowledge graph query translator.",
      "Given a natural language question, translate it into a structured JSON query.",
      "",
      "Available entity types:",
      ...entityTypes.map((t: EntityTypeDefinition) => `- ${t.name}: ${t.description}`),
      "",
      "Available relation types:",
      ...relationTypes.map((t) => `- ${t.name}: ${t.description}`),
      "",
      "Respond with ONLY a JSON object (no markdown, no explanation):",
      '{',
      '  "entityType": "optional entity type filter or null",',
      '  "name": "optional name search term or null",',
      '  "confidenceMin": 0.0',
      '}',
      "",
      `Question: ${question}`,
    ].join("\n");

    const raw = await this.llmProvider!.generate(prompt);

    // Parse LLM response — extract JSON from the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("LLM returned unparseable response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      entityType?: string | null;
      name?: string | null;
      confidenceMin?: number;
    };

    const filters: EntityFilters = { projectId };

    if (parsed.entityType && typeof parsed.entityType === "string") {
      filters.entityType = parsed.entityType;
    }
    if (parsed.name && typeof parsed.name === "string") {
      filters.name = parsed.name;
    }
    if (typeof parsed.confidenceMin === "number" && parsed.confidenceMin > 0) {
      filters.confidenceMin = parsed.confidenceMin;
    }

    return filters;
  }

  // -------------------------------------------------------------------------
  // buildContextSummary — 生成查询结果的文本摘要（Req 4.4）
  // -------------------------------------------------------------------------

  private buildContextSummary(entities: Entity[], relations: Relation[]): string {
    if (entities.length === 0 && relations.length === 0) {
      return "No results found.";
    }

    const lines: string[] = [];

    if (entities.length > 0) {
      lines.push(`Found ${entities.length} entit${entities.length === 1 ? "y" : "ies"}:`);
      for (const e of entities) {
        const lowConf = e.confidence < 0.5 ? " [low confidence]" : "";
        lines.push(`- ${e.name} (${e.entityType}, confidence: ${e.confidence})${lowConf}`);
      }
    }

    if (relations.length > 0) {
      lines.push(`${entities.length > 0 ? "\n" : ""}Found ${relations.length} relation${relations.length === 1 ? "" : "s"}.`);
    }

    return lines.join("\n");
  }
}
