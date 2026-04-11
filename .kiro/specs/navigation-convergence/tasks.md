# 实施计划：navigation-convergence

## 概述

本 spec 负责先把系统主导航从“功能陈列式”改成“主路径导向式”，为后续任务中台和工作流拆解提供稳定骨架。

## Worktree 并行建议

- 建议独立 worktree owner 负责 `App.tsx / Home.tsx / Toolbar.tsx`
- 与 `task-hub-convergence` 并行时，约定 `TasksPage` 由另一 worktree 独占
- 暂不在本 spec 内直接拆 `WorkflowPanel` 内容，避免与后续 spec 交叉冲突

## Tasks

- [ ] 1. 定义导航收口映射
  - [ ] 1.1 梳理现有一级入口到新信息架构的映射表
    - `office` -> `/`
    - `tasks` -> `/tasks`
    - `more` -> 配置 / 权限 / 审计 / 血缘 / 帮助
    - _Requirements: 1.1.1, 3.1.1, 4.1.1_
  - [ ] 1.2 明确旧入口兼容策略
    - `/command-center` 是否重定向或显示过渡提示
    - _Requirements: 5.1.1, 5.1.2_

- [ ] 2. 重构主导航组件
  - [ ] 2.1 更新 `client/src/components/Toolbar.tsx`
    - 收敛为 `办公室 / 任务 / 更多`
    - 保留 active 状态与可访问性
    - _Requirements: 1.1.1, 1.1.3_
  - [ ] 2.2 若仍使用 HoloDock 变体，统一处理 `client/src/components/HoloDock.tsx`
    - 避免遗留双套导航语义
    - _Requirements: 1.1.2_

- [ ] 3. 实现 `更多` 收纳层
  - [ ] 3.1 新增 `MoreDrawer` 或等效组件
    - 收纳配置、权限、审计、血缘、帮助
    - _Requirements: 4.1.1, 4.1.2_
  - [ ] 3.2 为低频页面补充返回主路径入口
    - _Requirements: 4.1.3, 5.1.3_

- [ ] 4. 更新首页与路由骨架
  - [ ] 4.1 更新 `client/src/pages/Home.tsx`
    - 明确 `办公室` 首页定位
    - 增加进入 `任务` 的 CTA 或显式跳转入口
    - _Requirements: 2.1.1, 2.1.3_
  - [ ] 4.2 更新 `client/src/App.tsx`
    - 保留旧路由
    - 接入新导航语义
    - _Requirements: 5.1.1, 5.1.2_

- [ ] 5. 回归验证
  - [ ] 5.1 编写导航与抽屉交互测试
  - [ ] 5.2 手动验证桌面端 / 移动端主路径
  - [ ] 5.3 验证旧路由书签不失效

## Notes

- 这个 spec 的完成标准不是“按钮数量变少”，而是“用户能自然进入办公室或任务主线”
- `任务` 页的真正承载能力由 `task-hub-convergence` 负责，本 spec 只建立外层骨架
