# 实现计划：Sandbox Live Preview

## 概述

按协议层 → 中继层 → 展示层的顺序递增实现。每一层完成后通过测试验证，确保后续层可以依赖前一层的正确性。使用 TypeScript 实现，复用项目现有的 vitest + fast-check 测试框架。

## 任务

- [x] 1. 扩展执行器回调协议
  - [x] 1.1 在 `shared/executor/contracts.ts` 的 `EXECUTOR_EVENT_TYPES` 中新增 `"job.log_stream"` 和 `"job.screenshot"` 事件类型，在 `ExecutorEvent` 接口中新增可选字段：`stepIndex`、`stream`、`data`、`imageData`、`imageWidth`、`imageHeight`
    - _需求: 1.1, 2.1_
  - [x] 1.2 在 `shared/mission/socket.ts` 中新增 `SANDBOX_SOCKET_EVENTS` 常量和 `SandboxLogPayload`、`SandboxScreenPayload`、`SandboxLogHistoryPayload` 接口
    - _需求: 3.2, 3.3, 3.5_
  - [x] 1.3 编写协议类型的单元测试，验证新事件类型在 `EXECUTOR_EVENT_TYPES` 中存在，验证类型定义的字段完整性
    - _需求: 1.1, 2.1_

- [x] 2. 实现执行器端日志批处理器和重试缓冲区
  - [x] 2.1 在 `services/lobster-executor/src/log-batcher.ts` 中实现 `LogBatcher` 类：`append(stream, chunk)` 累积数据，`flush()` 在达到 4KB 或 500ms 时输出批次
    - _需求: 1.3, 1.4_
  - [x] 2.2 编写 LogBatcher 属性测试
    - **Property 1: 日志批处理数据约束**
    - **验证: 需求 1.1, 1.3, 1.4**
  - [x] 2.3 在 `services/lobster-executor/src/retry-buffer.ts` 中实现 `RetryBuffer` 类：缓冲最多 64KB，指数退避重试（最多 3 次）
    - _需求: 1.5_
  - [x] 2.4 编写 RetryBuffer 属性测试
    - **Property 2: 重试缓冲区溢出保护**
    - **验证: 需求 1.5**

- [x] 3. 实现执行器端截图工具函数
  - [x] 3.1 在 `services/lobster-executor/src/screenshot-utils.ts` 中实现 `clampInterval(ms)` 函数（钳位到 [1000, 10000]）和 `computeResizedDimensions(w, h, maxW, maxH)` 函数（保持宽高比缩放）
    - _需求: 2.2, 2.3_
  - [x] 3.2 编写截图间隔钳位属性测试
    - **Property 4: 截图间隔钳位**
    - **验证: 需求 2.2**
  - [x] 3.3 编写截图缩放属性测试
    - **Property 3: 截图载荷约束**
    - **验证: 需求 2.1, 2.3**

- [x] 4. 检查点 - 确保协议层和执行器工具测试全部通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 5. 实现服务端日志中继层
  - [x] 5.1 在 `server/core/sandbox-relay.ts` 中实现 `SandboxRelay` 类：`appendLog(entry)` 追加日志到滚动缓冲区（每 Mission 最多 200 行 FIFO），`getLogHistory(missionId)` 返回缓冲内容，`clearMission(missionId)` 清理
    - _需求: 3.4, 3.5_
  - [x] 5.2 编写 SandboxRelay 滚动缓冲区属性测试
    - **Property 5: 滚动日志缓冲区大小不变量**
    - **验证: 需求 3.4**
  - [x] 5.3 在 `server/index.ts` 的 `/api/executor/events` 处理逻辑中，识别 `job.log_stream` 和 `job.screenshot` 类型，调用 SandboxRelay 写入缓冲区，通过 Socket.IO 广播 `mission_log` / `mission_screen` 事件
    - _需求: 3.1, 3.2, 3.3_
  - [x] 5.4 在 `server/core/socket.ts` 中新增 `request_log_history` Socket 事件监听，客户端发送 missionId 后回复 `mission_log_history`
    - _需求: 3.5_
  - [x] 5.5 编写服务端中继层单元测试：验证新事件类型的路由、Socket 广播、历史日志请求
    - _需求: 3.1, 3.2, 3.3, 3.5_

- [x] 6. 检查点 - 确保服务端中继层测试全部通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 7. 实现前端 sandbox-store
  - [x] 7.1 在 `client/src/lib/sandbox-store.ts` 中创建 Zustand store，管理 logLines（最多 500 行）、latestScreenshot、previousScreenshot、activeMissionId、isStreaming、fullscreen 状态，以及 appendLog、setLogHistory、updateScreenshot、setActiveMission、setFullscreen、reset actions
    - _需求: 4.1, 4.2, 5.1_
  - [x] 7.2 在 sandbox-store 中添加 Socket.IO 事件监听逻辑：监听 `mission_log`、`mission_screen`、`mission_log_history` 事件，连接时请求日志历史
    - _需求: 3.2, 3.3, 3.5_
  - [x] 7.3 实现日志格式化函数 `formatLogLine(line: LogLine): string`，为 stderr 添加 ANSI 红色转义码，为 stdout 保持默认
    - _需求: 4.3_
  - [x] 7.4 编写 stderr 格式化属性测试
    - **Property 6: Stderr 视觉区分格式化**
    - **验证: 需求 4.3**
  - [x] 7.5 实现时间戳格式化函数 `formatTimestamp(iso: string): string`，输出 HH:MM:SS 格式
    - _需求: 5.3_
  - [x] 7.6 编写时间戳格式化属性测试
    - **Property 7: 时间戳显示格式化**
    - **验证: 需求 5.3**

- [x] 8. 实现前端终端预览组件
  - [x] 8.1 在 `client/src/components/sandbox/TerminalPreview.tsx` 中实现终端组件：初始化 xterm.js Terminal（500 行 scrollback），接收 logLines 写入终端，支持 ANSI 颜色，新输出自动滚动到底部
    - _需求: 4.1, 4.2, 4.3_
  - [x] 8.2 实现空闲态显示（isStreaming === false 时显示 "等待执行..."）和全屏切换按钮
    - _需求: 4.5, 4.6_
  - [x] 8.3 编写终端组件单元测试：空闲态渲染、全屏切换状态
    - _需求: 4.5, 4.6_

- [x] 9. 实现前端截图预览组件
  - [x] 9.1 在 `client/src/components/sandbox/ScreenshotPreview.tsx` 中实现截图预览组件：显示最新截图、300ms 交叉淡入过渡（CSS opacity transition）、时间戳叠加层
    - _需求: 5.1, 5.2, 5.3_
  - [x] 9.2 实现无截图占位符（"暂无浏览器预览"）和点击放大功能
    - _需求: 5.5, 5.6_
  - [x] 9.3 编写截图预览组件单元测试：占位符渲染、时间戳显示
    - _需求: 5.1, 5.5_

- [x] 10. 检查点 - 确保前端组件和 store 测试全部通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 11. 实现 3D 场景集成
  - [x] 11.1 在 `client/src/components/three/SandboxMonitor.tsx` 中实现 3D 监视器组件：1-2 个 BoxGeometry 屏幕 + 支架，定位在办公室右侧（position [5.5, 0, 1.0]），通过 Html 组件桥接 TerminalPreview 和 ScreenshotPreview
    - _需求: 6.1, 6.2, 6.3_
  - [x] 11.2 实现屏幕发光效果：根据 isStreaming 状态控制 emissive material 强度（useFrame 动画），无活跃执行时暗屏
    - _需求: 6.4, 6.5_
  - [x] 11.3 在 `client/src/components/Scene3D.tsx` 中引入 `<SandboxMonitor />`，放置在 `<MissionIsland />` 之后、`<ContactShadows />` 之前，确保与 MissionIsland 无视觉冲突
    - _需求: 6.6_

- [x] 12. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有疑问请询问用户。

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP 开发
- 每个任务引用具体需求编号以确保可追溯性
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 检查点确保增量验证，避免错误累积
- 执行器端的 LogBatcher 和 RetryBuffer 可在 mock 模式下独立测试，不依赖真实 Docker 实现
