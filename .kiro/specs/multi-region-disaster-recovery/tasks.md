# Implementation Plan: 多区域灾难恢复系统

## Overview

基于设计文档，将多区域灾难恢复系统分解为增量式编码任务。从共享类型定义开始，逐步实现各核心组件，最后集成前端和路由层。使用 vitest + fast-check 进行测试。

## Tasks

- [ ] 1. 定义共享类型和契约
  - [ ] 1.1 创建 `shared/region/contracts.ts`，定义 RegionConfig、RegionCapacity、ReplicationConfig、MultiRegionConfig、RegionQuota 等核心类型和枚举（RegionTier、RegionStatus、ReplicationMode、ConflictResolutionStrategy、SchedulingStrategy、LoadBalancerAlgorithm）
    - _Requirements: 1.1, 1.2, 3.1, 3.2, 4.3, 6.2_
  - [ ] 1.2 创建 `shared/region/replication.ts`，定义 BinlogEntry、ConflictRecord、ReplicationStatus、VersionedRecord 类型
    - _Requirements: 2.4, 3.2, 3.4_
  - [ ] 1.3 创建 `shared/region/scheduling.ts`，定义 SchedulingConfig、SchedulingConstraint、FailoverPolicy、SchedulingDecision 类型
    - _Requirements: 4.1, 4.2, 4.3, 4.5_
  - [ ] 1.4 创建 `shared/region/load-balancer.ts`，定义 LoadBalancerConfig、HealthCheckConfig、RoutingDecision 类型
    - _Requirements: 6.1, 6.2, 6.4_
  - [ ] 1.5 创建 `shared/region/monitoring.ts`，定义 RegionMetrics、AlertRule、Alert、ConsistencyCheckResult、CostReport 类型
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 16.3_
  - [ ] 1.6 创建 `shared/region/socket-events.ts`，定义 REGION_SOCKET_EVENTS 常量
    - _Requirements: 17.5_
  - [ ] 1.7 创建 `shared/region/index.ts`，统一导出所有类型
    - _Requirements: 全部_

- [ ] 2. 实现 Region Manager（区域管理器）
  - [ ] 2.1 创建 `server/region/region-manager.ts`，实现 IRegionManager 接口：initializeMultiRegion()、getRegions()、getRegion()、updateRegionStatus()、getPrimaryRegion()、getGlobalConfig()、getQuota()、updateQuota()、checkQuota()
    - 区域配置持久化到 `data/region-config.json`
    - 配额数据存储在内存 Map 中，支持动态更新
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.1, 9.4, 12.1, 12.2, 12.3, 12.4, 12.5_
  - [ ]\* 2.2 编写 Property 1 属性测试：初始化正确性
    - **Property 1: 初始化正确性**
    - 使用 fast-check 生成随机区域配置列表，验证初始化后恰好有一个 primary 区域，所有区域都有存储实例
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
  - [ ]\* 2.3 编写 Property 16 属性测试：配额强制执行
    - **Property 16: 配额强制执行**
    - 生成随机配额配置和资源使用量，验证超过配额时 checkQuota() 返回 false
    - **Validates: Requirements 9.4, 12.3**
  - [ ]\* 2.4 编写 Property 19 属性测试：配额动态更新
    - **Property 19: 配额动态更新**
    - 更新配额后立即验证 checkQuota() 使用新值
    - **Validates: Requirements 12.5**

- [ ] 3. 实现 Replication Engine（复制策略引擎）
  - [ ] 3.1 创建 `server/region/replication-engine.ts`，实现 IReplicationEngine 接口：recordChange()、replicateTo()、getIncrementalChanges()、resolveConflict()、manualResolveConflict()、getReplicationStatus()、getConflictLog()
    - Binlog 存储为 JSONL 文件
    - 支持 primary-secondary 和 multi-master 复制模式
    - 冲突解决支持 primary-wins、timestamp、custom 策略
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 8.1, 8.5_
  - [ ]\* 3.2 编写 Property 2 属性测试：Binlog 记录完整性
    - **Property 2: Binlog 记录完整性（Round-Trip）**
    - 生成随机写操作，验证 recordChange() 生成的 BinlogEntry 可通过 getIncrementalChanges() 检索
    - **Validates: Requirements 2.4**
  - [ ]\* 3.3 编写 Property 3 属性测试：增量复制正确性
    - **Property 3: 增量复制正确性**
    - 生成随机时间戳和操作序列，验证 getIncrementalChanges() 仅返回指定时间戳之后的记录
    - **Validates: Requirements 2.3**
  - [ ]\* 3.4 编写 Property 5 属性测试：版本元数据不变量
    - **Property 5: 版本元数据不变量**
    - 生成随机数据记录，验证 recordChange() 后记录包含有效的 \_version、\_timestamp、\_regionId、\_checksum
    - **Validates: Requirements 3.2**
  - [ ]\* 3.5 编写 Property 6 属性测试：冲突解决正确性
    - **Property 6: 冲突解决正确性**
    - 生成随机并发修改对，验证 primary-wins 保留主区域版本，timestamp 保留较新版本
    - **Validates: Requirements 3.3, 3.4**

- [ ] 4. Checkpoint - 确保核心数据层测试通过
  - 确保所有测试通过，如有问题请咨询用户。

- [ ] 5. 实现 Region Scheduler（区域感知调度器）
  - [ ] 5.1 创建 `server/region/region-scheduler.ts`，实现 IRegionScheduler 接口：selectRegion()、calculateLatencies()、getRegionScores()、failover()
    - 实现 Haversine 公式计算地理距离
    - 支持 nearest、lowest-latency、load-balanced、affinity 四种策略
    - 支持成本感知调度
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 16.1, 16.2_
  - [ ]\* 5.2 编写 Property 7 属性测试：调度器区域偏好
    - **Property 7: 调度器区域偏好**
    - 生成随机偏好列表和区域状态，验证 selectRegion() 返回偏好列表中的健康区域
    - **Validates: Requirements 4.1**
  - [ ]\* 5.3 编写 Property 8 属性测试：最近区域选择
    - **Property 8: 最近区域选择**
    - 生成随机用户位置和区域坐标，验证 nearest 策略选择地理距离最近的区域
    - **Validates: Requirements 4.2, 15.2**
  - [ ]\* 5.4 编写 Property 9 属性测试：不可用区域排除
    - **Property 9: 不可用区域排除**
    - 生成随机区域集合（部分不可用），验证调度器永远不选择不可用区域
    - **Validates: Requirements 4.4, 7.2**
  - [ ]\* 5.5 编写 Property 23 属性测试：成本感知调度
    - **Property 23: 成本感知调度**
    - 生成随机区域成本和延迟约束，验证选择满足延迟约束的最低成本区域
    - **Validates: Requirements 16.1, 16.2**

- [ ] 6. 实现 Global Load Balancer（全局负载均衡器）
  - [ ] 6.1 创建 `server/region/global-load-balancer.ts`，实现 IGlobalLoadBalancer 接口：route()、updateWeights()、markUnavailable()、markAvailable()、getLoadDistribution()
    - 实现 round-robin、least-connections、weighted 三种算法
    - 支持会话亲和性
    - 支持手动区域选择
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 15.1, 15.2, 15.3, 15.4, 15.5_
  - [ ]\* 6.2 编写 Property 10 属性测试：负载均衡算法正确性
    - **Property 10: 负载均衡算法正确性**
    - 生成随机请求序列，验证 round-robin 均匀分配，weighted 按权重比例分配
    - **Validates: Requirements 6.2**
  - [ ]\* 6.3 编写 Property 11 属性测试：会话亲和性
    - **Property 11: 会话亲和性**
    - 生成随机 sessionId 和请求序列，验证相同 sessionId 路由到同一区域
    - **Validates: Requirements 6.4, 15.4**
  - [ ]\* 6.4 编写 Property 22 属性测试：手动区域选择
    - **Property 22: 手动区域选择**
    - 生成随机目标区域，验证手动选择时路由到指定区域
    - **Validates: Requirements 15.3**

- [ ] 7. Checkpoint - 确保调度和负载均衡测试通过
  - 确保所有测试通过，如有问题请咨询用户。

- [ ] 8. 实现 Region Health Monitor（区域健康监控器）
  - [ ] 8.1 创建 `server/region/region-health-monitor.ts`，实现 IRegionHealthMonitor 接口：start()、stop()、getMetrics()、getAllMetrics()、addAlertRule()、getActiveAlerts()、runConsistencyCheck()、getCostReport()
    - 健康检查定时器
    - 告警规则引擎
    - 一致性检查逻辑
    - 成本报告生成
    - _Requirements: 7.1, 8.2, 8.3, 8.4, 13.1, 13.2, 13.3, 13.4, 13.5, 16.3, 16.4, 16.5_
  - [ ]\* 8.2 编写 Property 20 属性测试：告警阈值触发
    - **Property 20: 告警阈值触发**
    - 生成随机指标值和告警阈值，验证超过阈值时生成包含完整字段的 Alert
    - **Validates: Requirements 2.5, 10.5, 13.3, 13.4, 16.5**
  - [ ]\* 8.3 编写 Property 13 属性测试：一致性检查自动修复
    - **Property 13: 一致性检查自动修复**
    - 生成随机不一致数据，验证 runConsistencyCheck() 修复后数据一致
    - **Validates: Requirements 8.3**

- [ ] 9. 实现 Migration Tool（迁移工具）
  - [ ] 9.1 创建 `server/region/migration-tool.ts`，实现 IMigrationTool 接口：migrate()、verify()、rollback()、drillRecovery()
    - 数据迁移逻辑
    - 一致性验证
    - 回滚支持
    - 灾难恢复演练
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 18.1, 18.2, 18.3, 18.4, 18.5_
  - [ ]\* 9.2 编写 Property 25 属性测试：迁移数据一致性
    - **Property 25: 迁移数据一致性（Round-Trip）**
    - 生成随机源数据集，执行迁移后验证目标区域数据与源一致
    - **Validates: Requirements 18.3**
  - [ ]\* 9.3 编写 Property 26 属性测试：迁移回滚
    - **Property 26: 迁移回滚**
    - 模拟迁移失败，验证 rollback() 恢复到迁移前状态
    - **Validates: Requirements 18.5**
  - [ ]\* 9.4 编写 Property 21 属性测试：备份点选择
    - **Property 21: 备份点选择**
    - 生成随机备份列表，验证恢复时选择最新备份
    - **Validates: Requirements 14.4**

- [ ] 10. Checkpoint - 确保所有后端组件测试通过
  - 确保所有测试通过，如有问题请咨询用户。

- [ ] 11. 实现 REST API 路由
  - [ ] 11.1 创建 `server/routes/region.ts`，实现所有区域管理 REST API 路由
    - GET /api/regions, GET /api/regions/:id
    - POST /api/regions/initialize
    - GET /api/regions/:id/metrics, GET /api/regions/metrics
    - GET /api/regions/alerts, POST /api/regions/alerts/rules
    - GET /api/regions/replication/status, GET /api/regions/replication/conflicts
    - POST /api/regions/replication/conflicts/:id/resolve
    - GET /api/regions/consistency
    - GET /api/regions/:id/quota, PUT /api/regions/:id/quota
    - GET /api/regions/cost-report
    - POST /api/regions/migrate, POST /api/regions/migrate/rollback, POST /api/regions/migrate/drill
    - GET /api/regions/load-distribution
    - _Requirements: 1.1, 3.5, 12.4, 13.5, 14.3_
  - [ ] 11.2 在 `server/index.ts` 中注册区域路由和 Socket.IO 事件广播
    - 注册 /api/regions/\* 路由
    - 广播 REGION_SOCKET_EVENTS 事件
    - _Requirements: 17.5_
  - [ ]\* 11.3 编写 Property 24 属性测试：状态变化事件推送
    - **Property 24: 状态变化事件推送**
    - 模拟区域状态变化，验证 WebSocket 事件被发射
    - **Validates: Requirements 17.5**

- [ ] 12. 实现前端 Region Store 和 Dashboard
  - [ ] 12.1 创建 `client/src/lib/region-store.ts`，实现 Zustand store 管理区域状态
    - regions、metrics、alerts、replicationStatus、loadDistribution、costReport 状态
    - Socket.IO 监听器自动更新
    - REST API 调用方法
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_
  - [ ] 12.2 创建 `client/src/components/region/RegionDashboard.tsx`，实现全局区域仪表板
    - 区域状态卡片（颜色编码）
    - 负载指标展示
    - 复制延迟展示
    - 告警列表
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [ ] 12.3 创建 `client/src/components/region/RegionMap.tsx`，实现区域地图视图
    - 基于区域坐标的简化地图
    - 区域间连线显示复制状态
    - _Requirements: 17.1_
  - [ ] 12.4 创建 `client/src/components/region/RegionMetricsCard.tsx`，实现单区域指标卡片
    - CPU、内存、QPS 指标
    - 健康状态指示
    - _Requirements: 17.2_

- [ ] 13. 集成和端到端连接
  - [ ] 13.1 将 RegionManager、ReplicationEngine、RegionScheduler、GlobalLoadBalancer、RegionHealthMonitor 在 `server/index.ts` 中初始化并注入到路由
    - _Requirements: 1.5, 7.1_
  - [ ] 13.2 集成 WorkflowEngine 的区域感知调度：在工作流启动时调用 RegionScheduler 选择执行区域
    - _Requirements: 4.1, 4.2, 5.1_
  - [ ] 13.3 集成 ReplicationEngine 到现有数据写入路径：在 MissionStore 和数据库写操作后触发 binlog 记录
    - _Requirements: 2.1, 2.4_
  - [ ]\* 13.4 编写 Property 4 属性测试：复制完整性
    - **Property 4: 复制完整性**
    - 生成随机数据写入，验证 replicateTo() 后目标区域数据与源一致
    - **Validates: Requirements 2.1, 2.2**
  - [ ]\* 13.5 编写 Property 12 属性测试：数据最终收敛
    - **Property 12: 数据最终收敛**
    - 生成随机多区域写操作序列，验证复制后所有区域数据收敛
    - **Validates: Requirements 7.5, 8.1**
  - [ ]\* 13.6 编写 Property 27 属性测试：操作日志完整性
    - **Property 27: 操作日志完整性**
    - 执行随机操作序列，验证每个操作都有对应的日志条目
    - **Validates: Requirements 4.5, 6.5, 7.4, 8.4, 14.5, 15.5**

- [ ] 14. Final Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请咨询用户。

## Notes

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP
- 每个任务引用具体的需求编号以确保可追溯性
- Checkpoint 任务确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界条件
- 所有新文件遵循项目现有的 TypeScript 严格模式和代码风格
