# Human-in-the-Loop (HITL) 决策系统 — 需求文档

## 概述

将当前 Mission 已有的基础 `waiting/decision` 状态机升级为完整、通用、可扩展的 Human-in-the-Loop（HITL）系统。支持通用审批流、多步决策链、决策模板、决策历史回溯、丰富决策类型，以及与 3D 办公室和 Feishu 的深度集成。

## 现有基线

当前已实现：
- `MissionDecision` 基础类型（prompt + options + allowFreeText）
- `submitMissionDecision()` 幂等决策提交
- `MissionStore.markWaiting()` / `resolveWaiting()` 状态切换
- `MissionOrchestrator.submitDecision()` 编排层决策处理
- `POST /api/tasks/:id/decision` REST 端点
- `FeishuProgressBridge` 中 waiting 状态消息推送 + 决策按钮
- Socket `mission.record.waiting` 事件广播

## 用户故事与验收标准

### 1. 决策类型系统

#### 1.1 作为 Mission 编排器，我需要发起不同类型的决策请求，以便根据场景选择合适的人工介入方式
- AC 1.1.1: 系统支持至少 6 种决策类型：`approve`、`reject`、`request-info`、`escalate`、`custom-action`、`multi-choice`
- AC 1.1.2: 每种决策类型有对应的 `DecisionType` 枚举值，定义在 `shared/mission/contracts.ts`
- AC 1.1.3: `MissionDecision` 扩展支持 `type: DecisionType` 字段，向后兼容（缺省时视为 `custom-action`）
- AC 1.1.4: 决策可携带结构化 `payload`（JSON 对象），用于传递审批上下文（如代码 diff、执行计划摘要等）

#### 1.2 作为开发者，我需要决策选项支持语义化动作标识，以便前端根据类型渲染不同 UI
- AC 1.2.1: `MissionDecisionOption` 扩展 `action?: DecisionType` 字段，标识该选项的语义动作
- AC 1.2.2: 选项支持 `severity?: 'info' | 'warn' | 'danger'` 字段，用于 UI 色调提示
- AC 1.2.3: 选项支持 `requiresComment?: boolean` 字段，标识是否必须附带理由

### 2. 多步决策链

#### 2.1 作为 Mission 编排器，我需要在一个 Mission 中发起多个连续决策节点，以便支持复杂审批流程
- AC 2.1.1: `MissionRecord` 新增 `decisionHistory: DecisionHistoryEntry[]` 字段，记录所有已完成的决策
- AC 2.1.2: 每个 `DecisionHistoryEntry` 包含：`decisionId`、`type`、`prompt`、`options`、`resolved`（选择结果）、`submittedBy`、`submittedAt`、`reason`
- AC 2.1.3: Mission 可在不同阶段多次进入 `waiting` 状态，每次决策完成后自动追加到 `decisionHistory`
- AC 2.1.4: `decisionHistory` 按时间正序排列，最新决策在末尾

#### 2.2 作为用户，我需要查看一个 Mission 的完整决策历史，以便审计和回溯
- AC 2.2.1: `GET /api/tasks/:id` 返回的 `MissionRecord` 包含完整 `decisionHistory`
- AC 2.2.2: 新增 `GET /api/tasks/:id/decisions` 端点，返回该 Mission 的决策历史列表
- AC 2.2.3: 决策历史支持 `limit` 分页参数，默认返回最近 50 条

### 3. 决策模板

#### 3.1 作为 Mission 编排器，我需要使用预定义的决策模板快速发起常见审批，以便减少重复配置
- AC 3.1.1: 新增 `shared/mission/decision-templates.ts`，定义 `DecisionTemplate` 接口和内置模板
- AC 3.1.2: 内置至少 3 个模板：`execution-plan-approval`（执行计划审批）、`stage-gate`（阶段门禁）、`risk-confirmation`（风险确认）
- AC 3.1.3: 模板包含：`templateId`、`name`、`description`、`defaultType`、`defaultOptions`、`defaultPayloadSchema`
- AC 3.1.4: `MissionDecision` 扩展 `templateId?: string` 字段，标识使用的模板
- AC 3.1.5: 模板可通过 `GET /api/decision-templates` 端点查询

### 4. 后端决策引擎升级

#### 4.1 作为后端服务，我需要升级决策提交逻辑以支持新的决策类型和历史记录
- AC 4.1.1: `submitMissionDecision()` 升级支持 `requiresComment` 校验——当选项要求评论时，`freeText` 不能为空
- AC 4.1.2: 决策提交成功后，自动将决策记录追加到 `MissionRecord.decisionHistory`
- AC 4.1.3: 决策提交触发 Socket 事件 `mission.decision.submitted`，payload 包含 `missionId`、`decisionId`、`resolved`
- AC 4.1.4: `MissionOrchestrator.submitDecision()` 在决策完成后自动检查是否有后续决策节点（多步链），如有则自动进入下一个 waiting 状态

#### 4.2 作为后端服务，我需要新增决策相关 API 端点
- AC 4.2.1: `GET /api/tasks/:id/decisions` — 返回决策历史
- AC 4.2.2: `GET /api/decision-templates` — 返回可用决策模板列表
- AC 4.2.3: 所有新端点遵循现有 `{ ok: true, ... }` 响应格式

### 5. 前端决策界面

#### 5.1 作为用户，我需要在 /tasks 详情页看到结构化的决策面板，以便做出明确的决策
- AC 5.1.1: 当 Mission 处于 `waiting` 状态时，任务详情页显示 `DecisionPanel` 组件
- AC 5.1.2: `DecisionPanel` 根据 `DecisionType` 渲染不同 UI：approve/reject 显示双按钮、multi-choice 显示选项列表、request-info 显示文本输入框
- AC 5.1.3: 选项按 `severity` 渲染不同色调（info=蓝、warn=黄、danger=红）
- AC 5.1.4: 当选项 `requiresComment` 为 true 时，显示必填的理由输入框
- AC 5.1.5: 决策提交后显示加载状态，成功后自动刷新任务详情

#### 5.2 作为用户，我需要在任务详情页查看决策历史时间线
- AC 5.2.1: 任务详情页新增"决策历史"标签页或区域
- AC 5.2.2: 以时间线形式展示每条决策记录：时间、决策类型图标、选择结果、理由
- AC 5.2.3: 时间线按时间正序排列，最新决策在底部

### 6. 3D 场景集成

#### 6.1 作为用户，我需要在 3D 办公室中看到 Agent 的"等待决策"状态
- AC 6.1.1: 当 Mission 进入 `waiting` 状态时，对应 Agent 在 3D 场景中显示"等待"视觉提示（如头顶问号气泡）
- AC 6.1.2: 点击等待状态的 Agent 可直接跳转到对应 Mission 的决策面板
- AC 6.1.3: 决策完成后，Agent 视觉提示自动消失

### 7. Feishu 集成增强

#### 7.1 作为飞书用户，我需要在飞书中直接完成决策操作
- AC 7.1.1: 飞书 waiting 消息包含决策类型标识和所有可选项按钮
- AC 7.1.2: 用户点击飞书按钮后，通过现有 Relay 链路提交决策
- AC 7.1.3: 决策提交成功后，飞书消息更新为已决策状态（显示选择结果和时间）
- AC 7.1.4: `escalate` 类型决策在飞书中显示为高优先级样式

### 8. 决策历史持久化

#### 8.1 作为系统，我需要将决策历史持久化到 Mission 快照
- AC 8.1.1: `decisionHistory` 随 `MissionRecord` 一起持久化到 `mission-storage`
- AC 8.1.2: 服务重启后，恢复的 Mission 包含完整 `decisionHistory`
- AC 8.1.3: 决策历史默认保留最近 100 条，超出时按 FIFO 归档到独立文件

## 非范围

- 复杂工作流引擎（如 BPMN）
- 外部审批系统集成（Jira、Notion 等）
- 决策 AI 辅助（AI 建议决策，后续可扩展）
- 多人联合决策（投票机制，后续 multi-user-office 结合）
