<!--
 * @Author: wangchunji
 * @Date: 2026-04-02 10:22:38
 * @Description: 
 * @LastEditTime: 2026-04-02 15:24:38
 * @LastEditors: wangchunji
-->
# Human-in-the-Loop (HITL) 决策系统 — 任务列表

## 任务

- [x] 1. 共享契约层扩展
  - [x] 1.1 在 `shared/mission/contracts.ts` 中新增 `DECISION_TYPES` 常量数组和 `DecisionType` 类型
  - [x] 1.2 扩展 `MissionDecisionOption` 接口，新增 `action?: DecisionType`、`severity?: 'info' | 'warn' | 'danger'`、`requiresComment?: boolean` 字段
  - [x] 1.3 扩展 `MissionDecision` 接口，新增 `type?: DecisionType`、`templateId?: string`、`payload?: Record<string, unknown>`、`decisionId?: string` 字段
  - [x] 1.4 新增 `DecisionHistoryEntry` 接口（decisionId、type、prompt、options、templateId、payload、resolved、submittedBy、submittedAt、reason、stageKey）
  - [x] 1.5 扩展 `MissionRecord` 接口，新增 `decisionHistory?: DecisionHistoryEntry[]` 字段
  - [x] 1.6 在 `shared/mission/index.ts` 中导出新增类型

- [x] 2. 决策模板
  - [x] 2.1 新增 `shared/mission/decision-templates.ts`，定义 `DecisionTemplate` 接口
  - [x] 2.2 实现 3 个内置模板：`execution-plan-approval`、`stage-gate`、`risk-confirmation`
  - [x] 2.3 在 `shared/mission/api.ts` 中新增 `listDecisionTemplates` 路由常量和 `ListDecisionTemplatesResponse` 类型
  - [x] 2.4 在 `shared/mission/index.ts` 中导出决策模板模块

- [x] 3. Socket 事件扩展
  - [x] 3.1 在 `shared/mission/socket.ts` 中新增 `decisionSubmitted: 'mission.decision.submitted'` 事件类型
  - [x] 3.2 新增 `MissionSocketDecisionSubmittedEvent` 接口（type、issuedAt、missionId、decisionId、resolved、task）
  - [x] 3.3 将新事件类型加入 `MissionSocketPayload` 联合类型

- [x] 4. 后端决策引擎升级
  - [x] 4.1 在 `server/tasks/mission-decision.ts` 中新增 `requiresComment` 校验逻辑：当选中选项 `requiresComment === true` 且 `freeText` 为空时返回 400
  - [x] 4.2 在 `server/tasks/mission-decision.ts` 中，决策成功后构建 `DecisionHistoryEntry` 并追加到 `MissionRecord.decisionHistory`
  - [x] 4.3 新增 `generateDecisionId()` 工具函数，格式为 `dec_<timestamp>_<random4>`
  - [x] 4.4 在 `server/tasks/mission-store.ts` 的 `resolveWaiting()` 中，清除 decision 前将当前决策归档到 `decisionHistory`

- [x] 5. MissionOrchestrator 多步决策链
  - [x] 5.1 扩展 `MissionOrchestratorHooks.onDecisionSubmitted` 返回类型，支持 `nextDecision?: MissionDecision`
  - [x] 5.2 在 `MissionOrchestrator.submitDecision()` 中，当 hook 返回 `nextDecision` 时自动调用 `markWaiting()` 进入下一决策节点
  - [x] 5.3 在 `server/tasks/mission-runtime.ts` 中，决策提交后广播 `mission.decision.submitted` Socket 事件

- [x] 6. 新增 API 端点
  - [x] 6.1 在 `server/routes/tasks.ts` 中新增 `GET /api/tasks/:id/decisions` 端点，返回决策历史
  - [x] 6.2 在 `server/routes/tasks.ts` 中新增 `GET /api/decision-templates` 端点，返回内置模板列表
  - [x] 6.3 在 `shared/mission/api.ts` 中新增 `listDecisionHistory` 路由常量和 `ListDecisionHistoryResponse` 类型

- [x] 7. 后端测试
  - [x] 7.1 新增 `server/tests/hitl-decision.test.ts`：测试 requiresComment 校验、决策历史追加、多步决策链、API 端点
  - [x] 7.2 [PBT] 新增 `server/tests/hitl-decision.property.test.ts`：Property 1 — 决策类型向后兼容性（验证: 需求 1.1）
  - [x] 7.3 [PBT] 在 `server/tests/hitl-decision.property.test.ts` 中：Property 2 — 决策历史单调递增（验证: 需求 2.1）
  - [x] 7.4 [PBT] 在 `server/tests/hitl-decision.property.test.ts` 中：Property 3 — requiresComment 校验一致性（验证: 需求 4.1）
  - [x] 7.5 [PBT] 在 `server/tests/hitl-decision.property.test.ts` 中：Property 4 — 决策历史持久化完整性（验证: 需求 8.1）

- [x] 8. 前端决策面板
  - [x] 8.1 新增 `client/src/components/tasks/DecisionPanel.tsx`：根据 `decision.type` 渲染不同布局（approve/reject 双按钮、multi-choice 选项列表、request-info 文本框、escalate 高优先级、custom-action 通用按钮）
  - [x] 8.2 实现选项 `severity` 色调渲染（info=蓝、warn=黄、danger=红）和 `requiresComment` 必填文本框
  - [x] 8.3 实现决策提交逻辑：调用 `POST /api/tasks/:id/decision`，显示加载状态，成功后刷新任务详情

- [x] 9. 前端决策历史
  - [x] 9.1 新增 `client/src/components/tasks/DecisionHistory.tsx`：时间线布局展示决策记录（时间、类型图标、选择结果、理由）
  - [x] 9.2 在 `client/src/components/tasks/TaskDetailView.tsx` 中集成 DecisionPanel（waiting 状态时显示）和 DecisionHistory（标签页）
  - [x] 9.3 在 `client/src/lib/tasks-store.ts` 中监听 `mission.decision.submitted` Socket 事件，更新对应 Mission 的 decisionHistory

- [x] 10. 3D 场景等待决策提示
  - [x] 10.1 在 3D 场景中，当 Mission 处于 `waiting` 状态时，对应 Agent 宠物上方显示问号气泡 sprite
  - [x] 10.2 点击气泡跳转到 `/tasks/:id` 决策面板，决策完成后气泡自动消失

- [x] 11. Feishu 集成增强
  - [x] 11.1 在 `server/feishu/bridge.ts` 中升级 `createTaskCard()`：根据 `decision.type` 渲染不同样式按钮，`escalate` 使用红色高优先级模板
  - [x] 11.2 决策提交成功后，通过 `handleTaskUpdate()` 更新飞书消息为"已决策"状态

- [x] 12. Steering 更新
  - [x] 12.1 在 `.kiro/steering/project-overview.md` 的模块清单表格中新增 human-in-the-loop 条目
