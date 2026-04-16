# Human-in-the-Loop (HITL) 决策系统 — 设计文档

## 概述

在现有 Mission `waiting/decision` 基础设施上，扩展决策类型系统、多步决策链、决策模板、决策历史回溯，并增强前端 UI、3D 场景和 Feishu 集成。设计原则：向后兼容、最小侵入、类型安全。

## 1. 共享契约层扩展

### 1.1 DecisionType 枚举

在 `shared/mission/contracts.ts` 中新增：

```typescript
export const DECISION_TYPES = [
  "approve",
  "reject",
  "request-info",
  "escalate",
  "custom-action",
  "multi-choice",
] as const;

export type DecisionType = (typeof DECISION_TYPES)[number];
```

### 1.2 MissionDecisionOption 扩展

```typescript
export interface MissionDecisionOption {
  id: string;
  label: string;
  description?: string;
  // --- 新增字段 ---
  action?: DecisionType;
  severity?: "info" | "warn" | "danger";
  requiresComment?: boolean;
}
```

### 1.3 MissionDecision 扩展

```typescript
export interface MissionDecision {
  prompt: string;
  options: MissionDecisionOption[];
  allowFreeText?: boolean;
  placeholder?: string;
  // --- 新增字段 ---
  type?: DecisionType; // 缺省视为 'custom-action'
  templateId?: string; // 引用的模板 ID
  payload?: Record<string, unknown>; // 结构化上下文数据
  decisionId?: string; // 唯一标识，用于历史追踪
}
```

### 1.4 DecisionHistoryEntry

```typescript
export interface DecisionHistoryEntry {
  decisionId: string;
  type: DecisionType;
  prompt: string;
  options: MissionDecisionOption[];
  templateId?: string;
  payload?: Record<string, unknown>;
  resolved: MissionDecisionResolved;
  submittedBy?: string;
  submittedAt: number;
  reason?: string;
  stageKey?: string;
}
```

### 1.5 MissionRecord 扩展

```typescript
export interface MissionRecord {
  // ... 现有字段不变 ...
  decisionHistory?: DecisionHistoryEntry[]; // 新增
}
```

`decisionHistory` 为可选字段，向后兼容。旧数据无此字段时视为空数组。

## 2. 决策模板

### 2.1 文件位置

新增 `shared/mission/decision-templates.ts`。

### 2.2 DecisionTemplate 接口

```typescript
export interface DecisionTemplate {
  templateId: string;
  name: string;
  description: string;
  defaultType: DecisionType;
  defaultOptions: MissionDecisionOption[];
  defaultPrompt: string;
  defaultAllowFreeText?: boolean;
  defaultPayloadSchema?: Record<string, string>; // 字段名 → 描述
}
```

### 2.3 内置模板

| templateId                | name         | defaultType     | 选项                               |
| ------------------------- | ------------ | --------------- | ---------------------------------- |
| `execution-plan-approval` | 执行计划审批 | `approve`       | Approve / Reject / Request Changes |
| `stage-gate`              | 阶段门禁     | `approve`       | Proceed / Hold / Abort             |
| `risk-confirmation`       | 风险确认     | `custom-action` | Accept Risk / Mitigate / Escalate  |

### 2.4 模板 API

`GET /api/decision-templates` → `{ ok: true, templates: DecisionTemplate[] }`

路由常量添加到 `shared/mission/api.ts`：

```typescript
listDecisionTemplates: '/api/decision-templates',
```

## 3. 后端决策引擎升级

### 3.1 submitMissionDecision 升级

在 `server/tasks/mission-decision.ts` 中：

1. 新增 `requiresComment` 校验：当选中选项的 `requiresComment === true` 且 `freeText` 为空时，返回 400 错误。
2. 决策成功后，构建 `DecisionHistoryEntry` 并追加到 `MissionRecord.decisionHistory`。
3. `decisionId` 由 `MissionDecision.decisionId` 提供，若缺省则自动生成 `dec_<timestamp>_<random>`。

### 3.2 MissionStore 升级

`resolveWaiting()` 方法扩展：在清除 `decision` 和 `waitingFor` 之前，将当前决策信息归档到 `decisionHistory`。

### 3.3 MissionOrchestrator 升级

`submitDecision()` 方法：

1. 决策完成后检查 `onDecisionSubmitted` hook 返回的 `nextDecision?: MissionDecision`。
2. 若有 `nextDecision`，自动调用 `markWaiting()` 进入下一个决策节点，而非恢复 running。
3. 这实现了多步决策链：hook 可以根据当前决策结果决定是否需要后续决策。

### 3.4 新增 Socket 事件

在 `shared/mission/socket.ts` 中新增：

```typescript
decisionSubmitted: 'mission.decision.submitted',
```

Payload：

```typescript
export interface MissionSocketDecisionSubmittedEvent {
  type: typeof MISSION_SOCKET_TYPES.decisionSubmitted;
  issuedAt: number;
  missionId: string;
  decisionId: string;
  resolved: MissionDecisionResolved;
  task: MissionRecord;
}
```

### 3.5 新增 API 端点

| 方法 | 路径                     | 说明             |
| ---- | ------------------------ | ---------------- |
| GET  | /api/tasks/:id/decisions | 返回决策历史     |
| GET  | /api/decision-templates  | 返回可用模板列表 |

路由实现在 `server/routes/tasks.ts` 中扩展。

决策历史响应：

```typescript
interface ListDecisionHistoryResponse {
  ok: true;
  missionId: string;
  decisions: DecisionHistoryEntry[];
}
```

## 4. 前端设计

### 4.1 DecisionPanel 组件

新增 `client/src/components/tasks/DecisionPanel.tsx`。

根据 `decision.type` 渲染不同布局：

- `approve` / `reject`：双按钮布局（绿色 Approve + 红色 Reject）
- `multi-choice`：选项卡片列表
- `request-info`：文本输入框 + 提交按钮
- `escalate`：高优先级样式 + 确认按钮
- `custom-action`：通用选项按钮列表（当前行为）

选项按 `severity` 渲染色调：

- `info` → 蓝色
- `warn` → 黄色/橙色
- `danger` → 红色

当 `requiresComment === true` 时，选项旁显示必填文本框。

### 4.2 DecisionHistory 组件

新增 `client/src/components/tasks/DecisionHistory.tsx`。

时间线布局，每条记录显示：

- 时间戳（相对时间）
- 决策类型图标
- 选择结果（optionLabel）
- 理由（freeText / reason）
- 阶段标识（stageKey）

集成到 `TaskDetailView.tsx` 的标签页中。

### 4.3 Zustand Store 扩展

在 `client/src/lib/tasks-store.ts` 中：

- 监听新的 `mission.decision.submitted` Socket 事件
- 更新对应 Mission 的 `decisionHistory`

## 5. 3D 场景集成

### 5.1 等待决策视觉提示

在 `client/src/components/three/` 中：

- 当 Mission 处于 `waiting` 状态时，对应 Agent 宠物模型上方显示问号气泡 sprite
- 使用 `<Html>` 组件（@react-three/drei）渲染浮动提示
- 点击气泡触发路由跳转到 `/tasks/:id`

### 5.2 状态同步

通过 Zustand store 中的 mission 状态驱动 3D 场景更新，无需额外 Socket 监听。

## 6. Feishu 集成增强

### 6.1 决策卡片升级

在 `server/feishu/bridge.ts` 中：

- `createTaskCard()` 根据 `decision.type` 渲染不同样式的按钮
- `escalate` 类型使用红色/高优先级卡片模板
- 按钮文案使用 `option.label`，按钮值编码 `optionId`

### 6.2 决策完成回传

决策提交成功后，通过 `FeishuProgressBridge.handleTaskUpdate()` 更新飞书消息：

- 卡片更新为"已决策"状态
- 显示选择结果和决策时间

## 7. 持久化策略

### 7.1 decisionHistory 持久化

`decisionHistory` 作为 `MissionRecord` 的一部分，随 `mission-storage` 快照一起持久化。无需独立存储。

### 7.2 历史上限

默认保留最近 100 条。超出时，旧记录从数组头部移除。归档逻辑在 `MissionStore.update()` 中执行。

## 8. 测试框架

使用 Vitest 作为测试框架，包括单元测试和 property-based 测试（使用 fast-check）。

## 正确性属性

### Property 1: 决策类型向后兼容性

**验证: 需求 1.1**
对于任意 `MissionDecision`，当 `type` 字段缺省时，系统应将其视为 `'custom-action'`。即 `resolveDecisionType(decision)` 对于 `type === undefined` 的输入始终返回 `'custom-action'`。

### Property 2: 决策历史单调递增

**验证: 需求 2.1**
对于任意 Mission，每次成功提交决策后，`decisionHistory.length` 严格递增 1，且新条目的 `submittedAt` 大于等于前一条目的 `submittedAt`。

### Property 3: requiresComment 校验一致性

**验证: 需求 4.1**
对于任意决策提交，当选中选项的 `requiresComment === true` 时：若 `freeText` 为空或仅含空白，提交必须失败（返回 400）；若 `freeText` 非空，提交可以成功。

### Property 4: 决策历史持久化完整性

**验证: 需求 8.1**
对于任意决策序列，持久化后恢复的 `decisionHistory` 与持久化前完全一致（长度相等、每条记录的 `decisionId` 和 `resolved` 字段相同）。

## 文件变更清单

| 文件                                              | 变更类型 | 说明                                                                        |
| ------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `shared/mission/contracts.ts`                     | 修改     | 新增 DecisionType、扩展 MissionDecisionOption/MissionDecision/MissionRecord |
| `shared/mission/decision-templates.ts`            | 新增     | 决策模板定义和内置模板                                                      |
| `shared/mission/api.ts`                           | 修改     | 新增路由常量和响应类型                                                      |
| `shared/mission/socket.ts`                        | 修改     | 新增 decisionSubmitted 事件类型                                             |
| `shared/mission/index.ts`                         | 修改     | 导出新模块                                                                  |
| `server/tasks/mission-decision.ts`                | 修改     | requiresComment 校验、历史追加                                              |
| `server/tasks/mission-store.ts`                   | 修改     | resolveWaiting 归档决策历史                                                 |
| `server/core/mission-orchestrator.ts`             | 修改     | 多步决策链支持                                                              |
| `server/tasks/mission-runtime.ts`                 | 修改     | 新增 Socket 事件广播                                                        |
| `server/routes/tasks.ts`                          | 修改     | 新增 decisions 和 templates 端点                                            |
| `client/src/components/tasks/DecisionPanel.tsx`   | 新增     | 结构化决策面板                                                              |
| `client/src/components/tasks/DecisionHistory.tsx` | 新增     | 决策历史时间线                                                              |
| `client/src/components/tasks/TaskDetailView.tsx`  | 修改     | 集成 DecisionPanel 和 DecisionHistory                                       |
| `client/src/lib/tasks-store.ts`                   | 修改     | 监听 decision.submitted 事件                                                |
| `server/feishu/bridge.ts`                         | 修改     | 决策卡片样式增强                                                            |
| `server/tests/hitl-decision.test.ts`              | 新增     | 决策引擎单元测试                                                            |
| `server/tests/hitl-decision.property.test.ts`     | 新增     | 决策引擎 property-based 测试                                                |
