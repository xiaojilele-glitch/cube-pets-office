# 数据血缘追踪 — 实现任务

## 任务列表

- [ ] 1. 共享类型与契约定义
  - [ ] 1.1 创建 `shared/lineage/contracts.ts`，定义 DataLineageNode、LineageEdge、AuditLogEntry、ChangeAlert、DataQualityMetrics 等核心类型
  - [ ] 1.2 创建 `shared/lineage/api.ts`，定义 REST API 路由常量和请求/响应类型
  - [ ] 1.3 创建 `shared/lineage/index.ts`，统一导出模块

- [ ] 2. 血缘存储层
  - [ ] 2.1 创建 `server/lineage/lineage-store.ts`，实现 LineageStorageAdapter 接口和 JsonLineageStorage 默认实现（JSONL 文件 + 内存索引）
  - [ ] 2.2 实现内存索引：byId、byAgent、bySession、byDecision、byTimestamp 五个 Map 索引
  - [ ] 2.3 实现 `purgeExpired()` 数据保留策略（默认 90 天，环境变量 `LINEAGE_RETENTION_DAYS` 可配置）
  - [ ] 2.4 编写存储层单元测试 `server/tests/lineage-store.test.ts`
  - [ ] 2.5 编写属性测试：P1（写入后可查询）和 P7（过期清理正确性）

- [ ] 3. 血缘采集器
  - [ ] 3.1 创建 `server/lineage/lineage-collector.ts`，实现 LineageCollector 类（异步缓冲、批量写入）
  - [ ] 3.2 实现 `recordSource()` 方法（AC-1.1 ~ AC-1.5），包含 SHA256 哈希计算和调试日志
  - [ ] 3.3 实现 `recordTransformation()` 方法（AC-2.1 ~ AC-2.6），包含堆栈跟踪捕获和 dataChanged 检测
  - [ ] 3.4 实现 `recordDecision()` 方法（AC-3.1 ~ AC-3.5），包含决策上下文和置信度记录
  - [ ] 3.5 实现 `computeHash()` 静态方法和 `captureCodeLocation()` 静态方法
  - [ ] 3.6 编写采集器单元测试 `server/tests/lineage-collector.test.ts`
  - [ ] 3.7 编写属性测试：P5（哈希确定性）和 P6（采集失败降级保证）

- [ ] 4. 血缘查询引擎
  - [ ] 4.1 创建 `server/lineage/lineage-query.ts`，实现 LineageQueryService 类
  - [ ] 4.2 实现 `getUpstream()` BFS 上游追溯（AC-5.1）
  - [ ] 4.3 实现 `getDownstream()` BFS 下游影响（AC-5.2）
  - [ ] 4.4 实现 `getFullPath()` 双向 BFS 完整链路（AC-5.3）
  - [ ] 4.5 实现 `getImpactAnalysis()` 影响分析和风险等级计算（AC-5.4）
  - [ ] 4.6 编写查询引擎单元测试 `server/tests/lineage-query.test.ts`
  - [ ] 4.7 编写属性测试：P2（上游正确性）、P3（下游正确性）、P4（拓扑序）

- [ ] 5. 审计与合规服务
  - [ ] 5.1 创建 `server/lineage/lineage-audit.ts`，实现 LineageAuditService 类
  - [ ] 5.2 实现 `getAuditTrail()` 审计追踪查询（AC-6.1 ~ AC-6.2）
  - [ ] 5.3 实现 `exportLineageReport()` 决策血缘报告导出（AC-6.3）
  - [ ] 5.4 实现异常检测逻辑：哈希变更、异常访问、权限违规（AC-6.4）
  - [ ] 5.5 实现 PII 检测标记和合规标签（AC-6.5）
  - [ ] 5.6 编写审计服务单元测试 `server/tests/lineage-audit.test.ts`

- [ ] 6. 变更检测服务
  - [ ] 6.1 创建 `server/lineage/change-detection.ts`，实现 ChangeDetectionService 类
  - [ ] 6.2 实现 `detectChanges()` 哈希对比检测（AC-8.1）
  - [ ] 6.3 实现 `analyzeChangeImpact()` 变更影响分析 + 告警生成（AC-8.2 ~ AC-8.3）
  - [ ] 6.4 实现 `getStateAtTime()` 时间点回溯查询（AC-8.4）
  - [ ] 6.5 实现 `measureQuality()` 数据质量指标计算（AC-8.5）
  - [ ] 6.6 编写变更检测单元测试 `server/tests/lineage-change-detection.test.ts`

- [ ] 7. 导入导出服务
  - [ ] 7.1 创建 `server/lineage/lineage-export.ts`，实现 LineageExportService 类
  - [ ] 7.2 实现 `exportLineage()` JSON/CSV 格式导出（AC-10.1 ~ AC-10.2）
  - [ ] 7.3 实现 `importLineage()` 导入 + 去重 + 冲突解决（AC-10.3 ~ AC-10.4）
  - [ ] 7.4 实现 `exportIncremental()` 增量导出（AC-10.5）
  - [ ] 7.5 编写导入导出单元测试 `server/tests/lineage-export.test.ts`
  - [ ] 7.6 编写属性测试：P8（导出-导入往返一致性）

- [ ] 8. REST API 路由
  - [ ] 8.1 创建 `server/routes/lineage.ts`，注册所有 `/api/lineage/*` 路由
  - [ ] 8.2 实现查询路由：getUpstream、getDownstream、getFullPath、getImpactAnalysis、getNode、queryNodes
  - [ ] 8.3 实现审计路由：getAuditTrail、exportReport、detectAnomalies
  - [ ] 8.4 实现导入导出路由：exportLineage、importLineage
  - [ ] 8.5 实现变更检测路由：detectChanges、getQualityMetrics、getStats
  - [ ] 8.6 在 `server/index.ts` 中注册 lineage 路由
  - [ ] 8.7 编写路由集成测试 `server/tests/lineage-routes.test.ts`

- [ ] 9. Agent 框架集成
  - [ ] 9.1 在 `shared/runtime-agent.ts` 的 RuntimeAgent 类中添加 `lineageTracked()` 包装方法（AC-9.1 ~ AC-9.3）
  - [ ] 9.2 实现异步采集和失败降级逻辑（AC-9.4）
  - [ ] 9.3 在 `server/core/agent.ts` 的 Agent 类中注入 LineageCollector 依赖
  - [ ] 9.4 在 MissionStore 关键状态变更点注入血缘采集钩子
  - [ ] 9.5 在 submitMissionDecision 成功后注入决策血缘记录
  - [ ] 9.6 编写 Agent 集成测试 `server/tests/lineage-agent-integration.test.ts`

- [ ] 10. 模块入口与 Socket 事件
  - [ ] 10.1 创建 `server/lineage/index.ts`，组装所有服务并导出单例
  - [ ] 10.2 创建 `shared/lineage/socket.ts`，定义 Socket 事件常量
  - [ ] 10.3 在采集器中添加 Socket 事件广播（lineage:node_created、lineage:alert_triggered）
  - [ ] 10.4 实现数据保留定时清理（每小时执行 purgeExpired）

- [ ] 11. 前端 Store 和 API 客户端
  - [ ] 11.1 创建 `client/src/lib/lineage-store.ts`，实现 Zustand store（fetchUpstream、fetchDownstream、fetchFullPath 等）
  - [ ] 11.2 实现 Socket 监听（lineage:node_created 实时更新图数据）
  - [ ] 11.3 实现过滤器状态管理（按 Agent、时间范围、数据源类型过滤）

- [ ] 12. 前端可视化组件
  - [ ] 12.1 创建 `client/src/components/lineage/LineageDAGView.tsx`，实现 Canvas 2D DAG 图（AC-7.1 ~ AC-7.2）
  - [ ] 12.2 创建 `client/src/components/lineage/LineageTimeline.tsx`，实现时间轴视图（AC-7.3）
  - [ ] 12.3 创建 `client/src/components/lineage/LineageHeatmap.tsx`，实现热力图（AC-7.4）
  - [ ] 12.4 创建 `client/src/components/lineage/LineageNodeDetail.tsx`，实现节点详情面板
  - [ ] 12.5 创建 `client/src/components/lineage/LineageExportButton.tsx`，实现 PNG/SVG 导出（AC-7.5）
  - [ ] 12.6 创建 `client/src/pages/lineage/LineagePage.tsx`，组装血缘追踪页面

- [ ] 13. 路由注册与导航
  - [ ] 13.1 在 `client/src/App.tsx` 中添加 `/lineage` 路由
  - [ ] 13.2 在 Toolbar 中添加血缘追踪入口按钮
  - [ ] 13.3 添加 i18n 文案（中英文）到 `client/src/i18n/messages.ts`
