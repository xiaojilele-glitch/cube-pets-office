# 设计文档：知识图谱集成

## 概述

知识图谱集成模块在 Cube Brain 现有三级记忆系统之上增加一个结构化知识层。该模块采用本地 JSON 文件存储（与项目现有 `server/db/index.ts` 模式一致），以实体-关系图结构持久化项目知识。核心设计原则：

1. **与现有架构一致**：复用项目已有的 JSON 文件存储、Express 路由、Socket.IO 事件广播模式
2. **互补而非替代**：图谱负责精确结构化查询，向量记忆负责模糊语义检索，两者通过 KnowledgeService 统一对外
3. **渐进式质量管理**：通过 confidence 分级、审核队列、垃圾回收实现知识质量的持续提升
4. **本地优先**：所有数据存储在 `data/knowledge/` 目录下，无需外部数据库依赖

## 架构

```mermaid
graph TB
    subgraph 前端层
        UI[Knowledge Graph UI]
        ReviewPanel[审核面板]
        MissionOverlay[Mission 浮动面板]
    end

    subgraph API 层
        KnowledgeRoutes[/api/knowledge/*]
        AdminRoutes[/api/admin/knowledge/*]
        WebSocket[Socket.IO Events]
    end

    subgraph 服务层
        KS[KnowledgeService]
        KGQ[KnowledgeGraphQuery]
        CKE[CodeKnowledgeExtractor]
        AKS[AgentKnowledgeSink]
        KRQ[KnowledgeReviewQueue]
        KGC[KnowledgeGarbageCollector]
    end

    subgraph 数据层
        OR[OntologyRegistry]
        GS[GraphStore]
        LL[LifecycleLog]
    end

    subgraph 现有系统
        VS[VectorStore 中期记忆]
        SS[SessionStore 短期记忆]
        Soul[SoulStore 长期记忆]
        DB[database.json]
    end

    UI --> KnowledgeRoutes
    ReviewPanel --> KnowledgeRoutes
    MissionOverlay --> WebSocket

    KnowledgeRoutes --> KS
    KnowledgeRoutes --> KGQ
    KnowledgeRoutes --> KRQ
    AdminRoutes --> GS
    AdminRoutes --> KGC

    KS --> KGQ
    KS --> VS
    CKE --> GS
    CKE --> OR
    AKS --> GS
    AKS --> KRQ
    AKS --> OR
    KGQ --> GS
    KGQ --> OR
    KGC --> GS
    KGC --> LL

    GS --> KS
    KS --> VS
```

### 文件结构

```
server/knowledge/
├── ontology-registry.ts       # 本体模型注册表
├── graph-store.ts             # 图谱存储引擎（JSON 文件持久化）
├── code-extractor.ts          # 代码知识提取器
├── agent-sink.ts              # Agent 知识沉淀服务
├── query-service.ts           # 图查询服务
├── knowledge-service.ts       # 统一知识检索（融合图谱+向量）
├── review-queue.ts            # 审核队列
├── garbage-collector.ts       # 垃圾回收器
├── lifecycle-log.ts           # 生命周期日志
├── metrics.ts                 # Prometheus 指标
└── types.ts                   # 共享类型定义

server/routes/
├── knowledge.ts               # /api/knowledge/* 路由
└── knowledge-admin.ts         # /api/admin/knowledge/* 路由

shared/knowledge/
├── types.ts                   # 前后端共享类型
└── api.ts                     # API 路由常量和请求/响应类型

client/src/components/knowledge/
├── KnowledgeGraphPanel.tsx    # 力导向图可视化面板
├── KnowledgeReviewPanel.tsx   # 审核面板
├── KnowledgeFilters.tsx       # 过滤器组件
└── KnowledgeNodeDetail.tsx    # 节点详情面板
```

## 组件与接口

### OntologyRegistry

管理实体类型和关系类型的定义，支持运行时扩展。

```typescript
// server/knowledge/ontology-registry.ts

interface EntityTypeDefinition {
  name: string;
  description: string;
  source: "core" | "custom";
  extendedAttributes: string[]; // 该类型特有的扩展属性名
  registeredAt: string;
}

interface RelationTypeDefinition {
  name: string;
  description: string;
  source: "core" | "custom";
  sourceEntityTypes: string[]; // 允许的源实体类型（空数组表示不限）
  targetEntityTypes: string[]; // 允许的目标实体类型
  registeredAt: string;
}

class OntologyRegistry {
  private entityTypes: Map<string, EntityTypeDefinition>;
  private relationTypes: Map<string, RelationTypeDefinition>;
  private listeners: Array<() => void>;

  constructor();

  // 查询
  getEntityTypes(): EntityTypeDefinition[];
  getRelationTypes(): RelationTypeDefinition[];
  getEntityType(name: string): EntityTypeDefinition | undefined;
  getRelationType(name: string): RelationTypeDefinition | undefined;

  // 扩展
  registerEntityType(
    definition: Omit<EntityTypeDefinition, "source" | "registeredAt">
  ): void;
  registerRelationType(
    definition: Omit<RelationTypeDefinition, "source" | "registeredAt">
  ): void;

  // 事件
  onChange(listener: () => void): () => void;

  // 持久化（加载/保存到 data/knowledge/ontology.json）
  load(): void;
  save(): void;
}
```

### GraphStore

图谱存储引擎，管理实体和关系的 CRUD 操作，持久化为 JSON 文件。

```typescript
// server/knowledge/graph-store.ts

interface Entity {
  entityId: string;
  entityType: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  source: "agent_extracted" | "user_defined" | "code_analysis" | "llm_inferred";
  confidence: number; // 0.0 - 1.0
  projectId: string;
  status: "active" | "deprecated" | "archived";
  needsReview: boolean;
  linkedMemoryIds: string[];
  deprecationReason?: string;
  extendedAttributes: Record<string, unknown>; // 类型特有属性
}

interface Relation {
  relationId: string;
  relationType: string;
  sourceEntityId: string;
  targetEntityId: string;
  weight: number; // 0.0 - 1.0
  evidence: string;
  createdAt: string;
  source: "agent_extracted" | "user_defined" | "code_analysis" | "llm_inferred";
  confidence: number;
  needsReview: boolean;
}

interface GraphData {
  version: number;
  entities: Entity[];
  relations: Relation[];
  _counters: { entities: number; relations: number };
}

class GraphStore {
  private data: GraphData;
  private saveTimer: NodeJS.Timeout | null;

  constructor();

  // 实体 CRUD
  createEntity(
    entity: Omit<Entity, "entityId" | "createdAt" | "updatedAt" | "status">
  ): Entity;
  getEntity(entityId: string): Entity | undefined;
  findEntities(filters: EntityFilters): Entity[];
  updateEntity(entityId: string, updates: Partial<Entity>): Entity | undefined;
  mergeEntity(
    entity: Partial<Entity> & {
      entityType: string;
      projectId: string;
      name: string;
    }
  ): Entity;

  // 关系 CRUD
  createRelation(
    relation: Omit<Relation, "relationId" | "createdAt">
  ): Relation;
  getRelation(relationId: string): Relation | undefined;
  findRelations(filters: RelationFilters): Relation[];
  updateRelation(
    relationId: string,
    updates: Partial<Relation>
  ): Relation | undefined;

  // 图遍历
  getNeighbors(
    entityId: string,
    relationTypes?: string[],
    depth?: number
  ): { entities: Entity[]; relations: Relation[] };
  findPath(
    sourceId: string,
    targetId: string
  ): { entities: Entity[]; relations: Relation[] } | null;
  getSubgraph(entityIds: string[]): {
    entities: Entity[];
    relations: Relation[];
  };

  // 去重
  deduplicateEntity(entity: Partial<Entity>): Entity;

  // 持久化
  load(): void;
  save(): void;
  forceSave(): void;

  // 事件
  onEntityChanged(
    listener: (
      entity: Entity,
      action: "created" | "updated" | "deleted"
    ) => void
  ): () => void;
}
```

### CodeKnowledgeExtractor

从代码仓库提取知识，支持 AST 静态分析和 LLM 辅助提取。

```typescript
// server/knowledge/code-extractor.ts

interface ExtractionOptions {
  repoPath: string;
  language: "typescript" | "javascript" | "python" | string;
  projectId: string;
  sinceCommit?: string; // 增量提取
}

interface ExtractionResult {
  entities: Array<
    Omit<Entity, "entityId" | "createdAt" | "updatedAt" | "status">
  >;
  relations: Array<Omit<Relation, "relationId" | "createdAt">>;
  stats: ExtractionStats;
}

interface ExtractionStats {
  filesAnalyzed: number;
  entitiesExtracted: number;
  relationsExtracted: number;
  extractionDurationMs: number;
  errors: Array<{ filePath: string; reason: string }>;
}

class CodeKnowledgeExtractor {
  constructor(graphStore: GraphStore, ontologyRegistry: OntologyRegistry);

  extract(options: ExtractionOptions): Promise<ExtractionResult>;

  // 内部方法
  private extractTypeScript(
    files: string[],
    projectId: string
  ): ExtractionResult;
  private extractPython(files: string[], projectId: string): ExtractionResult;
  private extractWithLLM(
    files: string[],
    language: string,
    projectId: string
  ): Promise<ExtractionResult>;
  private getChangedFiles(repoPath: string, sinceCommit: string): string[];
  private markDeletedAsDeprecated(
    repoPath: string,
    sinceCommit: string,
    projectId: string
  ): void;
}
```

### AgentKnowledgeSink

Agent 知识沉淀服务，支持主动写入和被动提取。

```typescript
// server/knowledge/agent-sink.ts

interface DecisionPayload {
  context: string;
  decision: string;
  alternatives: string[];
  consequences: string;
  projectId: string;
  missionId?: string;
  agentId?: string;
}

interface RulePayload {
  name: string;
  description: string;
  projectId: string;
  missionId?: string;
  agentId?: string;
}

interface BugfixPayload {
  bugDescription: string;
  rootCause: string;
  fix: string;
  relatedModules: string[];
  projectId: string;
  missionId?: string;
  agentId?: string;
}

interface SinkSummary {
  entitiesCreated: number;
  relationsCreated: number;
  pendingReviewCount: number;
}

class AgentKnowledgeSink {
  constructor(
    graphStore: GraphStore,
    ontologyRegistry: OntologyRegistry,
    reviewQueue: KnowledgeReviewQueue
  );

  // 主动写入
  recordDecision(payload: DecisionPayload): Entity;
  recordRule(payload: RulePayload): Entity;
  recordBugfix(payload: BugfixPayload): Entity;

  // 被动提取（监听 task.completed 事件）
  extractFromTaskCompletion(
    taskOutput: TaskCompletionOutput
  ): Promise<SinkSummary>;

  // 自动建立关系
  private autoLinkRelations(
    entity: Entity,
    missionId?: string,
    agentId?: string
  ): void;

  // 验证必填字段
  private validateDecisionPayload(payload: DecisionPayload): string[];
}
```

### KnowledgeGraphQuery

图查询服务，提供多种查询模式。

```typescript
// server/knowledge/query-service.ts

interface EntityFilters {
  entityType?: string;
  projectId: string;
  name?: string; // 模糊匹配
  confidenceMin?: number;
  status?: string;
}

interface QueryResult {
  entities: Entity[];
  relations: Relation[];
  contextSummary: string;
  isPartial: boolean;
}

class KnowledgeGraphQuery {
  constructor(graphStore: GraphStore, ontologyRegistry: OntologyRegistry);

  getEntity(entityId: string): Entity | undefined;
  findEntities(filters: EntityFilters): Entity[];
  getNeighbors(
    entityId: string,
    relationTypes: string[],
    depth: number
  ): QueryResult;
  findPath(sourceEntityId: string, targetEntityId: string): QueryResult;
  subgraph(entityIds: string[]): QueryResult;
  naturalLanguageQuery(
    question: string,
    projectId: string
  ): Promise<QueryResult>;

  // 内部
  private buildContextSummary(
    entities: Entity[],
    relations: Relation[]
  ): Promise<string>;
  private translateToStructuredQuery(
    question: string,
    ontology: EntityTypeDefinition[]
  ): Promise<EntityFilters>;
}
```

### KnowledgeService

统一知识检索服务，融合图查询和向量检索。

```typescript
// server/knowledge/knowledge-service.ts

interface UnifiedQueryOptions {
  mode: "preferStructured" | "preferSemantic" | "balanced";
}

interface UnifiedKnowledgeResult {
  structuredResults: { entities: Entity[]; relations: Relation[] };
  semanticResults: VectorSearchHit[];
  mergedSummary: string;
}

class KnowledgeService {
  constructor(
    queryService: KnowledgeGraphQuery,
    vectorStore: VectorStore,
    graphStore: GraphStore
  );

  query(
    question: string,
    projectId: string,
    options?: UnifiedQueryOptions
  ): Promise<UnifiedKnowledgeResult>;

  // 图谱 → 记忆同步
  syncEntityToVectorStore(entity: Entity): Promise<void>;

  // 记忆 → 图谱同步（批处理）
  syncMemoryCandidatesToGraph(projectId: string): Promise<void>;
}
```

### KnowledgeReviewQueue

审核队列管理。

```typescript
// server/knowledge/review-queue.ts

interface ReviewAction {
  action: "approve" | "reject" | "edit";
  reviewedBy: string; // agentId 或 userId
  reviewerType: "agent" | "human";
  rejectionReason?: string;
  editedAttributes?: Record<string, unknown>;
}

class KnowledgeReviewQueue {
  constructor(graphStore: GraphStore);

  getQueue(filters?: {
    projectId?: string;
    entityType?: string;
    sortBy?: string;
  }): Entity[];
  review(entityId: string, action: ReviewAction): Entity;
  getQueueSize(): number;
  checkBacklogAlert(threshold?: number): boolean;
}
```

### KnowledgeGarbageCollector

定时垃圾回收。

```typescript
// server/knowledge/garbage-collector.ts

interface GCConfig {
  archiveAfterDays: number; // 默认 90
  lowConfidenceThreshold: number; // 默认 0.3
  lowConfidenceMaxAgeDays: number; // 默认 30
  duplicateSimilarityThreshold: number; // 默认 0.9
}

interface GCResult {
  archived: number;
  deleted: number;
  merged: number;
  duration: number;
}

class KnowledgeGarbageCollector {
  constructor(
    graphStore: GraphStore,
    lifecycleLog: LifecycleLog,
    config?: Partial<GCConfig>
  );

  run(): GCResult;
  archiveExpiredDeprecated(): number;
  deleteLowQualityEntities(): number;
  mergeDuplicateEntities(): number;
}
```

## 数据模型

### 存储文件结构

```
data/knowledge/
├── ontology.json              # 本体模型定义
├── graph-{projectId}.json     # 按项目分文件的图谱数据
├── lifecycle-log.jsonl        # 生命周期操作日志（JSONL 追加写入）
├── review-queue-snapshot.json # 审核队列快照（可从 graph 数据重建）
└── metrics-snapshot.json      # 指标快照
```

### Entity 完整结构

```typescript
interface Entity {
  entityId: string; // UUID v4
  entityType: string; // 来自 OntologyRegistry
  name: string;
  description: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  source: "agent_extracted" | "user_defined" | "code_analysis" | "llm_inferred";
  confidence: number; // 0.0 - 1.0
  projectId: string;
  status: "active" | "deprecated" | "archived";
  needsReview: boolean;
  linkedMemoryIds: string[]; // 关联的向量记忆条目 ID
  deprecationReason?: string;
  extendedAttributes: Record<string, unknown>;
}
```

### CodeModule 扩展属性

```typescript
interface CodeModuleExtended {
  filePath: string;
  language: string;
  linesOfCode: number;
  complexity: number; // 圈复杂度
  exports: string[]; // 导出的公共接口列表
}
```

### API 扩展属性

```typescript
interface APIExtended {
  endpoint: string;
  httpMethod: string;
  requestSchema: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  authRequired: boolean;
}
```

### ArchitectureDecision 扩展属性

```typescript
interface ArchitectureDecisionExtended {
  context: string;
  decision: string;
  alternatives: string[];
  consequences: string;
  supersededBy?: string; // 被替代时指向新决策的 entityId
}
```

### Relation 完整结构

```typescript
interface Relation {
  relationId: string; // UUID v4
  relationType: string; // 来自 OntologyRegistry
  sourceEntityId: string;
  targetEntityId: string;
  weight: number; // 0.0 - 1.0
  evidence: string; // 支撑证据
  createdAt: string;
  source: "agent_extracted" | "user_defined" | "code_analysis" | "llm_inferred";
  confidence: number;
  needsReview: boolean;
}
```

### 图谱文件格式 (graph-{projectId}.json)

```typescript
interface GraphData {
  version: 1;
  projectId: string;
  lastUpdated: string;
  entities: Entity[];
  relations: Relation[];
  _counters: {
    entities: number;
    relations: number;
  };
}
```

### 生命周期日志条目

```typescript
interface LifecycleLogEntry {
  entityId: string;
  action: "status_change" | "garbage_collect" | "merge" | "review";
  reason: string;
  previousStatus?: string;
  newStatus?: string;
  timestamp: string;
  triggeredBy: "auto_cleanup" | "manual" | "code_change" | "review";
}
```

### API 路由常量

```typescript
// shared/knowledge/api.ts
export const KNOWLEDGE_API = {
  // 公开 API
  graph: "/api/knowledge/graph",
  reviewQueue: "/api/knowledge/review-queue",
  review: "/api/knowledge/review/:entityId",
  query: "/api/knowledge/query",

  // 管理 API
  stats: "/api/admin/knowledge/stats",
  reindex: "/api/admin/knowledge/reindex",
  reindexStatus: "/api/admin/knowledge/reindex/:taskId",
  export: "/api/admin/knowledge/export",
} as const;
```

## 正确性属性

_正确性属性是一种在系统所有有效执行中都应成立的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范与机器可验证正确性保证之间的桥梁。_

### Property 1: 实体创建属性完整性

_For any_ entity creation input with valid entityType, name, and projectId, the created Entity SHALL contain all common attributes (entityId, entityType, name, description, createdAt, updatedAt, source, confidence, projectId) with non-null values, and entityId SHALL be globally unique.
**Validates: Requirements 1.3**

### Property 2: 关系创建属性完整性

_For any_ relation creation input with valid relationType, sourceEntityId, and targetEntityId, the created Relation SHALL contain all common attributes (relationId, relationType, sourceEntityId, targetEntityId, weight, evidence, createdAt, source) with non-null values.
**Validates: Requirements 1.4**

### Property 3: 自定义类型注册往返一致性

_For any_ custom entity type name registered via OntologyRegistry.registerEntityType(), the type SHALL appear in OntologyRegistry.getEntityTypes() with source marked as "custom", and the total count of returned types SHALL equal the core types count plus the number of registered custom types.
**Validates: Requirements 1.5, 1.6**

### Property 4: 本体变更事件触发

_For any_ call to registerEntityType() or registerRelationType(), the OntologyRegistry SHALL emit exactly one "ontology.changed" event.
**Validates: Requirements 1.7**

### Property 5: 提取实体扩展属性完整性

_For any_ extracted entity of type CodeModule, the extendedAttributes SHALL contain filePath, language, linesOfCode, complexity, and exports; _for any_ extracted entity of type API, the extendedAttributes SHALL contain endpoint, httpMethod, requestSchema, responseSchema, and authRequired.
**Validates: Requirements 2.3, 2.4**

### Property 6: LLM 提取默认置信度

_For any_ entity extracted via LLM-assisted extraction (non-AST languages), the confidence SHALL default to 0.7.
**Validates: Requirements 2.2**

### Property 7: 实体去重唯一键不变量

_For any_ two entities with identical (entityType, projectId, filePath, name) written to the graph, the graph SHALL contain exactly one entity for that unique key, and the retained entity SHALL have the higher confidence value for conflicting attributes.
**Validates: Requirements 2.6**

### Property 8: ArchitectureDecision 必填字段验证

_For any_ DecisionPayload missing at least one of the required fields (context, decision, alternatives, consequences), AgentKnowledgeSink.recordDecision() SHALL reject the write and return an error.
**Validates: Requirements 3.4**

### Property 9: 低置信度实体进入审核队列

_For any_ entity with confidence < 0.5 or needsReview: true, the entity SHALL appear in the KnowledgeReviewQueue, and SHALL NOT be included in default graph query results (unless explicitly querying the review queue).
**Validates: Requirements 3.3, 7.1**

### Property 10: 知识写入自动关系建立

_For any_ entity written to the graph with a missionId and agentId, the GraphStore SHALL contain EXECUTED_BY relation linking the entity to the Mission, and KNOWS_ABOUT relation linking the Agent to the entity, without explicit specification by the caller.
**Validates: Requirements 3.5**

### Property 11: 查询结果置信度排序

_For any_ query result containing multiple entities, the entities SHALL be sorted by confidence in descending order, and any entity with confidence < 0.5 SHALL be annotated with a low-confidence warning in contextSummary.
**Validates: Requirements 4.4**

### Property 12: 项目隔离不变量

_For any_ graph query with projectId A, the returned entities and relations SHALL exclusively belong to projectId A; no entity or relation with a different projectId SHALL appear in the results.
**Validates: Requirements 4.5**

### Property 13: 图遍历深度约束

_For any_ getNeighbors(entityId, relationTypes, depth=N) query, all returned entities SHALL be reachable from the source entity within N hops through the specified relation types.
**Validates: Requirements 4.1**

### Property 14: 统一检索模式行为

_For any_ KnowledgeService.query() call with mode "preferStructured", the structuredResults SHALL be ranked higher than semanticResults in the merged output; with mode "preferSemantic", the reverse SHALL hold; with mode "balanced", results SHALL be mixed by relevance score.
**Validates: Requirements 5.1**

### Property 15: 图谱到向量同步双向链接

_For any_ entity synced to the vector store, the entity's linkedMemoryIds SHALL contain the vector memory entry ID, and the vector memory entry SHALL carry a linkedEntityId referencing the entity's entityId.
**Validates: Requirements 5.4**

### Property 16: 实体状态机转换合法性

_For any_ entity status transition, only the following transitions SHALL be allowed: active → deprecated, deprecated → archived, archived → active. Any other transition SHALL be rejected.
**Validates: Requirements 6.1**

### Property 17: 删除文件触发废弃标记

_For any_ file detected as deleted during incremental extraction, the corresponding CodeModule entity and target entities of its DEPENDS_ON and CALLS relations SHALL have status "deprecated" and deprecationReason containing the commit hash.
**Validates: Requirements 6.2**

### Property 18: 垃圾回收正确性

_For any_ entity with status "deprecated" older than archiveAfterDays, KnowledgeGarbageCollector SHALL transition it to "archived"; _for any_ entity with confidence < 0.3, age > 30 days, and zero query references, KnowledgeGarbageCollector SHALL delete it.
**Validates: Requirements 6.3**

### Property 19: 架构决策版本链

_For any_ chain of ArchitectureDecision entities connected by SUPERSEDES relations, a default query SHALL return only the latest (non-deprecated) decision; a query with includeHistory: true SHALL return all decisions in the chain ordered by creation time.
**Validates: Requirements 6.4**

### Property 20: 生命周期日志完整性

_For any_ lifecycle management operation (status transition, garbage collection, entity merge), a corresponding entry SHALL exist in knowledge_lifecycle_log containing entityId, action, reason, timestamp, and triggeredBy.
**Validates: Requirements 6.5**

### Property 21: 审核操作置信度调整

_For any_ review action "approve" by a human reviewer, the entity confidence SHALL become max(currentConfidence, 0.8); _for any_ review action "approve" by a trusted Agent, the confidence SHALL become max(currentConfidence, 0.7); _for any_ review action "reject", the entity status SHALL become "archived".
**Validates: Requirements 7.2, 7.3**

### Property 22: 图谱导出往返一致性

_For any_ project graph data, exporting via GET /api/admin/knowledge/export and then importing the resulting JSON SHALL produce an equivalent set of entities and relations (same entityIds, same attributes, same relations).
**Validates: Requirements 8.5**

## 错误处理

### 存储层错误

- JSON 文件读取失败：返回空图谱数据，记录错误日志，不中断服务
- JSON 文件写入失败：使用 debounced save 重试机制（与现有 `database.json` 模式一致），写入失败时保留内存数据
- 文件损坏：保留备份文件 `graph-{projectId}.json.bak`，损坏时从备份恢复

### LLM 调用错误

- LLM 提取失败：记录错误，跳过该文件，在 ExtractionStats.errors 中记录失败原因
- 自然语言查询 LLM 转译失败：降级为向量检索（回退到三级记忆系统），在 QueryResult 中标注降级信息
- LLM 返回格式异常：使用 JSON.parse 容错处理，解析失败时丢弃该结果并记录 warning

### 图查询错误

- 查询超时：返回已获取的部分结果，标注 `isPartial: true`
- 实体不存在：返回 undefined/null，不抛异常
- 循环引用（图遍历）：使用 visited set 防止无限循环，限制最大遍历深度

### 审核队列错误

- 审核不存在的实体：返回 404 错误
- 重复审核：幂等处理，返回当前状态
- 队列积压：超过阈值时触发告警，不阻塞写入

### 数据一致性错误

- 去重冲突：取 confidence 更高者的属性，记录合并日志
- 双向同步冲突：以 entityId 为唯一键，图谱为权威数据源
- 关系引用的实体不存在：创建关系时校验源和目标实体存在性，不存在时拒绝创建

## 测试策略

### 属性测试（Property-Based Testing）

使用 `fast-check` 库（Vitest 生态兼容）进行属性测试，每个属性测试运行至少 100 次迭代。

每个正确性属性对应一个独立的属性测试，测试标注格式：

```
Feature: knowledge-graph, Property N: {property_text}
```

属性测试重点覆盖：

- 实体/关系创建的属性完整性（Property 1, 2）
- 本体注册的往返一致性（Property 3）
- 去重逻辑的唯一键不变量（Property 7）
- 状态机转换合法性（Property 16）
- 项目隔离不变量（Property 12）
- 查询结果排序（Property 11）
- 审核操作的置信度调整（Property 21）
- 导出/导入往返一致性（Property 22）

### 单元测试

使用 Vitest 进行单元测试，重点覆盖：

- OntologyRegistry 核心类型初始化（验证 10 个实体类型和 11 个关系类型）
- CodeKnowledgeExtractor 的 TypeScript AST 解析（使用项目自身代码作为测试输入）
- AgentKnowledgeSink 的必填字段验证（ArchitectureDecision 缺少字段时拒绝）
- KnowledgeGraphQuery 的各查询模式（getEntity, findEntities, getNeighbors, findPath, subgraph）
- KnowledgeGarbageCollector 的各清理规则
- KnowledgeReviewQueue 的审核操作
- 生命周期状态转换

### 集成测试

- 端到端知识提取流程：代码仓库 → 提取 → 去重 → 写入图谱 → 查询验证
- 统一检索流程：KnowledgeService.query() 同时触发图查询和向量检索
- 双向同步流程：实体变更 → 向量存储同步 → 双向链接验证
- API 路由测试：各 REST API 端点的请求/响应验证

### 测试文件组织

```
server/tests/
├── knowledge-graph-store.test.ts          # GraphStore 单元测试 + 属性测试
├── knowledge-ontology.test.ts             # OntologyRegistry 测试
├── knowledge-extractor.test.ts            # CodeKnowledgeExtractor 测试
├── knowledge-sink.test.ts                 # AgentKnowledgeSink 测试
├── knowledge-query.test.ts                # KnowledgeGraphQuery 测试
├── knowledge-service.test.ts              # KnowledgeService 测试
├── knowledge-review.test.ts               # KnowledgeReviewQueue 测试
├── knowledge-gc.test.ts                   # KnowledgeGarbageCollector 测试
├── knowledge-lifecycle.test.ts            # 生命周期管理测试
└── knowledge-routes.test.ts               # API 路由集成测试
```
