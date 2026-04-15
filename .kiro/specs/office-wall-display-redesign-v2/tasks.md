# 办公室后墙三屏原生化重构实施任务（v2）

## 概述

本任务列表用于归档桌面办公室首页后墙三屏原生化重构。目标是把当前“贴在墙上的三个网页面板”升级为“一个统一的后墙设备”，并保持任务、终端、截图三条业务链路不回归。

## Tasks

- [x] 1. 新建 v2 spec 并补齐存档说明
  - [x] 1.1 在 `.kiro/specs/office-wall-display-redesign-v2/` 下创建 `requirements.md`
  - [x] 1.2 在 `.kiro/specs/office-wall-display-redesign-v2/` 下创建 `design.md`
  - [x] 1.3 在 `.kiro/specs/office-wall-display-redesign-v2/` 下创建 `tasks.md`
  - [x] 1.4 在 `.kiro/specs/office-wall-display-redesign-v2/` 下创建 `manual-verification.md`
  - [x] 1.5 记录 v1 旧稿保留、v2 新稿独立存档的归档策略

- [x] 2. 统一后墙设备壳体与三分区布局
  - [x] 2.1 将 `SandboxMonitor` 从左右双槽位升级为统一三分区容器
  - [x] 2.2 为后墙增加统一设备外壳、统一屏面和统一设备语义
  - [x] 2.3 确保中间区明显宽于左右两区，并成为默认镜头主中心

- [x] 3. 中间任务主控区替换为墙屏专用任务面板
  - [x] 3.1 桌面墙挂任务区停止使用 `MissionMiniView`
  - [x] 3.2 正式接入 `MissionWallTaskPanel`
  - [x] 3.3 中间区收敛为标题、状态、阶段、进度、告警和最多 4 个指标
  - [x] 3.4 无任务时提供稳定 standby 态

- [x] 4. 左侧执行流面板移除桌面终端窗口语义
  - [x] 4.1 重写 `TerminalPreview` 的 wall 视觉分支
  - [x] 4.2 移除三色圆点、窗口头、桌面工具窗语义
  - [x] 4.3 保留 live / idle / error 状态表达和高价值日志显示
  - [x] 4.4 保证空态、等待态和失败态结构稳定

- [x] 5. 右侧浏览器回传面板移除网页卡片语义
  - [x] 5.1 重写 `ScreenshotPreview` 的 wall 视觉分支
  - [x] 5.2 移除卡片式控制栏和网页预览窗口感
  - [x] 5.3 保留标题、状态角标、时间戳和上下文标签
  - [x] 5.4 无截图和失败态下保持稳定回传视图

- [x] 6. sandbox 聚焦模型升级为 pane 级聚焦
  - [x] 6.1 在 `useSandboxStore` 中引入或提升 `focusedPane`
  - [x] 6.2 `focusedPane` 至少支持 `terminal | task | browser | null`
  - [x] 6.3 如需兼容旧逻辑，保留 `fullscreen` 作为派生值而非主语义

- [ ] 7. 联调点击路径与任务焦点同步
  - [x] 7.1 左中右三块区域保持同一个任务焦点
  - [x] 7.2 点击左侧聚焦终端相关视图
  - [ ] 7.3 点击中间聚焦任务详情路径
  - [x] 7.4 点击右侧聚焦截图或浏览器相关视图
  - [ ] 7.5 确保 `/tasks`、任务详情、终端详情、截图放大路径不回归

- [ ] 8. 完成桌面视觉回归与手测留痕
  - [ ] 8.1 验证默认桌面镜头下 2 秒内可读出任务状态和进度
  - [ ] 8.2 验证中间区明显强于左右两区
  - [ ] 8.3 验证无任务、等待中、运行中、失败、完成五类状态
  - [ ] 8.4 验证与底部 `OfficeTaskCockpit` 共存时主次关系稳定
  - [ ] 8.5 记录 v1 与 v2 的差异点，补充回归留痕

## Notes

- 本轮只归档桌面办公室首页后墙三屏，不扩展到移动端或全站视觉统一。
- 本轮不采用真实 3D 纹理屏方案，默认继续使用 `Html transform`。
- 旧目录 `.kiro/specs/office-wall-display-redesign/` 保留，作为 v1 历史参考。
- 如果后续继续推进视觉统一，底部 `OfficeTaskCockpit` 是下一个应收口的候选对象。
- 当前已完成代码改造与针对性测试，未完成项主要集中在中间屏深链联调和手工回归留痕。
