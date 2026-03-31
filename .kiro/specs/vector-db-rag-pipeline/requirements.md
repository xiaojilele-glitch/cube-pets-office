# 需求文档：向量数据库与 RAG 管道

## 简介

向量数据库与 RAG（Retrieval-Augmented Generation）管道模块为 Cube Brain 平台的三级记忆系统提供底层语义检索基础设施。现有的三级记忆（短期/工作/长期）在"自进化"环节缺少高效的语义检索能力，Agent 在执行任务时无法快速从海量历史数据中找到相关的任务记录、代码片段、文档和对话记录，导致每次任务都近似"从零开始"。

本模块引入向量数据库作为统一的语义索引层，构建从数据摄入、分块、嵌入、索引到检索增强生成的完整 RAG 管道，使 Agent 能够在推理前自动获取最相关的历史上下文。

本模块与知识图谱集成互补——知识图谱解决"精确结构化查询"（如"PaymentService 依赖哪些下游模块"），RAG 管道解决"模糊语义检索"（如"之前有没有人处理过类似的超时问题"）；与自评估机制协同——Agent 在自评估时可检索历史相似任务的完成情况来辅助判断胜任度。

## 术语表

- **Ingestion_Pipeline**: 统一数据摄入管道，负责接收、清洗、分块、嵌入并写入向量数据库的完整流程
- **IngestionPayload**: 摄入数据的标准化封装结构，包含 sourceType、sourceId、projectId、content、metadata、timestamp、agentId
- **ChunkRecord**: 分块后的数据记录，包含 chunkId、sourceType、sourceId、projectId、chunkIndex、content、tokenCount、metadata
- **EmbeddingGenerator**: 嵌入生成器，调用配置的 Embedding 模型将文本转换为向量
- **VectorStoreAdapter**: 向量数据库适配器接口，抽象不同向量数据库后端（Qdrant/Milvus/Pgvector）
- **RAGRetriever**: 语义检索服务，提供基于向量相似度的检索能力
- **RetrievalResult**: 检索结果结构，包含 chunkId、score、content、sourceType、sourceId、metadata、highlight、totalCandidates
- **RAGPipeline**: RAG 增强生成管道，将检索结果注入 LLM 上下文
- **Reranker**: 重排器，对初步检索结果进行二次排序以提升相关性
- **VectorLifecycleManager**: 向量数据生命周期管理器，负责归档、删除、冷热分层
- **RRF**: Reciprocal Rank Fusion，混合检索结果合并算法
- **Dead_Letter_Queue**: 摄入失败的数据暂存队列，用于后续重试或人工处理

## 需求

### 需求 1：统一数据摄入管道

**用户故事：** 作为系统，我需要一条统一的数据摄入管道（Ingestion Pipeline），将平台中各类数据源的内容标准化处理后写入向量数据库，这样所有类型的历史数据都可被语义检索覆盖。

#### 验收标准

1. THE Ingestion_Pipeline SHALL 支持以下数据源类型：task_result、code_snippet、conversation、mission_log、document、architecture_decision、bug_report
2. WHEN 数据进入摄入管道时，THE Ingestion_Pipeline SHALL 将每条数据封装为 IngestionPayload，包含 sourceType、sourceId、projectId、content、metadata、timestamp、agentId 字段
3. WHEN 平台事件（task.completed、mission.finished、code.committed、document.uploaded）触发时，THE Ingestion_Pipeline SHALL 自动监听并摄入对应数据（事件驱动模式）
4. WHEN 用户通过 POST /api/rag/ingest 提交 IngestionPayload 时，THE Ingestion_Pipeline SHALL 接收并处理该数据（手动触发模式）
5. WHEN 数据进入摄入管道后，THE Ingestion_Pipeline SHALL 依次执行：接收 Payload → 数据清洗 → 分块 → 嵌入 → 写入向量数据库 → 写入元数据索引；IF 任何环节失败，THEN THE Ingestion_Pipeline SHALL 将该数据写入 ingestion_dead_letter_queue
6. WHEN 摄入相同数据时（sourceType + sourceId + contentHash 相同），THE Ingestion_Pipeline SHALL 跳过重复写入，保证幂等性
7. WHILE 系统处于正常运行状态，THE Ingestion_Pipeline SHALL 维持单实例 >= 50 条/秒的持续摄入吞吐量，峰值 >= 200 条/秒

### 需求 2：智能分块策略

**用户故事：** 作为系统，我需要根据不同数据源类型采用不同的分块策略，这样每种数据都能以最合适的粒度被索引和检索。

#### 验收标准

1. WHEN 数据进入分块阶段时，THE Chunker SHALL 按 sourceType 路由到对应分块策略：code_snippet 使用语法感知分块、conversation 使用对话轮次分块、document 使用语义段落分块、task_result 和 mission_log 使用滑动窗口分块（512 tokens, overlap 64）、architecture_decision 不分块（整体作为单个 chunk）
2. WHEN 分块完成后，THE Chunker SHALL 为每个 chunk 生成 ChunkRecord，包含 chunkId、sourceType、sourceId、projectId、chunkIndex、content、tokenCount、metadata 字段
3. WHEN 处理 code_snippet 类型数据时，THE Chunker SHALL 额外提取 codeLanguage、functionSignature、imports 元数据并写入 ChunkRecord.metadata
4. THE Chunker SHALL 确保每个 chunk 的 token 数上限为 1024，下限为 64；IF chunk token 数超出范围，THEN THE Chunker SHALL 进行再分割或合并
5. WHERE 配置中心 rag.chunking 提供了按 sourceType 的独立配置，THE Chunker SHALL 使用该配置覆盖默认分块参数

### 需求 3：嵌入生成与向量索引

**用户故事：** 作为系统，我需要将分块后的文本转换为向量并写入向量数据库，这样语义检索可以基于向量相似度高效执行。

#### 验收标准

1. THE EmbeddingGenerator SHALL 调用配置的 Embedding 模型生成向量，支持运行时热切换模型
2. WHEN 批量处理 chunk 时，THE EmbeddingGenerator SHALL 以 batchSize（默认 64）为单位批量调用 Embedding 模型；IF 批量调用失败，THEN THE EmbeddingGenerator SHALL 按单条逐一重试
3. THE VectorStoreAdapter SHALL 提供统一接口抽象，支持 Qdrant、Milvus、Pgvector 三种向量数据库后端
4. WHEN 写入向量数据库时，THE VectorStoreAdapter SHALL 按 projectId 分 collection，并创建 sourceType、agentId、timestamp、codeLanguage 过滤索引
5. WHEN 向量写入完成后，THE Ingestion_Pipeline SHALL 同步将元数据写入 rag_chunk_metadata 表
6. WHEN 管理员通过 POST /api/admin/rag/reembed 触发时，THE EmbeddingGenerator SHALL 对全量数据重新生成嵌入并更新向量数据库

### 需求 4：语义检索服务

**用户故事：** 作为 Agent，我需要通过语义检索快速找到与当前任务最相关的历史数据，这样我可以利用历史上下文提升任务执行质量。

#### 验收标准

1. THE RAGRetriever SHALL 提供 search(query, options) 接口，options 支持 projectId、topK、sourceTypes、timeRange、agentId、codeLanguage、minScore 过滤参数
2. WHEN 执行检索时，THE RAGRetriever SHALL 依次执行：query 向量化 → ANN 搜索 → 获取元数据 → 组装 RetrievalResult
3. THE RAGRetriever SHALL 返回 RetrievalResult，包含 chunkId、score、content、sourceType、sourceId、metadata、highlight、totalCandidates 字段
4. WHERE 检索模式配置为 hybrid，THE RAGRetriever SHALL 同时执行语义检索（semantic）和关键词检索（keyword），并使用 RRF 算法合并结果
5. WHERE expandContext 选项启用，THE RAGRetriever SHALL 对每个命中 chunk 前后各扩展 contextWindowChunks 个相邻 chunk
6. WHEN topK <= 10 时，THE RAGRetriever SHALL 在 200ms 内返回检索结果；WHEN topK <= 50 或启用上下文扩展时，THE RAGRetriever SHALL 在 500ms 内返回检索结果

### 需求 5：RAG 增强生成管道

**用户故事：** 作为系统，我需要将检索到的相关上下文自动注入 Agent 的 LLM 调用中，这样 Agent 可以基于历史知识做出更好的决策。

#### 验收标准

1. THE RAGPipeline SHALL 提供 augment(task, agent) 接口，自动为 Agent 的 LLM 调用注入检索到的相关上下文
2. WHEN 检索结果需要重排时，THE Reranker SHALL 对初步检索结果进行二次排序（支持 LLM-based 或 Cross-Encoder 两种重排策略，可选配置）
3. WHEN 组装 ragContext 时，THE RAGPipeline SHALL 控制注入的 token 总量不超过预算（默认 4096 tokens）
4. THE RAGPipeline SHALL 以结构化格式输出 ragContext，每个 chunk 带来源标注（sourceType、sourceId、score）
5. THE RAGPipeline SHALL 支持三种注入模式：auto（自动判断是否需要 RAG 增强）、on_demand（仅在显式请求时注入）、disabled（关闭 RAG 增强）
6. WHEN RAG 增强执行完成后，THE RAGPipeline SHALL 将执行记录写入 rag_augmentation_log，包含 taskId、agentId、retrievedChunks、injectedChunks、tokenUsage、latency

### 需求 6：检索反馈与自优化循环

**用户故事：** 作为系统，我需要收集检索结果的使用反馈并自动优化检索质量，这样 RAG 管道的检索精度可以持续提升。

#### 验收标准

1. WHEN Agent 使用检索结果完成任务后，THE RAGPipeline SHALL 自动计算隐式反馈指标 utilizationRate（实际使用的 chunk 数 / 注入的 chunk 数）
2. WHEN 用户或 Agent 提交显式反馈时，THE RAGPipeline SHALL 记录 helpfulChunkIds（有帮助的 chunk）、irrelevantChunkIds（无关的 chunk）、missingContext（缺失的上下文描述）
3. WHEN 反馈数据积累到阈值时，THE RAGPipeline SHALL 驱动检索权重调优；IF utilizationRate 持续低于阈值，THEN THE RAGPipeline SHALL 发出 RETRIEVAL_GAP_DETECTED 告警
4. WHEN irrelevantChunkIds 被标记时，THE RAGPipeline SHALL 将对应 chunk 加入硬负例集，在后续检索中降低其排名权重
5. THE RAGPipeline SHALL 提供反馈统计 API（GET /api/rag/feedback/stats），返回按 projectId、sourceType、timeRange 聚合的反馈指标

### 需求 7：向量数据库生命周期管理

**用户故事：** 作为系统管理员，我需要管理向量数据的生命周期，这样可以控制存储成本并保持检索性能。

#### 验收标准

1. THE Ingestion_Pipeline SHALL 为每条向量记录维护 ingestedAt（摄入时间）和 lastAccessedAt（最后访问时间）时间戳
2. THE VectorLifecycleManager SHALL 提供定时任务，执行以下操作：将超过配置天数未访问的向量归档到冷存储、删除超过配置天数的已归档向量、清理孤儿向量（元数据表中无对应记录的向量）
3. THE VectorLifecycleManager SHALL 支持冷热分层：hot collection 存放近期活跃数据，cold collection 存放归档数据；WHEN 检索命中 cold collection 时，THE VectorLifecycleManager SHALL 自动将该向量提升回 hot collection
4. WHEN 管理员通过 POST /api/admin/rag/purge 触发时，THE VectorLifecycleManager SHALL 按指定条件（projectId、sourceType、timeRange）批量清理向量数据
5. WHEN 生命周期操作执行时，THE VectorLifecycleManager SHALL 将操作日志写入 rag_lifecycle_log，包含操作类型、影响的向量数量、执行时间

### 需求 8：RAG 管道可观测性与成本治理

**用户故事：** 作为系统管理员，我需要监控 RAG 管道的运行状态和成本，这样可以及时发现问题并控制资源消耗。

#### 验收标准

1. THE RAGPipeline SHALL 暴露 Prometheus 兼容指标，包含：ingestion（摄入速率/延迟/失败率）、retrieval（检索 QPS/延迟/命中率）、augmentation（增强次数/token 消耗）、vector_count（各 collection 向量数量）、embedding_cost（嵌入 API 调用次数和 token 消耗）
2. THE RAGPipeline SHALL 支持项目级配额控制：每个 projectId 可配置最大向量数量和每日最大嵌入 token 消耗；IF 超出配额，THEN THE RAGPipeline SHALL 拒绝新的摄入请求并返回配额超限错误
3. THE RAGPipeline SHALL 提供 token 消耗分解统计，按 projectId、sourceType、操作类型（embedding/reranking/augmentation）分别统计
4. WHEN 管理员访问 GET /api/admin/rag/health 时，THE RAGPipeline SHALL 返回健康检查结果，包含向量数据库连接状态、Embedding 模型可用性、各 collection 状态、Dead Letter Queue 积压量
5. WHERE 配置 rag.enabled 设置为 false，THE RAGPipeline SHALL 全局关闭所有 RAG 功能；WHEN 管理员通过 POST /api/admin/rag/backfill 触发时，THE Ingestion_Pipeline SHALL 对历史数据执行回填摄入

### 需求 9：前端展示 RAG 检索过程与结果

**用户故事：** 作为用户，我需要在前端界面中查看 RAG 检索的过程和结果，这样可以理解 Agent 的决策依据并提供反馈。

#### 验收标准

1. WHEN 用户查看任务详情页时，THE Frontend SHALL 展示 RAG 增强信息区块，包含检索到的 chunk 列表、每个 chunk 的来源和相关度评分、注入的 token 数量
2. WHEN 展示检索结果时，THE Frontend SHALL 为每个 chunk 显示状态标签：injected（已注入 LLM 上下文）、pruned（因 token 预算被裁剪）、below_threshold（相关度低于阈值未使用）
3. WHERE 用户启用检索调试面板，THE Frontend SHALL 展示完整的检索流程：query 向量化耗时、ANN 搜索耗时、重排耗时、总耗时、候选数量、最终注入数量
4. WHEN 3D 场景中 Agent 执行 RAG 增强任务时，THE Frontend SHALL 在 TelemetryOverlay 中展示 RAG 相关遥测数据（检索延迟、命中率、token 消耗）
5. WHEN 用户对检索结果提交反馈时，THE Frontend SHALL 提供 helpful/irrelevant 标记按钮和缺失上下文描述输入框，并将反馈提交到后端 API
6. WHEN 前端请求任务的 RAG 数据时，THE Backend SHALL 通过 GET /api/workflows/:id/tasks/:taskId/rag 返回该任务的 RAG 增强记录
