# 实施计划：office-task-cockpit

## 概述

本 spec 负责把桌面端办公室推进为默认执行工作台：在办公室一屏中收口任务队列、主操作、任务详情和 workflow 上下文，同时保留 `/tasks` 作为全屏工作台与深链页。

## Worktree 并行建议

- 建议由单独 owner 覆盖 `Home.tsx`、`components/tasks/*`、`components/office/*`
- 如存在其他高频 worktree，优先先做壳层与 tab 容器，再合并右栏内容装配
- 避免与大范围改 `WorkflowPanelCompatibility` 或移动端布局的工作并行

## Tasks

- [ ] 1. 定义办公室驾驶舱壳层与 tab 状态
  - [ ] 1.1 在办公室桌面壳层中定义三栏驾驶舱布局与命令区落点
    - _Requirements: 1.1.1, 2.1.1, 2.1.3_
  - [ ] 1.2 定义 `OfficeCockpitTab`、`OfficeLaunchMode`、`OfficeLaunchResolution` 等本地 UI 状态
    - _Requirements: 4.1.1, 5.1.1, 6.1.3_

- [ ] 2. 将任务队列与主操作内嵌到办公室
  - [ ] 2.1 在办公室左栏接入 `TasksQueueRail`
    - _Requirements: 2.1.1, 2.1.2, 5.1.1_
  - [ ] 2.2 在办公室命令区接入 `TasksCommandDock`，形成统一发起与主操作入口
    - _Requirements: 2.1.3, 3.1.1, 3.1.2_

- [ ] 3. 将任务详情改为右侧默认 tab
  - [ ] 3.1 为右栏增加 `任务 / 团队流 / Agent / 记忆报告 / 历史` tab 容器
    - _Requirements: 4.1.1, 4.1.2_
  - [ ] 3.2 让 `任务` tab 默认渲染 `TasksCockpitDetail` 并保持现有 operator action 闭环
    - _Requirements: 4.1.1, 5.1.1, 5.1.3_

- [ ] 4. 将 workflow 上下文拆成 `团队流 / Agent / 记忆报告 / 历史`
  - [ ] 4.1 在 `团队流` tab 中收口 stage / org / role summary / attachments / artifact summary
    - _Requirements: 4.1.2, 4.1.3_
  - [ ] 4.2 在 `Agent` 与 `记忆报告` tab 中接入办公室 Agent 上下文、memory 与 heartbeat reports
    - _Requirements: 4.1.2, 5.1.2_
  - [ ] 4.3 在 `历史` tab 中接入 workflow history / sessions compatibility summary
    - _Requirements: 4.1.2, 6.1.2_

- [ ] 5. 实现统一发起入口与双通道焦点回落
  - [ ] 5.1 将普通任务创建与 NL command 保留在统一入口内
    - _Requirements: 3.1.1, 3.1.2_
  - [ ] 5.2 将 directive + attachment 的高级发起接入同一个办公室入口壳
    - _Requirements: 3.1.1, 3.1.3_
  - [ ] 5.3 实现高级发起从 workflow 到 mission 的待解析态与自动聚焦回落
    - _Requirements: 3.1.2, 5.1.1, 5.1.3_

- [ ] 6. 做兼容、回归与桌面手测
  - [ ] 6.1 保留 `/tasks`、`/tasks/:taskId` 与旧兼容入口行为
    - _Requirements: 6.1.1, 6.1.2_
  - [ ] 6.2 补充 tab 切换、任务聚焦、Agent 联动与高级发起待解析态测试
    - _Requirements: 5.1.1, 5.1.2, 5.1.3_
  - [ ] 6.3 手动验证桌面端三栏驾驶舱与移动端保守兼容行为
    - _Requirements: 1.1.1, 2.1.1, 6.1.3_

## Notes

- 关键不是把 `/tasks` 删除，而是把办公室变成运行时主壳
- V1 只做桌面端驾驶舱，移动端保守兼容
- 高级发起先统一入口，不强行统一后端协议
