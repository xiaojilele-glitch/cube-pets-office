# Mission 任务域 需求文档

## 概述

Mission 任务域是系统的真实任务执行链路，区别于分析型 workflow。一个 Mission 从接收用户请求开始，经过理解、规划、资源准备、执行到最终完成，全程六阶段推进。Mission 支持结构化执行计划生成、远端 Docker 执行器下发、执行器回调接收、人工决策暂停恢复，以及通过飞书和前端任务驾驶舱的实时可视化。

## 用户故事

### US-1: 创建 Mission
作为用户，我希望通过前端或飞书创建一个 Mission，系统自动初始化六阶段状态机并开始推进。

#### 验收标准
- AC-1.1: `POST /api/tasks` 接受 title、sourceText、kind、topicId，返回创建的 MissionRecord
- AC-1.2: Mission 创建后状态为 `queued`，六个阶段（receive/understand/plan/provision/execute/finalize）均为 `pending`
- AC-1.3: 每个 Mission 有唯一 ID（格式 `m_<timestamp>_<random>`）
- AC-1.4: 支持 topicId 维度聚合（飞书线程与 Cube UI 同主题关联）
- AC-1.5: 创建事件通过 Socket `mission_event` 推送前端

### US-2: Mission 六阶段状态机推进
作为系统，我需要按 receive → understand → plan → provision → execute → finalize 六阶段推进 Mission，每个阶段有独立的状态（pending/running/done/failed）。

#### 验收标准
- AC-2.1: `MissionStore.markRunning(id, stageKey, detail, progress, source)` 将指定阶段标记为 running
- AC-2.2: `MissionStore.updateStage(id, stageKey, patch, progress, source)` 更新阶段状态和详情
- AC-2.3: 每次状态变化生成 MissionEvent（type/message/progress/stageKey/level/time/source）
- AC-2.4: Mission 整体状态根据阶段状态自动推导：任一阶段 running → Mission running
- AC-2.5: 所有阶段 done → Mission 可进入 finalize

### US-3: 结构化执行计划生成
作为系统，我需要将 Mission 的 sourceText 转化为结构化的 ExecutionPlan，包含具体的执行步骤、依赖关系和验收标准。

#### 验收标准
- AC-3.1: `ExecutionPlanBuilder.build(input)` 接受 missionId、sourceText、title，输出 ExecutionPlanBuildResult
- AC-3.2: 通过 `classifyExecutionIntent()` 基于关键词匹配推断执行意图（scan/analyze/plan/codegen/execute/report/custom）
- AC-3.3: 每种意图对应预定义的 job pipeline（如 execute → [scan, analyze, plan, execute, report]）
- AC-3.4: ExecutionPlan 包含 version、missionId、summary、objective、steps、jobs、metadata
- AC-3.5: 每个 job 包含 id、kind、label、description、dependsOn、timeoutMs、payload

### US-4: 执行计划下发到远端执行器
作为系统，我需要将 ExecutionPlan 通过 HTTP 下发到远端 Docker 执行器，并处理执行器不可达的情况。

#### 验收标准
- AC-4.1: `ExecutorClient.dispatchPlan(plan, options)` 先调用 `assertReachable()` 检查执行器健康
- AC-4.2: 构建 `ExecutorJobRequest`（包含 plan、callback URL、HMAC 签名配置）
- AC-4.3: POST 到执行器的 `/api/executor/jobs` 端点
- AC-4.4: 执行器不可达时抛出 `ExecutorClientError(kind: "unavailable")`，Mission 进入 failed 状态
- AC-4.5: 执行器拒绝请求时抛出 `ExecutorClientError(kind: "rejected")`
- AC-4.6: 请求超时由 AbortController 控制（默认 10 秒）

### US-5: 接收执行器回调事件
作为系统，我需要通过 `/api/executor/events` 接收执行器的阶段进度、日志、工件和完成/失败事件，并更新 Mission 状态。

#### 验收标准
- AC-5.1: 回调请求包含 HMAC-SHA256 签名校验（timestamp + rawBody）
- AC-5.2: 支持事件类型：job.log、job.waiting、job.completed、job.failed、job.cancelled
- AC-5.3: 进度事件更新 Mission 的 progress 和 currentStageKey
- AC-5.4: 工件事件更新 Mission 的 artifacts 数组（kind: file/report/url/log）
- AC-5.5: 实例信息事件更新 Mission 的 instance（image、command、exitCode 等）
- AC-5.6: 完成/失败事件触发 Mission 进入 done/failed 终态

### US-6: Mission 等待人工决策
作为系统，我需要支持 Mission 在执行过程中暂停等待人工确认，用户可以在前端提交决策恢复执行。

#### 验收标准
- AC-6.1: `MissionStore.markWaiting(id, waitingFor, detail, progress, decision, source)` 将 Mission 标记为 waiting
- AC-6.2: waiting 状态的 Mission 包含 `decision` 字段（prompt、options、allowFreeText）
- AC-6.3: `POST /api/tasks/:id/decision` 接受 optionId 或 freeText，恢复 Mission 执行
- AC-6.4: 决策提交接口幂等：Mission 不在 waiting 状态时返回 alreadyResolved
- AC-6.5: 决策提交后 Mission 回到 running 状态

### US-7: Mission 重启恢复
作为系统，我需要在服务重启后恢复运行中的 Mission 状态，确保不会静默丢失。

#### 验收标准
- AC-7.1: Mission 数据通过 `MissionSnapshotStore` 持久化到本地文件
- AC-7.2: 服务启动时调用 `MissionStore.recoverInterrupted()` 恢复中断的 Mission
- AC-7.3: 运行中的 Mission 重启后标记为 failed（带 "server restarted" 说明）或恢复到上次状态
- AC-7.4: 恢复过程生成 MissionEvent 记录

### US-8: 前端任务驾驶舱实时展示
作为用户，我希望在 `/tasks` 页面实时看到 Mission 的状态、阶段进度、执行器信息、日志和工件。

#### 验收标准
- AC-8.1: 前端通过 `mission-client.ts` 调用 GET /api/tasks、GET /api/tasks/:id、GET /api/tasks/:id/events
- AC-8.2: 任务驾驶舱提供 Overview / Execution / Artifacts 三个视图
- AC-8.3: Mission 状态变化通过 Socket `mission_event` 实时推送，前端局部更新
- AC-8.4: 前端支持创建 Mission（CreateMissionDialog）和提交决策
