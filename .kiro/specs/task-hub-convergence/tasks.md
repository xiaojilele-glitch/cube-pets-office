# 实施计划：task-hub-convergence

## 概述

本 spec 负责把任务页从“任务列表页”升级成“任务中台”，让命令输入、计划摘要、任务列表、执行进度和人工干预聚合到同一个页面。

## Worktree 并行建议

- 建议由单独 worktree 独占 `TasksPage`、`TaskDetailView`、`nl-command` 页面与 store
- 与导航 spec 并行时，只共享 `/tasks` 这个目标路由，不共享页面实现文件
- 在本 spec 落地前，不建议其他 worktree 同时重排任务页布局

## Tasks

- [ ] 1. 抽取指挥中心可复用能力
  - [ ] 1.1 盘点 `client/src/pages/nl-command/CommandCenterPage.tsx` 的可迁移区块
    - 命令输入
    - 计划摘要
    - 澄清问题
    - 监控摘要
    - _Requirements: 1.1.1, 1.1.2_
  - [ ] 1.2 将 `components/nl-command/*` 抽成可嵌入任务页的组件
    - _Requirements: 1.1.3, 5.1.1_

- [ ] 2. 扩展任务页顶部命令区
  - [ ] 2.1 更新 `client/src/pages/tasks/TasksPage.tsx`
    - 在第一屏接入命令输入区
    - 显示计划摘要与澄清入口
    - _Requirements: 1.1.1, 2.1.1_
  - [ ] 2.2 保持现有任务列表与详情联动
    - _Requirements: 2.1.1, 2.1.3_

- [ ] 3. 打通命令与任务闭环
  - [ ] 3.1 更新 `client/src/lib/nl-command-store.ts`
    - 暴露命令提交结果与可定位元数据
    - _Requirements: 4.1.2_
  - [ ] 3.2 在任务页容器中建立命令提交后的任务定位逻辑
    - 新建任务自动选中
    - 相关任务高亮或滚动定位
    - _Requirements: 2.1.2, 4.1.3, 5.1.3_

- [ ] 4. 收口独立指挥中心
  - [ ] 4.1 更新 `client/src/pages/nl-command/CommandCenterPage.tsx`
    - 改为兼容页、迁移说明页或重定向页
    - _Requirements: 5.1.1, 5.1.2_
  - [ ] 4.2 更新路由文案与入口说明
    - _Requirements: 3.1.1, 3.1.3_

- [ ] 5. 测试与验证
  - [ ] 5.1 编写命令提交流程测试
  - [ ] 5.2 编写任务定位与联动测试
  - [ ] 5.3 手动验证“提命令 -> 进任务 -> 做干预”闭环

## Notes

- 本 spec 的核心判定标准是：用户不再需要单独进入 `CommandCenterPage` 才能开始工作
- 若短期无法彻底收口 `nl-command-store`，也必须先把它降为任务页内的辅助能力，而不是并列中心
