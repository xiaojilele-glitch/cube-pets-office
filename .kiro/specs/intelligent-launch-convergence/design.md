# Intelligent Launch Convergence - 设计文档

## 概述

本设计把当前办公室和任务页中的双入口发起模式，收敛为 `一个统一智能发起入口`。核心策略不是立即统一后端协议，而是：

1. 用户只看到一个输入框
2. 系统内部保留两条成熟的执行路径
3. 通过轻量路由层在提交时自动选择最合适的路径

这意味着产品体验被统一，但技术上仍然复用现有能力：

- `Mission_Path`: `TasksCommandDock` + `nl-command-store` + `createMission`
- `Workflow_Path`: `OfficeWorkflowLaunchPanel` + `workflow-store.submitDirective`

## 设计原则

1. 统一用户心智，不强行统一所有后端协议。
2. 优先复用现有组件和 store，避免重写整条链路。
3. 先解决体验断点，再考虑更深层的协议收敛。
4. 路由策略允许 v1 采用规则判断，后续再升级为模型判断。
5. workflow 与 mission 的映射要尽量前置消费，减少等待态。

## 现状拆解

### 1. 当前双入口的本质

当前用户看到两个入口，但底层实际上是两套不同粒度的发起策略：

- `任务命令`
  - 输入自然语言
  - 通过 `nl-command-store` 做意图分析与启发式澄清
  - 最终构造 mission brief
  - 调用 `createMission`

- `高级发起`
  - 输入 directive
  - 可附加文件并做摘要/OCR
  - 调用 `submitDirective`
  - 由服务端创建 workflow，同时创建并链接 mission

问题不在于“有两个表单”，而在于“系统把内部通道差异直接暴露给了用户”。

### 2. 当前的关键断点

#### 2.1 入口层断点

- 办公室驾驶舱使用 `launchMode = "mission" | "workflow"` 的显式切换模型
- 用户必须在发起前先理解“自己是在创建任务，还是在发起 workflow”

#### 2.2 状态层断点

- `nl-command-store` 负责草稿、澄清、任务落队摘要
- `workflow-store` 负责附件、directive、workflow 提交和上下文
- 两者缺少统一的调度壳和统一的提交结果模型

#### 2.3 焦点回落断点

- 后端 `POST /api/workflows` 已返回 `workflowId + missionId`
- 前端 `workflow-store` 仅消费 `workflowId`
- 办公室只能通过 `pendingLaunch + 轮询 workflow detail` 等待回落

## 目标架构

### 1. 顶层结构

新增一个用户可见的统一组件：

- `UnifiedLaunchComposer`

新增一个轻量策略层：

- `LaunchRouter`

新增一个统一结果对象：

- `UnifiedLaunchResult`

### 2. 模块关系

```text
UnifiedLaunchComposer
  -> LaunchRouter.evaluate(input)
    -> Clarification_Path
    -> Mission_Path
    -> Workflow_Path
    -> Runtime_Upgrade

Mission_Path
  -> nl-command-store.submitTaskHubCommand(...)
  -> tasks-store.createMission(...)

Workflow_Path
  -> workflow-store.submitDirective(...)
  -> server /api/workflows
  -> workflowId + missionId
  -> tasks-store.selectTask(missionId)
```

## 信息架构与交互

### 1. 用户可见形态

`UnifiedLaunchComposer` 默认只包含以下可见元素：

- 一个主输入框
- 一个附件按钮
- 一个提交按钮
- 一个路由结果提示条
- 必要时展开的澄清区
- 可折叠的“高级选项”区域

用户不再先看到：

- `任务命令`
- `高级发起`

这种内部通道命名。

### 2. 统一提交后的反馈文案

统一入口提交后，只反馈用户能理解的结果：

- 已作为快速任务创建
- 已进入附件编排流程
- 检测到需要高级执行，正在切换运行模式
- 仍缺少关键信息，请先补充

系统不直接要求用户理解：

- 现在走的是 workflow path
- 现在走的是 mission path

但调试信息可保留在内部 telemetry 或开发文案里。

## Launch Router 设计

### 1. 输入模型

```ts
interface UnifiedLaunchInput {
  text: string;
  attachments: WorkflowInputAttachment[];
  runtimeMode: "frontend" | "advanced";
  preferredMode?: "auto" | "mission" | "workflow";
}
```

### 2. 路由结果模型

```ts
type LaunchRouteKind =
  | "clarify"
  | "mission"
  | "workflow"
  | "upgrade-required";

interface LaunchRouteDecision {
  kind: LaunchRouteKind;
  reasons: string[];
  requiresAdvancedRuntime: boolean;
  needsClarification: boolean;
  canOverride: boolean;
}
```

### 3. v1 规则判断策略

#### 3.1 强制走 workflow 的信号

- 存在附件
- 文本包含“根据附件 / 根据文档 / 基于表格 / OCR / 从图片提取 / 结合材料”
- 文本包含“先组织团队 / 先拆工作包 / 按附件生成 brief”

#### 3.2 优先走澄清的信号

- 文本过短
- 缺少目标与交付物
- 缺少时限和约束
- 当前 `nl-command-store` 已具备的启发式规则判定为需补问

#### 3.3 需要高级运行时的信号

- 文本包含“运行命令 / 执行脚本 / 打开浏览器 / 沙盒 / 容器 / 抓日志 / 验证页面”
- 文本包含明确的真实执行动作，而非单纯整理建议

#### 3.4 优先走 mission 的信号

- 无附件
- 文本结构较完整
- 更像任务简报或目标下达
- 不需要先组织 workflow 上下文

### 4. v2 可升级方向

v2 可以把 `LaunchRouter` 从规则路由升级为模型辅助路由：

- 先用轻量 prompt 判断请求类型
- 输出结构化判断结果
- 再映射到 mission / workflow / clarify / upgrade-required

但 v1 不依赖该能力上线。

## 组件设计

### 1. `UnifiedLaunchComposer`

职责：

- 维护单一草稿输入
- 维护附件增删
- 展示统一提交按钮和状态
- 承接澄清区
- 接收 `LaunchRouter` 的决策结果
- 调用底层 mission / workflow 提交函数

建议位置：

- `client/src/components/launch/UnifiedLaunchComposer.tsx`

### 2. `LaunchRouter`

职责：

- 纯函数或轻状态服务
- 根据输入生成 `LaunchRouteDecision`
- 不直接操作 UI
- 不直接持久化业务状态

建议位置：

- `client/src/lib/launch-router.ts`

### 3. `UnifiedLaunchCoordinator`

职责：

- 协调 `nl-command-store`、`workflow-store`、`tasks-store`
- 把不同内部返回值整理成统一结果
- 处理聚焦、回落、高亮和提示

建议位置：

- `client/src/lib/unified-launch-coordinator.ts`

## 状态归属

### 1. `tasks-store`

继续负责：

- 任务列表
- 任务详情
- 当前选中任务
- 任务创建后的主真相源

### 2. `workflow-store`

继续负责：

- workflow 列表和详情
- 提交 directive
- workflow 级上下文
- 附件输入的标准化结果

需要扩展：

- `WorkflowCreateResponse` 增加 `missionId?: string | null`
- `submitDirective()` 返回统一结构，而不是只返回 `workflowId`

### 3. `nl-command-store`

继续负责：

- 草稿文本
- 澄清问题
- 计划摘要
- task-hub 路径下的提交和补问

需要调整：

- 从“页面级中心 store”进一步收口为“统一发起入口的一个子能力 store”

### 4. 协调层本地状态

新增轻量 UI 协调状态：

- 当前路由决策
- 当前统一提交状态
- 最近一次提交的统一结果
- 可选的“改走另一条路径”覆盖开关

## 数据契约调整

### 1. workflow 创建响应

当前服务端已返回：

```ts
{
  workflowId: string;
  missionId: string;
  status: "running";
  deduped: boolean;
}
```

前端建议调整为：

```ts
interface WorkflowCreateResponse {
  workflowId?: string;
  missionId?: string | null;
  status?: string;
  deduped?: boolean;
  error?: string;
}
```

### 2. workflow 提交返回值

把 `submitDirective()` 从：

```ts
Promise<string | null>
```

升级为：

```ts
interface WorkflowLaunchResult {
  workflowId: string | null;
  missionId: string | null;
  deduped: boolean;
  route: "workflow";
}
```

### 3. 统一发起返回值

```ts
type UnifiedLaunchResult =
  | {
      route: "mission";
      missionId: string | null;
      commandId?: string;
      status: "created" | "needs_clarification";
    }
  | {
      route: "workflow";
      workflowId: string | null;
      missionId: string | null;
      status: "created";
      pendingLink: boolean;
    }
  | {
      route: "upgrade-required";
      upgraded: boolean;
    };
```

## 页面改造方案

### 1. 办公室驾驶舱

`OfficeTaskCockpit.tsx` 的命令区从：

- `launchMode` 双按钮切换
- 二选一渲染 `TasksCommandDock` 或 `OfficeWorkflowLaunchPanel`

改为：

- 统一渲染 `UnifiedLaunchComposer`
- 将现有两个组件退化为内部复用片段或被抽象掉

### 2. `/tasks` 页

`TasksPage.tsx` 顶部命令区也改为复用 `UnifiedLaunchComposer`，避免办公室和任务页再次分叉。

### 3. 兼容阶段

第一阶段允许：

- `TasksCommandDock` 继续作为内部 mission 子面板存在
- `OfficeWorkflowLaunchPanel` 继续作为内部 workflow 子面板存在

但它们不再以“两个入口组件”的形式直接暴露给用户。

## 迁移阶段

### Phase 1: 统一壳层

- 新增 `UnifiedLaunchComposer`
- 复用现有 mission / workflow 提交逻辑
- 隐藏双按钮入口
- 保留内部双通道

### Phase 2: 打通结果模型

- 扩展 `workflow-store` 消费 `missionId`
- workflow 创建成功后直接聚焦任务
- 兼容旧的 `pendingLaunch` 轮询逻辑作为 fallback

### Phase 3: 收口状态和文案

- 合并重复状态文案
- 统一错误提示
- 抽取共享附件区和澄清区

### Phase 4: 删除旧心智

- 移除 `OfficeLaunchMode`
- 移除用户可见的双入口切换
- 清理只服务旧入口的兼容 UI

## 影响文件

- `client/src/components/office/OfficeTaskCockpit.tsx`
- `client/src/components/tasks/TasksCommandDock.tsx`
- `client/src/components/office/OfficeWorkflowLaunchPanel.tsx`
- `client/src/pages/tasks/TasksPage.tsx`
- `client/src/lib/nl-command-store.ts`
- `client/src/lib/workflow-store.ts`
- `client/src/components/office/office-task-cockpit-types.ts`
- `server/routes/workflows.ts`

## 测试策略

### 1. 路由策略测试

- 文本完整且无附件 -> mission
- 信息不足 -> clarify
- 带附件 -> workflow
- 需要真实执行但当前前端模式 -> upgrade-required

### 2. 集成测试

- 统一入口提交普通任务 -> 自动落任务
- 统一入口补澄清 -> 自动继续创建任务
- 统一入口带附件提交 -> workflow 创建成功并回落 mission
- workflow 创建响应直接带 `missionId` 时，不再必须依赖轮询

### 3. 回归测试

- 办公室驾驶舱右栏任务焦点不丢失
- `/tasks` 页现有任务操作不回退
- workflow 上下文附件展示仍可用
- 前端模式与高级模式切换提示正确

## Worktree 并行建议

- 建议由单一 owner 负责 `OfficeTaskCockpit.tsx`、`TasksPage.tsx`、`nl-command-store.ts`、`workflow-store.ts`
- 若需要并行，组件壳层与 store 契约变更必须由同一 worktree 收口
- 不建议与正在大改办公室布局、任务页布局或 workflow 上下文面板的 worktree 同时推进
