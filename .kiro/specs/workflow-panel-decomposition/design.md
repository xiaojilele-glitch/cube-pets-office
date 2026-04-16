# Workflow Panel Decomposition - 设计文档

## 概述

本设计采用“映射表 + 兼容壳 + 渐进拆空”的方式，对 `WorkflowPanel` 进行结构性减负，而不是一次性删除。

## 设计原则

1. 先给内容找新家，再拆旧壳
2. 任务内容归任务，Agent 内容归办公室
3. 迁移期允许兼容，但不能继续扩张旧弹窗
4. `tasks-store` 是任务执行主线真相源

## 内容映射表

| 原视图    | 新落点                      | 主要 owner                |
| --------- | --------------------------- | ------------------------- |
| directive | 任务页顶部命令区            | `task-hub-convergence`    |
| sessions  | 任务上下文会话 / 兼容历史区 | `task-hub-convergence`    |
| workflow  | 任务详情执行区              | `tasks-store`             |
| review    | 任务详情评审区              | `tasks-store`             |
| history   | 任务列表筛选 / 历史状态视图 | `tasks-store`             |
| org       | 办公室 Agent/组织视图       | `scene-agent-interaction` |
| memory    | Agent 详情侧栏              | `scene-agent-interaction` |
| reports   | Agent 详情侧栏 / 报告卡片   | `scene-agent-interaction` |

## 状态收口策略

### 1. `tasks-store`

持续负责：

- mission list / detail
- operator actions
- review / execution / artifacts 的用户主视图

### 2. `workflow-store`

保留但收口为：

- workflow runtime
- socket 驱动的执行状态
- agent memory / heartbeat / reports 数据获取

### 3. 兼容壳

在迁移期可将 `WorkflowPanel` 改为：

- 新落点的快捷跳转容器
- 旧入口兼容说明层
- 少量尚未迁出的遗留视图承载层

## 迁移步骤

1. 抽出共享 selector 与展示块
2. 将 `workflow / review / history` 迁入任务页
3. 将 `org / memory / reports` 迁入办公室侧栏
4. 将 `directive / sessions` 收口到任务上下文
5. 把 `WorkflowPanel` 降级为兼容层

## Worktree 并行建议

### 推荐 owner

- Worktree D: `client/src/components/WorkflowPanel.tsx`、`client/src/lib/workflow-store.ts`
- Worktree D: 仅在 `task-hub-convergence` 与 `scene-agent-interaction` 对外接口稳定后开始主迁移

### 可以并行

- 可先做 tab-to-destination 映射与 selector 抽取
- 可与 `workspace-visual-unification` 并行做遗留面板的收尾样式

### 不建议并行

- 不建议与 `task-hub-convergence` 同时大改 `TaskDetailView.tsx`
- 不建议在 `scene-agent-interaction` 数据 contract 未定前迁 `memory / reports`

## 测试策略

- 各视图迁移后可达性测试
- 兼容壳跳转测试
- 任务页与办公室页内容完整性回归

## 交付顺序

1. 内容映射与 selector 抽取
2. 任务侧迁移
3. 办公室侧迁移
4. 兼容壳降级
