# Workflow 寄生依赖盘点

> 本文件记录 Mission/tasks 代码对 Workflow 数据结构的所有依赖点。
> 第 1–8 节覆盖 tasks-store.ts（任务 1.1），第 9 节覆盖组件引用（任务 1.2）。
> 任务 1.3（shared/mission 类型交叉）将在后续补充。

## 1. Import 依赖

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| tasks-store.ts | 5–6 | import type | `WorkflowOrganizationNode`, `WorkflowOrganizationSnapshot` (from `@shared/organization-schema`) | 组织快照：部门列表、agent 节点、taskProfile | `MissionOrganizationSnapshot`（精简版，仅 departments + agentCount） |
| tasks-store.ts | 18–19 | import | `normalizeWorkflowAttachments`, `WorkflowInputAttachment` (from `@shared/workflow-input`) | 附件列表规范化，渲染附件 artifact | `MissionRecord.artifacts` 直接提供附件数据 |
| tasks-store.ts | 37–38 | import type | `WorkflowInfo` (from `./runtime/types`) | 工作流状态、阶段、结果等核心数据 | `MissionRecord` 丰富化字段（status, stages, organization, workPackages 等） |
| tasks-store.ts | 40 | import | `useWorkflowStore` (from `./workflow-store`) | 获取 workflow store 状态：workflows, agents, stages, eventLog, tasks, messages | 全部从 `MissionRecord` 原生字段 + `mission_event` Socket 获取 |

## 2. 本地类型定义（基于 Workflow 类型）

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| tasks-store.ts | 42–45 | type alias | `WorkflowTaskRecord` (extends `TaskInfo`) | 工作包记录：status, deliverable, score, verify_result | `MissionWorkPackage` |
| tasks-store.ts | 47–49 | type alias | `WorkflowMessageRecord` (extends `MessageInfo`) | 消息记录：content, metadata | `MissionMessageLogEntry` |
| tasks-store.ts | 51–55 | type alias | `WorkflowEventLogItem` | 事件日志：type, data, timestamp | `MissionEvent`（已原生） |
| tasks-store.ts | 57–97 | type alias | `WorkflowReportRecord` | 报告记录：stats, ceoFeedback, departmentReports | `MissionRecord.artifacts` + 丰富化字段 |
| tasks-store.ts | 99–108 | type alias | `WorkflowDetailRecord` | 工作流详情聚合：workflow, tasks, messages, report | 不再需要，由 `MissionRecord` 丰富化字段替代 |
| tasks-store.ts | 110–112 | type alias | `WorkflowDetailWithWorkflow` | 带非空 workflow 的详情记录 | 不再需要 |
| tasks-store.ts | 1627–1630 | type alias | `MissionWorkflowSupplement` | Mission 与 Workflow 的补充映射 | 不再需要，Mission 数据自包含 |

## 3. 接口字段中的 Workflow 类型引用

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| tasks-store.ts | 136 | 字段类型 | `MissionTaskSummary.workflowStatus: WorkflowInfo["status"]` | 卡片上显示 workflow 状态标签 | `MissionRecord.status` 直接映射 |
| tasks-store.ts | 218 | 字段类型 | `MissionTaskDetail.workflow: WorkflowInfo` | 详情页 workflow 元数据 | 不再需要独立 workflow 字段，从 MissionRecord 派生 |
| tasks-store.ts | 219 | 字段类型 | `MissionTaskDetail.tasks: WorkflowTaskRecord[]` | 详情页工作包列表 | `MissionRecord.workPackages` |
| tasks-store.ts | 220 | 字段类型 | `MissionTaskDetail.messages: WorkflowMessageRecord[]` | 详情页消息列表 | `MissionRecord.messageLog` |
| tasks-store.ts | 221 | 字段类型 | `MissionTaskDetail.report: WorkflowReportRecord \| null` | 详情页报告展示 | `MissionRecord.artifacts` 中的报告类 artifact |
| tasks-store.ts | 222 | 字段类型 | `MissionTaskDetail.organization: WorkflowOrganizationSnapshot \| null` | 详情页组织结构展示 | `MissionRecord.organization` (MissionOrganizationSnapshot) |

## 4. Workflow 数据读取函数（核心寄生函数）

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| tasks-store.ts | 356–365 | 函数 | `getOrganizationSnapshot(workflow)` — 从 `workflow.results.organization` 提取 | 获取组织快照用于部门标签、agent 角色 | `MissionRecord.organization` 直接读取 |
| tasks-store.ts | 368–379 | 函数 | `normalizeDetailReport(workflow, detail)` — 从 detail.report 或 workflow.results.final_report 提取 | 报告数据规范化 | `MissionRecord.artifacts` 中的报告 |
| tasks-store.ts | 382–392 | 函数 | `getAttachmentCount(workflow, report)` — 从 workflow.results.input.attachments 计数 | 附件计数显示 | `MissionRecord.artifacts.length` |
| tasks-store.ts | 395–405 | 函数 | `inferTaskKind(workflow, organization)` — 从 organization.taskProfile 推断 | 任务类型标签 | `MissionRecord.kind` 直接读取 |
| tasks-store.ts | 408–427 | 函数 | `inferMissionStatus(workflow, tasks)` — 从 workflow.status + tasks 状态推断 | 任务状态推断 | `MissionRecord.status` 直接读取 |
| tasks-store.ts | 429–464 | 函数 | `computeWorkflowProgress(workflow, tasks, stageCatalog)` — 从 tasks 完成比例计算 | 进度条百分比 | `MissionRecord.progress` 直接读取 |
| tasks-store.ts | 466–494 | 函数 | `buildWaitingFor(workflow, tasks, stageCatalog)` — 从 workflow 阶段 + tasks 状态推断 | "等待中" 提示文本 | `MissionRecord.waitingFor` 直接读取 |
| tasks-store.ts | 496–510 | 函数 | `extractIssueMessages(workflow)` — 从 workflow.results.workflow_issues 提取 | 问题/警告列表 | `MissionRecord` events 中 level=error 的事件 |
| tasks-store.ts | 513–552 | 函数 | `buildFailureReasons(workflow, tasks, report)` — 从 workflow + tasks + report 聚合失败原因 | 失败原因列表 | `missionFailureReasons(mission, events)` 已原生 |
| tasks-store.ts | 554–563 | 函数 | `getTaskPreview(task)` — 从 WorkflowTaskRecord 提取预览文本 | 工作包预览 | `MissionWorkPackage.description` |
| tasks-store.ts | 566–614 | 函数 | `buildSummary(workflow, tasks, report, ...)` — 从 workflow 数据构建摘要文本 | 任务卡片摘要 | `missionSummaryText(mission, events)` 已原生 |
| tasks-store.ts | 616–656 | 函数 | `getWorkflowUpdatedAt(workflow, detail, events)` — 从 workflow 时间戳取最新 | 更新时间显示 | `MissionRecord.updatedAt` |
| tasks-store.ts | 644–655 | 函数 | `getActiveAgentCount(organization, agents)` — 从 organization nodes + agents 计数 | 活跃 agent 计数 | `MissionRecord.agentCrew.filter(working/thinking).length` |
| tasks-store.ts | 659–806 | 函数 | `buildSummaryRecord(workflow, detail, agents, stageCatalog, eventLog)` — workflow-only summary 构建 | 纯 workflow 模式的 summary 构建 | `buildNativeSummaryRecord(mission)` |
| tasks-store.ts | 808–818 | 函数 | `workflowEventsFor(workflowId, eventLog)` — 从 eventLog 过滤特定 workflow 事件 | 事件过滤 | `MissionEvent[]` 已原生 |
| tasks-store.ts | 820–826 | 函数 | `taskStageKey(task)` / `taskProgressValue(task)` — 从 WorkflowTaskRecord 推断阶段和进度 | 工作包阶段映射 | `MissionWorkPackage.stageKey` / `MissionWorkPackage.status` |
| tasks-store.ts | 833–835 | 函数 | `workflowResultRecord(workflow)` — 从 workflow.results 提取 | 通用结果字段访问 | 不再需要 |
| tasks-store.ts | 838–864 | 函数 | `reportPath(report, key)` — 从 WorkflowReportRecord 提取路径 | 报告下载链接 | `MissionRecord.artifacts` 中的路径 |
| tasks-store.ts | 868–885 | 函数 | `getDepartmentReports(workflow, report)` — 从 report.departmentReports 提取 | 部门报告列表 | `MissionRecord.artifacts` 中 kind=department_report |
| tasks-store.ts | 888–903 | 函数 | `getWorkflowAttachments(workflow, report)` — 从 workflow.results.input + report 提取附件 | 附件列表 | `MissionRecord.artifacts` 中 kind=attachment |
| tasks-store.ts | 905–948 | 函数 | `nodeForAgent` / `syntheticAgentFor` / `resolveAgentTitle` / `resolveAgentDepartmentLabel` — 从 organization 解析 agent 信息 | agent 名称、部门、角色显示 | `MissionAgentCrewMember` 直接提供 |
| tasks-store.ts | 952–1013 | 函数 | `inferAgentStageKey(agent, workflow, organization, tasks)` — 从 workflow 阶段 + tasks 推断 agent 所在阶段 | agent 在哪个阶段工作 | `MissionRecord.currentStageKey` + `MissionAgentCrewMember.status` |
| tasks-store.ts | 987–1000 | 函数 | `inferAgentProgress(agent, tasks, summary)` — 从 tasks 推断 agent 进度 | agent 进度条 | `MissionWorkPackage` 按 worker 过滤计算 |
| tasks-store.ts | 1003–1013 | 函数 | `latestMessageForAgent(agentId, messages)` — 从 WorkflowMessageRecord[] 查找 | agent 最新消息 | `MissionMessageLogEntry[]` 按 sender 过滤 |
| tasks-store.ts | 1016–1083 | 函数 | `buildInteriorStages(workflow, tasks, stageCatalog)` — 从 workflow 阶段 + tasks 构建环形图 | 阶段环形图 | `buildMissionInteriorStages(mission)` 已原生 |
| tasks-store.ts | 1085–1165 | 函数 | `buildInteriorAgents(summary, workflow, detail, agents, organization, stageCatalog)` — 从 workflow agents + organization 构建 | agent 列表 | `buildNativeInteriorAgents(mission)` 从 agentCrew 构建 |
| tasks-store.ts | 1167–1324 | 函数 | `buildTimeline(workflow, detail, stageCatalog, eventLog, agents)` — 从 workflow 事件构建时间线 | 时间线面板 | `buildMissionTimeline(mission, events)` 已原生 |
| tasks-store.ts | 1326–1485 | 函数 | `buildArtifacts(workflow, report)` — 从 workflow report 构建 artifact 列表 | 产出物列表 | `buildMissionArtifacts(mission)` 已原生 |
| tasks-store.ts | 1487–1543 | 函数 | `buildInstanceInfo(summary, workflow, organization)` — 从 workflow 构建实例信息 | 实例信息面板 | `buildMissionInstanceInfo(summary, mission)` 已原生 |
| tasks-store.ts | 1545–1580 | 函数 | `buildLogSummary(workflow, detail, workflowEvents)` — 从 workflow 事件/消息构建日志摘要 | 日志摘要面板 | `buildNativeLogSummary(mission)` 从 messageLog 构建 |
| tasks-store.ts | 1582–1625 | 函数 | `buildDetailRecord(summary, workflow, detail, agents, stageCatalog, eventLog)` — workflow-only detail 构建 | 纯 workflow 模式的 detail 构建 | `buildNativeDetailRecord(mission)` |

## 5. Workflow 桥接/补充函数

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| tasks-store.ts | 1643–1648 | 函数 | `workflowStatusFromMission(status)` — 将 MissionTaskStatus 映射为 `WorkflowInfo["status"]` | 为 syntheticWorkflow 生成 status | 不再需要，MissionRecord.status 直接使用 |
| tasks-store.ts | 1707–1732 | 函数 | `syntheticWorkflowFromMission(mission)` — 从 MissionRecord 构造虚拟 WorkflowInfo | 当无真实 workflow 时提供兼容数据 | 不再需要，直接读 MissionRecord |
| tasks-store.ts | 1733–1752 | 函数 | `findSupplementalWorkflow(mission, workflows)` — 按 id/directive 匹配 Mission 对应的 Workflow | 建立 Mission→Workflow 映射 | 不再需要，Mission 数据自包含 |
| tasks-store.ts | 2363–2413 | 函数 | `loadWorkflowDetailRecord(workflowId, runtimeMode)` — 从 `/api/workflows/:id` 或 localRuntime 加载 | 加载 workflow 详情数据 | 不再需要，MissionRecord 丰富化字段替代 |
| tasks-store.ts | 2437–2490 | 函数 | `loadMissionSupplementMap(missions, workflows, runtimeMode)` — 批量加载 Mission→Workflow 补充映射 | 为每个 mission 加载对应 workflow 详情 | 不再需要 |
| tasks-store.ts | 2223–2303 | 函数 | `buildMissionSummaryRecord(mission, supplement, ...)` — 混合 Mission + Workflow 数据构建 summary | Mission-first 模式的 summary 构建（仍依赖 supplement） | `buildNativeSummaryRecord(mission)` 纯 Mission 数据 |
| tasks-store.ts | 2305–2361 | 函数 | `buildMissionDetailRecord(summary, mission, supplement, ...)` — 混合 Mission + Workflow 数据构建 detail | Mission-first 模式的 detail 构建（仍依赖 supplement） | `buildNativeDetailRecord(mission)` 纯 Mission 数据 |

## 6. useWorkflowStore 直接调用点

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| tasks-store.ts | 2394 | store 调用 | `useWorkflowStore.getState()` — loadWorkflowDetailRecord 失败时回退读取 currentWorkflow, tasks, messages | 错误恢复：从 workflow store 缓存读取 | 不再需要，MissionRecord 丰富化字段替代 |
| tasks-store.ts | 2505–2508 | store 调用 | `useWorkflowStore.getState().initSocket()` — patchMissionRecordInStore 中初始化 workflow socket | 确保 workflow socket 连接 | 不再需要 |
| tasks-store.ts | 2516 | store 调用 | `useWorkflowStore.getState()` — patchMissionRecordInStore 中读取 workflows, agents, stages | 获取 workflow 列表用于 supplement 映射 | 不再需要 |
| tasks-store.ts | 2628–2635 | store 订阅 | `useWorkflowStore.subscribe(...)` — 监听 eventLog / connected 变化触发 refresh | 当 workflow 事件日志变化时刷新任务列表 | `mission_event` Socket 已覆盖实时更新 |
| tasks-store.ts | 2658–2661 | store 调用 | `useWorkflowStore.getState().initSocket()` — hydrateWorkflowTaskData 中初始化 | workflow-only 模式初始化 | 不再需要（workflow-only 模式将被移除） |
| tasks-store.ts | 2669 | store 调用 | `useWorkflowStore.getState()` — hydrateWorkflowTaskData 中读取 stages, agents, workflows, eventLog | workflow-only 模式数据加载 | 不再需要 |
| tasks-store.ts | 2751–2754 | store 调用 | `useWorkflowStore.getState().initSocket()` — hydrateMissionTaskData 中初始化 | Mission-first 模式仍需 workflow socket | 不再需要 |
| tasks-store.ts | 2764 | store 调用 | `useWorkflowStore.getState()` — hydrateMissionTaskData 中读取 workflows, agents, stages | Mission-first 模式仍需 workflow 数据做 supplement | 不再需要 |
| tasks-store.ts | 3032–3036 | store 调用 | `useWorkflowStore.getState().submitDirective(...)` — launchDecision 中发起新 workflow | 决策操作：通过 workflow 引擎发起新任务 | 通过 `createMission` API 发起，或保留为独立 workflow 操作 |

## 7. Workflow 事件类型引用（非 Socket 监听，而是事件类型字符串）

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| tasks-store.ts | 497–498 | 数据字段 | `workflow.results.workflow_issues` | 提取工作流问题列表 | `MissionEvent` 中 level=error 的事件 |
| tasks-store.ts | 1159 | 事件类型 | `"workflow_error"` — timelineLevelForEvent 中判断 | 时间线事件级别映射 | `MissionEvent.level === "error"` |
| tasks-store.ts | 1160 | 事件类型 | `"workflow_complete"` — timelineLevelForEvent 中判断 | 时间线事件级别映射 | `MissionEvent.type === "completed"` |
| tasks-store.ts | 1180 | 事件类型 | `"workflow_created"` — buildTimeline 中构造 | 时间线"创建"事件 | `MissionEvent.type === "created"` |
| tasks-store.ts | 1192 | 事件类型 | `"workflow_started"` — buildTimeline 中构造 | 时间线"启动"事件 | `MissionEvent.type === "started"` |
| tasks-store.ts | 1257 | 事件类型 | `"workflow_complete"` — buildTimeline 中判断 | 时间线"完成"事件 | `MissionEvent.type === "completed"` |
| tasks-store.ts | 1271 | 事件类型 | `"workflow_error"` — buildTimeline 中判断 | 时间线"错误"事件 | `MissionEvent.type === "failed"` |
| tasks-store.ts | 1303 | 事件类型 | `"workflow_closed"` — buildTimeline 中构造 | 时间线"关闭"事件 | `MissionEvent.type === "completed"` |

> **注意**: tasks-store.ts 中没有直接的 `socket.on("workflow_*")` 监听。Workflow Socket 事件由 `workflow-store.ts` 管理，tasks-store 通过 `useWorkflowStore.subscribe()` (行 2628) 间接响应 workflow 事件变化。这是一种间接的 workflow 事件依赖。

## 8. 统计摘要

| 类别 | 数量 |
|------|------|
| Import 语句 | 4 条（workflow-store, WorkflowInfo, WorkflowOrganizationSnapshot/Node, WorkflowInputAttachment） |
| 本地 Workflow 类型定义 | 7 个（WorkflowTaskRecord, WorkflowMessageRecord, WorkflowEventLogItem, WorkflowReportRecord, WorkflowDetailRecord, WorkflowDetailWithWorkflow, MissionWorkflowSupplement） |
| 接口字段引用 Workflow 类型 | 6 处（MissionTaskSummary.workflowStatus, MissionTaskDetail 的 workflow/tasks/messages/report/organization） |
| Workflow 数据读取函数 | 30+ 个（从 getOrganizationSnapshot 到 buildDetailRecord） |
| useWorkflowStore 直接调用 | 9 处（getState × 7, subscribe × 1, submitDirective × 1） |
| Workflow 事件类型字符串 | 7 处（workflow_error, workflow_complete, workflow_created, workflow_started, workflow_closed） |
| **总依赖点** | **~56 处** |


## 9. 组件引用（client/src/components/tasks/）

> 审查范围：TaskDetailView.tsx、TaskPlanetInterior.tsx、task-helpers.ts 以及同目录下其他文件。

### 9.1 TaskDetailView.tsx

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| TaskDetailView.tsx | 13 | import（图标） | `Workflow` (from `lucide-react`) | 作为 Work Packages 卡片标题的图标 | 保留不变——这是 lucide 图标组件，与 workflow 数据无关 |
| TaskDetailView.tsx | 58 | import | `useWorkflowStore` (from `@/lib/workflow-store`) | 获取 `downloadWorkflowReport` 和 `downloadDepartmentReport` 方法 | 迁移为 Mission 原生的报告下载 API（如 `/api/missions/:id/report`），或保留为独立 workflow 下载工具函数 |
| TaskDetailView.tsx | 480–481 | store 调用 | `useWorkflowStore(state => state.downloadWorkflowReport)` | 下载 workflow 报告（JSON/MD 格式） | Mission 原生报告下载函数，从 `MissionRecord.artifacts` 获取下载链接 |
| TaskDetailView.tsx | 483–485 | store 调用 | `useWorkflowStore(state => state.downloadDepartmentReport)` | 下载部门报告（按 managerId + format） | Mission 原生部门报告下载函数，从 `MissionRecord.artifacts` 中 kind=department_report 获取 |
| TaskDetailView.tsx | 544 | 数据字段 | `artifact.workflowId`（guard 判断） | 判断 artifact 是否有关联 workflow，无则跳过下载 | 改为判断 `artifact.downloadKind` 或 `artifact.href` 是否存在，不再依赖 workflowId |
| TaskDetailView.tsx | 554 | 数据字段 | `artifact.workflowId`（传参） | 作为 `downloadDepartmentReport(workflowId, managerId, format)` 的第一个参数 | 改为 Mission 原生下载 API，使用 missionId + artifactId |
| TaskDetailView.tsx | 561 | 数据字段 | `artifact.workflowId`（传参） | 作为 `downloadWorkflowReport(workflowId, format)` 的第一个参数 | 改为 Mission 原生下载 API，使用 missionId + artifactId |
| TaskDetailView.tsx | 984 | 数据字段 | `artifact.workflowId`（disabled 判断） | 当 artifact 无 workflowId 且非 attachment/external 时禁用下载按钮 | 改为基于 `artifact.href` 或 `artifact.downloadKind` 判断 |
| TaskDetailView.tsx | 624 | UI 文本 | `<Workflow />` 图标组件 | Work Packages 卡片标题图标 | 保留不变——纯 UI 图标 |
| TaskDetailView.tsx | 746 | UI 文本 | `"The workflow has not emitted work packages yet."` | 空状态提示文本 | 改为 `"No work packages have been emitted yet."` 移除 workflow 措辞 |
| TaskDetailView.tsx | 761 | UI 文本 | `"Workflow events, task transitions, and the latest coordination messages."` | Timeline 卡片描述 | 改为 `"Mission events, task transitions, and the latest coordination messages."` |
| TaskDetailView.tsx | 928 | UI 文本 | `"Workflow reports, department summaries, and captured input attachments."` | Artifacts 卡片描述 | 改为 `"Mission reports, department summaries, and captured input attachments."` |
| TaskDetailView.tsx | 1001 | UI 文本 | `"No artifacts are linked to this workflow yet."` | Artifacts 空状态提示 | 改为 `"No artifacts are linked to this mission yet."` |

### 9.2 TaskPlanetInterior.tsx

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| TaskPlanetInterior.tsx | — | 无依赖 | — | — | — |

> TaskPlanetInterior.tsx 不包含任何 workflow 数据源引用。它仅从 `MissionTaskDetail`（tasks-store 导出的类型）读取 `stages`、`agents`、`progress` 等字段，这些字段已由 tasks-store 的构建函数预处理。该组件是纯展示组件，无需修改。

### 9.3 task-helpers.ts

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| task-helpers.ts | 122 | 数据字段 | `artifact.workflowId`（guard 判断） | `artifactActionLabel()` 中：当 artifact 无 workflowId 时返回 "View metadata" 而非下载标签 | 改为基于 `artifact.downloadKind` 或 `artifact.href` 判断，不再依赖 workflowId |

### 9.4 同目录其他文件

> 对 `client/src/components/tasks/` 下其余文件（CompactPlanetInterior.tsx、CreateMissionDialog.tsx、index.ts、mission-island-helpers.ts、MissionDetailOverlay.tsx、MissionMiniView.tsx）执行 grep 搜索，未发现任何 workflow 相关引用。

### 9.5 组件引用统计

| 类别 | 数量 | 涉及文件 |
|------|------|----------|
| workflow-store import | 1 处 | TaskDetailView.tsx |
| useWorkflowStore 调用 | 2 处（downloadWorkflowReport, downloadDepartmentReport） | TaskDetailView.tsx |
| artifact.workflowId 数据字段访问 | 5 处（guard × 2, 传参 × 2, disabled × 1） | TaskDetailView.tsx (4), task-helpers.ts (1) |
| workflow 措辞 UI 文本 | 4 处 | TaskDetailView.tsx |
| lucide Workflow 图标（非数据依赖） | 1 处 | TaskDetailView.tsx |
| **总依赖点（不含图标和 UI 文本）** | **8 处** | TaskDetailView.tsx (7), task-helpers.ts (1) |

> **关键发现**: 组件层的 workflow 依赖集中在 TaskDetailView.tsx 的报告下载功能。核心问题是 `downloadWorkflowReport` / `downloadDepartmentReport` 通过 `useWorkflowStore` 调用，需要 `workflowId` 作为参数。解耦后需要提供 Mission 原生的报告下载 API，使用 missionId + artifactId 替代 workflowId。TaskPlanetInterior.tsx 和 task-helpers.ts 本身不直接依赖 workflow-store，task-helpers.ts 仅通过 `TaskArtifact.workflowId` 字段间接依赖。


## 10. 类型交叉（shared/mission/）

> 审查范围：`shared/mission/` 目录下全部 6 个文件（api.ts、contracts.ts、enrichment.ts、index.ts、socket.ts、topic.ts）。

| 文件 | 行号 | 依赖类型 | 访问的数据字段 | UI 用途 | Mission 原生替代 |
|------|------|----------|---------------|---------|-----------------|
| enrichment.ts | 11 | import type | `AgentRole` (from `../workflow-runtime.js`) | 为 `MissionAgentCrewMember.role` 字段提供类型定义（`"ceo" \| "manager" \| "worker"`） | 在 `shared/mission/enrichment.ts` 中自行定义 `type MissionAgentRole = "ceo" \| "manager" \| "worker"`，断开对 workflow-runtime 的 import |
| enrichment.ts | 41 | 类型使用 | `MissionAgentCrewMember.role: AgentRole` | Agent 角色标签显示（CEO / Manager / Worker） | 将字段类型改为 `MissionAgentRole`（值域相同，仅断开 import 链） |

### 10.1 其他文件审查结果

| 文件 | 结果 |
|------|------|
| contracts.ts | 无 workflow-runtime / workflow-kernel 依赖 |
| api.ts | 无 workflow-runtime / workflow-kernel 依赖 |
| socket.ts | 无 workflow-runtime / workflow-kernel 依赖 |
| topic.ts | 无 workflow-runtime / workflow-kernel 依赖 |
| index.ts | 无 workflow-runtime / workflow-kernel 依赖（且未 re-export enrichment.ts） |

### 10.2 统计

| 类别 | 数量 |
|------|------|
| workflow-runtime import | 1 处（enrichment.ts 行 11） |
| workflow-kernel import | 0 处 |
| 类型使用点 | 1 处（enrichment.ts 行 41，`MissionAgentCrewMember.role`） |
| **总依赖点** | **2 处**（1 个 import + 1 个类型使用） |

> **关键发现**: `shared/mission/` 对 workflow 的依赖非常轻量，仅 `enrichment.ts` 通过 `import type { AgentRole } from "../workflow-runtime.js"` 引入了 `AgentRole` 类型联合（`"ceo" | "manager" | "worker"`）。解耦方案简单：在 enrichment.ts 中内联定义等价的 `MissionAgentRole` 类型，删除 workflow-runtime import 即可。其余 5 个文件（contracts.ts、api.ts、socket.ts、topic.ts、index.ts）均无任何 workflow 依赖。
