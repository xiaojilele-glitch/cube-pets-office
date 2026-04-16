/**
 * 知识图谱共享类型定义
 *
 * 前后端共享的类型，涵盖实体、关系、查询、提取、生命周期、审核等核心数据结构。
 * 与 OntologyRegistry（server/knowledge/ontology-registry.ts）配合使用。
 *
 * 使用场景：
 * - knowledge-graph: 图谱存储、查询、提取、审核全链路
 * - knowledge-service: 统一知识检索（融合图谱 + 向量）
 * - 前端可视化: KnowledgeGraphPanel、KnowledgeReviewPanel
 */

// ---------------------------------------------------------------------------
// 枚举值
// ---------------------------------------------------------------------------

/** 实体来源 */
export type EntitySource =
  | "agent_extracted"
  | "user_defined"
  | "code_analysis"
  | "llm_inferred";

/** 实体状态 */
export type EntityStatus = "active" | "deprecated" | "archived";

/** 本体类型来源 */
export type OntologySource = "core" | "custom";

// ---------------------------------------------------------------------------
// 实体（Entity）
// ---------------------------------------------------------------------------

export interface Entity {
  entityId: string; // UUID v4
  entityType: string; // 来自 OntologyRegistry
  name: string;
  description: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  source: EntitySource;
  confidence: number; // 0.0 - 1.0
  projectId: string;
  status: EntityStatus;
  needsReview: boolean;
  linkedMemoryIds: string[]; // 关联的向量记忆条目 ID
  deprecationReason?: string;
  extendedAttributes: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 关系（Relation）
// ---------------------------------------------------------------------------

export interface Relation {
  relationId: string; // UUID v4
  relationType: string; // 来自 OntologyRegistry
  sourceEntityId: string;
  targetEntityId: string;
  weight: number; // 0.0 - 1.0
  evidence: string; // 支撑证据
  createdAt: string; // ISO 8601
  source: EntitySource;
  confidence: number; // 0.0 - 1.0
  needsReview: boolean;
}

// ---------------------------------------------------------------------------
// 扩展属性接口
// ---------------------------------------------------------------------------

/** CodeModule 扩展属性 */
export interface CodeModuleExtended {
  filePath: string;
  language: string;
  linesOfCode: number;
  complexity: number; // 圈复杂度
  exports: string[]; // 导出的公共接口列表
}

/** API 扩展属性 */
export interface APIExtended {
  endpoint: string;
  httpMethod: string;
  requestSchema: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  authRequired: boolean;
}

/** ArchitectureDecision 扩展属性 */
export interface ArchitectureDecisionExtended {
  context: string;
  decision: string;
  alternatives: string[];
  consequences: string;
  supersededBy?: string; // 被替代时指向新决策的 entityId
}

// ---------------------------------------------------------------------------
// 过滤器
// ---------------------------------------------------------------------------

export interface EntityFilters {
  entityType?: string;
  projectId: string;
  name?: string; // 模糊匹配
  confidenceMin?: number;
  status?: EntityStatus;
}

export interface RelationFilters {
  relationType?: string;
  sourceEntityId?: string;
  targetEntityId?: string;
  projectId?: string;
}

// ---------------------------------------------------------------------------
// 查询结果
// ---------------------------------------------------------------------------

export interface QueryResult {
  entities: Entity[];
  relations: Relation[];
  contextSummary: string;
  isPartial: boolean;
}

export interface UnifiedKnowledgeResult {
  structuredResults: { entities: Entity[]; relations: Relation[] };
  semanticResults: unknown[]; // VectorSearchHit[]，避免循环依赖
  mergedSummary: string;
}

// ---------------------------------------------------------------------------
// 提取结果
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  entities: Array<
    Omit<Entity, "entityId" | "createdAt" | "updatedAt" | "status">
  >;
  relations: Array<Omit<Relation, "relationId" | "createdAt">>;
  stats: ExtractionStats;
}

export interface ExtractionStats {
  filesAnalyzed: number;
  entitiesExtracted: number;
  relationsExtracted: number;
  extractionDurationMs: number;
  errors: Array<{ filePath: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// 生命周期日志
// ---------------------------------------------------------------------------

export interface LifecycleLogEntry {
  entityId: string;
  action: "status_change" | "garbage_collect" | "merge" | "review";
  reason: string;
  previousStatus?: EntityStatus;
  newStatus?: EntityStatus;
  timestamp: string; // ISO 8601
  triggeredBy: "auto_cleanup" | "manual" | "code_change" | "review";
}

// ---------------------------------------------------------------------------
// 本体类型定义
// ---------------------------------------------------------------------------

export interface EntityTypeDefinition {
  name: string;
  description: string;
  source: OntologySource;
  extendedAttributes: string[]; // 该类型特有的扩展属性名
  registeredAt: string; // ISO 8601
}

export interface RelationTypeDefinition {
  name: string;
  description: string;
  source: OntologySource;
  sourceEntityTypes: string[]; // 允许的源实体类型（空数组表示不限）
  targetEntityTypes: string[]; // 允许的目标实体类型
  registeredAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// 图谱数据文件格式
// ---------------------------------------------------------------------------

export interface GraphData {
  version: number;
  projectId?: string;
  lastUpdated?: string; // ISO 8601
  entities: Entity[];
  relations: Relation[];
  _counters: {
    entities: number;
    relations: number;
  };
}

// ---------------------------------------------------------------------------
// Agent 知识沉淀 Payload
// ---------------------------------------------------------------------------

export interface DecisionPayload {
  context: string;
  decision: string;
  alternatives: string[];
  consequences: string;
  projectId: string;
  missionId?: string;
  agentId?: string;
}

export interface RulePayload {
  name: string;
  description: string;
  projectId: string;
  missionId?: string;
  agentId?: string;
}

export interface BugfixPayload {
  bugDescription: string;
  rootCause: string;
  fix: string;
  relatedModules: string[];
  projectId: string;
  missionId?: string;
  agentId?: string;
}

export interface SinkSummary {
  entitiesCreated: number;
  relationsCreated: number;
  pendingReviewCount: number;
}

// ---------------------------------------------------------------------------
// 审核
// ---------------------------------------------------------------------------

export interface ReviewAction {
  action: "approve" | "reject" | "edit";
  reviewedBy: string; // agentId 或 userId
  reviewerType: "agent" | "human";
  rejectionReason?: string;
  editedAttributes?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 垃圾回收
// ---------------------------------------------------------------------------

export interface GCConfig {
  archiveAfterDays: number; // 默认 90
  lowConfidenceThreshold: number; // 默认 0.3
  lowConfidenceMaxAgeDays: number; // 默认 30
  duplicateSimilarityThreshold: number; // 默认 0.9
}

export interface GCResult {
  archived: number;
  deleted: number;
  merged: number;
  duration: number;
}

// ---------------------------------------------------------------------------
// 统一检索选项
// ---------------------------------------------------------------------------

export interface UnifiedQueryOptions {
  mode: "preferStructured" | "preferSemantic" | "balanced";
}
