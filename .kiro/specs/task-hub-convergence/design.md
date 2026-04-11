# Task Hub Convergence - 设计文档

## 概述

本设计把现有 `CommandCenterPage` 的命令入口能力并入 `/tasks`，让任务页成为“发起执行 + 观察进度 + 做人工干预”的唯一操作中枢。

## 设计原则

1. 任务真相优先于计划展示
2. 命令输入要嵌入任务上下文，而不是独立存在
3. 复用现有任务详情能力，避免平行造页
4. 兼容旧指挥中心路由，逐步收口

## 目标页面结构

### 1. 顶部

- `TaskHubCommandComposer`
- 当前命令执行计划摘要
- 澄清问题入口

### 2. 中左

- 任务搜索与筛选
- 进行中 / 已完成 / 阻塞 / 等待等状态过滤
- 当前任务列表

### 3. 中右

- 任务详情
- 执行进度
- 评审反馈
- 操作动作栏

## 状态策略

### 1. `tasks-store`

继续负责：

- 任务列表
- 任务详情
- 任务选择
- operator actions
- decision note

### 2. `nl-command-store`

收口为：

- 命令草稿
- 澄清问题
- 当前计划摘要
- 命令提交结果元数据

### 3. 协调层

建议增加轻量协调层或容器逻辑，负责：

- 命令提交后定位任务
- 计划摘要与当前任务联动
- 兼容旧 `CommandCenterPage` 的共享组件抽取

## 迁移策略

### 第一阶段

- 抽取 `CommandInput` 与计划摘要面板的可复用部分
- 嵌入 `/tasks`

### 第二阶段

- 将 `CommandCenterPage` 改成兼容页或直接重定向页
- 保留旧路由但不再作为一级主入口

## 组件改造范围

- `client/src/pages/tasks/TasksPage.tsx`
- `client/src/components/tasks/TaskDetailView.tsx`
- `client/src/pages/nl-command/CommandCenterPage.tsx`
- `client/src/components/nl-command/*`
- `client/src/lib/nl-command-store.ts`

## Worktree 并行建议

### 推荐 owner

- Worktree B: `TasksPage.tsx`、`TaskDetailView.tsx`、`pages/nl-command/*`、`components/nl-command/*`、`nl-command-store.ts`

### 可以并行

- 可与 `navigation-convergence` 并行，前提是另一方不改 `TasksPage.tsx`
- 可与 `api-fallback-empty-states` 并行，但高频 store 适配要排到后段

### 不建议并行

- 不建议与 `workflow-panel-decomposition` 同时改 `TaskDetailView.tsx`
- 不建议与 `workspace-visual-unification` 同时大改任务页布局

## 测试策略

- 命令提交流程测试
- 命令澄清与计划摘要测试
- 新建任务后自动定位测试
- `/command-center` 兼容路径测试

## 交付顺序

1. 抽取命令输入复用组件
2. 接入 `/tasks` 顶部命令区
3. 打通命令到任务的定位闭环
4. 收口旧 `CommandCenterPage`
