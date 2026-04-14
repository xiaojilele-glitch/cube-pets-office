# Intelligent Launch Convergence - 需求文档

## 概述

当前办公室驾驶舱里同时存在 `任务命令` 和 `高级发起` 两个发布入口。它们虽然最终都会落到任务主线，但对用户暴露成了两种不同心智：

- 一种是“先理解自然语言，再澄清，再落入任务队列”
- 一种是“直接走 workflow，支持附件、团队准备和上下文编排”

这会让用户在发起前就被迫理解系统内部实现差异，而不是像现代 GPT / Claude 类产品那样，只需要在一个输入框里说出目标，由系统自动判断是否需要附件上下文、是否要进入高级运行时、是否要经过沙盒或 workflow 编排。

本 spec 的目标，是把当前双入口收敛为 `一个统一智能发起入口`。用户只看到一个输入区，系统根据输入内容、附件、当前运行模式和执行意图，自动选择最合适的内部通道：

- `mission / task-hub` 通道
- `workflow + mission` 通道
- 必要时先触发澄清，再继续执行

## 设计目标

1. 把办公室和任务页中的发起动作收敛为一个统一智能入口。
2. 保留现有 `task-hub` 与 `workflow` 两条内部能力链路，而不是强行砍成一条。
3. 让“是否需要高级执行 / workflow / 附件编排 / 澄清补问”由系统判断，而不是用户手动选入口。
4. 优先复用现有 `TasksCommandDock`、`OfficeWorkflowLaunchPanel`、`nl-command-store`、`workflow-store`、`tasks-store` 和现有后端路由。
5. 在不破坏现有 mission / workflow 数据链路的前提下，让用户感知为一个统一的主操作体验。

## 依赖关系

- 依赖已完成的 `task-hub-convergence`，复用命令输入、澄清和任务落队能力。
- 依赖已完成的 `office-task-cockpit`，复用办公室驾驶舱中的统一命令区位置。
- 依赖已完成的 `workflow-panel-decomposition`，继续复用 workflow 上下文展示能力。
- 依赖现有 `workflow-decoupling` 成果，确保 workflow 和 mission 之间的映射可被消费。

## 非目标

- 本 spec 不要求删除后端 `POST /api/tasks` 或 `POST /api/workflows` 任一路由。
- 本 spec 不要求立即统一为单一后端协议。
- 本 spec 不要求第一阶段就用 LLM 完成完整的智能路由；v1 可先采用规则 + 元数据的混合策略。
- 本 spec 不重做任务详情页、workflow 上下文页或移动端整体导航结构。
- 本 spec 不扩展到“聊天问答”和“执行发起”之外的全部输入场景。

## 术语

- **Unified_Launch_Composer**: 用户可见的唯一发起输入组件。
- **Launch_Router**: 根据输入文本、附件和运行模式选择内部通道的策略层。
- **Mission_Path**: 通过 `task-hub / createMission` 直接创建任务的发起路径。
- **Workflow_Path**: 通过 `submitDirective` 创建 workflow，再关联 mission 的发起路径。
- **Clarification_Path**: 用户输入信息不足时，先进入澄清问答再继续发起的路径。
- **Runtime_Upgrade**: 当前处于 `frontend` 模式时，系统判断该请求需要 `advanced` 模式才能真实执行的升级动作。

## 用户故事与验收标准

### 1. 统一入口取代双按钮入口

#### 1.1 作为用户，我希望只面对一个输入框，而不是先在“任务命令”和“高级发起”之间做选择

- AC 1.1.1: 办公室驾驶舱 SHALL 不再把 `任务命令` 和 `高级发起` 暴露为两个一级发布入口。
- AC 1.1.2: 办公室驾驶舱 SHALL 提供单一 `Unified_Launch_Composer` 承接文本输入、附件输入和提交动作。
- AC 1.1.3: `/tasks` 页与办公室内嵌发起区 SHALL 使用一致的统一发起模型和一致的状态文案。

### 2. 系统自动选择内部发起通道

#### 2.1 作为用户，我希望系统根据输入内容自动判断应该走普通任务还是高级 workflow，而不是让我自己理解系统内部实现

- AC 2.1.1: 当输入不带附件、目标较明确、无需额外上下文编排时，系统 SHALL 优先走 `Mission_Path`。
- AC 2.1.2: 当输入带附件，或文本中明确要求“基于附件 / 文档 / 表格 / 图片 / OCR / 上下文材料”时，系统 SHALL 优先走 `Workflow_Path`。
- AC 2.1.3: 当输入体现明显执行环境需求，如“运行命令 / 打开网页 / 抓日志 / 访问容器 / 沙盒验证 / 浏览器操作”时，系统 SHALL 能标记该请求需要高级执行能力。
- AC 2.1.4: 路由结果 SHALL 以用户可理解的方式反馈，例如“已作为快速任务创建”或“检测到附件上下文，已进入高级编排”。

### 3. 澄清仍然存在，但降为统一入口内的一个阶段

#### 3.1 作为用户，我希望在信息不足时被补问，而不是因为入口不同产生两套交互逻辑

- AC 3.1.1: 当输入缺少目标、时限、约束或交付物信息时，统一入口 SHALL 支持进入 `Clarification_Path`。
- AC 3.1.2: 澄清问题 SHALL 在统一入口区域内原地展示，而不是跳去另一套页面或弹窗。
- AC 3.1.3: 澄清完成后，系统 SHALL 自动继续原请求的路由流程，而不要求用户重新选择入口或重新输入。

### 4. 附件和高级能力合并进统一入口

#### 4.1 作为用户，我希望附件是统一输入框的自然组成部分，而不是“高级发起”专属能力

- AC 4.1.1: `Unified_Launch_Composer` SHALL 支持文件添加、附件摘要展示、移除附件和附件数量限制提示。
- AC 4.1.2: 当存在附件时，系统 SHALL 能在统一入口中展示附件预处理状态与错误信息。
- AC 4.1.3: 附件能力 SHALL 不再要求用户切换到单独的“高级发起”入口后才能使用。

### 5. 前端模式与高级模式的自动升级提示

#### 5.1 作为用户，我希望在前端模式下输入真实执行请求时，系统明确告诉我需要切换高级模式，而不是让我自己猜

- AC 5.1.1: 当当前运行模式为 `frontend` 且请求需要真实执行时，统一入口 SHALL 提示需要 `advanced runtime`。
- AC 5.1.2: 若部署环境允许升级，统一入口 SHALL 支持从统一入口直接触发升级动作，而不是要求用户先切换另一个入口。
- AC 5.1.3: 若当前部署不支持高级执行，统一入口 SHALL 明确给出“可预览但不可真实执行”的反馈。

### 6. workflow 与 mission 的焦点回落必须缩短

#### 6.1 作为用户，我希望高级编排发起后能尽快回到任务焦点，而不是长时间停留在“等待落任务”的中间态

- AC 6.1.1: 当 `Workflow_Path` 创建成功且服务端已返回 `missionId` 时，前端 SHALL 能直接用该 `missionId` 聚焦任务，而不是仅依赖轮询补链。
- AC 6.1.2: 当 `missionId` 暂未返回但后续可从 workflow detail 获取时，前端 SHALL 保留兼容的等待解析态。
- AC 6.1.3: 一旦 workflow 关联到 mission，统一入口 SHALL 自动把焦点回落到对应任务并更新当前详情视图。

### 7. 状态归属必须收口

#### 7.1 作为系统，我希望统一入口不会再引入第三套发起状态中心

- AC 7.1.1: 任务列表与任务详情 SHALL 继续以 `tasks-store` 为真相源。
- AC 7.1.2: workflow 上下文与 workflow 提交状态 SHALL 继续以 `workflow-store` 为真相源。
- AC 7.1.3: 自然语言草稿、澄清、计划摘要和统一入口路由元数据 SHALL 由 `nl-command-store` 或新增轻量协调层承载。
- AC 7.1.4: 统一入口 SHALL 避免把 `launchMode` 继续保留为用户可见的一等心智。

### 8. 渐进迁移与兼容

#### 8.1 作为产品，我希望先完成体验收敛，再逐步删除旧入口代码，而不是一次性大爆改

- AC 8.1.1: 第一阶段 SHALL 允许内部继续同时复用 `Mission_Path` 和 `Workflow_Path`。
- AC 8.1.2: 第一阶段 MAY 暂时保留内部兼容逻辑，但不再暴露双入口按钮给用户。
- AC 8.1.3: 迁移过程中 SHALL 不出现任务创建成功但无法定位、workflow 创建成功但无法回落、或澄清状态丢失的问题。

## 约束与风险

- `client/src/components/office/OfficeTaskCockpit.tsx`、`client/src/components/tasks/TasksCommandDock.tsx`、`client/src/components/office/OfficeWorkflowLaunchPanel.tsx`、`client/src/lib/nl-command-store.ts`、`client/src/lib/workflow-store.ts` 是高冲突区。
- 当前 `workflow-store` 的创建响应只消费 `workflowId`，尚未承接后端已返回的 `missionId`，这是统一体验的关键断点。
- 若路由策略过于激进，可能出现用户预期“快速任务”但系统误判为高级 workflow 的情况，因此需要保留轻量纠偏能力。
- 若统一入口只是 UI 合并，但仍把澄清、附件、高级模式提示拆成平行逻辑，用户仍会感知为“两套系统叠一起”。
