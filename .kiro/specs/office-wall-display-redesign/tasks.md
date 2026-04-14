# 实施计划：office-wall-display-redesign

## 概述

本 spec 负责把办公室后墙改造成统一的三分区监控屏，在不改变现有 mission 和 sandbox 数据主线的前提下，重构后墙的终端、任务和浏览器显示方式，让它真正成为场景内的设备。

## Worktree / Ownership 建议

- 建议由同一个 owner 负责 `client/src/components/three/SandboxMonitor.tsx`、`client/src/components/Scene3D.tsx` 以及相关墙面壳体样式，避免场景装配冲突。
- 建议由同一个 owner 负责墙面任务区组件和任务数据投影逻辑，确保任务层级表达一致。
- 避免多人并行改 `client/src/lib/sandbox-store.ts`，因为 pane 焦点模型会触碰共享预览行为。

## Tasks

- [x] 1. 重做后墙外壳为统一监控设备
  - [x] 1.1 将 `client/src/components/three/SandboxMonitor.tsx` 中当前双槽位板结构替换为一台包含三分区的统一墙面显示器
    - _Requirements: 1.1.1, 1.1.2, 1.1.3, 7.1.2_
  - [x] 1.2 补齐实体设备特征，例如边框厚度、支架感、状态灯、线缆轮廓、墙面阴影和冷色溢光
    - _Requirements: 1.1.2, 1.1.4, 6.1.3_

- [x] 2. 实现中间 `Mission Control` 任务主控区
  - [x] 2.1 新建墙面专用任务摘要组件，并从 `tasks-store` 读取活跃任务
    - _Requirements: 2.1.1, 2.1.2, 5.1.1, 7.1.1_
  - [x] 2.2 将中间区域内容限制为标题、状态标签、阶段/运行态、进度、告警行和最多四个指标
    - _Requirements: 2.1.2, 2.1.3, 2.1.4, 6.1.1_
  - [x] 2.3 实现无任务和待命态，保证墙面布局不塌陷
    - _Requirements: 2.1.5, 6.1.4_

- [x] 3. 改造左侧 `Execution Feed` 终端区
  - [x] 3.1 为 `client/src/components/sandbox/TerminalPreview.tsx` 增加墙面显示器变体，弱化桌面窗口感
    - _Requirements: 3.1.1, 3.1.2, 3.1.4_
  - [x] 3.2 保留最近高价值日志，并确保 stderr 高亮在缩小后的墙面形态下仍然明显
    - _Requirements: 3.1.2, 3.1.3_

- [x] 4. 改造右侧 `Browser Live` 浏览器区
  - [x] 4.1 为 `client/src/components/sandbox/ScreenshotPreview.tsx` 增加墙面显示器变体，补齐标题、时间和上下文标签
    - _Requirements: 4.1.1, 4.1.2, 4.1.3_
  - [x] 4.2 在失败或等待态保留最后一张有效截图，直到新截图到来
    - _Requirements: 4.1.4, 6.1.4_

- [x] 5. 打通共享焦点与 pane 级交互
  - [x] 5.1 保证墙面任务选择与当前已选任务保持一致，必要时回退到最相关活跃任务
    - _Requirements: 5.1.1, 7.1.1_
  - [x] 5.2 将 `client/src/lib/sandbox-store.ts` 从单一 global fullscreen 模型演进为 pane 级聚焦模型
    - _Requirements: 5.1.3, 5.1.4, 5.1.5_
  - [x] 5.3 给终端、任务、浏览器三个区域接入点击后的正确聚焦路径
    - _Requirements: 5.1.2, 5.1.3, 5.1.4_

- [x] 6. 验证层级、可读性与兼容边界
  - [x] 6.1 在默认桌面端主镜头下验证任务状态和进度的可读性
    - _Requirements: 6.1.1, 6.1.2_
  - [x] 6.2 覆盖运行中、等待中、失败、完成和无任务五种状态，验证墙面布局稳定性和证据区行为
    - _Requirements: 3.1.4, 4.1.4, 6.1.4_
  - [x] 6.3 回归 `/tasks`、`/tasks/:taskId`、`ExecutorTerminalPanel` 以及 sandbox socket 预览行为
    - _Requirements: 7.1.3, 7.1.4_

## Notes

- 这次改造的关键不是“多加一张任务卡”，而是“把任务 HUD 场景化为后墙上的真实设备”。
- 中间任务区必须始终是最强视觉信号。如果三块区域同样吵，说明方案失败。
- 建议按“壳体先行、任务区次之、两侧收口、交互补完、场景打磨”这样的顺序推进，降低回归风险。
