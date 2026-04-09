# Task Detail Operations First - 需求文档

## 概述

当前任务详情页的信息量很大，但首屏优先级不够清晰：

- Tabs、日志、产物、成本、决策都很丰富
- 真正最关键的“我现在能做什么”“谁在负责”“卡在哪”“下一步是什么”没有被放在第一优先级

这会让用户感觉它更像一个观察面板，而不是执行工作台。本 spec 的目标，是把任务详情页第一屏重排为“操作优先、责任清晰、阻塞可见、下一步明确”的执行界面。

## 设计目标

1. 第一屏优先展示操作和决策，不让用户先陷入 tabs 和日志
2. 让用户一眼看到当前负责人、阻塞项、下一步动作
3. 保留原有执行、产物、成本等深层信息，但下沉为二级区域
4. 桌面与移动端都能保持清晰的信息顺序

## 依赖关系

- 依赖 `mission-cancel-control`
- 依赖 `mission-operator-actions`

## 非目标

- 本 spec 不重新设计整站视觉风格
- 本 spec 不引入新的任务业务状态
- 本 spec 不修改 executor 底层执行逻辑

## 用户故事与验收标准

### 1. 第一屏主操作区

#### 1.1 作为用户，我希望一打开任务详情就看到当前主操作，而不是先在多个 tab 之间寻找

- AC 1.1.1: 任务详情页首屏 SHALL 显示统一主操作区
- AC 1.1.2: 主操作区 SHALL 优先展示当前最相关动作，例如 `Cancel`、`Pause`、`Resume`、`Retry`、`Submit decision`
- AC 1.1.3: 若当前没有可执行动作，界面 SHALL 明确显示“当前无需人工干预”
- AC 1.1.4: 危险动作与普通动作 SHALL 分层展示

### 2. 当前负责人

#### 2.1 作为用户，我希望知道当前是谁在负责这个任务，以便快速判断接力点

- AC 2.1.1: 首屏 SHALL 显示 `Current owner`
- AC 2.1.2: 若存在活跃 agent、assignee、executor 或 manager 信息，界面 SHALL 优先展示最具体的负责人
- AC 2.1.3: 若没有明确个人负责人，界面 SHALL 回退展示当前执行主体，例如 `Executor runtime`、`Manager review`、`Waiting for user`
- AC 2.1.4: 当前负责人信息 SHALL 附带当前阶段或动作摘要

### 3. Blocker 与等待原因

#### 3.1 作为用户，我希望在任务被阻塞、等待决策或暂停时，第一时间看到原因

- AC 3.1.1: 若 Mission 存在 blocker，首屏 SHALL 显示阻塞卡片
- AC 3.1.2: 若 Mission 处于 `waiting`，首屏 SHALL 显示等待原因与待决策提示
- AC 3.1.3: 若 Mission 处于 `paused`，首屏 SHALL 显示暂停来源与原因
- AC 3.1.4: blocker / waiting / paused 的展示 SHALL 具有明显视觉区分

### 4. 下一步动作

#### 4.1 作为用户，我希望系统能告诉我现在的下一步是什么，而不是只给状态

- AC 4.1.1: 首屏 SHALL 显示 `Next step`
- AC 4.1.2: `Next step` SHALL 根据 Mission status、operatorState、decision、executor 信息动态生成
- AC 4.1.3: 若需要用户动作，`Next step` 文案 SHALL 指向具体操作
- AC 4.1.4: 若任务在自动执行中，`Next step` 文案 SHALL 说明系统接下来预计发生什么

### 5. 信息层级重排

#### 5.1 作为用户，我希望首屏先看执行决策信息，二级区域再看日志和分析细节

- AC 5.1.1: 第一屏信息顺序 SHALL 优先为：状态摘要 -> 主操作 -> 当前负责人 -> blocker / waiting -> next step
- AC 5.1.2: 现有 tabs 区域 SHALL 继续保留，但下移到首屏总结区之后
- AC 5.1.3: Artifacts、Execution、Cost、Timeline 等深层信息 SHALL 作为二级信息，不抢主操作注意力

### 6. 响应式体验

#### 6.1 作为移动端用户，我希望第一屏仍然有清晰的信息顺序，而不是桌面布局被简单压缩

- AC 6.1.1: 桌面端 SHALL 采用双栏或分区布局承载主操作摘要
- AC 6.1.2: 移动端 SHALL 采用单列堆叠布局
- AC 6.1.3: 在移动端，主操作按钮 SHALL 保持在首屏可见范围内

## 约束与风险

- “当前负责人”和“下一步动作”可能需要从现有 detail 数据派生，而不是直接后端返回
- 若第一屏承载过多信息，会再次失去层级，因此需要严格控制模块数量
