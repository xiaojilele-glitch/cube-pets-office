# 实现计划：EdgeBrain 边缘部署

## 概述

基于设计文档，将 EdgeBrain 边缘部署功能分解为增量式编码任务。采用 TypeScript 实现，服务端使用 Express + SQLite，前端使用 React + Zustand，测试使用 Vitest + fast-check。

## 任务

- [ ] 1. 定义共享类型和常量
  - [ ] 1.1 创建 `shared/edge-brain/contracts.ts`，定义所有 EdgeBrain 相关的 TypeScript 接口和类型（EdgeNode、SyncStrategy、VersionedData、ExecutionResult、ConflictRecord、PendingOperation、NodeGroup、ResourceUsage、HealthStatus 等）
    - _Requirements: 1.1, 1.4, 2.1, 3.2, 4.2, 5.5, 12.1_
  - [ ] 1.2 创建 `shared/edge-brain/api.ts`，定义所有 REST API 路由常量和请求/响应类型
    - _Requirements: 7.4, 8.4, 12.4_
  - [ ] 1.3 创建 `shared/edge-brain/socket.ts`，定义 WebSocket 事件常量（节点状态变化、同步进度、资源告警等）
    - _Requirements: 16.5_
  - [ ] 1.4 创建 `shared/edge-brain/index.ts`，统一导出模块
    - _Requirements: 1.1_

- [ ] 2. 实现节点注册服务
  - [ ] 2.1 创建 `server/edge-brain/node-registry.ts`，实现 NodeRegistryService（registerEdgeNode、unregisterEdgeNode、getEdgeNode、listEdgeNodes、updateNodeStatus），使用 UUID 生成 nodeId，JWT 生成 authToken，根据 tier 设置容量
    - _Requirements: 1.1, 1.2, 1.4, 1.5_
  - [ ]\* 2.2 编写属性测试：节点注册产生有效唯一标识和正确容量
    - **Property 1: 节点注册产生有效唯一标识和正确容量**
    - **Validates: Requirements 1.1, 1.2, 1.4**
  - [ ] 2.3 创建 `server/edge-brain/node-storage.ts`，实现节点数据的 JSON 文件持久化（与项目现有 database.json 模式一致）
    - _Requirements: 1.3_

- [ ] 3. 实现同步引擎核心
  - [ ] 3.1 创建 `server/edge-brain/sync-engine.ts`，实现 SyncEngineService（syncToEdge、syncToCloud、syncBidirectional），包含 checksum 计算（SHA-256）、增量同步逻辑（基于 version 比较）、数据过滤和批量同步
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.3_
  - [ ] 3.2 创建 `server/edge-brain/sync-log.ts`，实现 SyncLog 记录服务，每次同步操作记录时间、数据量、状态
    - _Requirements: 2.5, 3.5_
  - [ ]\* 3.3 编写属性测试：选择性同步过滤正确性
    - **Property 2: 选择性同步过滤正确性**
    - **Validates: Requirements 2.2**
  - [ ]\* 3.4 编写属性测试：同步数据完整性校验
    - **Property 3: 同步数据完整性校验**
    - **Validates: Requirements 2.3**
  - [ ]\* 3.5 编写属性测试：增量同步只传输变更数据
    - **Property 4: 增量同步只传输变更数据**
    - **Validates: Requirements 2.4**
  - [ ]\* 3.6 编写属性测试：批量同步传输所有项目
    - **Property 7: 批量同步传输所有项目**
    - **Validates: Requirements 3.3**
  - [ ]\* 3.7 编写属性测试：执行结果数据完整性
    - **Property 6: 执行结果数据完整性**
    - **Validates: Requirements 3.2**
  - [ ]\* 3.8 编写属性测试：操作日志完整性
    - **Property 5: 操作日志完整性**
    - **Validates: Requirements 2.5, 3.5, 4.4, 7.5, 8.5, 11.5**

- [ ] 4. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 5. 实现冲突解决服务
  - [ ] 5.1 创建 `server/edge-brain/conflict-resolver.ts`，实现 ConflictResolverService（detectConflicts、resolveConflict、resolveManually），支持 cloud-wins、edge-wins、manual、merge 四种策略，基于 version 和 lastModifiedTime 检测冲突
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]\* 5.2 编写属性测试：数据版本追踪
    - **Property 10: 数据版本追踪**
    - **Validates: Requirements 4.2**
  - [ ]\* 5.3 编写属性测试：冲突解决策略一致性
    - **Property 11: 冲突解决策略一致性**
    - **Validates: Requirements 4.3**
  - [ ]\* 5.4 编写属性测试：双向同步变更传播
    - **Property 9: 双向同步变更传播**
    - **Validates: Requirements 4.1**

- [ ] 6. 实现离线队列服务
  - [ ] 6.1 创建 `server/edge-brain/offline-queue.ts`，实现 OfflineQueueService（enqueue、dequeue、markCompleted、markFailed、retry、getQueueStats），支持优先级排序、重试策略和时间顺序排空
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]\* 6.2 编写属性测试：网络故障时离线队列缓存
    - **Property 8: 网络故障时离线队列缓存**
    - **Validates: Requirements 3.4, 5.2**
  - [ ]\* 6.3 编写属性测试：离线队列按时间顺序排空
    - **Property 13: 离线队列按时间顺序排空**
    - **Validates: Requirements 5.3**
  - [ ]\* 6.4 编写属性测试：网络状态检测和模式切换
    - **Property 12: 网络状态检测和模式切换**
    - **Validates: Requirements 5.1**

- [ ] 7. 实现本地缓存服务
  - [ ] 7.1 创建 `server/edge-brain/local-cache.ts`，实现 LocalCacheService（get、set、invalidate、invalidateByPattern、warmup、getStats、evict），支持 LRU/LFU/TTL 三种淘汰策略、缓存预热和统计
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]\* 7.2 编写属性测试：缓存淘汰策略正确性
    - **Property 15: 缓存淘汰策略正确性**
    - **Validates: Requirements 6.1**
  - [ ]\* 7.3 编写属性测试：缓存优先级基于频率和大小
    - **Property 16: 缓存优先级基于频率和大小**
    - **Validates: Requirements 6.2**
  - [ ]\* 7.4 编写属性测试：云端更新触发缓存失效
    - **Property 17: 云端更新触发缓存失效**
    - **Validates: Requirements 6.4**
  - [ ]\* 7.5 编写属性测试：缓存统计准确性
    - **Property 18: 缓存统计准确性**
    - **Validates: Requirements 6.5**

- [ ] 8. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 9. 实现资源监控服务
  - [ ] 9.1 创建 `server/edge-brain/resource-monitor.ts`，实现 ResourceMonitorService（getResourceUsage、checkQuota、setThreshold、onThresholdExceeded），定期采集 CPU/内存/磁盘使用率，支持阈值告警和资源回收
    - _Requirements: 7.1, 7.2, 7.3, 7.5_
  - [ ]\* 9.2 编写属性测试：资源监控和阈值响应
    - **Property 19: 资源监控和阈值响应**
    - **Validates: Requirements 7.1, 7.2**
  - [ ]\* 9.3 编写属性测试：资源配额强制执行
    - **Property 20: 资源配额强制执行**
    - **Validates: Requirements 7.3**

- [ ] 10. 实现健康检查服务
  - [ ] 10.1 创建 `server/edge-brain/health-check.ts`，实现 HealthCheckService（sendHeartbeat、getHealthStatus、startHeartbeatScheduler、stopHeartbeatScheduler），支持心跳调度、连续失败计数和 offline 标记
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [ ]\* 10.2 编写属性测试：心跳失败阈值触发离线标记
    - **Property 21: 心跳失败阈值触发离线标记**
    - **Validates: Requirements 8.3**

- [ ] 11. 实现任务分配服务
  - [ ] 11.1 创建 `server/edge-brain/task-dispatch.ts`，实现 TaskDispatchService（dispatchTask、selectNode、getNodeLoad），支持 edgeNodeSelector 匹配、容量检查和优先级排序
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ]\* 11.2 编写属性测试：任务分配匹配节点选择器和容量
    - **Property 22: 任务分配匹配节点选择器和容量**
    - **Validates: Requirements 9.1, 9.2**
  - [ ]\* 11.3 编写属性测试：任务分配遵循优先级顺序
    - **Property 23: 任务分配遵循优先级顺序**
    - **Validates: Requirements 9.3**

- [ ] 12. 实现敏感数据处理
  - [ ] 12.1 创建 `server/edge-brain/security.ts`，实现敏感数据加密（AES-256）、数据分类过滤（阻止敏感数据同步到云端）、审计日志记录和 RBAC 访问控制
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 14.3, 14.4_
  - [ ]\* 12.2 编写属性测试：敏感数据不离开边缘节点
    - **Property 24: 敏感数据不离开边缘节点**
    - **Validates: Requirements 10.2, 10.3**
  - [ ]\* 12.3 编写属性测试：敏感数据加密存储
    - **Property 25: 敏感数据加密存储**
    - **Validates: Requirements 10.4**
  - [ ]\* 12.4 编写属性测试：RBAC 访问控制
    - **Property 30: RBAC 访问控制**
    - **Validates: Requirements 14.4**

- [ ] 13. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 14. 实现更新管理服务
  - [ ] 14.1 创建 `server/edge-brain/update-manager.ts`，实现 UpdateManagerService（pushUpdate、canaryUpdate、rollback、getUpdateHistory），支持更新包验证、灰度更新和自动回滚
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [ ]\* 14.2 编写属性测试：更新验证和失败回滚
    - **Property 26: 更新验证和失败回滚**
    - **Validates: Requirements 11.2, 11.4**
  - [ ]\* 14.3 编写属性测试：灰度更新只影响目标子集
    - **Property 27: 灰度更新只影响目标子集**
    - **Validates: Requirements 11.3**

- [ ] 15. 实现节点组管理服务
  - [ ] 15.1 创建 `server/edge-brain/node-group.ts`，实现 NodeGroupService（createGroup、updateGroup、deleteGroup、listGroups、addNodeToGroup、removeNodeFromGroup、batchOperation），支持层级结构和配置继承
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [ ]\* 15.2 编写属性测试：节点组操作传播和继承
    - **Property 28: 节点组操作传播和继承**
    - **Validates: Requirements 12.2, 12.3, 12.5**

- [ ] 16. 实现多租户隔离服务
  - [ ] 16.1 创建 `server/edge-brain/tenant-isolation.ts`，实现 TenantIsolationService（createTenantSpace、deleteTenantSpace、getTenantDb、listTenants、setTenantSyncStrategy），每个租户独立 SQLite 数据库，支持租户删除时完全清除数据
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - [ ]\* 16.2 编写属性测试：租户生命周期隔离
    - **Property 31: 租户生命周期隔离**
    - **Validates: Requirements 15.1, 15.3, 15.4, 15.5**

- [ ] 17. 实现数据压缩
  - [ ] 17.1 在 `server/edge-brain/sync-engine.ts` 中添加 gzip 压缩逻辑，当传输数据量超过阈值（默认 1MB）时自动压缩
    - _Requirements: 13.3_
  - [ ]\* 17.2 编写属性测试：数据压缩阈值
    - **Property 29: 数据压缩阈值**
    - **Validates: Requirements 13.3**

- [ ] 18. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 19. 实现云端 REST API 路由
  - [ ] 19.1 创建 `server/routes/edge-nodes.ts`，实现边缘节点管理路由（POST/GET/DELETE /api/edge-nodes，GET /api/edge-nodes/:id/resources，GET /api/edge-nodes/:id/health，POST /api/edge-nodes/:id/update）
    - _Requirements: 1.1, 7.4, 8.4, 11.1_
  - [ ] 19.2 创建 `server/routes/edge-sync.ts`，实现同步管理路由（POST /api/edge-sync/to-edge，POST /api/edge-sync/to-cloud，POST /api/edge-sync/bidirectional，GET /api/edge-sync/:nodeId/log，GET /api/edge-sync/:nodeId/conflicts，POST /api/edge-sync/conflicts/:id/resolve）
    - _Requirements: 2.1, 3.1, 4.1, 4.5_
  - [ ] 19.3 创建 `server/routes/edge-node-groups.ts`，实现节点组管理路由（POST/GET/PUT/DELETE /api/edge-node-groups，POST /api/edge-node-groups/:id/batch）
    - _Requirements: 12.1, 12.4, 12.5_
  - [ ] 19.4 创建 `server/routes/edge-tasks.ts`，实现任务分配路由（POST /api/edge-tasks/dispatch，GET /api/edge-tasks/:nodeId）
    - _Requirements: 9.1_
  - [ ] 19.5 在 `server/index.ts` 中注册所有 EdgeBrain 路由
    - _Requirements: 1.1_
  - [ ]\* 19.6 编写路由集成测试，验证 API 端点的请求/响应格式
    - _Requirements: 7.4, 8.4, 12.4_

- [ ] 20. 实现 WebSocket 状态推送
  - [ ] 20.1 在 `server/core/socket.ts` 中添加 EdgeBrain 相关的 WebSocket 事件广播（节点状态变化、同步进度、资源告警），在各服务中触发事件
    - _Requirements: 16.5_
  - [ ]\* 20.2 编写属性测试：WebSocket 状态实时推送
    - **Property 32: WebSocket 状态实时推送**
    - **Validates: Requirements 16.5**

- [ ] 21. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 22. 实现前端 EdgeBrain 管理面板
  - [ ] 22.1 创建 `client/src/lib/edge-brain-store.ts`，实现 Zustand store，管理边缘节点列表、选中节点、资源数据、同步状态，监听 WebSocket 事件
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_
  - [ ] 22.2 创建 `client/src/lib/edge-brain-client.ts`，封装 EdgeBrain REST API 调用（节点 CRUD、同步操作、节点组管理、任务分配）
    - _Requirements: 1.1, 2.1, 3.1, 12.4_
  - [ ] 22.3 创建 `client/src/components/edge-brain/EdgeNodePanel.tsx`，实现节点列表面板，显示名称、位置、状态、容量，支持选择节点查看详情
    - _Requirements: 16.1, 16.2_
  - [ ] 22.4 创建 `client/src/components/edge-brain/SyncStatusPanel.tsx`，实现同步状态面板，显示最后同步时间、待同步数据量、同步进度
    - _Requirements: 16.3_
  - [ ] 22.5 创建 `client/src/components/edge-brain/ResourceChart.tsx`，实现资源使用图表（CPU、内存、磁盘使用率），使用简单的 SVG 或 div 进度条
    - _Requirements: 16.2_
  - [ ] 22.6 创建 `client/src/components/edge-brain/ExecutionStatsPanel.tsx`，实现执行统计面板，显示已执行任务数、成功率、平均执行时间
    - _Requirements: 16.4_
  - [ ] 22.7 创建 `client/src/pages/EdgeBrainPage.tsx`，组合以上组件为完整的 EdgeBrain 管理页面，在 `App.tsx` 中添加路由
    - _Requirements: 16.1_

- [ ] 23. 最终 Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号，确保可追溯性
- Checkpoint 任务确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界条件
- 使用 fast-check 作为属性测试库，每个属性测试至少 100 次迭代
