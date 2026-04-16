# 工作流引擎 设计文档

## 概述

工作流引擎将用户自然语言指令通过十阶段管道推进，驱动动态生成的多智能体组织完成协作。引擎基于 `WorkflowRuntime` 抽象接口设计，使同一套编排逻辑可运行在服务端（Express + JSON）和浏览器端（IndexedDB + Web Worker）两种环境中。

## 系统架构

```
用户指令
  │
  ▼
WorkflowEngine.startWorkflow(directive, options)
  │
  ├── 生成 workflowId (UUID)
  ├── 构建 directiveContext (指令文本 + 附件全文)
  ├── 构建 inputSignature (去重签名)
  ├── 创建 WorkflowRecord (status: running)
  │
  ▼ (异步)
runPipeline(workflowId, directiveContext)
  │
  ├── 1. runDirection()    → 动态组织生成 + CEO 拆解 + 方向分发
  ├── 2. runPlanning()     → 经理并行规划 + Worker 任务分配
  ├── 3. runExecution()    → Worker 并行执行 + 交付物产出
  ├── 4. runReview()       → 经理 20 分制四维度评审
  ├── 5. runMetaAudit()    → 审计节点独立质量检查
  ├── 6. runRevision()     → 低分任务退回修订 (v2/v3)
  ├── 7. runVerify()       → 经理逐条验证反馈回应
  ├── 8. runSummary()      → 部门汇总报告生成
  ├── 9. runFeedback()     → CEO 全局总评
  ├── 10. runEvolution()   → 评分分析 + 人设修补 + 能力注册
  │
  ├── persistFinalReport() → 报告落盘 (JSON + Markdown)
  ├── materializeWorkflowMemories() → 记忆持久化
  │
  ▼
WorkflowRecord (status: completed | completed_with_errors | failed)
```

## 核心数据模型

### WorkflowRecord

```typescript
interface WorkflowRecord {
  id: string; // UUID, 格式 wf_<timestamp>_<random>
  directive: string; // 用户原始指令
  status: WorkflowStatus; // pending | running | completed | completed_with_errors | failed
  current_stage: string | null; // 当前阶段 key
  departments_involved: string[]; // 参与部门 ID 列表
  started_at: string | null; // ISO 时间戳
  completed_at: string | null;
  results: {
    // 执行结果与元数据
    input?: { attachments; directiveContext; signature };
    last_error?: string;
    failed_stage?: string;
    report_error?: string;
  };
  created_at: string;
}
```

### TaskRecord

```typescript
interface TaskRecord {
  id: number;
  workflow_id: string;
  worker_id: string;
  manager_id: string;
  department: string;
  description: string;
  deliverable: string | null; // v1 交付物
  deliverable_v2: string | null; // 修订后
  deliverable_v3: string | null; // 二次修订
  score_accuracy: number | null; // 0-5
  score_completeness: number | null;
  score_actionability: number | null;
  score_format: number | null;
  total_score: number | null; // 0-20
  manager_feedback: string | null;
  meta_audit_feedback: string | null;
  verify_result: VerifyResult | null;
  version: number; // 1, 2, 3
  status: string; // assigned | executing | submitted | reviewed | ...
}
```

### ReviewScore

```typescript
interface ReviewScore {
  accuracy: number; // 0-5
  completeness: number; // 0-5
  actionability: number; // 0-5
  format: number; // 0-5
  total: number; // 0-20
  feedback: string;
}
```

### WorkflowOrganizationSnapshot

```typescript
interface WorkflowOrganizationSnapshot {
  kind: "workflow_organization";
  version: 1;
  workflowId: string;
  directive: string;
  source: "generated" | "fallback";
  taskProfile: string;
  reasoning: string;
  rootNodeId: string;
  departments: WorkflowOrganizationDepartment[];
  nodes: WorkflowOrganizationNode[]; // 每个节点含 skills, mcp, model, execution 配置
}
```

## 运行时抽象层 (WorkflowRuntime)

引擎通过 `WorkflowRuntime` 接口与外部环境解耦：

| 接口                  | 职责                   | 服务端实现                       | 浏览器实现                            |
| --------------------- | ---------------------- | -------------------------------- | ------------------------------------- |
| `WorkflowRepository`  | 工作流/任务/消息 CRUD  | `server/db/index.ts` (JSON 文件) | `BrowserWorkflowRepository` (内存)    |
| `MemoryRepository`    | 记忆上下文构建与持久化 | `server/memory/session-store.ts` | `BrowserMemoryRepository` (IndexedDB) |
| `ReportRepository`    | 报告生成与落盘         | `server/memory/report-store.ts`  | `BrowserReportRepository` (内存)      |
| `RuntimeEventEmitter` | Socket 事件发射        | `server/core/socket.ts`          | `BrowserEventEmitter` (postMessage)   |
| `AgentDirectory`      | 智能体查找与 LLM 调用  | `server/core/registry.ts`        | `BrowserAgentDirectory`               |
| `RuntimeMessageBus`   | 层级消息发送与收件箱   | `server/core/message-bus.ts`     | `BrowserMessageBus`                   |
| `EvolutionService`    | 进化分析               | `server/core/evolution.ts`       | 空实现                                |

## 并发控制

```typescript
async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]>;
```

- `runPlanning` 和 `runExecution` 阶段使用此函数控制并行 LLM 调用
- 并发上限由环境变量 `LLM_MAX_CONCURRENT` 控制（默认 9999，即不限制）
- 每个 Promise 完成后立即启动队列中的下一个

## 评审决策逻辑

```
total_score ≥ 16  →  pass (通过)
10 ≤ total < 16   →  revise (退回修订，生成 v2)
total_score < 10  →  reject (拒绝，标记失败)

验证阶段：
未回应反馈点 > 30%  →  触发 v3 修订
未回应反馈点 ≤ 30%  →  通过
```

## 错误处理策略

| 场景                         | 处理方式                                                      |
| ---------------------------- | ------------------------------------------------------------- |
| 单个 LLM 调用超时/rate limit | `isTemporaryLLMError()` 检测，自动重试                        |
| LLM 返回无法解析的 JSON      | 使用默认值 + 记录 `WorkflowIssue`                             |
| 单个 Worker 执行失败         | 记录 issue，不阻塞其他 Worker                                 |
| 阶段级异常                   | 工作流进入 `failed` 状态，记录 `last_error` 和 `failed_stage` |
| 报告持久化失败               | 工作流状态改为 `completed_with_errors`，不影响主流程          |

## Socket 事件协议

| 事件类型            | 触发时机       | payload 关键字段                     |
| ------------------- | -------------- | ------------------------------------ |
| `stage_change`      | 阶段切换       | workflowId, stage                    |
| `agent_active`      | 智能体开始工作 | agentId, action, workflowId          |
| `message_sent`      | 智能体间消息   | workflowId, from, to, stage, preview |
| `score_assigned`    | 评分完成       | workflowId, taskId, workerId, score  |
| `task_update`       | 任务状态变化   | workflowId, taskId, workerId, status |
| `workflow_complete` | 工作流完成     | workflowId, status, summary          |
| `workflow_error`    | 工作流失败     | workflowId, error                    |

## 报告输出结构

### 部门报告 (DepartmentReportRecord)

- 经理 ID/名称/部门
- 部门汇总文本
- 任务统计（数量、平均分、通过率）
- 落盘路径：`data/agents/<managerId>/reports/`

### 最终综合报告 (FinalWorkflowReportRecord)

- 工作流元数据（指令、状态、时间）
- 全局统计（消息数、任务数、通过数、平均分）
- 各部门报告摘要
- CEO 反馈文本
- 关键问题清单
- 所有任务明细
- 落盘路径：`data/agents/<ceoId>/reports/`
