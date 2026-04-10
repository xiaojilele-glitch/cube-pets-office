# 实施计划：mission-ui-polish

## 概述

本任务对任务控制台做交互与信息表达层面的打磨，提升完成度与可用性。

## Tasks

- [x] 1. 统一关键动作反馈
  - [x] 1.1 梳理 cancel / pause / resume / retry / terminate 的 loading / success / error 状态
  - [x] 1.2 提炼复用反馈组件或模式
    - _Requirements: 1.1.1, 1.1.2, 1.1.3_

- [x] 2. 统一按钮层级
  - [x] 2.1 为首屏主操作定义唯一 primary 规则
  - [x] 2.2 将 destructive 动作与普通动作分区
    - _Requirements: 2.1.1, 2.1.2, 2.1.3_

- [x] 3. 统一状态可见性
  - [x] 3.1 统一状态标签组件与颜色映射
  - [x] 3.2 接入最近更新时间与操作状态展示
    - _Requirements: 3.1.1, 3.1.2, 3.1.3_

- [x] 4. 补全空态与错误态
  - [x] 4.1 Artifacts / Logs / Decisions 空态文案与占位
  - [x] 4.2 executor / artifact / log 加载失败的错误提示与 retry 入口
    - _Requirements: 4.1.1, 4.1.2, 4.1.3, 5.1.1, 5.1.2, 5.1.3_

- [x] 5. 轻量过渡与高亮
  - [x] 5.1 为状态变化添加轻量过渡
  - [x] 5.2 为 blocker / 新结果摘要添加适度强调
    - _Requirements: 6.1.1, 6.1.2_

- [ ] 6. 测试与回归
  - [x] 6.1 编写关键组件测试
  - [ ] 6.2 手动检查桌面 / 移动端表现
  - [ ] 6.3 回归 destructive action 误触风险

## Notes

- 该 spec 不新增业务能力，重点在体验完成度
- 动效只服务状态理解，不做展示型炫技
