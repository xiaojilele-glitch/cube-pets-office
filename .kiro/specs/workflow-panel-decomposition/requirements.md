# Workflow Panel Decomposition - 需求文档

## 概述

当前 `WorkflowPanel` 同时承载 `directive / org / workflow / review / memory / reports / history / sessions` 多个视图，导致用户既难以判断哪里最重要，也很难在单个 tab 中获得足够深度的上下文。

本 spec 的目标是把 `WorkflowPanel` 拆解到更合适的落点：任务相关内容进入任务中台，Agent 相关内容进入办公室侧栏，低频历史进入筛选器或兼容入口，并逐步去掉首页对 `WorkflowPanel` 的强依赖。

## 设计目标

1. 让 `WorkflowPanel` 不再承担“大而全弹窗”角色
2. 让每类信息回到最自然的使用场景
3. 降低 `workflow-store` 与 `tasks-store` 的双中心冲突
4. 在迁移期保留兼容入口，避免一次性硬切

## 依赖关系

- 依赖 `task-hub-convergence` 提供任务侧承接面
- 依赖 `navigation-convergence` 提供新的主导航骨架
- 与 `scene-agent-interaction` 强协同

## 非目标

- 本 spec 不负责完整视觉统一
- 本 spec 不要求一次性删除所有 `workflow-store` 逻辑
- 本 spec 不重写底层 workflow 执行协议

## 用户故事与验收标准

### 1. 任务类内容回归任务页

#### 1.1 作为用户，我希望执行进度和评审反馈在任务页里完整查看，而不是塞在弹窗 tab 里

- AC 1.1.1: `workflow` 与 `review` 内容 SHALL 收口到任务页或任务详情页
- AC 1.1.2: `history` SHALL 通过任务列表筛选或历史视图承接
- AC 1.1.3: 与任务执行直接相关的内容 SHALL 不再优先依赖 `WorkflowPanel`

### 2. Agent 类内容回归办公室

#### 2.1 作为用户，我希望组织、记忆、报告等 Agent 信息在点击 Agent 时自然出现

- AC 2.1.1: `org` SHALL 迁移到办公室场景相关视图
- AC 2.1.2: `memory` 与 `reports` SHALL 迁移到 Agent 详情侧栏或相邻面板
- AC 2.1.3: 相关迁移后 SHALL 保持数据可达，不因移位而丢失

### 3. 指令与会话收口

#### 3.1 作为产品，我希望命令与会话归于任务上下文，而不是继续扩出新的独立心智

- AC 3.1.1: `directive` SHALL 由任务中台的命令输入区承接
- AC 3.1.2: `sessions` SHALL 迁移到任务上下文会话或兼容历史视图
- AC 3.1.3: 工作流相关命令入口 SHALL 明确以任务主线为中心

### 4. 兼容迁移

#### 4.1 作为系统，我希望在迁移期间用户不会因为旧按钮失效而找不到信息

- AC 4.1.1: `WorkflowPanel` SHALL 支持兼容期存在
- AC 4.1.2: 兼容期内旧 tab SHALL 能导向新落点或显示迁移提示
- AC 4.1.3: 首页默认交互 SHALL 逐步摆脱对 `WorkflowPanel` 的依赖

## 约束与风险

- `WorkflowPanel.tsx` 同时依赖 `workflow-store` 与 `tasks-store`，拆解时要避免双向耦合继续加深
- 如果目标落点未先成型，直接拆 tab 会造成信息散失
- 这是高冲突 spec，适合放在第二波 worktree 中推进
