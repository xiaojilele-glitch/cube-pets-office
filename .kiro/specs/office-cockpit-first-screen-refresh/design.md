# Office Cockpit First Screen Refresh - 设计文档

## 概述

本设计在 `office-task-cockpit` 已经完成能力收口的基础上，继续推进桌面端办公室首屏体验重构。目标不是新增业务能力，而是对现有桌面驾驶舱做视觉与信息架构优化：保留任务、workflow、Agent、记忆、历史和主操作完整能力，把页面从“多块同级卡片并列”收敛成“单主轴、主次分层、可持续执行”的办公室驾驶舱。

## 设计原则

1. 功能不减，只重排主次。
2. `Scene3D` 继续是桌面首屏主视觉，不被大面积信息卡压成背景。
3. 统一发起继续走双通道，但用户只感知一个驾驶台。
4. 右侧坚持任务优先，先给能判断和能操作的内容，再给长信息与低频上下文。
5. 不新建第二套业务状态中心，继续复用既有 store 与组件。
6. 桌面优先收口，移动端保守兼容。

## 目标信息架构

| 区域 | 承载内容 | 设计结论 |
| --- | --- | --- |
| 顶栏 | 品牌、runtime mode、全局入口 | 只保留轻量全局顶栏，不再叠加重型工作区头卡 |
| 左栏 | 任务搜索、筛选、队列滚动 | 继续复用 `TasksQueueRail`，只做密度与层级优化 |
| 中栏上沿 | 场景 HUD | 展示当前焦点任务、状态、阶段与联动状态 |
| 中栏主体 | `Scene3D` | 保持场景沉浸感与联动中心 |
| 中栏下沿 | 统一发起驾驶台 | 继续复用 `TasksCommandDock`，并统一包裹 `OfficeWorkflowLaunchPanel` |
| 右栏 | 任务优先详情与上下文 tab | 保留 `任务 / 团队流 / Agent / 记忆 / 历史`，但改为渐进展开 |

## 状态归属

### 任务真相源

- `selectedTaskId` 继续由 `useTasksStore` 作为任务真相源。
- 任务摘要、任务详情、operator actions、decision note 继续由 `useTasksStore` 承载。

### Agent 真相源

- `selectedPet` 继续由 `useAppStore` 作为 Agent 真相源。
- 点击场景 Agent、切换 `Agent` tab 与办公室 Agent 详情视图继续围绕 `selectedPet` 联动。

### workflow 上下文归属

- workflow 的 directive、organization、history、memory、reports 继续由现有 `workflow-store` 与 selector 提供。
- 首屏重构只改变装配方式与信息层级，不新增第二套 workflow 全局 store。

### 新增本地 UI 状态

仅新增轻量本地 UI 状态，不引入新的全局业务状态中心：

- `OfficeDetailSectionKey = "summary" | "actions" | "insights" | "detail" | "artifacts" | "history"`
- `collapsedSections: Partial<Record<OfficeDetailSectionKey, boolean>>`
- `SceneHudDensity = "compact" | "comfortable"`

## 组件装配方案

### 顶层壳层

- `Home` 顶部只保留轻量全局顶栏，不再叠加重型工作区头卡。
- `OfficeTaskCockpit` 顶部摘要改为低占高 meta strip，不再用大面积 header card。

### 中栏

- 中栏继续保留 `Scene3D`。
- 在中栏上沿新增轻量 `scene focus HUD`，承接当前焦点任务、阶段、失败/等待信号与场景联动提示。
- HUD 不替代场景，只作为贴边信息层存在。

### 统一驾驶台

- 命令区继续复用 `TasksCommandDock`。
- 通过统一外壳承接 `OfficeWorkflowLaunchPanel`，不新增第二套命令中心。
- `mission` 与 `workflow` 继续走各自现有链路，但切换逻辑、布局语言、状态条与回执区域统一。

### 左栏

- 左栏继续复用 `TasksQueueRail`。
- 只调整卡片密度、状态标签层级、激活态表达、阴影与留白节奏。

### 右栏

- 右栏继续保留 `任务 / 团队流 / Agent / 记忆 / 历史` tab，不删 tab。
- `任务` tab 内部改成 `sticky summary + primary action zone + progressive detail sections`。
- 其他 tab 统一到同一种 panel shell 中，避免每个 tab 出现不同节奏和壳层重量。

## 视觉与交互改造方案

### 顶层与壳层

- 去掉当前多块同级摘要卡的并列感。
- 顶栏强调“全局控制”，cockpit 强调“运行时执行”。
- 用更薄的 meta strip 展示 runtime、队列计数、warnings、Agent 数等摘要。

### 中栏 HUD

- 将当前焦点信息从大浮卡收敛为贴场景上沿的轻量 HUD。
- HUD 保留标题、阶段、状态、联动提示与模式切换，但减少高度、阴影和背景重量。
- HUD 不独立成为第二个主区域，避免继续与命令区和右栏抢焦点。

### 统一驾驶台

- 驾驶台固定在中栏下沿，成为唯一强主操作区。
- `mission / workflow` 双通道共享同一驾驶台外壳与节奏。
- 高级发起的 `pending launch` 保留，但改成驾驶台内的状态条，不再用独立厚重大块警示卡。

### 右栏任务优先详情

- 首层固定摘要显示标题、状态、阶段、更新时间与失败信号。
- 主操作条、负责人、blocker、next step 放入首屏可操作区域。
- 低频详情、artifact、历史、补充上下文改为可折叠或弱化区块，保证仍可达但不挤占第一屏。

### 左栏队列

- 任务项改成更像执行列表的紧凑卡片。
- 激活态采用更克制的强调边、底色或轻量高亮，不再依赖大面积高饱和视觉。
- 搜索、刷新、滚动定位与高亮逻辑保持不变。

### 栏宽策略

- 左栏维持窄轨，优先保证中栏场景空间。
- 右栏使用更稳定的 `clamp` 宽度范围，减少当前 1280 左右的挤压问题。
- 当桌面宽度收窄时，优先压缩低频内容的首屏露出，而不是压缩主操作与失败信号。

## 兼容与迁移策略

- 不改后端契约，不改 socket 协议，不改移动端主路径。
- `/tasks` 与 `/tasks/:taskId` 完全保留。
- `ChatPanel` 与 `TelemetryDashboard` 继续保持覆盖层形态。
- 既有任务 / Agent / workflow 数据流不迁移，只调整桌面端首屏装配关系。

## Worktree 并行建议

- 建议单独 owner 覆盖 `Home.tsx` 与 `OfficeTaskCockpit.tsx` 的壳层改造。
- 建议同一 owner 负责 `TasksCockpitDetail` 与右栏上下文 panel shell，避免右栏样式与布局冲突。
- 建议共享样式层 `index.css` 由壳层 owner 一并收口，避免多个 worktree 同时重写 workspace token。

## 测试策略

- 组件测试：
  - 顶层壳层简化后，首屏仍可进入全屏工作台、兼容面板、运行时配置。
  - `mission / workflow` 双通道在统一驾驶台内正常切换。
  - 任务选中后，中栏 HUD 与右栏详情同步更新。
  - 点击场景 Agent 后仍自动切到 `Agent` tab。
  - 失败任务时，右栏首层可直接看到真实失败信号。
  - 右栏折叠区不影响原有详情、artifact、decision、history 的可达性。
- 桌面回归：
  - 1280、1440、1728+ 宽度下三栏不出现明显挤压或裁切。
  - `/tasks`、`/tasks/:taskId`、`ChatPanel`、`TelemetryDashboard` 行为不回归。
- 手测重点：
  - 首屏视觉中心是否明确回到 `Scene3D + 驾驶台 + 右栏任务优先详情`
  - 任务队列、场景联动、失败态和主操作是否仍形成闭环

## 交付顺序

1. 先收敛桌面顶层壳层与 cockpit 头部。
2. 再重构中栏 `scene HUD` 与统一驾驶台。
3. 再重排右栏 `任务` tab 为任务优先的渐进详情。
4. 再统一其他上下文 tab 的 panel shell。
5. 最后做左侧队列降噪、三栏宽度回归与桌面手测。
