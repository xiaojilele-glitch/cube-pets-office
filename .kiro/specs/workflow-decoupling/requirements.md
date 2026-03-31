# 需求文档

## 简介

本特性系统性地解耦 Mission 任务域对 Workflow 数据结构的寄生依赖。当前 tasks-store.ts（2800+ 行）作为"mission-first + workflow 补充层"，从 workflow-store 读取 agent crew、work packages、stage details 等数据来渲染任务驾驶舱 UI。解耦目标是让 tasks-store 和 task 组件完全从 MissionRecord 原生数据获取所需信息，同时保留 Workflow 引擎（workflow-engine.ts、WorkflowPanel.tsx、workflow-store.ts）作为独立的十阶段执行引擎。

## 术语表

- **tasks-store**: 前端 Zustand 状态管理模块（client/src/lib/tasks-store.ts），负责合成任务驾驶舱 UI 所需的 MissionTaskSummary 和 MissionTaskDetail
- **workflow-store**: 前端 Zustand 状态管理模块（client/src/lib/workflow-store.ts），管理工作流面板 UI 状态
- **MissionRecord**: Mission 核心数据记录（shared/mission/contracts.ts），包含 status、progress、stages、events、artifacts 等字段
- **WorkflowRecord**: 工作流引擎详细记录（shared/workflow-runtime.ts），包含 tasks、messages、organization、report 等字段
- **WorkflowInfo**: workflow-store 中的工作流信息类型，包含 id、directive、status、stages 等字段
- **MissionOrchestrator**: 服务端 Mission 编排器（server/core/mission-orchestrator.ts），协调 Mission 执行流程
- **MissionStore**: 服务端 Mission 状态机（server/tasks/mission-store.ts），管理 MissionRecord 生命周期
- **WorkflowOrganizationSnapshot**: 动态组织快照（shared/organization-schema.ts），包含部门、角色、层级结构
- **MissionWorkPackage**: Mission 原生的工作包数据结构，包含 worker 分配、交付物、评分、反馈
- **MissionMessageLogEntry**: Mission 原生的消息日志条目，包含发送者、内容、时间戳、阶段
- **useMissionNativeData**: 特性开关常量，控制 tasks-store 使用 Mission 原生数据源还是 Workflow 补充层
- **mission_event**: Mission 域的 Socket.IO 事件名（shared/mission/socket.ts）
- **workflow_***: Workflow 域的 Socket.IO 事件前缀（workflow-store 监听的事件族）

## 需求

### 需求 1: Workflow 寄生依赖盘点

**用户故事:** 作为开发者，我希望精确盘点 Mission/tasks 代码对 Workflow 数据的每一个依赖点，以便系统性地规划解耦。

#### 验收标准

1. THE Inventory SHALL list every import statement in tasks-store.ts that references workflow-store or workflow-related types, with line numbers and the specific data fields being accessed
2. THE Inventory SHALL list every reference in TaskDetailView.tsx, TaskPlanetInterior.tsx, and task-helpers.ts that reads data from workflow sources (WorkflowRecord, WorkflowInfo, workflow-store)
3. THE Inventory SHALL list every Socket event listener in tasks-related code that listens to workflow_* events (as opposed to mission_event)
4. THE Inventory SHALL list every cross-reference in shared/mission/ types that imports from or depends on shared/workflow-runtime.ts or shared/workflow-kernel.ts types
5. FOR EACH dependency point, THE Inventory SHALL document: the file and line, what data field is being accessed, what the data is used for in the UI, and what the mission-native replacement would be
6. THE Inventory SHALL be stored as a markdown file at `.kiro/specs/workflow-decoupling/inventory.md`

### 需求 2: Mission 原生数据补齐

**用户故事:** 作为开发者，我希望 MissionRecord 包含任务驾驶舱 UI 所需的全部数据，以便不再需要 Workflow 补充数据。

#### 验收标准

1. THE MissionRecord SHALL include an optional `organization` field (WorkflowOrganizationSnapshot) that gets populated when the workflow engine generates the dynamic organization
2. THE MissionRecord SHALL include an optional `workPackages` field containing task-level detail (worker id, description, deliverable, scores, feedback, status) that gets populated during workflow execution
3. THE MissionRecord SHALL include an optional `messageLog` field containing recent message summaries (sender, content, timestamp, stage) that gets populated during workflow execution
4. THE MissionRecord SHALL include an optional `agentCrew` field containing the list of participating agents with their roles, departments, and current status
5. WHEN the workflow engine completes each stage, THE MissionOrchestrator SHALL update the corresponding MissionRecord with the latest data from that stage (organization after planning, work packages after execution, scores after review)
6. THE mission_event Socket payload SHALL be extended to include the enriched fields when they change, so the frontend receives real-time updates without polling
7. ALL new fields SHALL be optional (backward compatible) and SHALL NOT break the existing mission contract freeze (docs/mission-contract-freeze.md)

### 需求 3: 前端数据源切换

**用户故事:** 作为开发者，我希望通过特性开关将 tasks-store 从读取 Workflow 数据切换到读取 Mission 原生数据，以便安全回滚。

#### 验收标准

1. THE tasks-store SHALL introduce a feature flag `useMissionNativeData` (default: false initially, flipped to true after validation)
2. WHEN useMissionNativeData is true, THE tasks-store SHALL derive ALL MissionTaskSummary fields exclusively from MissionRecord, without reading from workflow-store
3. WHEN useMissionNativeData is true, THE tasks-store SHALL derive ALL MissionTaskDetail fields exclusively from MissionRecord and its enriched fields, without reading from workflow-store
4. WHEN useMissionNativeData is true, THE tasks-store SHALL NOT listen to any workflow_* Socket events for task-related data
5. WHEN useMissionNativeData is false, THE tasks-store SHALL continue using the existing workflow supplementary layer (backward compatible fallback)
6. THE feature flag SHALL be configurable via a constant in tasks-store.ts (not a runtime toggle), so it can be flipped in code review
7. FOR EACH data field that switches source, THE output SHALL be equivalent — the UI should render identically regardless of which data source is active

### 需求 4: 寄生代码清除

**用户故事:** 作为开发者，我希望在迁移验证完成后移除 tasks-store 中所有 Workflow 补充层代码。

#### 验收标准

1. AFTER useMissionNativeData is permanently set to true, THE tasks-store SHALL remove all imports from workflow-store
2. THE tasks-store SHALL remove all workflow supplementary layer functions (any function that reads from WorkflowRecord or WorkflowInfo to populate mission UI fields)
3. THE tasks-store SHALL remove the useMissionNativeData feature flag itself
4. THE tasks-related components SHALL NOT contain any references to workflow_* Socket events
5. THE shared/mission/ types SHALL NOT import from shared/workflow-runtime.ts or shared/workflow-kernel.ts (mission types should be self-contained)
6. AFTER cleanup, THE tasks-store.ts file size SHALL be reduced by at least 30% from its current 2800+ lines

### 需求 5: 架构边界验证

**用户故事:** 作为开发者，我希望验证解耦完成且架构边界清晰。

#### 验收标准

1. WHEN grep is run for "workflow-store" in tasks-store.ts, THE result SHALL return zero matches
2. WHEN grep is run for "workflow_" event names in client/src/components/tasks/, THE result SHALL return zero matches
3. WHEN grep is run for "WorkflowRecord" or "WorkflowInfo" in client/src/lib/tasks-store.ts, THE result SHALL return zero matches
4. THE WorkflowPanel.tsx and workflow-store.ts SHALL continue to function independently for the workflow view (they are NOT being removed)
5. ALL existing tests in server/tests/ SHALL continue to pass
6. THE project-overview.md steering file SHALL be updated to remove "双轨并存" descriptions and reflect the clean architecture
