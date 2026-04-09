# Mission 取消控制 - 需求文档

## 概述

当前任务执行链路已经具备创建、运行、等待决策、完成、失败等基本能力，但“取消任务”仍未打通：

- 前端没有明确的取消入口
- `POST /api/executor/jobs/:id/cancel` 仍返回 `501`
- 运行中的 Docker 容器无法被用户主动停止
- Mission 侧虽然能接收 `job.cancelled` 事件，但缺少完整的用户触发、服务编排、状态落库与 UI 回显闭环

本 spec 目标是将“取消任务”补齐为端到端能力，使用户可以在 `/tasks` 中取消 `queued`、`running`、`waiting` 状态的 Mission，并让 executor、服务端状态机、Socket 推送、任务详情页保持一致。

## 设计目标

1. 用户可显式取消任务，且取消动作具备审计信息
2. 取消动作对重复点击幂等，不会制造重复副作用
3. 正在运行的 Docker 任务可被可靠停止，并回传 `job.cancelled`
4. Mission 在取消后进入独立终态 `cancelled`，不再混入 `failed`
5. 前后端对取消中的反馈清晰，用户知道动作是否已被接受

## 非目标

- 本 spec 不覆盖暂停、恢复、重试、阻塞、终止等其他操作动作
- 本 spec 不重新设计任务详情页第一屏布局
- 本 spec 不处理多任务批量取消

## 用户故事与验收标准

### 1. 用户取消 Mission

#### 1.1 作为用户，我希望在任务详情页取消尚未结束的 Mission，以便及时停止错误或不再需要的执行

- AC 1.1.1: 当前端对 `POST /api/tasks/:id/cancel` 发起请求时，服务端 SHALL 接受 `reason?: string`、`requestedBy?: string`、`source?: "user" | "system"` 字段
- AC 1.1.2: 当 Mission 不存在时，服务端 SHALL 返回 HTTP 404
- AC 1.1.3: 当 Mission 已处于 `done`、`failed`、`cancelled` 终态时，服务端 SHALL 以幂等方式返回当前 Mission，不再次触发 executor 取消
- AC 1.1.4: 当 Mission 处于 `queued`、`running`、`waiting` 时，服务端 SHALL 接受取消请求并返回 `ok: true`
- AC 1.1.5: 前端 SHALL 在取消发起后显示加载状态，并在动作完成后刷新任务详情

#### 1.2 作为用户，我希望取消动作保留原因和发起者，以便后续回溯

- AC 1.2.1: Mission 事件流 SHALL 记录一条用户取消事件，包含取消原因、请求来源和时间
- AC 1.2.2: 若用户未填写原因，系统 SHALL 写入默认说明，例如 `Mission cancelled by user`
- AC 1.2.3: Mission 详情接口 SHALL 能返回最近一次取消请求的摘要信息

### 2. 服务端取消编排

#### 2.1 作为服务端，我需要在 Mission 侧协调本地状态和 executor 取消请求，以便完成端到端闭环

- AC 2.1.1: 当 Mission 关联了 `executor.jobId` 且 executor 仍处于非终态时，服务端 SHALL 调用 executor 取消接口
- AC 2.1.2: 当 Mission 尚未下发 executor 或无有效 `jobId` 时，服务端 SHALL 直接将 Mission 标记为 `cancelled`
- AC 2.1.3: 当 Mission 正处于 `waiting` 状态时，取消 SHALL 清除 `waitingFor` 和 `decision`
- AC 2.1.4: 服务端 SHALL 将取消结果写入持久化 Mission 快照，并通过 Socket 广播给前端

#### 2.2 作为服务端，我希望取消请求幂等，以避免重复点击或网络重试导致状态污染

- AC 2.2.1: 对同一 Mission 的重复取消请求 SHALL 返回相同终态结果
- AC 2.2.2: 若 executor 已经返回 `job.cancelled`，后续重复取消 SHALL 不再调用 executor
- AC 2.2.3: Mission 取消过程中若再次收到取消请求，服务端 SHALL 返回已接受结果，而不是报错

### 3. Executor 取消能力

#### 3.1 作为 executor，我需要实现 `cancel` 接口，以便真正停止任务

- AC 3.1.1: `POST /api/executor/jobs/:id/cancel` SHALL 从 `501` 升级为已实现接口
- AC 3.1.2: 当 job 不存在时，executor SHALL 返回 HTTP 404
- AC 3.1.3: 当 job 处于 `completed`、`failed`、`cancelled` 时，executor SHALL 幂等返回当前 job 状态
- AC 3.1.4: 当 job 处于 `queued` 时，executor SHALL 阻止其进入运行，并将状态设置为 `cancelled`
- AC 3.1.5: 当 job 处于 `running` 时，executor SHALL 尝试停止对应 Docker 容器，并最终发出 `job.cancelled` 事件
- AC 3.1.6: 当 job 处于 `waiting` 时，executor SHALL 将其标记为 `cancelled`

#### 3.2 作为 executor，我希望取消后的日志和产物仍然可用，以便排查

- AC 3.2.1: 取消动作 SHALL 追加 executor 日志，说明取消来源与结果
- AC 3.2.2: 若已有 `executor.log`、`result.json`、`execution.log` 等产物，取消不应删除这些文件
- AC 3.2.3: `job.cancelled` 事件 SHALL 携带可选 summary，说明停止发生在哪个阶段

### 4. Mission 状态与协议扩展

#### 4.1 作为系统，我需要用独立终态表达“取消”，而不是复用“失败”

- AC 4.1.1: `MissionStatus` SHALL 新增 `cancelled`
- AC 4.1.2: Mission 进入 `cancelled` 后 SHALL 被视为终态
- AC 4.1.3: 前端任务列表、任务详情、状态标签与颜色映射 SHALL 识别 `cancelled`
- AC 4.1.4: Socket 协议 SHALL 支持 `mission.record.cancelled`

#### 4.2 作为系统，我需要让 executor 事件与 Mission 状态映射保持一致

- AC 4.2.1: 当服务端收到 `job.cancelled` 事件时，Mission SHALL 进入 `cancelled`
- AC 4.2.2: `job.cancelled` SHALL 不再映射为 `failed`
- AC 4.2.3: Mission 取消后 SHALL 停止等待人工决策，并清空当前未完成决策

### 5. 前端取消交互

#### 5.1 作为用户，我希望在任务详情中看到明确的取消入口和反馈

- AC 5.1.1: 任务详情页 SHALL 为 `queued`、`running`、`waiting` 状态显示 `Cancel mission` 主操作按钮
- AC 5.1.2: 点击按钮后 SHALL 弹出确认层，支持填写可选原因
- AC 5.1.3: 提交中 SHALL 禁用重复点击，并显示进行中的文案
- AC 5.1.4: 取消成功后 SHALL 在 1 秒内通过本地刷新或 Socket 更新为 `cancelled`

#### 5.2 作为用户，我希望任务列表和详情都能看出任务已取消

- AC 5.2.1: 任务列表状态徽标 SHALL 区分 `cancelled`
- AC 5.2.2: 任务详情页 SHALL 显示取消原因、取消时间和发起来源
- AC 5.2.3: 已取消 Mission SHALL 隐藏继续执行类操作

## 约束与风险

- Docker 容器停止可能存在延迟，取消接口需要兼容“请求已接受，但 callback 稍后到达”的场景
- 现有 MissionStatus、Socket 类型、前端状态色板和筛选逻辑都依赖有限状态集，新增 `cancelled` 需要同步梳理
- 部分任务没有 executor 上下文，需支持纯 Mission 本地取消路径
