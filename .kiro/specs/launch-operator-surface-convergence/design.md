# Launch Operator Surface Convergence - 设计文档

## 摘要

推荐方案是将任务操作区并入底部发起组件，形成一个共享操作栏；但在内部实现上，发起提交与任务操作仍保持各自独立的动作路径。

这是一次 UI 操作面收敛，不是状态机收敛。

## 为什么可以合并

当前架构本身就已经由父级组件完成组合，具备较好的收敛基础：

- `OfficeTaskCockpit.tsx` 持有发起回调和任务操作回调。
- `TasksPage.tsx` 在任务页场景中同样持有任务操作回调和当前活动任务状态。
- `UnifiedLaunchComposer.tsx` 已经掌管底部操作区与提交 CTA。
- `OperatorActionBar.tsx` 已经封装了任务操作的可用性规则、弹窗和行内反馈。

当前缺的不是数据访问，而是一个共享的展示外壳。

## 当前职责分离

### 底部发起组件职责

`UnifiedLaunchComposer` 当前负责：

- 输入文本
- 指令历史
- 路由决策
- 澄清流程
- 附件上传
- 运行时元信息
- 提交按钮

### 右侧任务操作区职责

`TasksCockpitDetail` 当前渲染：

- 动作引导摘要
- 推荐任务操作
- 紧凑版 `OperatorActionBar`

`OperatorActionBar` 负责：

- 选择主任务操作
- 展示次级操作
- 危险操作区
- 最近一次操作摘要
- 当前阻塞摘要
- 阻塞与终止弹窗
- 行内成功/失败反馈

## 设计决策

### 决策

将任务操作控件移动到底部发起区，并在达到功能对等后移除右侧栏中单独的“任务操作”卡片。

### 原因

这样可以让首屏交互心智更简单：

- 在同一个 dock 中发起或继续澄清
- 在同一个 dock 中控制当前任务
- 右侧栏更多承担上下文、信号和历史职责

这也避免让用户因为面板位置不同，被迫在“创建模式”和“任务控制模式”之间切换思维。

## 建议的信息架构

```text
底部共享操作 Dock
  -> 输入文本框
  -> 发起提交 CTA
  -> 附件入口
  -> 运行时元信息
  -> 当前任务操作状态
  -> 任务操作按钮组
  -> 行内反馈 / 最近操作摘要

右侧栏
  -> 任务摘要
  -> 信号 / 产物 / 下一步
  -> 不再保留独立任务操作卡片
```

## 建议的组件结构

### 1. 扩展 `UnifiedLaunchComposer`

增加可选的任务操作相关 props：

```ts
activeTaskDetail?: MissionTaskDetail | null;
operatorActionLoading?: MissionOperatorActionLoadingMap;
onSubmitOperatorAction?: (payload: {
  action: "pause" | "resume" | "retry" | "mark-blocked" | "terminate";
  reason?: string;
}) => void | Promise<void>;
```

这些 props 允许组件在存在活动任务时渲染任务操作控件，同时仍保持在其他场景中可作为纯发起组件使用。

### 2. 抽离行内任务操作栏

新增一个紧凑型组件，例如：

- `LaunchOperatorActionRail.tsx`

职责包括：

- 展示当前任务操作状态
- 展示最近一次操作摘要
- 将主任务操作按钮放在提交 CTA 附近
- 将次级操作渲染为 chip 或紧凑按钮
- 保留阻塞与终止弹窗行为
- 保留行内成功/失败反馈

这个组件应复用现有任务操作判定辅助逻辑：

- `derivePrimaryActions(...)`
- `resolvePrimaryOperatorAction(...)`
- `missionOperatorActionLabel(...)`
- `missionOperatorActionDescription(...)`

### 3. 收缩 `OperatorActionBar` 的职责边界

如果仍有需要，可保留 `OperatorActionBar` 用于更详细的展示场景，但不再把它作为首屏任务操作的主入口。

第一阶段建议：

- 保留它作为兜底或深层详情场景使用
- 将首屏职责迁移给新的行内任务操作栏

## 共享 Dock 布局

### 桌面端

建议布局：

```text
--------------------------------------------------------
| textarea                                              |
|                                                       |
| [runtime] [attachment count] [latest action summary]  |
|                                   [operator actions]  |
|                                      [submit CTA]     |
--------------------------------------------------------
```

说明：

- 提交按钮仍是最强主 CTA。
- 主任务操作紧邻提交按钮，但视觉权重低于提交按钮。
- 次级任务操作可用描边按钮或溢出 chip 展示。

### 窄宽度 / 移动端

建议响应式回退：

```text
textarea
submit CTA
primary operator action
secondary operator actions (wrap or overflow)
runtime + attachment + latest action summary
```

这样可以避免底部右侧动作区在窄屏场景中过度拥挤。

## 交互规则

### 1. 无活动任务

当没有活动 mission 详情时：

- 只展示发起相关控件
- 隐藏任务操作栏

### 2. 有活动任务且存在可用操作

当存在活动 mission 详情且有可用操作时：

- 展示任务状态 chip
- 展示最近一次操作摘要
- 在提交 CTA 附近展示主任务操作
- 以紧凑形式展示次级操作
- 危险操作通过单独入口或更低优先级位置展示

### 3. 当前处于澄清流程

当发起流程处于澄清中时：

- 提交 CTA 仍以澄清流程为主
- 当前任务的操作控件仍可以保留可见
- 任务操作不能在视觉上与澄清 CTA 抢主次

### 4. Loading

两类 loading 继续彼此独立：

- 发起提交 loading 由 composer 自身提交状态驱动
- 任务操作 loading 由 `operatorActionLoadingByMissionId` 驱动

共享 dock 不能把两者错误合并为一个统一 spinner 状态。

## 迁移计划

### 第一阶段

- 给 `UnifiedLaunchComposer` 增加任务操作相关 props
- 创建行内任务操作栏
- 渲染共享底部操作区
- 暂时保留右侧任务操作卡片，用于功能对等验证

### 第二阶段

- 从 `TasksCockpitDetail` 中移除独立的首屏任务操作卡片
- 保持右侧栏聚焦于摘要、信号和深层详情

### 第三阶段

- 清理重复文案与重复推荐动作展示
- 将测试重点收敛到底部共享操作栏行为

## 受影响文件

- `client/src/components/launch/UnifiedLaunchComposer.tsx`
- `client/src/components/launch/LaunchRuntimeMeta.tsx`
- `client/src/components/launch/LaunchAttachmentSection.tsx`
- `client/src/components/launch/LaunchOperatorActionRail.tsx`（新增）
- `client/src/components/tasks/OperatorActionBar.tsx`
- `client/src/components/tasks/TasksCockpitDetail.tsx`
- `client/src/pages/tasks/TasksPage.tsx`
- `client/src/components/office/OfficeTaskCockpit.tsx`

## 测试策略

1. 保留现有任务操作判定辅助函数测试。
2. 为共享 dock 增加以下场景测试：
   - 无活动任务
   - 活动任务可暂停
   - 活动任务可恢复
   - 活动任务可重试
   - 阻塞操作需要原因
   - 终止操作需要确认
3. 为紧凑布局和窄宽度布局增加响应式渲染检查。
4. 增加回归测试，确保发起提交与任务操作提交仍然彼此独立。
