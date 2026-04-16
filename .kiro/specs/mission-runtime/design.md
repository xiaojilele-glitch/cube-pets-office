# Mission 任务域 设计文档

## 概述

Mission 任务域是独立于分析型 workflow 的真实任务执行链路。核心由 MissionStore（状态机）、MissionOrchestrator（编排器）、ExecutionPlanBuilder（计划构建）、ExecutorClient（执行器客户端）四个组件构成，通过 `/api/tasks` REST API 和 Socket.IO `mission_event` 对外暴露。

## 六阶段状态机

```
receive → understand → plan → provision → execute → finalize
```

每个阶段独立状态：`pending | running | done | failed`
Mission 整体状态：`queued | running | waiting | done | failed`

## 核心组件

### MissionStore (`server/tasks/mission-store.ts`)

内存状态机 + 可选快照持久化。

关键方法：

- `create(input)` → 初始化六阶段，状态 queued
- `markRunning(id, stageKey, detail, progress, source)` → 推进阶段
- `updateStage(id, stageKey, patch, progress, source)` → 更新阶段详情
- `markWaiting(id, waitingFor, detail, progress, decision, source)` → 暂停等待决策
- `resolveWaiting(id, submission)` → 恢复执行
- `markDone(id, summary, source)` → 完成
- `markFailed(id, reason, source)` → 失败
- `recoverInterrupted(options)` → 重启恢复

### MissionOrchestrator (`server/core/mission-orchestrator.ts`)

编排器，协调 MissionStore、ExecutionPlanBuilder、ExecutorClient。

```
startMission(input)
  → MissionRepository.create(record)
  → buildPlan(input) → ExecutionPlanBuildResult
  → persist(record) → 更新阶段
  → hooks.onMissionUpdated(mission)
  → return { mission, plan, understanding }

applyExecutorEvent(event)
  → 根据 event.status 更新 Mission 阶段和字段
  → 处理 artifacts、instance、progress
  → persist(record)

submitDecision(missionId, submission)
  → resolveDecision() → 恢复 Mission
  → hooks.onDecisionSubmitted()
```

### ExecutionPlanBuilder (`server/core/execution-plan-builder.ts`)

将 sourceText 转化为结构化执行计划。

意图分类规则（`classifyExecutionIntent`）：
| 关键词 | 意图 | 置信度 | Pipeline |
|--------|------|--------|----------|
| playwright/run tests/execute | execute | 0.92 | scan→analyze→plan→execute→report |
| codegen/generate/scaffold | codegen | 0.88 | scan→analyze→plan→codegen |
| report/summary/status | report | 0.85 | report |
| plan/strategy/roadmap | plan | 0.82 | scan→analyze→plan |
| analyze/review/investigate | analyze | 0.78 | scan→analyze |
| scan/inspect/graph | scan | 0.74 | scan |
| 无匹配 | custom | 0.45 | analyze→plan→custom |

### ExecutorClient (`server/core/executor-client.ts`)

HTTP 客户端，负责与远端执行器通信。

```typescript
class ExecutorClient {
  assertReachable(); // GET /health，不可达时 fail fast
  dispatchPlan(plan); // POST /api/executor/jobs
  buildJobRequest(plan); // 构建 ExecutorJobRequest（含 callback URL 和 HMAC 配置）
}
```

错误类型：

- `unavailable` — 执行器不可达或超时
- `protocol` — 响应格式不符合契约
- `rejected` — 执行器主动拒绝

## 数据模型

### MissionRecord

```typescript
interface MissionRecord {
  id: string; // m_<timestamp>_<random>
  kind: string; // chat | executor-smoke | restart-smoke
  title: string;
  sourceText?: string;
  topicId?: string; // 飞书线程聚合
  status: MissionStatus; // queued | running | waiting | done | failed
  progress: number; // 0-100
  currentStageKey?: string;
  stages: MissionStage[]; // 六阶段数组
  summary?: string;
  executor?: MissionExecutorContext; // 执行器信息
  instance?: MissionInstanceContext; // 容器实例信息
  artifacts?: MissionArtifact[]; // 工件列表
  waitingFor?: string;
  decision?: MissionDecision; // 决策选项
  events: MissionEvent[]; // 事件流
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}
```

### ExecutionPlan

```typescript
interface ExecutionPlan {
  version: string;
  missionId: string;
  summary: string;
  objective: string;
  requestedBy: "brain" | "system" | "user";
  mode: "auto" | "manual" | "dry-run";
  sourceText: string;
  workspaceRoot?: string;
  steps: ExecutionPlanStep[];
  jobs: ExecutionPlanJob[];
  metadata?: Record<string, unknown>;
}
```

## 回调签名校验

```
签名算法: HMAC-SHA256
签名内容: timestamp + "." + rawBody
Header: x-cube-executor-timestamp, x-cube-executor-signature
时间偏移容忍: EXECUTOR_CALLBACK_MAX_SKEW_SECONDS (默认 300 秒)
密钥: EXECUTOR_CALLBACK_SECRET 环境变量（留空时跳过校验）
```

## REST API

| 方法 | 路径                    | 说明                 |
| ---- | ----------------------- | -------------------- |
| POST | /api/tasks              | 创建 Mission         |
| GET  | /api/tasks              | 列表（limit 参数）   |
| GET  | /api/tasks/:id          | 详情                 |
| GET  | /api/tasks/:id/events   | 事件流（limit 参数） |
| POST | /api/tasks/:id/decision | 提交决策             |
| POST | /api/executor/events    | 执行器回调           |

## Socket 事件

`mission_event` — Mission 状态变化时广播，payload 为完整 MissionRecord。
