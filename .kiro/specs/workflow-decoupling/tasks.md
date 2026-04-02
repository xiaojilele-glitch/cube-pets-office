# 实现计划：Workflow 寄生依赖解耦

## 概述

按盘点 → 数据补齐 → 前端切换 → 清除的顺序递增实现。每个阶段完成后通过测试验证，确保后续阶段可以依赖前一阶段的正确性。使用 TypeScript 实现，复用项目现有的 vitest + fast-check 测试框架。

## 任务

- [x] 1. 寄生依赖盘点
  - [x] 1.1 审查 `client/src/lib/tasks-store.ts`，记录所有对 workflow-store 的 import 语句、对 WorkflowRecord/WorkflowInfo/WorkflowDetailRecord 类型的使用、对 workflow_* Socket 事件的监听，输出到 `.kiro/specs/workflow-decoupling/inventory.md`
    - 使用 grep 辅助搜索 `workflow-store`、`WorkflowRecord`、`WorkflowInfo`、`workflow_` 关键词
    - 记录每个依赖点的文件、行号、数据字段、UI 用途、Mission 原生替代方案
    - _需求: 1.1, 1.3, 1.5, 1.6_
  - [x] 1.2 审查 `client/src/components/tasks/` 目录（TaskDetailView.tsx、TaskPlanetInterior.tsx、task-helpers.ts），记录所有 workflow 数据源引用
    - _需求: 1.2, 1.5_
  - [x] 1.3 审查 `shared/mission/` 目录，记录所有对 `shared/workflow-runtime.ts` 或 `shared/workflow-kernel.ts` 的 import 或类型依赖
    - _需求: 1.4, 1.5_

- [x] 2. 检查点 - 盘点完成
  - 确保 inventory.md 已完成且覆盖所有依赖类别，如有疑问请询问用户。

- [x] 3. MissionRecord 扩展类型定义
  - [x] 3.1 在 `shared/mission/contracts.ts` 中新增 `MissionOrganizationSnapshot`、`MissionWorkPackage`、`MissionMessageLogEntry`、`MissionAgentCrewMember` 接口定义，并在 `MissionRecord` 接口中添加四个可选字段：`organization?`、`workPackages?`、`messageLog?`、`agentCrew?`
    - 所有新字段必须为 optional，确保向后兼容
    - MissionOrganizationSnapshot 是 WorkflowOrganizationSnapshot 的精简版（departments + agentCount）
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.7_
  - [ ]* 3.2 编写 MissionRecord 丰富化字段向后兼容属性测试
    - **Property 1: MissionRecord 丰富化字段向后兼容**
    - **验证: 需求 2.1, 2.2, 2.3, 2.4, 2.7**

- [x] 4. MissionOrchestrator 丰富化钩子
  - [x] 4.1 在 `server/core/mission-orchestrator.ts` 中实现 `enrichMissionFromWorkflow(missionId, workflowId, completedStage)` 私有方法，包含 `extractOrganization`、`extractAgentCrew`、`extractWorkPackages`、`extractMessageLog` 四个提取函数
    - planning/direction 阶段完成后填充 organization 和 agentCrew
    - execution/review/revision/verify 阶段完成后填充 workPackages
    - 每个阶段完成后更新 messageLog（最近 50 条）
    - _需求: 2.5_
  - [x] 4.2 在 MissionOrchestrator 的工作流阶段完成回调中调用 `enrichMissionFromWorkflow()`，确保 MissionStore.update() 触发 Socket 广播包含丰富化字段
    - _需求: 2.5, 2.6_
  - [ ]* 4.3 编写阶段完成丰富化完整性属性测试
    - **Property 2: 阶段完成丰富化完整性**
    - **验证: 需求 2.5, 2.6**
  - [ ]* 4.4 编写丰富化钩子单元测试：extractOrganization 转换正确性、extractWorkPackages 转换正确性、workflow 不存在时安全跳过
    - _需求: 2.5_

- [x] 5. 检查点 - 数据补齐完成
  - 确保所有测试通过，MissionRecord 丰富化字段在工作流执行时正确填充，如有疑问请询问用户。

- [x] 6. tasks-store 原生构建函数
  - [x] 6.1 在 `client/src/lib/tasks-store.ts` 顶部添加 `const useMissionNativeData = false` 特性开关常量
    - _需求: 3.1, 3.6_
  - [x] 6.2 实现 `buildNativeSummaryRecord(mission: MissionRecord): MissionTaskSummary` 函数，从 MissionRecord 的 organization、workPackages、messageLog、agentCrew 字段派生所有 summary 字段，不引用 workflow-store
    - departmentLabels 从 organization.departments 派生
    - taskCount 从 workPackages.length 派生
    - completedTaskCount 从 workPackages.filter(passed/verified) 派生
    - messageCount 从 messageLog.length 派生
    - activeAgentCount 从 agentCrew.filter(working/thinking) 派生
    - 所有丰富化字段为 undefined 时使用默认值（空数组、0）
    - _需求: 3.2_
  - [ ]* 6.3 编写原生 Summary 构建完整性属性测试
    - **Property 3: 原生 Summary 构建完整性**
    - **验证: 需求 3.2**
  - [x] 6.4 实现 `buildNativeDetailRecord(mission: MissionRecord): MissionTaskDetail` 函数，从 MissionRecord 派生所有 detail 字段，包括 `buildNativeInteriorAgents()`（从 agentCrew 构建）和 `buildNativeLogSummary()`（从 messageLog 构建）
    - agents 从 agentCrew 构建，始终包含 mission-core agent
    - logSummary 从 messageLog 最近 10 条构建
    - _需求: 3.3_
  - [ ]* 6.5 编写原生 Detail 构建完整性属性测试
    - **Property 4: 原生 Detail 构建完整性**
    - **验证: 需求 3.3**

- [x] 7. tasks-store 数据源切换
  - [x] 7.1 实现 `hydrateNativeTaskData()` 函数，使用 listMissions() + buildNativeSummaryRecord/buildNativeDetailRecord 构建任务数据，不调用 workflow-store
    - _需求: 3.2, 3.3, 3.4_
  - [x] 7.2 修改 `hydrateTaskData()` 函数，根据 `useMissionNativeData` 开关分支调用 `hydrateNativeTaskData()` 或现有逻辑（重命名为 `hydrateTaskDataLegacy()`）
    - _需求: 3.1, 3.5_
  - [x] 7.3 修改 `ensureMissionSocket()` 函数，当 `useMissionNativeData` 为 true 时不注册 workflow_* Socket 事件监听
    - _需求: 3.4_
  - [ ]* 7.4 编写数据源等价性属性测试
    - **Property 5: 数据源等价性**
    - **验证: 需求 3.7**

- [x] 8. 检查点 - 前端切换完成
  - 将 `useMissionNativeData` 翻转为 true，确保所有测试通过，UI 渲染与翻转前等价，如有疑问请询问用户。

- [x] 9. 寄生代码清除
  - [x] 9.1 从 `client/src/lib/tasks-store.ts` 中删除 `import { useWorkflowStore } from "./workflow-store"` 及所有 workflow-store 引用
    - _需求: 4.1, 5.1_
  - [x] 9.2 删除 tasks-store.ts 中所有 workflow 补充层函数：`syntheticWorkflowFromMission()`、`findSupplementalWorkflow()`、`loadMissionSupplementMap()`、`loadWorkflowDetailRecord()`、`hydrateWorkflowTaskData()`、`buildSummaryRecord()`（workflow 版）、`buildDetailRecord()`（workflow 版）及相关类型定义（WorkflowDetailRecord、WorkflowTaskRecord、WorkflowMessageRecord 等）
    - _需求: 4.2_
  - [x] 9.3 删除 `useMissionNativeData` 常量，将 `buildNativeSummaryRecord` 重命名为 `buildSummaryRecord`，将 `buildNativeDetailRecord` 重命名为 `buildDetailRecord`，将 `hydrateNativeTaskData` 重命名为 `hydrateTaskData`
    - _需求: 4.3_
  - [x] 9.4 审查并清理 `client/src/components/tasks/` 目录中的 workflow_* Socket 事件引用（如有）
    - _需求: 4.4, 5.2_
  - [x] 9.5 审查并清理 `shared/mission/` 目录中对 `shared/workflow-runtime.ts` 或 `shared/workflow-kernel.ts` 的 import（如有）
    - _需求: 4.5, 5.3_

- [x] 10. 架构边界验证
  - [x] 10.1 运行 grep 验证：tasks-store.ts 中 "workflow-store" 零匹配、"WorkflowRecord" 零匹配、"WorkflowInfo" 零匹配
    - _需求: 5.1, 5.3_
  - [x] 10.2 运行 grep 验证：client/src/components/tasks/ 中 "workflow_" 事件名零匹配
    - _需求: 5.2_
  - [x] 10.3 验证 WorkflowPanel.tsx 和 workflow-store.ts 独立功能正常（不受解耦影响）
    - _需求: 5.4_
  - [x] 10.4 运行 `npm run check` 确保 TypeScript 类型检查通过，运行 server/tests/ 全部测试确保通过
    - _需求: 5.5_
  - [x] 10.5 更新 `.kiro/steering/project-overview.md`，移除"双轨并存"相关描述，反映清洁架构
    - _需求: 5.6_
  - [x] 10.6 验证 tasks-store.ts 文件行数较解耦前减少至少 30%
    - _需求: 4.6_

- [x] 11. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，架构边界验证全部通过，如有疑问请询问用户。

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP 开发
- 每个任务引用具体需求编号以确保可追溯性
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 本 spec 与 `mission-native-projection` spec 的需求 2（MissionRecord 数据丰富化）有重叠，实施时应协调避免重复工作
- 盘点阶段（任务 1）必须在任何代码变更之前完成
- 特性开关确保可安全回滚，验证通过后再执行清除阶段
