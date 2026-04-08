# 实现计划：跨 Pod 自主协作机制 (Autonomous Swarm)

## 概述

按照从共享类型 → 消息总线扩展 → 协作引擎 → 工作流集成 → 3D 可视化的顺序，逐步实现跨 Pod 自主协作功能。每个步骤在前一步基础上构建，确保无孤立代码。

## 任务

- [x] 1. 定义协作协议类型与扩展消息总线规则
  - [x] 1.1 创建 `shared/swarm.ts`，定义 `CollaborationRequest`、`CollaborationResponse`、`CollaborationResult`、`SubTaskOutput`、`CollaborationSession`、`PodCapability`、`SwarmConfig` 类型和默认配置
    - 所有类型使用纯数据结构（number 时间戳，string ID），确保 JSON 序列化安全
    - 导出 `DEFAULT_SWARM_CONFIG` 常量
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 1.2 扩展 `shared/message-bus-rules.ts`，新增 `validateCrossPod(from, to): boolean` 函数
    - 验证 `from.role === "manager"` 且 `to.role === "manager"` 且 `from.department !== to.department`
    - _Requirements: 1.1, 1.2_
  - [x] 1.3 编写属性测试：CollaborationSession 序列化往返一致性
    - **Property 4: CollaborationSession 序列化往返一致性**
    - 使用 fast-check 生成随机 CollaborationSession 对象，验证 JSON.parse(JSON.stringify(session)) 深度相等
    - **Validates: Requirements 2.5**
  - [x] 1.4 编写属性测试：跨 Pod 消息验证规则
    - **Property 2: 非 Manager 跨 Pod 消息拒绝**
    - 使用 fast-check 生成随机非 Manager Agent 对，验证 validateCrossPod 返回 false
    - **Validates: Requirements 1.2**

- [x] 2. 扩展 MessageBus 支持跨 Pod 通信
  - [x] 2.1 在 `server/core/message-bus.ts` 的 `MessageBus` 类中新增 `sendCrossPod()` 方法
    - 调用 `validateCrossPod()` 验证权限
    - 构建 `CrossPodMessageMetadata`（crossPod: true, sourcePodId, targetPodId, contentPreview）
    - contentPreview 截取前 summaryMaxLength 字符
    - 发射 `cross_pod_message` Socket.IO 事件
    - _Requirements: 1.1, 1.3, 1.4, 1.5_
  - [x] 2.2 在 `MessageBus` 类中新增 `getCrossPodMessageContent()` 方法
    - 根据消息 ID 返回完整消息内容
    - _Requirements: 1.5_
  - [x] 2.3 编写属性测试：跨 Pod 消息投递与元数据正确性
    - **Property 1: 跨 Pod 消息投递与元数据正确性**
    - 使用 fast-check 生成随机 Manager 对，验证 sendCrossPod 返回正确元数据和 Socket.IO 事件
    - **Validates: Requirements 1.1, 1.3, 1.4**
  - [x] 2.4 编写属性测试：跨 Pod 消息摘要截断
    - **Property 3: 跨 Pod 消息摘要截断**
    - 使用 fast-check 生成随机长度字符串，验证 contentPreview 长度不超过 summaryMaxLength
    - **Validates: Requirements 1.5**

- [x] 3. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 4. 实现 SwarmOrchestrator 核心引擎
  - [x] 4.1 创建 `server/core/swarm-orchestrator.ts`，实现 `SwarmOrchestrator` 类骨架
    - 构造函数接收 `SwarmOrchestratorOptions`（messageBus, config, llmProvider, agentDirectory）
    - 实现 Pod 能力注册表（`registerPodCapability`, `getPodCapabilities`）
    - 实现活跃会话管理（`getActiveSessions`）
    - _Requirements: 3.2, 5.1, 5.2_
  - [x] 4.2 实现能力匹配逻辑 `matchCapabilities(required: string[]): PodCapability[]`
    - 遍历注册表，返回能力集合与 required 有交集的 Pod
    - 按匹配度排序
    - _Requirements: 3.2_
  - [x] 4.3 编写属性测试：Pod 能力匹配返回相关 Pod
    - **Property 5: Pod 能力匹配返回相关 Pod**
    - 使用 fast-check 生成随机能力集合和注册表，验证返回的 Pod 能力与请求有非空交集
    - **Validates: Requirements 3.2**
  - [x] 4.4 实现 `handleRequest()` 方法
    - 验证协作深度（depth <= maxDepth）
    - 验证并发会话数（activeSessions.length < maxConcurrentSessions）
    - 验证能力合法性
    - 创建 CollaborationSession，返回 CollaborationResponse
    - _Requirements: 5.1, 5.2, 5.3, 5.5_
  - [x] 4.5 编写属性测试：协作深度限制与并发限制
    - **Property 7: 协作深度限制执行**
    - **Property 8: 并发协作会话数量限制**
    - 使用 fast-check 生成随机深度值和会话数量，验证边界行为
    - **Validates: Requirements 5.1, 5.2, 5.5**
  - [x] 4.6 编写属性测试：协作请求能力验证
    - **Property 9: 协作请求能力验证**
    - 使用 fast-check 生成随机请求和 Pod 能力，验证自身已具备的能力被拒绝
    - **Validates: Requirements 5.3**
  - [x] 4.7 实现 `submitResult()` 和结果封装逻辑
    - 将子任务产出列表封装为 CollaborationResult
    - 全部成功 → completed，任一失败 → failed
    - 更新 Session 状态
    - _Requirements: 4.3, 4.4_
  - [x] 4.8 编写属性测试：协作结果封装保留所有子任务产出
    - **Property 6: 协作结果封装保留所有子任务产出**
    - 使用 fast-check 生成随机子任务产出列表，验证封装后的 result 包含所有产出且状态正确
    - **Validates: Requirements 4.3, 4.4**
  - [x] 4.9 实现 `terminateTimedOutSessions()` 方法
    - 遍历活跃会话，终止 startedAt + timeoutMs < now 的会话
    - 设置状态为 timeout，通知双方
    - _Requirements: 5.4_
  - [x] 4.10 编写属性测试：超时会话自动终止
    - **Property 10: 超时会话自动终止**
    - 使用 fast-check 生成随机会话和时间戳，验证超时判定正确性
    - **Validates: Requirements 5.4**

- [x] 5. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 6. 实现协作发现与 HeartbeatScheduler 集成
  - [x] 6.1 在 `SwarmOrchestrator` 中实现 `analyzeHeartbeat()` 方法
    - 接收 HeartbeatReport，提取 actionItems 和 observations
    - 调用 LLM 分析是否需要跨 Pod 协作
    - 匹配目标 Pod 能力，生成 CollaborationRequest
    - 无匹配时返回 null
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 6.2 在 `SwarmOrchestrator` 中实现 `generateSubTasks()` 方法
    - 调用 LLM 基于 CollaborationRequest 生成子任务描述
    - 分配给目标 Pod 内的可用 Worker
    - _Requirements: 4.1, 4.2_
  - [x] 6.3 扩展 `server/core/heartbeat.ts`，在 `HeartbeatScheduler` 中新增 `setSwarmOrchestrator()` 方法
    - 在 `trigger()` 成功生成报告后调用 `swarmOrchestrator.analyzeHeartbeat(report)`
    - _Requirements: 3.1_
  - [x] 6.4 编写单元测试：HeartbeatScheduler 与 SwarmOrchestrator 集成
    - 验证心跳报告生成后触发协作分析
    - 验证无匹配时不抛出异常
    - _Requirements: 3.1, 3.4_

- [x] 7. 集成 MissionOrchestrator 协作结果汇总
  - [x] 7.1 在 `server/core/mission-orchestrator.ts` 的 `MissionOrchestrator` 类中新增 `appendCollaborationResult()` 方法
    - 将 CollaborationSession 结果追加到 Mission 事件列表
    - 事件包含源 Pod ID、目标 Pod ID、协作耗时、结果状态
    - _Requirements: 6.1, 6.3_
  - [x] 7.2 在 `SwarmOrchestrator.submitResult()` 中调用 `MissionOrchestrator.appendCollaborationResult()`
    - 将协作结果自动汇总到关联的 Mission
    - _Requirements: 6.1, 6.2_
  - [x] 7.3 编写属性测试：协作结果正确汇总到 Mission
    - **Property 11: 协作结果正确汇总到 Mission**
    - 使用 fast-check 生成随机 CollaborationSession，验证 Mission 事件列表包含正确的协作记录
    - **Validates: Requirements 6.1, 6.3**

- [x] 8. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 9. 实现 3D 场景跨 Pod 协作可视化
  - [x] 9.1 创建 `client/src/stores/swarmStore.ts`，实现 Zustand 协作状态管理
    - 管理 activeSessions 和 crossPodMessages
    - 监听 Socket.IO `cross_pod_message` 和 `collaboration_session_update` 事件
    - _Requirements: 7.1, 7.2, 7.5_
  - [x] 9.2 创建 `client/src/components/three/CrossPodParticles.tsx`，实现粒子流动画组件
    - 基于 swarmStore 中的活跃会话渲染粒子流
    - 不同会话使用不同颜色，透明度随会话数递减
    - Session 结束后 1 秒淡出
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 9.3 在 `client/src/components/Scene3D.tsx` 中集成 `CrossPodParticles` 组件
    - 在 Canvas 内 Suspense 中添加 CrossPodParticles
    - _Requirements: 7.1_

- [x] 10. 最终检查点 - 确保所有测试通过
  - 运行 `npm run check` 确保类型检查通过
  - 运行所有新增测试确保通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用具体需求以确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性（使用 fast-check，每个属性至少 100 次迭代）
- 单元测试验证具体示例和边界条件
- 需要新增 `fast-check` 开发依赖：`pnpm add -D fast-check`
