# 需求文档：EdgeBrain 边缘部署

## 简介

EdgeBrain 是 Cube Brain 的轻量版本，支持在本地/边缘环境部署 Agent，用于处理敏感数据和离线场景。EdgeBrain 与云端主节点保持双向数据同步，支持离线工作、冲突解决和渐进式同步。通过最小化资源占用和智能缓存策略，EdgeBrain 可运行在资源受限的设备上。

## 术语表

- **EdgeBrain_Node**: 边缘节点实例，Cube Brain 的轻量版本，部署在本地/边缘环境
- **Cloud_Node**: 云端主节点，运行完整 Cube Brain 的中心服务器
- **Sync_Engine**: 同步引擎，负责云端与边缘节点之间的数据同步
- **Offline_Queue**: 离线队列，在网络不可用时缓存待同步的操作
- **Local_Cache**: 本地缓存，存储 Agent 定义、知识库、工作流等数据的边缘节点缓存层
- **Conflict_Resolver**: 冲突解决器，处理双向同步中的数据冲突
- **Resource_Monitor**: 资源监控器，监控边缘节点的 CPU、内存、磁盘使用
- **Health_Checker**: 健康检查器，监控边缘节点的连接状态和运行健康度
- **Task_Dispatcher**: 任务分配器，将工作流任务分配到合适的边缘节点
- **Node_Group**: 节点组，按地理位置、功能、租户等维度对边缘节点进行分组管理
- **Sync_Log**: 同步日志，记录每次同步操作的时间、数据量、状态等信息
- **Tenant**: 租户，在多租户模式下使用边缘节点的独立用户或组织

## 需求

### 需求 1：EdgeBrain 节点注册和初始化

**用户故事：** 作为系统管理员，我需要注册新的边缘节点并初始化其基础配置，这样边缘设备可以加入网络。

#### 验收标准

1. WHEN 管理员调用 registerEdgeNode() 接口并提供 name、location、tier、connectivity 参数, THE EdgeBrain_Node SHALL 创建新的边缘节点实例并返回注册结果
2. WHEN 边缘节点注册成功, THE EdgeBrain_Node SHALL 生成唯一的 nodeId（UUID 格式）和认证令牌（JWT 格式）
3. WHEN 边缘节点注册成功, THE EdgeBrain_Node SHALL 初始化本地存储结构，包括 SQLite 数据库和缓存目录
4. WHEN 边缘节点的 tier 为 lite, THE EdgeBrain_Node SHALL 设置容量上限为 10 个 Agent 和 5GB 存储；WHEN tier 为 standard, THE EdgeBrain_Node SHALL 设置容量上限为 50 个 Agent 和 20GB 存储；WHEN tier 为 premium, THE EdgeBrain_Node SHALL 不设置容量上限
5. WHEN 注册成功, THE EdgeBrain_Node SHALL 返回包含 nodeId、认证令牌和初始配置的响应对象

### 需求 2：云端到边缘的配置同步

**用户故事：** 作为系统，我需要将云端的 Agent、知识库、工作流配置同步到边缘节点，这样边缘节点可以执行任务。

#### 验收标准

1. WHEN 云端调用 syncToEdge(nodeId, dataTypes, filter) 接口, THE Sync_Engine SHALL 将指定类型的数据同步到目标边缘节点
2. WHEN 同步请求包含 dataTypes 和 filter 参数, THE Sync_Engine SHALL 只同步匹配过滤条件的 Agent、知识库或工作流数据
3. WHEN 同步数据传输完成, THE Sync_Engine SHALL 计算数据的 checksum 并与源数据比对，验证数据完整性
4. WHEN 边缘节点已有部分数据, THE Sync_Engine SHALL 执行增量同步，只传输自上次同步以来变更的数据
5. WHEN 每次同步操作完成, THE Sync_Log SHALL 记录同步时间、数据量、状态和涉及的数据类型

### 需求 3：边缘到云端的执行结果同步

**用户故事：** 作为系统，我需要将边缘节点的工作流执行结果同步回云端，这样可以进行统一的结果管理和分析。

#### 验收标准

1. WHEN 边缘节点调用 syncToCloud(nodeId, executionResults) 接口, THE Sync_Engine SHALL 将执行结果上传到云端
2. THE Sync_Engine SHALL 确保每条执行结果包含 workflowId、executionId、status、output、metrics 和 timestamp 字段
3. WHEN 多条执行结果待同步, THE Sync_Engine SHALL 支持批量同步，将多条结果合并为单次网络请求
4. IF 同步过程中网络连接中断, THEN THE Offline_Queue SHALL 将未同步的结果存储在本地队列中，待网络恢复后自动重试
5. WHEN 每次同步操作完成, THE Sync_Log SHALL 记录同步时间、数据量和状态

### 需求 4：双向数据同步和冲突解决

**用户故事：** 作为系统，我需要支持双向同步，并在发生冲突时自动解决。

#### 验收标准

1. WHEN 同步模式设置为 bidirectional, THE Sync_Engine SHALL 允许云端和边缘节点双方修改数据并同步变更
2. THE Sync_Engine SHALL 为每条数据记录 version（递增整数）和 lastModifiedTime（时间戳），用于冲突检测
3. WHEN 同一条数据在云端和边缘节点都被修改, THE Conflict_Resolver SHALL 根据配置的策略（cloud-wins、edge-wins、manual、merge）自动解决冲突
4. WHEN 冲突发生, THE Conflict_Resolver SHALL 记录冲突日志，包含冲突的数据标识、双方版本号、双方修改内容和最终解决方案
5. WHEN 冲突解决策略为 manual, THE Conflict_Resolver SHALL 暂停同步并通过 API 允许用户选择保留哪个版本

### 需求 5：离线工作和操作队列

**用户故事：** 作为边缘节点，我需要支持离线工作，即使网络不可用也能继续执行任务。

#### 验收标准

1. THE EdgeBrain_Node SHALL 持续检测网络连接状态，WHEN 网络不可用, THE EdgeBrain_Node SHALL 自动切换到离线模式
2. WHILE 处于离线模式, THE EdgeBrain_Node SHALL 将工作流执行结果存储在 Offline_Queue 中
3. WHEN 网络连接恢复, THE Offline_Queue SHALL 自动将队列中的数据按时间顺序同步到云端
4. WHERE 连接模式设置为 offline-first, THE EdgeBrain_Node SHALL 优先使用 Local_Cache 中的数据执行任务
5. THE Offline_Queue SHALL 为每条待同步操作记录操作类型、时间戳、重试次数和最大重试次数

### 需求 6：智能缓存策略

**用户故事：** 作为系统，我需要实现智能缓存策略，最大化边缘节点的存储利用率。

#### 验收标准

1. THE Local_Cache SHALL 支持 LRU（最近最少使用）、LFU（最不经常使用）和 TTL（生存时间）三种缓存淘汰策略
2. THE Local_Cache SHALL 根据数据访问频率和数据大小自动调整缓存优先级，高频小数据优先保留
3. WHEN 边缘节点启动, THE Local_Cache SHALL 执行缓存预热，根据历史访问记录预加载最常用的数据
4. WHEN 云端数据更新, THE Local_Cache SHALL 自动将对应的本地缓存标记为失效并在下次访问时重新获取
5. THE Local_Cache SHALL 提供缓存统计接口，返回命中率、缓存大小、最后更新时间等指标

### 需求 7：边缘节点资源管理

**用户故事：** 作为系统，我需要管理边缘节点的资源（CPU、内存、存储），防止过度使用。

#### 验收标准

1. THE Resource_Monitor SHALL 定期采集边缘节点的 CPU 使用率、内存使用量和磁盘使用量
2. WHEN 资源使用超过配置的阈值（默认 80%）, THE Resource_Monitor SHALL 触发资源回收，自动清理过期缓存或降低同步频率
3. THE EdgeBrain_Node SHALL 支持资源配额限制，包括最大 Agent 数量和最大工作流并发数
4. WHEN 客户端请求 GET /api/edge-nodes/:id/resources, THE EdgeBrain_Node SHALL 返回当前 CPU、内存、磁盘使用情况的 JSON 响应
5. WHEN 资源使用超过告警阈值, THE Resource_Monitor SHALL 将告警信息记录到日志中，包含资源类型、当前值和阈值

### 需求 8：边缘节点健康检查和监控

**用户故事：** 作为系统，我需要监控边缘节点的健康状态，及时发现和处理问题。

#### 验收标准

1. THE Cloud_Node SHALL 按配置的间隔（默认 30 秒）向每个已注册的边缘节点发送心跳请求
2. WHEN 边缘节点收到心跳请求, THE EdgeBrain_Node SHALL 响应心跳并返回当前状态信息（online、offline、error）
3. WHEN 心跳请求连续超时达到配置的阈值（默认 3 次）, THE Cloud_Node SHALL 将该节点标记为 offline 并停止向其分配新任务
4. WHEN 客户端请求边缘节点的 /health 端点, THE EdgeBrain_Node SHALL 返回详细的健康信息，包括运行时间、资源使用、同步状态和最后心跳时间
5. WHEN 健康检查完成, THE Health_Checker SHALL 将检查结果记录到监控系统中，用于告警和趋势分析

### 需求 9：边缘节点任务分配和执行

**用户故事：** 作为系统，我需要支持将工作流任务分配到边缘节点执行。

#### 验收标准

1. WHEN 工作流定义包含 edgeNodeSelector 字段, THE Task_Dispatcher SHALL 根据选择器匹配合适的边缘节点
2. WHEN 分配任务到边缘节点, THE Task_Dispatcher SHALL 检查目标节点的容量和资源使用情况，确保节点有足够资源执行任务
3. WHEN 多个任务等待分配, THE Task_Dispatcher SHALL 按任务优先级从高到低的顺序分配任务到边缘节点
4. WHILE 边缘节点执行任务, THE EdgeBrain_Node SHALL 使用 Local_Cache 中缓存的 Agent 定义和知识库数据
5. WHEN 边缘节点完成任务执行, THE Sync_Engine SHALL 将执行结果同步回云端

### 需求 10：敏感数据本地处理

**用户故事：** 作为用户，我需要在边缘节点处理敏感数据，确保数据不上传到云端。

#### 验收标准

1. THE EdgeBrain_Node SHALL 支持在工作流定义中通过 dataClassification 字段标记数据敏感性级别
2. WHEN 数据标记为 sensitive: true, THE EdgeBrain_Node SHALL 确保该数据只在边缘节点本地处理，不传输到云端
3. WHEN 敏感数据的工作流执行完成, THE Sync_Engine SHALL 只同步执行结果的摘要信息（不含原始敏感数据）到云端
4. THE EdgeBrain_Node SHALL 对敏感数据在传输和本地存储时使用 AES-256 加密
5. THE EdgeBrain_Node SHALL 记录敏感数据的访问审计日志，包含访问者、操作类型、时间戳和数据标识

### 需求 11：边缘节点更新和升级

**用户故事：** 作为系统管理员，我需要能够远程更新边缘节点的软件和配置。

#### 验收标准

1. WHEN 管理员调用 updateEdgeNode(nodeId, updatePackage) 接口, THE Cloud_Node SHALL 将更新包推送到目标边缘节点
2. THE Cloud_Node SHALL 确保更新包包含版本号、变更内容清单和回滚信息
3. WHEN 管理员选择灰度更新, THE Cloud_Node SHALL 先将更新推送到指定的测试节点子集，验证成功后再全量推送
4. IF 更新过程中发生错误, THEN THE EdgeBrain_Node SHALL 自动回滚到上一个稳定版本
5. WHEN 更新操作完成, THE Sync_Log SHALL 记录更新时间、目标版本、更新状态和涉及的节点列表

### 需求 12：边缘节点分组和管理

**用户故事：** 作为系统管理员，我需要对边缘节点进行分组管理，便于统一配置和监控。

#### 验收标准

1. THE Cloud_Node SHALL 支持创建 Node_Group，按地理位置、功能或租户维度对边缘节点分组
2. WHEN 为 Node_Group 设置同步策略、资源配额或权限, THE Cloud_Node SHALL 将配置自动应用到组内所有边缘节点
3. THE Cloud_Node SHALL 支持 Node_Group 的层级结构（如地区 > 城市 > 机房），子组继承父组配置
4. WHEN 客户端请求 GET /api/edge-node-groups, THE Cloud_Node SHALL 返回节点组列表，包含组名、节点数量和配置摘要
5. WHEN 管理员对 Node_Group 执行批量操作（更新、同步）, THE Cloud_Node SHALL 将操作并行应用到组内所有节点

### 需求 13：边缘节点性能优化

**用户故事：** 作为系统，我需要优化边缘节点的性能，减少资源消耗。

#### 验收标准

1. THE EdgeBrain_Node SHALL 使用 SQLite 作为本地数据存储引擎
2. WHEN 执行数据同步, THE Sync_Engine SHALL 使用增量同步策略，只传输自上次同步以来变更的数据
3. WHEN 传输数据量超过配置的阈值（默认 1MB）, THE Sync_Engine SHALL 对数据进行 gzip 压缩后再传输
4. WHEN 边缘节点启动, THE Local_Cache SHALL 根据历史访问模式智能预加载最可能被访问的数据
5. THE EdgeBrain_Node SHALL 提供性能指标接口，返回同步耗时、缓存命中率和工作流平均执行时间

### 需求 14：边缘节点安全性

**用户故事：** 作为系统，我需要确保边缘节点的安全，防止未授权访问和数据泄露。

#### 验收标准

1. THE EdgeBrain_Node SHALL 使用 TLS 1.2 或更高版本加密与云端的所有通信
2. THE EdgeBrain_Node SHALL 支持 mTLS（双向 TLS），云端和边缘节点互相验证对方的证书
3. THE EdgeBrain_Node SHALL 对本地存储的敏感数据使用 AES-256 加密
4. THE EdgeBrain_Node SHALL 实现基于角色的访问控制（RBAC），限制用户对边缘节点的操作权限
5. THE EdgeBrain_Node SHALL 定期生成访问审计报告，记录所有 API 调用和数据访问操作

### 需求 15：多租户隔离

**用户故事：** 作为系统，我需要在边缘节点上实现多租户隔离。

#### 验收标准

1. THE EdgeBrain_Node SHALL 为每个租户创建独立的数据存储空间，确保租户间数据完全隔离
2. THE EdgeBrain_Node SHALL 为每个租户使用独立的 SQLite 数据库文件存储数据
3. WHILE 多个租户的工作流同时执行, THE EdgeBrain_Node SHALL 确保各租户的执行环境相互隔离，不共享运行时状态
4. THE Cloud_Node SHALL 支持为不同租户配置独立的同步策略（频率、模式、数据过滤规则）
5. WHEN 租户被删除, THE EdgeBrain_Node SHALL 完全清除该租户的所有本地数据，包括数据库文件、缓存和日志

### 需求 16：前端边缘节点管理面板

**用户故事：** 作为用户，我希望在前端看到边缘节点的状态、资源使用情况和同步进度。

#### 验收标准

1. THE EdgeBrain_Node 管理面板 SHALL 显示节点列表，每个节点包含名称、位置、状态和容量信息
2. WHEN 用户选择某个节点, THE EdgeBrain_Node 管理面板 SHALL 显示该节点的资源使用情况（CPU、内存、磁盘使用率）
3. THE EdgeBrain_Node 管理面板 SHALL 显示每个节点的同步状态，包含最后同步时间和待同步数据量
4. THE EdgeBrain_Node 管理面板 SHALL 显示每个节点的执行统计，包含已执行任务数、成功率和平均执行时间
5. WHEN 边缘节点状态发生变化, THE Cloud_Node SHALL 通过 WebSocket 实时推送状态更新到前端管理面板
