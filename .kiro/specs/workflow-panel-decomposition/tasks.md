# 实施计划：workflow-panel-decomposition

## 概述

本 spec 负责拆解 `WorkflowPanel` 的“大杂烩”职责，把每个 tab 的内容迁移到更合理的页面与交互位置。

## Worktree 并行建议

- 建议在 `navigation-convergence` 和 `task-hub-convergence` 第一版合并后再启动
- worktree owner 尽量独占 `WorkflowPanel.tsx` 与 `workflow-store.ts`
- 与 `scene-agent-interaction` 并行时，只通过稳定的 selector 或数据 contract 协作

## Tasks

- [x] 1. 建立 tab 迁移映射与共享 selector
  - [x] 1.1 盘点 `WorkflowPanel.tsx` 中各视图的数据依赖
    - _Requirements: 1.1.1, 2.1.1, 3.1.1_
  - [x] 1.2 在 `client/src/lib/workflow-store.ts` 或辅助模块中提炼可复用 selector
    - _Requirements: 4.1.1_

- [x] 2. 迁移任务相关视图
  - [x] 2.1 将 `workflow` 内容迁入任务页执行区
    - _Requirements: 1.1.1, 1.1.3_
  - [x] 2.2 将 `review` 内容迁入任务详情评审区
    - _Requirements: 1.1.1_
  - [x] 2.3 将 `history` 迁入任务列表筛选或历史视图
    - _Requirements: 1.1.2_

- [x] 3. 迁移 Agent 相关视图
  - [x] 3.1 将 `org` 迁入办公室场景的 Agent/组织信息层
    - _Requirements: 2.1.1_
  - [x] 3.2 将 `memory` 与 `reports` 迁入 Agent 详情侧栏
    - _Requirements: 2.1.2, 2.1.3_

- [x] 4. 收口命令与会话视图
  - [x] 4.1 将 `directive` 收口到任务页命令区
    - _Requirements: 3.1.1_
  - [x] 4.2 将 `sessions` 收口到任务上下文会话或兼容历史区
    - _Requirements: 3.1.2_

- [x] 5. 降级旧 WorkflowPanel
  - [x] 5.1 将 `WorkflowPanel` 改为兼容层或迁移说明层
    - _Requirements: 4.1.1, 4.1.2_
  - [x] 5.2 从首页主路径中移除其一级依赖
    - _Requirements: 4.1.3_

- [ ] 6. 测试与验证
  - [x] 6.1 编写兼容跳转与迁移测试
  - [ ] 6.2 手动验证各类信息仍可达
  - [ ] 6.3 回归首页、任务页与 Agent 详情路径

## Notes

- 这个 spec 的关键不是“删掉一个面板”，而是“让内容回到自然场景”
- 若迁移目标未就绪，允许 `WorkflowPanel` 先变成兼容壳，但不应继续增加新职责
