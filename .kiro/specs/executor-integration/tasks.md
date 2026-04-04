# 实现计划：executor-integration

## 概述

将 WorkflowEngine 的 execution 阶段与 lobster-executor Docker 执行管线桥接。核心新增 `ExecutionBridge` 组件，复用现有 ExecutionPlanBuilder、ExecutorClient 和 `/api/executor/events` 回调机制。

## Tasks

- [ ] 1. 实现 ExecutionBridge 核心模块
  - [ ] 1.1 创建 `server/core/execution-bridge.ts`，实现 `ExecutionBridge` 类
    - 实现 `detectExecutable(deliverables, metadata)` 方法：代码块检测、脚本关键字检测、metadata 强制覆盖
    - 实现 `bridge(missionId, deliverables, metadata)` 方法：检测 → 构建计划 → 分发 → 更新状态
    - 实现 mock/real 模式 payload 注入逻辑
    - 实现重试逻辑（不可达时重试 1 次，间隔 2 秒）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4, 3.1, 3.2, 3.4, 3.5, 7.1, 7.2, 7.3_

  - [ ]* 1.2 编写 detectExecutable 属性测试
    - **Property 1: 可执行内容检测**
    - **Property 2: 非可执行内容跳过**
    - **Property 3: Metadata 强制覆盖**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [ ]* 1.3 编写 ExecutionPlan 构建属性测试
    - **Property 4: ExecutionPlan 构建不变量**
    - **Validates: Requirements 2.1, 2.2, 2.4**

  - [ ]* 1.4 编写模式 payload 属性测试
    - **Property 8: 模式特定 payload 注入**
    - **Validates: Requirements 7.1, 7.2**

- [ ] 2. 集成 ExecutionBridge 到 WorkflowEngine
  - [ ] 2.1 修改 `server/core/workflow-engine.ts`，在 `runPipeline` 中 `runExecution` 完成后插入 `bridgeToExecutor` 调用
    - 新增 `bridgeToExecutor(workflowId)` 私有方法
    - 收集 workflow 所有 task 的 deliverable
    - 调用 `ExecutionBridge.bridge()`
    - 桥接失败时记录 workflow issue 但不阻断管线
    - _Requirements: 1.1, 1.2, 2.1, 3.1_

  - [ ]* 2.2 编写 bridgeToExecutor 单元测试
    - 测试有可执行产物时触发桥接
    - 测试无可执行产物时跳过桥接
    - 测试桥接失败时记录 issue 并继续
    - _Requirements: 1.1, 1.2, 6.4_

- [ ] 3. Checkpoint — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 4. 实现分发后状态更新与回调 URL 构建
  - [ ] 4.1 在 `ExecutionBridge.bridge()` 中实现分发成功后的 Mission 状态更新
    - 调用 `missionRuntime.patchMissionExecution()` 写入 executor 上下文
    - 调用 `missionRuntime.markMissionRunning()` 推进到 execute 阶段，进度 60%
    - 构建 callback URL：从服务器 base URL 拼接 `/api/executor/events`
    - _Requirements: 3.2, 3.4, 3.5_

  - [ ]* 4.2 编写分发后状态一致性属性测试
    - **Property 5: 分发后 executor 上下文一致性**
    - **Validates: Requirements 3.2**

  - [ ]* 4.3 编写 callback URL 属性测试
    - **Property 6: Callback URL 构建正确性**
    - **Validates: Requirements 3.5**

- [ ] 5. 实现错误处理与心跳超时
  - [ ] 5.1 在 `ExecutionBridge` 中实现完整错误处理
    - ExecutionPlan 构建失败 → 记录错误 + Mission failed
    - ExecutorClient 不可达 → 重试 1 次 → Mission failed
    - 分发超时 → Mission failed
    - 未预期异常 → 顶层 try-catch → Mission failed
    - _Requirements: 2.3, 3.3, 6.1, 6.4_

  - [ ] 5.2 实现心跳超时监控逻辑
    - 分发成功后启动 30 秒定时器
    - 收到 ExecutorEvent 时重置定时器
    - 超时后标记 Mission failed
    - Mission 终态时清除定时器
    - _Requirements: 6.3_

  - [ ]* 5.3 编写异常安全性属性测试
    - **Property 9: 异常安全性**
    - **Validates: Requirements 6.4**

  - [ ]* 5.4 编写心跳超时单元测试
    - 测试 30 秒无事件后 Mission 标记为 failed
    - 测试收到事件后定时器重置
    - 测试 Mission 终态时定时器清除
    - _Requirements: 6.3_

- [ ] 6. Checkpoint — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 7. 验证事件回流映射（现有机制）
  - [ ] 7.1 审查并补充 `server/index.ts` 中 `/api/executor/events` 处理逻辑
    - 确认 job.started → executor.status = running 映射正确
    - 确认 job.progress → mission.progress 更新正确
    - 确认 job.completed → mission.status = done 映射正确
    - 确认 job.failed → mission.status = failed 映射正确
    - 确认 job.log_stream 和 job.screenshot 的 Socket.IO 转发正确
    - 如有缺失则补充逻辑
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 7.2 编写事件到状态映射属性测试
    - **Property 7: 事件到状态映射**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 7.4**

- [ ] 8. 实现前端 ExecutorStatusPanel 组件
  - [ ] 8.1 创建 `ExecutorStatusPanel` 组件
    - 显示执行器名称、Job ID、当前状态、最后事件时间
    - running 状态时显示进度条
    - 列出 artifacts（名称、类型、描述）
    - 集成到 Mission 详情视图
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ] 8.2 集成 Socket.IO 日志流到终端面板
    - 监听 job.log_stream 事件并实时显示
    - 区分 stdout/stderr 流
    - _Requirements: 5.4_

- [ ] 9. 端到端集成与最终验证
  - [ ] 9.1 在 `server/index.ts` 中初始化 ExecutionBridge 实例并注入到 WorkflowEngine 运行时
    - 从环境变量读取 executorBaseUrl、executionMode、defaultImage
    - 构建 callbackUrl
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 9.2 编写集成测试：mock 模式完整桥接流程
    - 创建 Mission → WorkflowEngine 执行 → 产出代码 → ExecutionBridge 检测 → 构建计划 → 分发 → 事件回流 → Mission 完成
    - _Requirements: 1.1, 2.1, 3.1, 4.3, 7.1_

- [ ] 10. Final checkpoint — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 完全复用现有 `ExecutionPlanBuilder`、`ExecutorClient`、`/api/executor/events` 回调机制
- 现有 smoke dispatch 路由 (`/api/tasks/smoke/dispatch`) 中的模式可作为参考实现
- 属性测试使用 `fast-check` 库，每个属性最少 100 次迭代
