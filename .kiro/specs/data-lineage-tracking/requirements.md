# 数据血缘追踪 — 需求文档

## 模块概述

数据血缘追踪模块负责在 Mission 原生数据源基础上，记录每个数据的完整生命周期——从源头数据、经过 Agent 处理、到最终决策输出。通过血缘链路追踪，系统可以回答"这个决策基于什么数据""数据变更会影响哪些决策"等关键问题，支撑审计合规和故障调试。

## 用户故事

### US-1: 自动采集数据源血缘

作为系统，我需要在 Mission 数据源查询执行时自动记录血缘信息，包括查询内容、执行时间、结果哈希和数据源标识，这样每份数据都能追溯到原始来源。

#### 验收标准

- AC-1.1: Mission 数据源查询完成后，系统自动生成 DataLineageNode（包含 lineageId、sourceId、query、resultHash、timestamp）
- AC-1.2: 数据源血缘记录包含 type: "source"、sourceName、queryText 等字段
- AC-1.3: 结果哈希采用 SHA256，用于后续数据变更检测
- AC-1.4: 血缘采集延迟 < 10ms，不阻塞查询返回
- AC-1.5: 采集过程记录调试日志（sourceId、query、resultSize、executionTimeMs）

### US-2: 追踪 Agent 数据处理链路

作为系统，我需要在每个 Agent 处理数据前后记录血缘信息，包括输入数据 ID、处理操作、代码位置、执行参数和输出数据 ID，这样可以重现数据的每一步变换。

#### 验收标准

- AC-2.1: Agent 执行前后，系统调用 recordTransformation()，生成 DataLineageNode（包含 inputLineageIds、agentId、operation、codeLocation、parameters、outputLineageId）
- AC-2.2: 代码位置通过堆栈跟踪自动捕获（文件名:行号）
- AC-2.3: 处理操作类型包括 filter、aggregate、join、ml_inference、transform 等
- AC-2.4: 执行参数记录关键配置（如 threshold、model_version、window_size）
- AC-2.5: 输出数据哈希与输入哈希不同时，标记为 dataChanged: true
- AC-2.6: 处理链路支持多输入（upstream 数组）和多输出（downstream 数组）

### US-3: 记录决策血缘和上下文

作为系统，我需要在决策生成时记录决策依赖的所有数据、驱动决策的 Agent、执行上下文（会话 ID、用户、环境），这样审计人员可以完整追溯决策的合理性。

#### 验收标准

- AC-3.1: 决策生成时，系统调用 recordDecision()，生成 DataLineageNode（包含 decisionId、inputLineageIds、agentId、decisionLogic、result、confidence）
- AC-3.2: 上下文信息包含 sessionId、userId、requestId、environment、timestamp
- AC-3.3: 决策节点的 type: "decision"，与数据节点区分
- AC-3.4: 记录决策的置信度、使用的模型版本、执行耗时
- AC-3.5: 决策结果（如 approve/reject）和关键指标（如 risk_score）存储在 metadata 中

### US-4: 血缘存储和索引

作为系统，我需要将血缘数据持久化到高效的存储后端，并建立多维索引，这样可以快速查询血缘链路而不影响性能。

#### 验收标准

- AC-4.1: 默认使用本地 JSON 文件存储（与项目现有模式一致），通过 LineageStorageAdapter 接口支持未来切换到图数据库（Neo4j）或时间序列数据库（ClickHouse）
- AC-4.2: 建立内存索引：(dataId → timestamp)、(agentId → timestamp)、(sessionId → timestamp)、(decisionId → node)
- AC-4.3: 单条血缘记录大小 < 500 bytes，支持百万级数据量
- AC-4.4: 查询响应时间：单条查询 < 50ms，完整链路查询 < 500ms
- AC-4.5: 支持数据保留策略（默认 90 天），过期数据自动清理

### US-5: 血缘查询接口

作为系统，我需要提供多种血缘查询接口，支持上游追溯、下游影响分析、完整链路查询，这样用户可以灵活探索数据血缘。

#### 验收标准

- AC-5.1: getUpstream(dataId, depth) 返回数据的所有上游依赖（递归追溯到源头）
- AC-5.2: getDownstream(dataId, depth) 返回数据的所有下游消费者（包括 Agent、决策）
- AC-5.3: getFullPath(sourceId, decisionId) 返回从数据源到决策的完整链路（DAG）
- AC-5.4: getImpactAnalysis(dataId) 分析数据变更对下游决策的影响范围和风险等级
- AC-5.5: 查询结果包含节点详情（id、type、name、timestamp、metadata）和边信息（relationship、weight）

### US-6: 审计日志和合规输出

作为审计人员，我需要查询谁在何时访问了哪些数据、数据如何被处理、最终驱动了什么决策，这样可以生成合规报告和异常告警。

#### 验收标准

- AC-6.1: getAuditTrail(userId, timeRange) 返回用户在指定时间内的所有数据访问记录
- AC-6.2: 审计日志包含 userId、timestamp、dataId、agentId、operation、decisionId、result
- AC-6.3: exportLineageReport(decisionId) 生成完整的决策血缘证明（PDF/JSON），包含所有上游数据和处理步骤
- AC-6.4: 异常检测：数据突变（哈希变更）、异常访问（非预期 Agent 访问）、权限违规自动告警
- AC-6.5: 支持 PII 检测标记，合规数据（GDPR、PCI）标记为 complianceTags

### US-7: 血缘可视化和交互

作为用户，我需要在前端看到数据血缘的 DAG 图、时间轴和热力图，这样可以直观理解数据流向和关键节点。

#### 验收标准

- AC-7.1: 血缘图展示为 DAG（节点=数据/Agent/决策，边=依赖关系）
- AC-7.2: 支持交互：点击节点查看详情、高亮完整链路、过滤（按 Agent、时间、数据源）
- AC-7.3: 时间轴视图按执行顺序展示数据流转过程
- AC-7.4: 热力图标记高频数据源和关键 Agent（颜色深度表示重要性）
- AC-7.5: 支持导出为 PNG/SVG，便于报告和演示

### US-8: 血缘数据变更检测

作为系统，我需要监控数据源的变更（新增字段、数据量异常、质量下降），并自动分析对下游决策的影响，这样可以及时预警和调整。

#### 验收标准

- AC-8.1: 定期对比数据源的结果哈希，检测数据变更
- AC-8.2: 数据变更时，自动调用 getDownstream() 分析影响范围
- AC-8.3: 生成变更告警，包含变更类型（schema 变更、数据量异常、质量下降）、影响的 Agent 和决策
- AC-8.4: 支持变更回溯：查询"在某个时间点，这个决策基于的数据是什么"
- AC-8.5: 记录数据质量指标（freshness、completeness、accuracy），用于决策可信度评估

### US-9: 血缘采集器集成到 Agent 框架

作为开发者，我需要在 Agent 基类中集成血缘采集逻辑，这样所有 Agent 自动获得血缘追踪能力，无需手动埋点。

#### 验收标准

- AC-9.1: RuntimeAgent 提供 lineageTracked 包装方法（TypeScript 装饰器模式），自动采集输入/输出血缘
- AC-9.2: 包装方法自动捕获方法名、代码位置、执行时间、异常信息
- AC-9.3: 支持自定义血缘元数据（如 lineageTracked({ operation: "ml_inference", model_version: "v2" })）
- AC-9.4: 血缘采集失败不影响 Agent 执行（异步记录或降级处理）
- AC-9.5: 提供血缘采集的性能监控（采集延迟、存储吞吐量）

### US-10: 血缘数据导入导出

作为系统，我需要支持血缘数据的导入导出，便于跨系统迁移、备份和分析。

#### 验收标准

- AC-10.1: exportLineage(startTime, endTime, format) 支持 JSON、CSV 格式导出
- AC-10.2: 导出数据包含完整的节点和边信息，可独立重建血缘图
- AC-10.3: importLineage(file) 支持从外部系统导入血缘数据
- AC-10.4: 导入时自动去重和冲突解决（基于 lineageId 和 timestamp）
- AC-10.5: 支持增量导出（仅导出指定时间范围的新增数据）
