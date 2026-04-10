# 实施计划：task-detail-operations-first

## 概述

本任务重排任务详情页第一屏，让用户优先看到操作、负责人、阻塞项和下一步动作，tabs 与深层信息后移。

## Tasks

- [x] 1. 梳理首屏所需派生数据
  - [x] 1.1 在 `client/src/lib/tasks-store.ts` 或 `client/src/components/tasks/task-helpers.ts` 中新增派生函数
    - `derivePrimaryActions`
    - `deriveCurrentOwner`
    - `deriveTaskBlocker`
    - `deriveNextStep`
    - _Requirements: 1.1.2, 2.1.1, 3.1.1, 4.1.2_
  - [x] 1.2 为派生逻辑编写测试
    - waiting / running / blocked / paused / failed / done
    - _Requirements: 2.1.2, 3.1.2, 4.1.2_

- [x] 2. 新增首屏摘要组件
  - [x] 2.1 创建 `TaskOperationsHero` 或等效组件
    - 展示主状态、operatorState、更新时间、摘要
    - _Requirements: 1.1.1, 5.1.1_
  - [x] 2.2 创建摘要卡片组件
    - `Current owner`
    - `Blocker / waiting`
    - `Next step`
    - `Current stage / runtime`
    - _Requirements: 2.1.1, 3.1.1, 4.1.1_

- [x] 3. 接入主操作条
  - [x] 3.1 将 `OperatorActionBar` 集成到任务详情页首屏
    - 危险动作与普通动作分层
    - 无动作时展示被动提示
    - _Requirements: 1.1.2, 1.1.3, 1.1.4_
  - [x] 3.2 接入 waiting decision 场景
    - 在首屏显示待决策提示
    - 保持与 `DecisionPanel` 协同
    - _Requirements: 3.1.2, 4.1.3_

- [x] 4. 重排 `TaskDetailView.tsx`
  - [x] 4.1 将 tabs 区域下移到首屏摘要之后
    - 保留现有 Overview / Execution / Decisions / Artifacts / Cost
    - _Requirements: 5.1.2, 5.1.3_
  - [x] 4.2 调整首屏布局
    - 桌面端采用分区布局
    - 移动端采用单列堆叠
    - _Requirements: 6.1.1, 6.1.2, 6.1.3_

- [ ] 5. 回归测试与验证
  - [x] 5.1 编写组件测试
    - 第一屏模块顺序
    - 当前负责人展示
    - blocker 优先级
    - next step 文案
    - _Requirements: 2.1.4, 3.1.4, 4.1.4_
  - [ ] 5.2 手动验证首屏使用路径
    - running Mission
    - waiting Mission
    - blocked / paused Mission
    - done Mission

## Notes

- 第一屏不要再继续堆新面板，新增信息必须服务于“更快决策”。
- 若某些摘要信息缺少明确后端字段，优先使用客户端派生，避免一次性拉大后端改动。
