# Office Task Cockpit - 设计文档

## 概述

本设计将桌面端办公室从“全局态势首页”升级为“默认执行工作台”。核心策略不是把 `/tasks` 页面整块搬进办公室，而是让办公室成为壳层，在同一屏中装配现有任务队列、命令区、任务详情和 workflow 上下文组件，同时保留 `Scene3D` 作为中心现场。

V1 只定义桌面端驾驶舱，不改变后端契约，不改 Socket 协议，不重做移动端路径。

## 设计原则

1. 办公室做主壳，`/tasks` 做全屏工作台，而不是二选一替代。
2. 复用现有任务组件和 store，避免再造第二套命令中心、任务详情和选中状态。
3. 右侧默认先给“可操作任务界面”，上下文信息按 tab 展开，而不是把所有信息平铺堆满。
4. 高级发起先统一入口，不强行统一后端协议。
5. 桌面优先，移动端保守兼容。

## 目标信息架构

| 区域   | 承载内容                                  | 组件来源                                            |
| ------ | ----------------------------------------- | --------------------------------------------------- |
| 左栏   | 任务搜索、筛选、选中、高亮、刷新          | `TasksQueueRail`                                    |
| 中栏   | 办公室场景、公告板、场景联动              | `Scene3D` + 现有办公室场景层                        |
| 右栏   | `任务 / 团队流 / Agent / 记忆报告 / 历史` | `TasksCockpitDetail` + workflow / office 上下文组件 |
| 命令区 | 统一发起入口、NL command、主操作摘要      | `TasksCommandDock` + 新统一入口壳                   |

补充路径：

- `/tasks`：保留为全屏工作台与深链页
- `/tasks/:taskId`：保留为任务深链详情页
- 旧 `WorkflowPanel`：降级为兼容入口 / 迁移壳

## 状态归属

### 1. 任务真相源

- `selectedTaskId` 继续由 `useTasksStore` 作为唯一任务选中状态
- 任务列表、任务详情、operator actions、decision note 继续由 `useTasksStore` 承载

### 2. Agent 真相源

- `selectedPet` 继续由 `useAppStore` 作为唯一 Agent 选中状态
- 场景点击、Agent 查看和办公室侧信息继续围绕 `selectedPet` 联动

### 3. workflow 上下文归属

- workflow 的 directive、organization、history、memory、reports 继续由既有 `workflow-store` 与已拆解 selector 提供
- 办公室驾驶舱只负责装配与展示，不新增第二套 workflow 全局 store

### 4. 新增本地 UI 类型

仅新增轻量本地 UI 类型，不引入新的全局业务状态中心：

- `OfficeCockpitTab = "task" | "flow" | "agent" | "memory" | "history"`
- `OfficeLaunchMode = "mission" | "workflow"`
- `OfficeLaunchResolution`：描述高级发起后从 workflow 落回 mission 聚焦的临时解析状态

## 组件装配方案

### 1. 左栏：任务队列

- 直接复用 `TasksQueueRail`
- 保留现有搜索、高亮、刷新、选中与滚动聚焦逻辑
- 任务选中后继续驱动 `selectedTaskId`，供场景和右栏共同消费

### 2. 中栏：办公室场景

- 继续保留 `Scene3D` 为中心主场景
- 办公室公告板、场景 Agent 点击和阶段流线继续存在
- 中栏不承担密集文本阅读，主要负责现场感、位置感与联动反馈

### 3. 右栏：详情 tab 容器

- 默认 tab 为 `任务`，直接渲染 `TasksCockpitDetail`
- `团队流`：承接旧 workflow 的 stage bar、organization summary、role execution summary、input attachments、artifact summary
- `Agent`：承接办公室 Agent 详情视图
- `记忆报告`：承接 memory + heartbeat reports
- `历史`：承接 workflow history / sessions compatibility summary

### 4. 命令区：统一入口壳

- 复用 `TasksCommandDock` 的 NL command、澄清和任务落队逻辑
- 在其外层增加统一发起壳，使用户只看到一个发起入口，而不是普通创建和高级发起各占一级位置
- 不新增第二套命令中心页面或全局入口

## 双通道发起方案

### 1. 普通任务发起

- 继续使用现有 `createMission`
- 继续支持 `TaskHubCommand` → 任务落队 → 自动聚焦
- 适用于不带附件、无需高级上下文的常规任务发起

### 2. 高级发起

- 复用旧 workflow directive + attachment composer
- 支持附件准备、directive 输入和 workflow 创建
- 不改 mission create API，不要求后端一次性统一协议

### 3. 焦点回落

- 高级发起后可能先得到 workflow，再稍后关联 mission
- 办公室驾驶舱需要提供“已发起，等待落任务”的临时解析态
- 一旦 workflow 关联到 mission，自动将焦点切回对应任务，并更新左栏选中与右栏详情

## 兼容与迁移策略

- 桌面端办公室升级为默认执行壳，移动端保持现状
- `/tasks` 与 `/tasks/:taskId` 保留，不做删除或重定向
- `WorkflowPanel` 保留为兼容入口或迁移说明壳，不再作为桌面端默认执行入口
- 旧任务发起、旧任务详情、旧深链在迁移期间均保持可访问

## Worktree 并行建议

- 建议单独 owner 覆盖 `client/src/pages/Home.tsx`
- 建议同一 owner 负责 `client/src/components/tasks/*` 与 `client/src/components/office/*` 的装配层改动
- 若存在并行 worktree，避免同时大改 `Home.tsx`、`TasksCockpitDetail`、`WorkflowPanelCompatibility`

## 测试策略

- 组件测试：tab 切换、任务选中、Agent 选中、统一发起入口模式切换
- 集成测试：普通任务创建、NL command 落队、高级发起待解析态、任务聚焦回落
- 回归测试：`/tasks` 深链、`WorkflowPanel` 兼容入口、场景 Agent 查看、移动端现有路径
- 手动验证：桌面端三栏驾驶舱、任务与场景联动、右栏 tab 信息完整性

## 交付顺序

1. 先搭办公室桌面壳层与三栏布局
2. 再把右栏默认 `任务` tab 与上下文 tab 收口
3. 再实现统一发起入口与双通道焦点回落
4. 最后做兼容入口、回归验证与桌面手测
