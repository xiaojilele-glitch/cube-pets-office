# 需求文档：executor-integration

## 简介

当前系统存在两条断裂的执行管线：
1. **WorkflowEngine 管线**：用户提交 Mission → WorkflowEngine 编排 Agent 协作 → LLM 生成结果 → Mission 完成
2. **Docker 执行管线**：ExecutionPlanBuilder 构建计划 → ExecutorClient 分发到 lobster-executor → DockerRunner 创建容器 → 容器执行 → 结果回收

这两条管线目前没有连接。Docker 执行只能通过 `/api/tasks/smoke/dispatch` 测试路由触发，正常 Mission 流程永远不会创建 Docker 容器。

本需求的目标是：当 WorkflowEngine 的 execution 阶段产出代码、脚本或可执行产物时，系统自动将其桥接到 Docker 执行管线，在容器中运行，并将执行结果回流到 Mission 运行时。

## 术语表

- **WorkflowEngine**：十阶段工作流引擎，编排 Agent 协作完成 Mission
- **ExecutionPlanBuilder**：根据 Mission 输入构建 ExecutionPlan 的组件
- **ExecutorClient**：向 lobster-executor 服务分发 ExecutionPlan 的 HTTP 客户端
- **LobsterExecutor**：Docker 容器执行服务，接收 Job 请求并在容器中运行
- **MissionRuntime**：Mission 运行时管理器，维护 Mission 状态并通过 Socket.IO 广播更新
- **ExecutionBridge**：本需求新增的桥接组件，连接 WorkflowEngine 产出与 Docker 执行管线
- **ExecutorEvent**：lobster-executor 通过回调发送的事件（job.accepted、job.started、job.completed 等）
- **MissionRecord**：Mission 的完整运行时记录，包含 executor、instance、artifacts 等字段

## 需求

### 需求 1：可执行产物检测

**用户故事：** 作为系统，我希望在 WorkflowEngine execution 阶段完成后自动检测产出中是否包含可执行内容，以便决定是否需要触发 Docker 执行。

#### 验收标准

1. WHEN WorkflowEngine 的 execution 阶段完成且任务交付物包含代码块或脚本内容, THE ExecutionBridge SHALL 将该交付物标记为需要 Docker 执行
2. WHEN WorkflowEngine 的 execution 阶段完成且任务交付物仅包含文本分析或报告, THE ExecutionBridge SHALL 跳过 Docker 执行并继续正常工作流
3. THE ExecutionBridge SHALL 支持通过 Mission metadata 中的 `requiresExecution: true` 标志强制触发 Docker 执行
4. THE ExecutionBridge SHALL 支持通过 Mission metadata 中的 `requiresExecution: false` 标志强制跳过 Docker 执行

### 需求 2：ExecutionPlan 自动生成

**用户故事：** 作为系统，我希望从 WorkflowEngine 的执行产出自动构建 ExecutionPlan，以便无需人工干预即可分发到 Docker 执行管线。

#### 验收标准

1. WHEN 可执行产物被检测到, THE ExecutionBridge SHALL 调用 ExecutionPlanBuilder 从交付物内容构建 ExecutionPlan
2. THE ExecutionPlan SHALL 包含从交付物中提取的 sourceText、objective 和 missionId
3. WHEN ExecutionPlan 构建失败, THEN THE ExecutionBridge SHALL 记录错误日志并将 Mission 标记为失败状态
4. THE ExecutionPlan SHALL 继承 Mission 的 mode 设置（auto/reuse/managed），默认为 auto

### 需求 3：ExecutorClient 分发集成

**用户故事：** 作为系统，我希望自动将构建好的 ExecutionPlan 分发到 lobster-executor 服务，以便在 Docker 容器中执行代码。

#### 验收标准

1. WHEN ExecutionPlan 构建成功, THE ExecutionBridge SHALL 通过 ExecutorClient 将计划分发到 lobster-executor
2. WHEN 分发成功, THE ExecutionBridge SHALL 使用 MissionRuntime.patchMissionExecution 更新 Mission 的 executor 上下文（name、requestId、jobId、status、baseUrl）
3. WHEN ExecutorClient 报告 lobster-executor 不可达, THEN THE ExecutionBridge SHALL 重试一次后将 Mission 标记为失败
4. WHEN 分发成功, THE ExecutionBridge SHALL 将 Mission 阶段推进到 execute 并设置进度为 60%
5. THE ExecutionBridge SHALL 正确构建 callback URL 指向主服务器的 `/api/executor/events` 端点

### 需求 4：执行事件回流

**用户故事：** 作为系统，我希望 lobster-executor 的执行事件能自动更新 Mission 运行时状态，以便前端实时展示执行进度。

#### 验收标准

1. WHEN lobster-executor 发送 job.started 事件, THE MissionRuntime SHALL 将 Mission 的 executor.status 更新为 running
2. WHEN lobster-executor 发送 job.progress 事件, THE MissionRuntime SHALL 更新 Mission 的 progress 字段
3. WHEN lobster-executor 发送 job.completed 事件, THE MissionRuntime SHALL 将 Mission 标记为 done 状态
4. WHEN lobster-executor 发送 job.failed 事件, THE MissionRuntime SHALL 将 Mission 标记为 failed 状态并记录错误信息
5. WHEN lobster-executor 发送 job.log_stream 事件, THE MissionRuntime SHALL 通过 Socket.IO 将日志转发到前端
6. WHEN lobster-executor 发送 job.screenshot 事件, THE MissionRuntime SHALL 通过 Socket.IO 将截图数据转发到前端

### 需求 5：前端执行状态展示

**用户故事：** 作为用户，我希望在 Mission 详情视图中看到 Docker 执行的实时状态，以便了解代码执行进度和结果。

#### 验收标准

1. WHEN Mission 关联了 executor 上下文, THE 前端 Mission 详情视图 SHALL 显示执行器状态面板（executor name、job status、最后事件时间）
2. WHEN executor 状态为 running, THE 前端 SHALL 显示实时进度条
3. WHEN executor 产出 artifacts, THE 前端 SHALL 在 Mission 详情中列出所有产物（名称、类型、描述）
4. WHEN executor 发送 job.log_stream 事件, THE 前端 SHALL 在终端面板中实时显示日志输出

### 需求 6：错误处理与容错

**用户故事：** 作为系统，我希望在 Docker 执行过程中的任何错误都能被正确处理并反映到 Mission 状态，以便用户了解失败原因。

#### 验收标准

1. WHEN ExecutorClient 分发超时, THEN THE ExecutionBridge SHALL 将 Mission 标记为 failed 并记录超时详情
2. WHEN Docker 容器执行超时, THEN THE MissionRuntime SHALL 将 Mission 标记为 failed 并记录容器超时信息
3. WHEN lobster-executor 服务在执行过程中断开, THEN THE MissionRuntime SHALL 在 30 秒无心跳后将 Mission 标记为 failed
4. IF ExecutionBridge 在桥接过程中遇到未预期异常, THEN THE ExecutionBridge SHALL 捕获异常、记录完整错误栈并将 Mission 标记为 failed

### 需求 7：Mock 与 Real 模式透明支持

**用户故事：** 作为开发者，我希望 ExecutionBridge 能透明地支持 mock 和 real 两种执行模式，以便在没有 Docker 环境时也能测试完整流程。

#### 验收标准

1. WHEN 环境变量 LOBSTER_EXECUTION_MODE 为 mock, THE ExecutionBridge SHALL 在 Job payload 中注入 mock runner 配置
2. WHEN 环境变量 LOBSTER_EXECUTION_MODE 为 real 或未设置, THE ExecutionBridge SHALL 在 Job payload 中注入 Docker 镜像和命令配置
3. THE ExecutionBridge SHALL 使用相同的 ExecutorClient 接口分发 mock 和 real 模式的 Job，调用方无需感知模式差异
4. WHEN mock 模式下执行完成, THE MissionRuntime SHALL 收到与 real 模式相同结构的 ExecutorEvent 回调
