# Mission Contract Freeze

## 冻结基线

- 参考仓库：`..\openclaw-feishu-progress`
- 参考 SHA：`f60fdbe5944fc839ee901f8a5aad7544b8969e73`
- 冻结日期：`2026-03-28`
- 当前 worktree：`chore/mission-contracts`

## 开工前必须先看

### 参考源目录

- `..\openclaw-feishu-progress\src`
- `..\openclaw-feishu-progress\src\server`
- `..\openclaw-feishu-progress\src\server\routes`
- `..\openclaw-feishu-progress\src\execution`
- `..\openclaw-feishu-progress\src\web\src\features\tasks`

### 本次对照过的关键文件

- `..\openclaw-feishu-progress\src\types.ts`
- `..\openclaw-feishu-progress\src\execution\types.ts`
- `..\openclaw-feishu-progress\src\server\topic.ts`
- `..\openclaw-feishu-progress\src\server\task-store.ts`
- `..\openclaw-feishu-progress\src\server\task-decision.ts`
- `..\openclaw-feishu-progress\src\server\routes\agents.ts`
- `..\openclaw-feishu-progress\src\server\routes\planets.ts`
- `..\openclaw-feishu-progress\src\web\src\features\tasks\types.ts`

## Worktree 0 只写目录

- `shared/mission/**`
- `shared/executor/**`
- `docs/mission-worktree-dual-repo.md`
- `docs/mission-contract-freeze.md`

## 禁止改动文件

- `server/index.ts`
- `client/src/App.tsx`

## 跨仓依赖禁令

- 不允许在当前仓库写 `..\openclaw-feishu-progress\**` 的运行时 import。
- 不允许把参考仓库路径写进 `package.json`、`tsconfig` alias、脚本命令或部署配置。
- topic、task、planet、executor 逻辑必须迁回当前仓库实现。

## 共享契约落点

- `shared/mission/contracts.ts`
- `shared/mission/api.ts`
- `shared/mission/socket.ts`
- `shared/mission/topic.ts`
- `shared/executor/contracts.ts`
- `shared/executor/api.ts`

## 已冻结契约

### Mission Domain

- `MissionRecord`
- `MissionStage`
- `MissionEvent`
- `MissionDecision`
- `MissionDecisionSubmission`
- `MissionPlanetOverviewItem`
- `MissionPlanetInteriorData`
- `MissionPlanetEdge`

### Executor Domain

- `ExecutionPlan`
- `ExecutionPlanJob`
- `ExecutorJobRequest`
- `ExecutorEvent`

## 已冻结 REST 契约

### `/api/tasks`

- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/decision`

### `/api/planets`

- `GET /api/planets`
- `GET /api/planets/:id`
- `GET /api/planets/:id/interior`
- `POST /api/planets/edges`
- `PUT /api/planets/edges/:fromId/:toId`
- `DELETE /api/planets/edges/:fromId/:toId`

### `/api/executor/events`

- `POST /api/executor/events`
- 回调鉴权头固定为：
- `x-cube-executor-id`
- `x-cube-executor-timestamp`
- `x-cube-executor-signature`

## 已冻结 Socket 事件名

- Socket.IO 频道：`mission_event`
- payload type：
- `mission.snapshot`
- `mission.record.updated`
- `mission.record.waiting`
- `mission.record.completed`
- `mission.record.failed`
- `mission.planet.updated`
- `mission.planet.edge.updated`
- `mission.executor.event`

## 主题聚合策略

- Feishu topic 策略固定为 `strict-by-thread`
- 优先级：`threadId` > `rootMessageId` > `requestId`

## 给 A/B/C/D/E 的约束

- A 只读 `shared/mission/**`，需要补字段先回推到 Worktree 0。
- B 只读 `shared/mission/**`、`shared/executor/**`，不要自创 executor 事件字段。
- C 组装 `ExecutionPlan` 时只能填已冻结字段，不能顺手扩充共享类型。
- D 复用已冻结 topic 规则与 waiting/decision 契约，不要自改 mission record 结构。
- E 只消费已冻结 `/api/tasks`、`/api/planets` 和 `mission_event`，不碰 `shared/mission/**`。

## 结论

本 worktree 的 mission / executor / planets / socket 共享契约已经冻结。

如果后续任何 worktree 需要新增共享字段，先回到 `Worktree 0` 修改 `shared/mission/**` 或 `shared/executor/**`，不要在各自分支私改。
