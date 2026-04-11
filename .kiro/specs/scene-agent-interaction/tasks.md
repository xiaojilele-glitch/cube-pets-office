# 实施计划：scene-agent-interaction

## 概述

本 spec 负责把办公室场景从“展示层”升级成“可交互态势入口”，让用户点击 Agent 就能继续深入，而不是看完一眼就离开。

## Worktree 并行建议

- 建议单独 worktree owner 负责 `Home / Scene3D / three/*`
- 若导航 worktree 仍在改 `Home.tsx`，先只做 `PetWorkers`、侧栏组件和场景配置，最后再并线
- 依赖的 Agent 记忆 / 报告接口优先通过稳定 selector 接入，避免直接耦合旧面板实现

## Tasks

- [ ] 1. 定义 Agent 侧栏数据模型
  - [ ] 1.1 盘点角色、部门、心跳、信誉、当前任务、记忆、报告所需字段
    - _Requirements: 1.1.2, 1.1.3_
  - [ ] 1.2 设计侧栏视图状态与空态
    - _Requirements: 4.1.2, 4.1.3_

- [ ] 2. 实现 Agent 详情侧栏
  - [ ] 2.1 新增 `AgentDetailDrawer` 或等效组件
    - _Requirements: 1.1.1, 1.1.2_
  - [ ] 2.2 更新 `client/src/components/three/PetWorkers.tsx`
    - 点击 Agent 打开侧栏
    - _Requirements: 1.1.1_
  - [ ] 2.3 更新 `client/src/pages/Home.tsx`
    - 接入侧栏容器
    - _Requirements: 1.1.3_

- [ ] 3. 实现办公室公告板
  - [ ] 3.1 新增关键指标摘要组件
    - 执行中任务数
    - 阻塞 Agent 数
    - 成本 / Token 摘要
    - _Requirements: 2.1.1, 2.1.2_
  - [ ] 3.2 提供跳转到相关任务的入口
    - _Requirements: 2.1.3_

- [ ] 4. 实现场景阶段流线
  - [ ] 4.1 新增 stage-to-zone 映射配置
    - _Requirements: 3.1.2_
  - [ ] 4.2 在 `Scene3D.tsx` 或 `OfficeRoom.tsx` 中渲染任务流线
    - _Requirements: 3.1.1, 3.1.3_

- [ ] 5. 演示模式与回归验证
  - [ ] 5.1 补充无服务端时的解释文案
  - [ ] 5.2 编写场景交互测试
  - [ ] 5.3 手动验证桌面端 / 移动端侧栏与公告板表现

## Notes

- 先让 Agent 侧栏“有用”，再做流线特效；顺序不要反
- 场景流线必须依赖稳定的 stage 语义，不能变成一次性视觉演示
