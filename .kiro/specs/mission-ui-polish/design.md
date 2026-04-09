# Mission UI Polish - 设计文档

## 概述

本设计为任务控制台建立一套更稳的交互打磨规则，重点不是“更炫”，而是“更清楚、更不费劲、更不容易误判状态”。

## 设计原则

1. 清晰优先于装饰
2. 反馈优先于动画
3. 一屏只强调一个主要动作
4. 错误提示必须带建议

## 重点改造面

### 1. Action Feedback

为关键操作统一反馈模式：

- 提交中：按钮 loading + 文案变化
- 成功：状态标签/卡片即时更新
- 失败：inline error + retry affordance

### 2. Button Hierarchy

建议层级：

- Primary: 当前最应该做的动作
- Secondary: 其他安全动作
- Destructive: terminate / cancel

### 3. Status Stack

在任务详情首屏统一展示：

- 执行状态 badge
- operatorState badge
- 最近更新时间
- executor 连通性 / runtime 简报

### 4. Empty / Error States

所有空态与错误态都需要带原因和下一步建议。

示例：

- “尚未产生产物。任务还在运行中，稍后这里会出现执行结果。”
- “未获取到日志。任务可能尚未开始，或 executor 尚未返回日志文件。”

## 实现策略

### 1. 组件级抽象

建议新增轻量复用组件：

- `ActionFeedbackInline`
- `StatusPillStack`
- `EmptyHintBlock`
- `RetryInlineNotice`

### 2. 统一状态色

建议为以下状态定义稳定映射：

- running
- waiting
- paused
- blocked
- done
- cancelled
- failed

危险态与终止态不要都用同一红色。

### 3. 动效边界

允许：

- 状态变化淡入
- blocker 卡片高亮
- 新结果卡片轻量 reveal

避免：

- 频繁跳动
- 大面积闪烁
- 与执行控制无关的装饰动画

## 覆盖范围

优先覆盖：

- TaskDetailView
- TasksPage 列表状态
- ArtifactPreview / ArtifactList 的空态和错误态
- ExecutorTerminalPanel / ExecutorStatusPanel 的错误提示

## 测试策略

- loading / success / error UI 状态测试
- destructive action hierarchy 测试
- empty state copy 测试
- mobile / desktop 快速回归检查

## 交付顺序

1. 统一状态 badge 与按钮层级
2. 统一 action feedback
3. 补空态 / 错误态
4. 最后加轻量过渡效果
