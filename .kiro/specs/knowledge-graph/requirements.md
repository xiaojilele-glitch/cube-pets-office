# 需求文档：知识图谱集成

## 简介

知识图谱集成模块为 Cube Brain 平台的三级记忆系统引入结构化知识管理层。现有的三级记忆（短期会话/中期向量检索/长期 SOUL.md）以非结构化文本和向量嵌入为主，擅长模糊语义检索但缺乏实体间关系的显式表达。知识图谱模块将项目中的代码结构、API 依赖、业务规则、架构决策、Agent 历史经验等信息建模为实体-关系-属性的图结构，Agent 在执行任务时可通过图查询精确获取上下文，替代"每次从头推理"的低效模式。

本模块与三级记忆系统互补而非替代——向量记忆负责"模糊回忆"，知识图谱负责"精确查询"；与动态组织生成协同——组织结构本身也作为图的一部分被持久化，供跨 Mission 复用。

## 术语表

- **Knowledge_Graph**：知识图谱存储引擎，管理实体和关系的图结构数据，持久化为本地 JSON 文件
- **Entity**：图谱中的节点，表示一个具有类型和属性的知识单元（如代码模块、API、业务规则等）
- **Relation**：图谱中的有向边，表示两个实体之间的关系（如依赖、调用、实现等）
- **OntologyRegistry**：本体模型注册表，管理实体类型和关系类型的定义，支持运行时扩展
- **CodeKnowledgeExtractor**：代码知识提取器，通过 AST 静态分析或 LLM 辅助从代码仓库提取实体和关系
- **AgentKnowledgeSink**：Agent 知识沉淀服务，负责将 Agent 执行过程中产生的知识写入图谱
- **KnowledgeGraphQuery**：图查询服务，提供多种查询模式供 Agent 获取结构化上下文
- **KnowledgeService**：统一知识检索服务，融合图查询和向量检索结果
- **KnowledgeReviewQueue**：知识审核队列，管理低置信度或需人工审核的实体和关系
- **KnowledgeGarbageCollector**：知识垃圾回收器，定时清理过期、低质量和重复的知识条目
- **ExtractionResult**：代码提取结果结构，包含实体列表和关系列表
- **QueryResult**：图查询结果结构，包含实体列表、关系列表和上下文摘要
- **UnifiedKnowledgeResult**：统一检索结果结构，包含结构化结果、语义结果和融合摘要

## 需求

### 需求 1：定义知识图谱的本体模型

**用户故事：** 作为平台开发者，我希望定义一套可扩展的本体模型（实体类型和关系类型），以便知识图谱能够统一表达项目中各类知识的结构和关联。

#### 验收标准

1. THE OntologyRegistry SHALL define the following core entity types: CodeModule, API, BusinessRule, ArchitectureDecision, TechStack, Agent, Role, Mission, Bug, Config
2. THE OntologyRegistry SHALL define the following core relation types: DEPENDS_ON, CALLS, IMPLEMENTS, DECIDED_BY, SUPERSEDES, USES, CAUSED_BY, RESOLVED_BY, BELONGS_TO, EXECUTED_BY, KNOWS_ABOUT
3. WHEN an Entity is created, THE Knowledge_Graph SHALL assign the following common attributes: entityId (globally unique), entityType, name, description, createdAt, updatedAt, source (one of "agent_extracted", "user_defined", "code_analysis", "llm_inferred"), confidence (0.0-1.0, where user-defined entities receive 1.0), projectId
4. WHEN a Relation is created, THE Knowledge_Graph SHALL assign the following common attributes: relationId, relationType, sourceEntityId, targetEntityId, weight (0.0-1.0), evidence (supporting text or code reference), createdAt, source
5. WHEN OntologyRegistry.getEntityTypes() or OntologyRegistry.getRelationTypes() is called, THE OntologyRegistry SHALL return the complete list of registered types including both core and custom types
6. WHEN OntologyRegistry.registerEntityType(customType) is called, THE OntologyRegistry SHALL register the custom entity type with source marked as "custom" and make the type available for subsequent queries
7. WHEN the ontology model definition changes, THE OntologyRegistry SHALL emit an "ontology.changed" event so that downstream consumers (graph query engine, knowledge extractors) automatically load the latest model

### 需求 2：从代码仓库自动提取知识入图

**用户故事：** 作为平台开发者，我希望系统能自动分析代码仓库并提取结构化知识（模块、依赖、API 等），以便知识图谱能反映项目的真实代码结构。

#### 验收标准

1. WHEN CodeKnowledgeExtractor receives a repository path and target language parameter, THE CodeKnowledgeExtractor SHALL output an ExtractionResult containing entity and relation lists
2. WHEN the target language is TypeScript or JavaScript, THE CodeKnowledgeExtractor SHALL extract modules, classes, functions, and import dependencies through AST parsing; WHEN the target language is Python, THE CodeKnowledgeExtractor SHALL extract modules, classes, functions, and import dependencies through AST parsing; WHEN the target language is not directly supported, THE CodeKnowledgeExtractor SHALL use LLM-assisted extraction with confidence defaulting to 0.7
3. WHEN a CodeModule entity is extracted, THE CodeKnowledgeExtractor SHALL include extended attributes: filePath, language, linesOfCode, complexity (cyclomatic complexity), exports (list of public interfaces)
4. WHEN an API entity is extracted, THE CodeKnowledgeExtractor SHALL include extended attributes: endpoint, httpMethod, requestSchema, responseSchema, authRequired, sourced from route definitions, OpenAPI/Swagger files, or annotation markers
5. WHEN CodeKnowledgeExtractor receives a sinceCommit parameter, THE CodeKnowledgeExtractor SHALL analyze only changed files, merge updated attributes for existing entities while preserving unchanged relations, and mark entities for deleted code as status "deprecated" rather than physically deleting them
6. WHEN extraction results are written to the graph, THE Knowledge_Graph SHALL perform deduplication using entityType + projectId + filePath + name as the unique key, merging attributes for duplicate entities and retaining the attribute with higher confidence when conflicts occur
7. WHEN extraction completes, THE CodeKnowledgeExtractor SHALL record debug logs containing filesAnalyzed, entitiesExtracted, relationsExtracted, extractionDurationMs, and errors (list of files that failed parsing with reasons)

### 需求 3：Agent 执行过程中自动沉淀知识

**用户故事：** 作为 Agent，我希望在执行任务过程中能自动将发现的架构决策、业务规则、缺陷修复经验等知识沉淀到图谱，以便后续任务可以复用这些经验。

#### 验收标准

1. THE AgentKnowledgeSink SHALL provide active write methods: sink.recordDecision(decisionPayload) for architecture decisions, sink.recordRule(rulePayload) for business rules, sink.recordBugfix(bugfixPayload) for bug fix experiences
2. WHEN a task.completed event is received, THE AgentKnowledgeSink SHALL extract knowledge from the Agent output (code diff, documents, conversation records) by sending them to the LLM with the current project ontology model definition from OntologyRegistry, requesting structured entity and relation JSON output
3. WHEN passive extraction produces results with confidence < 0.5, THE AgentKnowledgeSink SHALL mark those entries as needsReview: true and place them in the review queue rather than writing them directly to the main graph
4. WHEN an ArchitectureDecision entity is submitted for writing, THE AgentKnowledgeSink SHALL validate that all required fields are present (context, decision, alternatives, consequences), and IF any required field is missing, THEN THE AgentKnowledgeSink SHALL reject the write and record a warning
5. WHEN knowledge is written to the graph, THE AgentKnowledgeSink SHALL automatically establish relations with the current Mission (EXECUTED_BY), the executing Agent (KNOWS_ABOUT), and related CodeModules (BELONGS_TO) without requiring the Agent to specify them manually
6. WHEN a Mission completes knowledge sinking, THE AgentKnowledgeSink SHALL write statistics (entity count, relation count, pending review count) to the Mission metadata knowledgeSinkSummary field

### 需求 4：Agent 通过图查询获取结构化上下文

**用户故事：** 作为 Agent，我希望能通过多种查询模式从知识图谱中获取精确的结构化上下文，以便在执行任务时做出更准确的决策。

#### 验收标准

1. THE KnowledgeGraphQuery SHALL support the following query modes: getEntity(entityId) for single entity lookup; findEntities(filters) for batch query with entityType, projectId, name fuzzy match, and confidence threshold filtering; getNeighbors(entityId, relationTypes, depth) for graph traversal within N hops; findPath(sourceEntityId, targetEntityId) for shortest path discovery; subgraph(entityIds) for retrieving a set of entities and all relations between them
2. WHEN KnowledgeGraphQuery.naturalLanguageQuery(question, projectId) is called, THE KnowledgeGraphQuery SHALL send the question and ontology model definition to the LLM, receive structured query parameters, execute the corresponding graph query, and assemble results into a natural language answer; IF LLM translation fails, THEN THE KnowledgeGraphQuery SHALL fall back to vector retrieval through the three-tier memory system
3. WHEN a query returns results, THE KnowledgeGraphQuery SHALL return a QueryResult containing entities (entity list), relations (relation list), and contextSummary (LLM-generated result summary for Agent context window injection)
4. THE KnowledgeGraphQuery SHALL sort results by confidence in descending order by default, and WHEN confidence < 0.5, THE KnowledgeGraphQuery SHALL annotate those entities with a "low confidence" warning in the contextSummary
5. WHEN a query is executed, THE KnowledgeGraphQuery SHALL enforce project isolation by requiring projectId, returning only entities and relations belonging to that project; WHEN cross-project query is needed, THE KnowledgeGraphQuery SHALL require explicit multiple projectIds and cross_project_query permission
6. THE KnowledgeGraphQuery SHALL complete single entity and neighbor queries within 200ms, path and subgraph queries within 1000ms, and natural language queries (including LLM translation) within 3000ms; IF a query exceeds the timeout, THEN THE KnowledgeGraphQuery SHALL return partial results with isPartial: true

### 需求 5：图谱与三级记忆系统双向同步

**用户故事：** 作为平台开发者，我希望知识图谱与现有三级记忆系统能双向同步，以便 Agent 通过统一接口获取最完整的知识上下文。

#### 验收标准

1. WHEN KnowledgeService.query(question, projectId, options) is called, THE KnowledgeService SHALL trigger both graph query and vector retrieval simultaneously, and merge results based on options: preferStructured (prioritize graph results), preferSemantic (prioritize vector results), or balanced (default, mixed ranking by relevance)
2. WHEN an entity is created or updated in the Knowledge_Graph, THE KnowledgeService SHALL asynchronously generate a text summary and write it to the long-term memory vector store as an embedding, triggered by the graph.entityChanged event without blocking graph writes
3. WHEN the three-tier memory system self-evolution module identifies structured knowledge candidates during long-term memory consolidation, THE KnowledgeService SHALL push those candidates to the AgentKnowledgeSink review queue for approval before writing to the graph, executed as async batch processing (hourly or at Mission completion)
4. THE KnowledgeService SHALL maintain bidirectional linking: vector store memory entries carry a linkedEntityId field referencing graph entities, and graph entities carry a linkedMemoryIds field referencing vector memory entries, preventing inconsistent duplication
5. WHEN KnowledgeService.query returns results, THE KnowledgeService SHALL return a UnifiedKnowledgeResult containing structuredResults (graph entities and relations), semanticResults (vector retrieval memory entries), and mergedSummary (LLM-fused comprehensive summary)

### 需求 6：知识图谱的生命周期管理

**用户故事：** 作为平台开发者，我希望知识图谱中的实体具有完整的生命周期管理（激活、废弃、归档），以便图谱保持准确和整洁。

#### 验收标准

1. THE Knowledge_Graph SHALL maintain a status field on each entity with values: active, deprecated, archived; THE Knowledge_Graph SHALL enforce status transitions: active → deprecated (when code is deleted or rules become invalid), deprecated → archived (automatically after archiveAfterDays, default 90 days), archived → active (manual restoration only)
2. WHEN CodeKnowledgeExtractor detects a deleted file during incremental extraction, THE CodeKnowledgeExtractor SHALL mark the corresponding CodeModule and target entities of its DEPENDS_ON and CALLS relations as deprecated, recording the triggering commit hash in deprecationReason
3. WHEN KnowledgeGarbageCollector runs (default weekly), THE KnowledgeGarbageCollector SHALL: transition deprecated entities older than archiveAfterDays to archived; delete entities with confidence < 0.3 that are older than 30 days and have never been referenced by queries; merge duplicate entities (name + entityType + projectId similarity > 0.9) retaining the higher-confidence entity attributes
4. WHEN a new ArchitectureDecision SUPERSEDES an old one, THE Knowledge_Graph SHALL automatically mark the old decision as deprecated; WHEN querying ArchitectureDecision entities, THE KnowledgeGraphQuery SHALL return only the latest version by default, and return the complete version chain when includeHistory: true is specified
5. WHEN any lifecycle management operation occurs (status transition, garbage collection, entity merge), THE Knowledge_Graph SHALL record it in the knowledge_lifecycle_log with entityId, action, reason, timestamp, and triggeredBy (auto_cleanup, manual, code_change)

### 需求 7：知识审核与质量保障

**用户故事：** 作为平台管理员，我希望低置信度的知识条目能进入审核队列，支持人工和高信誉 Agent 审核，以便保障知识图谱的质量。

#### 验收标准

1. WHEN an entity or relation has confidence < 0.5 or needsReview: true, THE KnowledgeReviewQueue SHALL include the entry in the review queue, accessible via GET /api/knowledge/review-queue with support for filtering by projectId, entityType, and sorting by confidence
2. WHEN POST /api/knowledge/review/:entityId is called with action "approve", THE KnowledgeReviewQueue SHALL set confidence to max(currentConfidence, 0.8) and needsReview to false; WHEN action is "reject", THE KnowledgeReviewQueue SHALL mark the entity as archived with rejectionReason recorded; WHEN action is "edit", THE KnowledgeReviewQueue SHALL update entity attributes and then approve
3. WHEN a trusted Agent (trustTier: "trusted" and qualityScore >= 700) performs a review, THE KnowledgeReviewQueue SHALL set confidence to max(currentConfidence, 0.7) instead of 0.8, and record reviewedBy as agentId; WHEN a human performs a review, THE KnowledgeReviewQueue SHALL record reviewedBy as userId
4. WHEN the review queue size exceeds reviewQueueAlertThreshold (default 200), THE KnowledgeReviewQueue SHALL trigger a KNOWLEDGE_REVIEW_BACKLOG alert

### 需求 8：知识图谱的可观测性与运维

**用户故事：** 作为平台运维人员，我希望能监控知识图谱的运行状态、数据质量和成本消耗，以便及时发现问题并优化运营。

#### 验收标准

1. THE Knowledge_Graph SHALL expose Prometheus metrics: knowledge_graph_entity_total (gauge by entityType and status), knowledge_graph_relation_total (gauge by relationType), knowledge_graph_query_total (counter by query type), knowledge_graph_query_duration_ms (histogram), knowledge_extraction_total (counter by source), knowledge_review_queue_size (gauge), knowledge_confidence_distribution (histogram)
2. WHEN GET /api/admin/knowledge/stats is called, THE Knowledge_Graph SHALL return overall statistics: entity and relation counts grouped by project, distribution by entityType, average confidence, proportion of active/deprecated/archived statuses, and growth trends for the last 7 days
3. WHEN POST /api/admin/knowledge/reindex is called, THE Knowledge_Graph SHALL trigger a vector index rebuild and return a task ID; WHEN GET /api/admin/knowledge/reindex/:taskId is called, THE Knowledge_Graph SHALL return the rebuild progress
4. THE Knowledge_Graph SHALL track token consumption for knowledge graph operations (LLM extraction, natural language query translation, review assistance) separately for cost monitoring
5. WHEN GET /api/admin/knowledge/export?projectId=xxx&format=json is called, THE Knowledge_Graph SHALL export all entities and relations for the specified project as a self-describing JSON file that includes the ontology model definition

### 需求 9：前端展示知识图谱

**用户故事：** 作为用户，我希望通过可视化面板直观地浏览和操作知识图谱，以便理解项目知识结构和 Agent 的决策依据。

#### 验收标准

1. THE Knowledge_Graph_UI SHALL display a force-directed graph visualization with entity nodes and relation edges, using distinct colors and icons for different entityTypes, and node sizes reflecting the number of connected relations
2. THE Knowledge_Graph_UI SHALL support interactive operations: clicking a node to show entity details and related entities; double-clicking a node to expand its one-hop neighbors; box-selecting multiple nodes to view a subgraph; searching by entity name and type to locate nodes
3. THE Knowledge_Graph_UI SHALL provide filters: entityType checkboxes for show/hide, confidence threshold slider, status filter (default showing only active), and relationType checkboxes for show/hide specific relation types
4. WHEN an Agent executes a graph query during a Mission, THE Knowledge_Graph_UI SHALL display the queried knowledge subgraph as a floating panel in the MissionIsland TelemetryOverlay within the 3D scene
5. THE Knowledge_Graph_UI SHALL provide a review panel displaying pending review entries as a list with entity/relation details, source Agent, confidence value, and associated context, allowing users to execute approve/reject/edit operations directly
6. THE Knowledge_Graph_UI SHALL fetch visualization data via GET /api/knowledge/graph?projectId=xxx&entityTypes=...&depth=2 and subscribe to knowledge.entityChanged WebSocket events for real-time updates
