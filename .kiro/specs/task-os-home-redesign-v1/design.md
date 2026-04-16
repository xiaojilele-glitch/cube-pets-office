# 任务操作系统首页重构方案 v1 设计

## 现状问题

当前首页的主要问题不是某个组件不好看，而是结构混乱：

- `Home.tsx` 责任过重
- 3D 场景视觉过强，但任务主线不够聚焦
- 输入、澄清、工作流、遥测、任务驾驶舱并列出现
- 用户不清楚“当前任务中心”到底在哪里

## 目标结构

首页重构后固定为以下骨架：

```text
顶部状态条
左侧场景区 | 中间任务主线区 | 右侧控制区
底部运行区
```

## 模块建议

- `OfficeShellHeader`
- `OfficeScenePane`
- `MissionFlowPane`
- `MissionControlPane`
- `RuntimeDock`

## 区域职责

### 顶部状态条

只放少量全局状态：

- 当前模式
- 当前任务标题
- 全局状态摘要
- 必要的全局操作

不再堆放复杂导航。

### 左侧场景区

承接已有 3D 办公室场景，但必须降级为“状态背景层”。
保留：

- 房间主体
- 当前任务焦点
- agent 活动态

弱化：

- 抢注意力的装饰性内容
- 与主流程无关的卡片型浮层

### 中间任务主线区

这是首页唯一主中心。

应包含：

- 当前任务标题
- 步骤流
- 当前步骤高亮
- 当前阻塞原因
- 当前结果摘要

不应被场景标签或驾驶舱卡片干扰。

### 右侧控制区

统一接入：

- `TaskHubCommandPanel` 的输入能力
- `ClarificationPanel`
- decision 操作
- cancel / retry / resume

不再让用户去独立命令中心页面做这些事情。

### 底部运行区

统一承接运行时证据：

- `Logs`
- `Artifacts`
- `Runtime`

默认打开 `Logs`，其他区可通过 tabs 或折叠切换。

## 代码落点

- `client/src/pages/Home.tsx`
- `client/src/components/Scene3D.tsx`
- `client/src/components/nl-command/TaskHubCommandPanel.tsx`
- `client/src/components/nl-command/ClarificationPanel.tsx`
- `client/src/components/office/OfficeTaskCockpit.tsx`
- 与任务队列、任务详情关联的首页组件

## 风险

- `Home.tsx` 当前耦合较重，建议分阶段拆组件
- 不应在本轮同时重写全部任务详情能力
- 3D 视觉降级必须控制在“弱化抢戏”，而不是直接砍掉空间感
