# 实施计划：api-fallback-empty-states

## 概述

本 spec 负责消灭裸露技术报错，并给多个空白页面补上可解释、可恢复的用户体验。

## Worktree 并行建议

- 建议先由独立 worktree owner 做公共请求层和低冲突 store 接入
- 高频任务路径放到第二阶段，与任务中台和工作流拆解 worktree 协调
- 适合作为并行执行的“基础设施型 spec”

## Tasks

- [x] 1. 建立公共请求兜底层
  - [x] 1.1 新增轻量 `fetchJsonSafe` 或等效工具
    - 识别 HTML fallback、非 JSON 响应、网络错误
    - _Requirements: 1.1.1, 1.1.2_
  - [x] 1.2 定义统一错误模型
    - 区分 demo/offline/error
    - _Requirements: 1.1.3, 3.1.2, 3.1.3_

- [x] 2. 接入低冲突 store
  - [x] 2.1 改造 `lineage-store / audit-store / permission-store / reputation-store`
    - _Requirements: 1.1.2, 3.1.1_
  - [x] 2.2 改造 `telemetry-store / cost-store`
    - _Requirements: 1.1.2, 3.1.1_

- [x] 3. 补重点页面空态与错误态
  - [x] 3.1 更新血缘页、历史会话、报告等空态
    - _Requirements: 2.1.1, 2.1.2, 2.1.3_
  - [x] 3.2 为错误态增加 retry 入口与建议动作
    - _Requirements: 3.1.1, 3.1.2_

- [x] 4. 接入高频路径
  - [x] 4.1 与主路径 worktree 协调后接入 `workflow-store`
    - _Requirements: 1.1.2, 3.1.3_
  - [x] 4.2 协调接入任务页高频请求与 `ChatPanel`
    - _Requirements: 1.1.2, 3.1.1_

- [x] 5. 测试与验证
  - [x] 5.1 编写请求兜底单元测试
  - [x] 5.2 编写空态 / 错误态交互测试（已补首批组件 / store 覆盖，并补第二批 `workflow-store / mission-client / ChatPanel / WorkflowErrorNotice / RetryInlineNotice` 回归与交互覆盖）
  - [x] 5.3 手动验证离线 / 演示模式文案
    - 文档见 `manual-verification.md`

## Notes

- 这类治理最怕“一次想接全站”，建议严格分批
- 第一批先证明模式有效，第二批再进任务主链，worktree 冲突最小
