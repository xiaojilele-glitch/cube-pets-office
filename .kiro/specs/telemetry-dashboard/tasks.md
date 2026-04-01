# 实现计划：实时遥测仪表盘（Telemetry Dashboard）

## 概述

按照自底向上的顺序实现：先定义共享类型，再实现服务端存储和埋点，然后实现 REST API 和 Socket 推送，最后实现前端仪表盘和 3D 集成。每个阶段都包含对应的测试任务。

## 任务

- [x] 1. 定义共享遥测类型
  - [x] 1.1 创建 `shared/telemetry.ts`，定义 LLMCallRecord、AgentTimingRecord、TelemetryAlert、TelemetrySnapshot、AgentTimingSummary、MissionStageTiming、MissionTelemetrySummary、TelemetryBudget 接口
    - 所有接口字段参照设计文档"组件与接口"第 1 节
    - 导出费用预估函数 `estimateCost(model, tokensIn, tokensOut)`
    - 导出默认预算常量 `DEFAULT_BUDGET: TelemetryBudget`
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 1.2 编写 Property 11 属性测试：遥测类型 JSON 往返一致性
    - **Property 11: 遥测类型 JSON 往返一致性**
    - 使用 fast-check 生成随机 TelemetrySnapshot，验证 `JSON.parse(JSON.stringify(snapshot))` 深度相等
    - **Validates: Requirements 10.3**

- [x] 2. 实现服务端遥测存储
  - [x] 2.1 创建 `server/core/telemetry-store.ts`，实现 TelemetryStore 类
    - 实现 `recordLLMCall(record)` — 同步写入内存数组，更新聚合指标
    - 实现 `recordAgentTiming(record)` — 写入 agentId 对应的滑动窗口（最近 20 条）
    - 实现 `getSnapshot()` — 计算并返回 TelemetrySnapshot
    - 实现 `getHistory()` — 返回历史 Mission 摘要列表
    - 实现 `finalizeMission(missionId, title)` — 归档当前 Mission 指标到历史，重置当前状态
    - 实现 `resetCurrentMission()` — 清空当前 Mission 数据
    - 实现预警检查逻辑 `checkAlerts()` — 每次记录后检查 Agent 慢响应和 Token 超预算
    - 实现 `persistHistory()` / `loadHistory()` — JSON 文件持久化到 `data/telemetry-history.json`
    - 导出单例 `telemetryStore`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 8.1, 8.2_

  - [ ]* 2.2 编写 Property 4 属性测试：聚合指标不变量
    - **Property 4: 聚合指标不变量**
    - 使用 fast-check 生成随机 LLMCallRecord 序列，验证 snapshot 中的 totalTokensIn/Out/Cost/Calls 等于各记录之和
    - **Validates: Requirements 3.1**

  - [ ]* 2.3 编写 Property 3 属性测试：滑动窗口平均值正确性
    - **Property 3: 滑动窗口平均值正确性**
    - 生成随机长度的 AgentTimingRecord 序列，验证平均值等于最近 min(N, 20) 条的算术平均
    - **Validates: Requirements 2.2**

  - [ ]* 2.4 编写 Property 5 属性测试：历史缓冲区有界性
    - **Property 5: 历史缓冲区有界性**
    - 生成随机次数的 finalizeMission 调用，验证 history 长度为 min(N, 10)
    - **Validates: Requirements 3.2**

  - [ ]* 2.5 编写 Property 6 属性测试：历史持久化往返一致性
    - **Property 6: 历史持久化往返一致性**
    - 生成随机 MissionTelemetrySummary 列表，验证 persistHistory → loadHistory 往返一致
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 2.6 编写 Property 8 和 Property 9 属性测试：预警生成
    - **Property 8: Agent 响应过慢预警生成**
    - 生成随机计时序列，当滑动窗口平均 > 30000ms 时验证 alert 存在
    - **Property 9: Token 超预算预警生成**
    - 生成随机调用序列，当累计 Token 超过 budget × threshold 时验证 alert 存在
    - **Validates: Requirements 8.1, 8.2**

- [x] 3. 检查点 — 确保存储层测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 4. 实现 LLM 调用和 Agent 埋点
  - [x] 4.1 修改 `server/core/llm-client.ts`，在 `callProvider` 函数中添加遥测埋点
    - 调用前记录 startTime，调用后构造 LLMCallRecord 并写入 telemetryStore
    - 失败时同样记录，包含 error 字段
    - 从 response.usage 提取 token 数据，使用 estimateCost 计算费用
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 4.2 修改 `server/core/agent.ts`，在 `sharedAgentDependencies.llmProvider` 中添加 Agent 计时埋点
    - 在 call 和 callJson 包装中记录调用耗时
    - 需要通过某种方式传递当前 agentId（可在 Agent 构造时绑定）
    - _Requirements: 2.1_

  - [ ]* 4.3 编写 Property 1 和 Property 2 属性测试：调用记录完整性
    - **Property 1: LLM 调用记录完整性**
    - **Property 2: Agent 计时记录完整性**
    - 验证 recordLLMCall 和 recordAgentTiming 产生的记录包含所有必填字段
    - **Validates: Requirements 1.1, 1.3, 2.1**

- [x] 5. 实现遥测 REST API 和 Socket 推送
  - [x] 5.1 创建 `server/routes/telemetry.ts`，实现 GET /api/telemetry/live 和 GET /api/telemetry/history 路由
    - live 返回 telemetryStore.getSnapshot()
    - history 返回 telemetryStore.getHistory()
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 5.2 在 `server/index.ts` 中注册遥测路由
    - _Requirements: 4.1, 4.2_

  - [x] 5.3 修改 `server/core/socket.ts`，新增 `emitTelemetryUpdate` 函数
    - 实现 500ms 节流逻辑
    - 在 connection 事件中向新客户端发送当前快照
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.4 在 TelemetryStore 的 recordLLMCall 和 recordAgentTiming 中调用 emitTelemetryUpdate
    - _Requirements: 5.1_

  - [ ]* 5.5 编写 Property 7 属性测试：Socket 广播节流上界
    - **Property 7: Socket 广播节流上界**
    - 模拟快速连续更新，验证广播次数不超过 ceil(T / 500) + 1
    - **Validates: Requirements 5.2**

- [x] 6. 检查点 — 确保后端全部测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 7. 实现前端遥测 Store 和仪表盘组件
  - [x] 7.1 创建 `client/src/lib/telemetry-store.ts`，实现 Zustand store
    - 状态：snapshot、history、dashboardOpen
    - 方法：toggleDashboard、initSocket（监听 telemetry.update）、fetchInitial（REST 加载）
    - 服务端模式下通过 Socket.IO 实时更新，纯前端模式下从 IndexedDB 加载
    - _Requirements: 6.3, 6.4, 9.1_

  - [x] 7.2 创建 `client/src/components/TelemetryDashboard.tsx`
    - 使用 shadcn/ui Card + Recharts 实现四个指标卡片
    - Token 消耗/费用卡片（shadcn Progress 组件）
    - Top 3 瓶颈 Agent 列表
    - Mission 阶段耗时柱状图（Recharts BarChart）
    - 活跃 Agent 计数
    - 历史趋势折线图（Recharts LineChart，最近 5 次 Mission）
    - 预警信息高亮区域
    - 侧滑展开/收起动画（framer-motion）
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 8.3_

  - [x] 7.3 修改 `client/src/components/Scene3D.tsx`，在 Canvas 外层添加仪表盘浮窗图标
    - 右上角像素风格图标按钮
    - 点击切换 dashboardOpen
    - 存在预警时显示红色圆点徽标
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 7.4 修改 `client/src/pages/Home.tsx`，集成 TelemetryDashboard 组件
    - 在 isSceneReady 条件块中渲染 TelemetryDashboard
    - 初始化 Socket 监听和 REST 数据加载
    - _Requirements: 6.1_

- [x] 8. 实现纯前端模式遥测支持
  - [x] 8.1 创建 `client/src/lib/browser-telemetry-store.ts`
    - 在 IndexedDB 中新增 telemetry object store
    - 实现 saveTelemetrySnapshot / loadTelemetrySnapshot 函数
    - _Requirements: 9.2, 9.3_

  - [x] 8.2 修改 `client/src/lib/browser-llm.ts`，在 callBrowserLLM 中添加遥测埋点
    - 调用前后记录时间，构造 LLMCallRecord 写入前端 telemetry store
    - _Requirements: 9.1_

  - [ ]* 8.3 编写 Property 10 属性测试：IndexedDB 往返一致性
    - **Property 10: IndexedDB 往返一致性**
    - 生成随机 TelemetrySnapshot，验证 IndexedDB 写入后读取等价
    - **Validates: Requirements 9.2, 9.3**

- [x] 9. 实现 3D 场景 Agent 预警图标
  - [x] 9.1 修改 `client/src/components/three/PetWorkers.tsx`（或相关 3D 组件），在存在 agent_slow 预警时在对应 Agent 头顶显示警告图标
    - 从 telemetry store 读取 alerts，匹配 agentId
    - 使用 drei 的 Html 组件在 3D 空间中渲染 2D 警告图标
    - _Requirements: 8.4_

- [x] 10. 最终检查点 — 确保所有测试通过
  - 运行 `npm run check` 确保 TypeScript 类型检查通过
  - 运行所有新增测试确保通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号以保证可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 需要安装 fast-check 依赖：`pnpm add -D fast-check`
