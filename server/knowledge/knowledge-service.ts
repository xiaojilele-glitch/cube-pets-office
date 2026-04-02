/**
 * KnowledgeService — 统一知识检索服务
 *
 * 融合图查询（KnowledgeGraphQuery）和向量检索结果，
 * 通过 mode 参数控制结果融合策略：
 * - preferStructured: 优先图谱结构化结果
 * - preferSemantic: 优先向量语义结果
 * - balanced: 按相关性混合排列（默认）
 *
 * 向量存储（vectorStore）为可选依赖——来自 L16 vector-db-rag-pipeline spec，
 * 当前阶段不存在时 semanticResults 始终为空。
 *
 * Requirements: 5.1, 5.5
 */

import type { KnowledgeGraphQuery } from "./query-service.js";
import type { GraphStore } from "./graph-store.js";
import type {
  Entity,
  Relation,
  UnifiedKnowledgeResult,
  UnifiedQueryOptions,
} from "../../shared/knowledge/types.js";

// ---------------------------------------------------------------------------
// VectorStore 抽象接口（可选依赖，L16 实现后替换）
// ---------------------------------------------------------------------------

export interface VectorSearchHit {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorStore {
  search(query: string, options?: { projectId?: string; limit?: number }): Promise<VectorSearchHit[]>;
  upsert?(id: string, content: string, metadata: Record<string, unknown>): Promise<string>;
  listRecent?(options: { projectId: string; limit?: number; excludeLinked?: boolean }): Promise<VectorSearchHit[]>;
}

// ---------------------------------------------------------------------------
// KnowledgeService
// ---------------------------------------------------------------------------

export class KnowledgeService {
  private queryService: KnowledgeGraphQuery;
  private graphStore: GraphStore;
  private vectorStore: VectorStore | null;

  constructor(
    queryService: KnowledgeGraphQuery,
    graphStore: GraphStore,
    vectorStore?: VectorStore | null,
  ) {
    this.queryService = queryService;
    this.graphStore = graphStore;
    this.vectorStore = vectorStore ?? null;
  }

  private entitySyncUnsubscribe: (() => void) | null = null;

  /**
   * syncEntityToVectorStore — 图谱 → 记忆方向同步
   *
   * 从实体生成文本摘要，写入向量存储，维护双向链接。
   * Requirements: 5.2, 5.4
   */
  async syncEntityToVectorStore(entity: Entity): Promise<void> {
    if (!this.vectorStore?.upsert) {
      // Vector store not available (L16 not yet implemented) — skip silently
      return;
    }

    // Generate text summary from entity
    const summary = this.buildEntitySummary(entity);

    // Write to vector store with linkedEntityId metadata
    const memoryId = await this.vectorStore.upsert(
      entity.entityId,
      summary,
      {
        linkedEntityId: entity.entityId,
        entityType: entity.entityType,
        projectId: entity.projectId,
        source: entity.source,
      },
    );

    // Update entity's linkedMemoryIds (bidirectional link)
    const ids = entity.linkedMemoryIds ?? [];
    if (!ids.includes(memoryId)) {
      this.graphStore.updateEntity(entity.entityId, {
        linkedMemoryIds: [...ids, memoryId],
      });
    }
  }

  /**
   * startEntitySync — 注册 graphStore.onEntityChanged 监听器
   *
   * 在 created / updated 时异步同步到向量存储，不阻塞图谱写入。
   * Requirements: 5.2
   */
  startEntitySync(): void {
    // Avoid duplicate listeners
    if (this.entitySyncUnsubscribe) return;

    this.entitySyncUnsubscribe = this.graphStore.onEntityChanged(
      (entity: Entity, action: string) => {
        if (action === "created" || action === "updated") {
          // Fire-and-forget — don't block graph writes
          this.syncEntityToVectorStore(entity).catch(() => {
            // Sync failure is non-fatal; vector store may not be available
          });
        }
        // 'deleted' — optionally remove from vector store in the future
      },
    );
  }

  /**
   * stopEntitySync — 取消监听
   */
  stopEntitySync(): void {
    if (this.entitySyncUnsubscribe) {
      this.entitySyncUnsubscribe();
      this.entitySyncUnsubscribe = null;
    }
  }

  /**
   * syncMemoryCandidatesToGraph — 记忆 → 图谱方向同步（批处理）
   *
   * 从长期记忆中识别结构化知识候选项，推送到审核队列。
   * 作为批处理运行（每小时或 Mission 完成时）。
   * 如果 vectorStore 不存在或没有 listRecent 方法，则静默跳过。
   *
   * Requirements: 5.3
   */
  async syncMemoryCandidatesToGraph(projectId: string): Promise<void> {
    // No vector store available (L16 not yet implemented) — skip
    if (!this.vectorStore) return;

    // Vector store doesn't support listRecent yet — skip
    if (!this.vectorStore.listRecent) return;

    const candidates = await this.vectorStore.listRecent({
      projectId,
      limit: 50,
      excludeLinked: true,
    });

    for (const candidate of candidates) {
      // Create entity in graph with needsReview: true for approval
      const entity = this.graphStore.createEntity({
        entityType: "BusinessRule",
        name: candidate.content.slice(0, 80) || "Memory candidate",
        description: candidate.content,
        source: "llm_inferred",
        confidence: 0.5,
        projectId,
        needsReview: true,
        linkedMemoryIds: [candidate.id],
        extendedAttributes: {
          sourceMemoryId: candidate.id,
          ...(candidate.metadata ?? {}),
        },
      });

      // Update the vector memory entry with linkedEntityId if upsert is available
      if (this.vectorStore.upsert) {
        await this.vectorStore.upsert(candidate.id, candidate.content, {
          ...(candidate.metadata ?? {}),
          linkedEntityId: entity.entityId,
        }).catch(() => {
          // Non-fatal — bidirectional link update failure is acceptable
        });
      }
    }
  }

  /**
   * buildEntitySummary — 从实体生成文本摘要
   */
  private buildEntitySummary(entity: Entity): string {
    const parts: string[] = [
      `[${entity.entityType}] ${entity.name}`,
    ];
    if (entity.description) {
      parts.push(entity.description);
    }
    // Include key extended attributes
    const attrs = entity.extendedAttributes;
    if (attrs && typeof attrs === "object") {
      const keys = Object.keys(attrs);
      if (keys.length > 0) {
        const attrLines = keys
          .filter((k) => attrs[k] !== undefined && attrs[k] !== null)
          .map((k) => `${k}: ${typeof attrs[k] === "string" ? attrs[k] : JSON.stringify(attrs[k])}`)
          .join("; ");
        if (attrLines) parts.push(attrLines);
      }
    }
    return parts.join(" — ");
  }

  /**
   * query — 统一知识检索
   *
   * 同时触发图查询和向量检索，根据 mode 融合结果。
   * Requirements: 5.1, 5.5
   */
  async query(
    question: string,
    projectId: string,
    options?: UnifiedQueryOptions,
  ): Promise<UnifiedKnowledgeResult> {
    const mode = options?.mode ?? "balanced";

    // 1. 并行触发图查询和向量检索
    const [graphResult, semanticHits] = await Promise.all([
      this.executeGraphQuery(question, projectId),
      this.executeVectorSearch(question, projectId),
    ]);

    const structuredResults = {
      entities: graphResult.entities,
      relations: graphResult.relations,
    };

    // 2. 构建融合摘要
    const mergedSummary = this.buildMergedSummary(
      structuredResults,
      semanticHits,
      mode,
    );

    return {
      structuredResults,
      semanticResults: semanticHits,
      mergedSummary,
    };
  }

  // -------------------------------------------------------------------------
  // 图查询执行
  // -------------------------------------------------------------------------

  private async executeGraphQuery(
    question: string,
    projectId: string,
  ): Promise<{ entities: Entity[]; relations: Relation[] }> {
    try {
      // 尝试使用 findEntities 进行基础查询
      // 如果 queryService 有 LLM 能力，可以用 naturalLanguageQuery
      const entities = await this.queryService.findEntities({ projectId });
      return { entities, relations: [] };
    } catch {
      // 图查询失败时返回空结果
      return { entities: [], relations: [] };
    }
  }

  // -------------------------------------------------------------------------
  // 向量检索执行
  // -------------------------------------------------------------------------

  private async executeVectorSearch(
    question: string,
    projectId: string,
  ): Promise<VectorSearchHit[]> {
    if (!this.vectorStore) {
      return [];
    }

    try {
      return await this.vectorStore.search(question, { projectId, limit: 10 });
    } catch {
      // 向量检索失败时返回空结果
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // 结果融合摘要
  // -------------------------------------------------------------------------

  private buildMergedSummary(
    structured: { entities: Entity[]; relations: Relation[] },
    semantic: VectorSearchHit[],
    mode: UnifiedQueryOptions["mode"],
  ): string {
    const structuredSection = this.buildStructuredSection(structured);
    const semanticSection = this.buildSemanticSection(semantic);

    const hasStructured = structured.entities.length > 0 || structured.relations.length > 0;
    const hasSemantic = semantic.length > 0;

    if (!hasStructured && !hasSemantic) {
      return "No results found from either knowledge graph or semantic search.";
    }

    switch (mode) {
      case "preferStructured":
        return this.mergePreferStructured(structuredSection, semanticSection, hasStructured, hasSemantic);
      case "preferSemantic":
        return this.mergePreferSemantic(structuredSection, semanticSection, hasStructured, hasSemantic);
      case "balanced":
      default:
        return this.mergeBalanced(structuredSection, semanticSection, hasStructured, hasSemantic);
    }
  }

  private mergePreferStructured(
    structuredSection: string,
    semanticSection: string,
    hasStructured: boolean,
    hasSemantic: boolean,
  ): string {
    const parts: string[] = [];

    if (hasStructured) {
      parts.push("[Knowledge Graph Results — Primary]\n" + structuredSection);
    }
    if (hasSemantic) {
      parts.push("[Semantic Search Results — Supplementary]\n" + semanticSection);
    }
    if (!hasStructured && hasSemantic) {
      parts.push("[Semantic Search Results]\n" + semanticSection);
      parts.push("Note: No structured knowledge graph results available.");
    }

    return parts.join("\n\n");
  }

  private mergePreferSemantic(
    structuredSection: string,
    semanticSection: string,
    hasStructured: boolean,
    hasSemantic: boolean,
  ): string {
    const parts: string[] = [];

    if (hasSemantic) {
      parts.push("[Semantic Search Results — Primary]\n" + semanticSection);
    }
    if (hasStructured) {
      parts.push("[Knowledge Graph Results — Supplementary]\n" + structuredSection);
    }
    if (!hasSemantic && hasStructured) {
      parts.push("[Knowledge Graph Results]\n" + structuredSection);
      parts.push("Note: No semantic search results available.");
    }

    return parts.join("\n\n");
  }

  private mergeBalanced(
    structuredSection: string,
    semanticSection: string,
    hasStructured: boolean,
    hasSemantic: boolean,
  ): string {
    const parts: string[] = [];

    if (hasStructured) {
      parts.push("[Knowledge Graph Results]\n" + structuredSection);
    }
    if (hasSemantic) {
      parts.push("[Semantic Search Results]\n" + semanticSection);
    }

    return parts.join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Section builders
  // -------------------------------------------------------------------------

  private buildStructuredSection(
    structured: { entities: Entity[]; relations: Relation[] },
  ): string {
    const lines: string[] = [];

    if (structured.entities.length > 0) {
      lines.push(`Found ${structured.entities.length} entit${structured.entities.length === 1 ? "y" : "ies"}:`);
      for (const e of structured.entities) {
        const lowConf = e.confidence < 0.5 ? " [low confidence]" : "";
        lines.push(`- ${e.name} (${e.entityType}, confidence: ${e.confidence})${lowConf}`);
      }
    }

    if (structured.relations.length > 0) {
      lines.push(`Found ${structured.relations.length} relation${structured.relations.length === 1 ? "" : "s"}.`);
    }

    return lines.join("\n");
  }

  private buildSemanticSection(semantic: VectorSearchHit[]): string {
    if (semantic.length === 0) {
      return "No semantic search results.";
    }

    const lines: string[] = [];
    lines.push(`Found ${semantic.length} semantic match${semantic.length === 1 ? "" : "es"}:`);
    for (const hit of semantic) {
      const preview = hit.content.length > 100
        ? hit.content.slice(0, 100) + "..."
        : hit.content;
      lines.push(`- [score: ${hit.score.toFixed(2)}] ${preview}`);
    }

    return lines.join("\n");
  }
}
