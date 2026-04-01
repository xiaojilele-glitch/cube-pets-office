# Implementation Plan: 成本可观测性系统（Cost Observability）

## Overview

基于已有的 LLM 统一调用层（`llm-client.ts`），在调用链路中插入成本埋点，构建 `CostTracker` 核心模块实现成本聚合、预警和降级，通过 REST API + Socket.IO 推送到前端 `CostDashboard` 看板组件。实现顺序：共享类型 → 核心追踪器 → LLM 埋点 → REST API → Socket 推送 → 前端 Store → 看板 UI → 3D 浮窗 → /tasks 侧边栏 → 纯前端模式。

## Tasks

- [x] 1. 共享类型定义与定价表
  - [x] 1.1 创建 `shared/cost.ts`，定义所有成本相关 TypeScript 接口（CostRecord、CostSnapshot、Budget、DowngradePolicy、CostAlert、AgentCostSummary、MissionCostSummary、ModelPricing）和常量（PRICING_TABLE、DEFAULT_PRICING、DEFAULT_BUDGET、DEFAULT_DOWNGRADE_POLICY）
    - 实现 `estimateCost(model, tokensIn, tokensOut)` 纯函数
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 13.1_
  - [ ]* 1.2 编写 estimateCost 属性测试
    - **Property 2: estimateCost 纯函数正确性**
    - **Validates: Requirements 2.3, 2.4**
  - [ ]* 1.3 编写成本类型 JSON 往返属性测试
    - **Property 12: 成本类型 JSON 往返一致性**
    - **Validates: Requirements 13.3**

- [x] 2. 服务端成本追踪器核心
  - [x] 2.1 创建 `server/core/cost-tracker.ts`，实现 CostTracker 类
    - 实现 `recordCall(record)` 同步内存写入
    - 实现 `getSnapshot()` 实时快照计算
    - 实现 `getAgentCosts()` 按 Agent 聚合
    - 实现 `getSessionCosts()` 按 Session 聚合
    - 实现 `finalizeMission()` Mission 归档
    - 实现 `resetCurrentMission()` 重置当前 Mission
    - 实现 `getHistory()` 历史列表
    - 导出 `costTracker` 单例
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ]* 2.2 编写 CostRecord 完整性属性测试
    - **Property 1: CostRecord 完整性**
    - **Validates: Requirements 1.1, 1.2, 1.3**
  - [ ]* 2.3 编写聚合指标不变量属性测试
    - **Property 3: 聚合指标不变量**
    - **Validates: Requirements 3.1, 3.2, 3.3**
  - [ ]* 2.4 编写历史缓冲区有界性属性测试
    - **Property 4: 历史缓冲区有界性**
    - **Validates: Requirements 3.4, 3.5**

- [x] 3. 预算与预警系统
  - [x] 3.1 在 CostTracker 中实现预算管理和预警逻辑
    - 实现 `getBudget()` / `setBudget(budget)` 预算配置
    - 实现 `checkAlerts()` 预警检查（费用预警、Token 预警、费用超限、Token 超限）
    - 实现预算百分比计算（budgetUsedPercent、tokenUsedPercent）
    - 每次 `recordCall` 后自动调用 `checkAlerts()`
    - `setBudget` 后立即重新评估预警状态
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ]* 3.2 编写阈值预警生成属性测试
    - **Property 5: 阈值预警生成**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
  - [ ]* 3.3 编写预算百分比正确性属性测试
    - **Property 6: 预算百分比正确性**
    - **Validates: Requirements 4.6**
  - [ ]* 3.4 编写预算更新触发预警重评估属性测试
    - **Property 8: 预算更新触发预警重评估**
    - **Validates: Requirements 6.4**

- [x] 4. 自动降级策略
  - [x] 4.1 在 CostTracker 中实现降级逻辑
    - 实现 `getEffectiveModel(originalModel)` 根据降级状态返回实际模型
    - 实现 `isAgentPaused(agentId)` 检查 Agent 暂停状态
    - 实现 `applyDowngrade()` 在预警检查后自动触发降级
    - 实现 `manualReleaseDegradation()` 手动解除降级
    - 实现降级状态机（none → soft → hard → none）
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 4.2 编写降级模型切换与恢复属性测试
    - **Property 7: 降级模型切换与恢复**
    - **Validates: Requirements 5.2, 5.3, 5.4**

- [x] 5. Checkpoint - 核心逻辑验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. 历史持久化
  - [x] 6.1 在 CostTracker 中实现 JSON 文件持久化
    - 实现 `persistHistory()` 写入 `data/cost-history.json`（包含 budget、downgradePolicy、missions）
    - 实现 `loadHistory()` 启动时加载历史数据
    - 文件损坏或不存在时以空历史启动并记录 console.warn
    - _Requirements: 11.1, 11.2, 11.3_
  - [ ]* 6.2 编写历史持久化往返一致性属性测试
    - **Property 10: 历史持久化往返一致性**
    - **Validates: Requirements 11.1, 11.2**

- [x] 7. LLM 调用埋点与降级集成
  - [x] 7.1 修改 `server/core/llm-client.ts`，在 callLLM 中集成成本追踪
    - 在调用前检查 Agent 暂停状态（通过 options 传入 agentId）
    - 应用降级模型（通过 costTracker.getEffectiveModel）
    - 调用完成后记录 CostRecord（成功和失败都记录）
    - 扩展 LLMOptions 接口添加 agentId、missionId、sessionId 可选字段
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.2, 5.3_

- [x] 8. 成本 REST API
  - [x] 8.1 创建 `server/routes/cost.ts`，实现成本路由
    - GET /api/cost/live → 返回 CostSnapshot
    - GET /api/cost/history → 返回 MissionCostSummary[]
    - GET /api/cost/budget → 返回 Budget
    - PUT /api/cost/budget → 更新 Budget 并重评估预警
    - POST /api/cost/downgrade/release → 手动解除降级
    - 无活跃 Mission 时返回零值快照
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 8.2 在 `server/index.ts` 中注册成本路由
    - _Requirements: 6.1_
  - [ ]* 8.3 编写成本 REST API 单元测试
    - 测试各端点响应格式、零值快照、预算更新
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 9. Socket.IO 实时推送
  - [x] 9.1 扩展 `server/core/socket.ts`，添加成本广播函数
    - 实现 `emitCostUpdate(snapshot)` 带 500ms 节流
    - 实现 `emitCostAlert(alert)` 立即广播
    - 新客户端连接时发送当前快照
    - 在 CostTracker.recordCall 中触发广播
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [ ]* 9.2 编写 Socket 广播节流上界属性测试
    - **Property 9: Socket 广播节流上界**
    - **Validates: Requirements 7.2**

- [x] 10. Checkpoint - 服务端完整验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. 前端成本 Store
  - [x] 11.1 创建 `client/src/lib/cost-store.ts`，实现 Zustand store
    - 管理 CostSnapshot、MissionCostSummary[] 历史、dashboardOpen 状态
    - 实现 initSocket 监听 cost.update 和 cost.alert 事件
    - 实现 fetchInitial 从 REST API 加载初始数据
    - 实现 updateBudget 调用 PUT /api/cost/budget
    - 实现 releaseDegradation 调用 POST /api/cost/downgrade/release
    - _Requirements: 8.3, 13.2_

- [x] 12. 成本看板组件
  - [x] 12.1 创建 `client/src/components/CostDashboard.tsx`
    - Token 消耗卡片（input/output 分开，Progress 进度条）
    - 实时费用卡片（带预算进度条）
    - 剩余预算百分比卡片
    - Agent 费用占比饼图（Recharts PieChart）
    - 历史成本趋势折线图（Recharts LineChart，最近 10 次 Mission）
    - 预警横幅区域
    - 预算设置表单（max_cost、max_tokens、warning_threshold）
    - 降级操作按钮组（切换低成本模型、暂停非关键 Agent、解除降级）
    - 展开/收起两种模式
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6_

- [x] 13. 3D 场景成本浮窗
  - [x] 13.1 修改 `client/src/components/Scene3D.tsx`，添加成本浮窗
    - 右上角显示当前费用和剩余预算百分比
    - 预警时边框变红 + 预警图标
    - 降级时显示降级状态标识
    - 点击展开/收起 CostDashboard
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 14. /tasks 页面成本侧边栏
  - [x] 14.1 修改 `client/src/components/tasks/TaskDetailView.tsx`，添加成本标签页
    - Mission 成本明细展示
    - Token 消耗时间线（Recharts AreaChart）
    - 费用累计曲线（Recharts LineChart）
    - 实时更新（通过 Socket 事件）
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 15. 纯前端模式支持
  - [x] 15.1 创建 `client/src/lib/browser-cost-store.ts`
    - 在 browser-llm.ts 调用前后采集成本数据
    - 存入 IndexedDB 的 cost object store
    - 页面加载时从 IndexedDB 恢复
    - 与 cost-store.ts 集成，纯前端模式下使用 IndexedDB 数据源
    - _Requirements: 12.1, 12.2, 12.3_
  - [ ]* 15.2 编写 IndexedDB 往返一致性属性测试
    - **Property 11: IndexedDB 往返一致性**
    - **Validates: Requirements 12.2, 12.3**

- [x] 16. Final checkpoint - 全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- 本模块与 telemetry-dashboard 共享部分数据源（LLM 调用记录），但各自独立聚合，避免耦合
