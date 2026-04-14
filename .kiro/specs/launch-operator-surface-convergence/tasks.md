# Launch Operator Surface Convergence - 任务拆解

## 概述

本计划将在不修改后端契约的前提下，把首屏任务操作控件并入底部发起提交区域。

## Tasks

- [x] 1. 审计并统一首屏动作归属
  - [x] 1.1 确认 `UnifiedLaunchComposer` 已具备的全部发起相关 props
  - [x] 1.2 确认 `OfficeTaskCockpit.tsx` 与 `TasksPage.tsx` 已具备的任务操作相关 props
  - [x] 1.3 记录右侧任务操作区中哪些元素需要迁移，哪些应该保留

- [x] 2. 扩展底部发起组件契约
  - [x] 2.1 为 `UnifiedLaunchComposer` 增加可选的活动任务与任务操作 props
  - [x] 2.2 确保在未传入任务详情时，组件仍保持向后兼容

- [x] 3. 构建行内任务操作栏
  - [x] 3.1 创建适用于底部 dock 的紧凑型任务操作组件
  - [x] 3.2 复用现有任务操作可用性与文案辅助逻辑
  - [x] 3.3 保留 `mark-blocked` 原因输入流程
  - [x] 3.4 保留 `terminate` 确认流程
  - [x] 3.5 保留行内成功与错误反馈

- [x] 4. 合并 dock 布局
  - [x] 4.1 将主任务操作放置在提交 CTA 附近
  - [x] 4.2 在 dock 元信息行中渲染任务状态与最近操作摘要
  - [x] 4.3 保证运行时信息与附件入口在合并布局中仍然易用
  - [x] 4.4 为窄宽度场景补充响应式回退行为

- [x] 5. 改造父级页面接线
  - [x] 5.1 从 `OfficeTaskCockpit.tsx` 向 `UnifiedLaunchComposer` 传入活动任务详情与任务操作回调
  - [x] 5.2 从 `TasksPage.tsx` 向 `UnifiedLaunchComposer` 传入活动任务详情与任务操作回调
  - [x] 5.3 验证任务操作 loading map 仍正确绑定到当前选中 mission

- [x] 6. 退役重复的首屏任务操作 UI
  - [x] 6.1 移除或弱化 `TasksCockpitDetail` 中独立的任务操作卡片
  - [x] 6.2 保留右侧栏的上下文、信号和深层工作区内容
  - [x] 6.3 确保迁移过程中没有丢失关键的任务操作摘要

- [ ] 7. 测试与验证
  - [x] 7.1 为合并后的发起/任务操作 dock 增加组件测试
  - [x] 7.2 为发起提交流程增加回归测试
  - [x] 7.3 为合并后 dock 中的任务操作增加回归测试
  - [ ] 7.4 在 office cockpit 中手动验证桌面端与窄宽度表现
