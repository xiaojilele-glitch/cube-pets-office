# 实施计划：office-cockpit-first-screen-refresh

## 概述

本 spec 负责在 `office-task-cockpit` 已收口能力的基础上，对桌面端办公室首屏做风格重构：保留任务、workflow、Agent、记忆、历史与主操作能力，不通过删功能换整洁，而是把首屏主次关系重新排好。

## Worktree 并行建议

- 建议单独 owner 覆盖 `Home.tsx`、`OfficeTaskCockpit.tsx` 与 `index.css`，统一处理桌面壳层、Scene HUD 与驾驶台节奏。
- 建议同一 owner 负责 `TasksCockpitDetail`、`OfficeWorkflowContextPanels`、`OfficeAgentInspectorPanel` 的右栏 panel shell 与渐进展开。
- 如存在其他高频 UI worktree，避免同时大改 `Home.tsx`、`TasksQueueRail.tsx`、`TasksCommandDock.tsx` 与 `TasksCockpitDetail.tsx`。

## Tasks

- [ ] 1. 收敛桌面顶层壳层与 cockpit 头部
  - [ ] 1.1 精简 `Home` 顶栏，只保留品牌、runtime mode 与全局入口
    - _Requirements: 1.1.1, 1.1.2, 1.1.3, 6.1.3_
  - [ ] 1.2 将 `OfficeTaskCockpit` 顶部摘要重构为低占高 meta strip，移除重型 header card
    - _Requirements: 1.1.2, 1.1.3_

- [ ] 2. 重构中栏 Scene HUD 与统一驾驶台
  - [ ] 2.1 在中栏上沿实现轻量 `scene HUD`，承接当前焦点任务、状态、阶段与联动提示
    - _Requirements: 2.1.1, 2.1.2, 2.1.3_
  - [ ] 2.2 用统一驾驶台外壳包裹 `TasksCommandDock` 与 `OfficeWorkflowLaunchPanel`
    - _Requirements: 3.1.1, 3.1.2, 3.1.3_

- [ ] 3. 重排右栏任务 tab 为操作优先
  - [ ] 3.1 将 `任务` tab 重构为 `sticky summary + primary action zone + progressive detail sections`
    - _Requirements: 4.1.1, 4.1.2, 4.1.3_
  - [ ] 3.2 提升失败任务的真实失败信号到右栏首层
    - _Requirements: 4.1.4_

- [ ] 4. 重组右栏其他 tab 与统一 panel shell
  - [ ] 4.1 统一 `团队流 / Agent / 记忆 / 历史` 的 panel shell、留白节奏与滚动区域
    - _Requirements: 4.1.3, 6.1.1_
  - [ ] 4.2 保持任务 / Agent / 场景联动与 tab 切换逻辑稳定
    - _Requirements: 2.1.2, 3.1.3, 6.1.2_

- [ ] 5. 降噪左侧队列并调整三栏宽度
  - [ ] 5.1 压缩左侧任务卡密度，保留状态、warning、阶段、进度与更新时间
    - _Requirements: 5.1.1, 5.1.2, 5.1.3_
  - [ ] 5.2 调整左中右三栏宽度策略，优先保证 `Scene3D` 与右栏主操作可读性
    - _Requirements: 6.1.1_

- [ ] 6. 做兼容回归与桌面手测
  - [ ] 6.1 回归 `/tasks`、`/tasks/:taskId`、`ChatPanel`、`TelemetryDashboard` 与兼容入口行为
    - _Requirements: 6.1.2, 6.1.3_
  - [ ] 6.2 补充桌面宽度与联动场景手测，覆盖 1280 / 1440 / 1728+ 断点
    - _Requirements: 2.1.1, 3.1.1, 4.1.2, 6.1.1, 6.1.4_

## Notes

- 关键不是减少功能，而是把首屏主次关系重新排好。
- `Scene3D` 仍是首屏主视觉，命令区仍是唯一主操作中心。
- `/tasks`、移动端与覆盖层入口本轮只做兼容，不做主路径重构。
