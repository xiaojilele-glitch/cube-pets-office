# Implementation Plan: Demo Guided Experience

## Overview

将演示回放引擎和引导体验层分为四个阶段实现：核心引擎 → Store 集成 → UI 入口与展示组件 → 集成联调。每个阶段增量构建，确保前一阶段的代码在后续阶段中被完整集成。使用 TypeScript，测试框架为 vitest + fast-check。

## Tasks

- [ ] 1. 实现 DemoPlaybackEngine 核心类
  - [ ] 1.1 创建 `client/src/runtime/demo-playback/engine.ts`，实现 DemoPlaybackEngine 类
    - 定义 PlaybackState 类型（idle/playing/paused/completed/failed）和 PlaybackCallbacks 接口
    - 实现 start()：记录 startTime，遍历 DemoTimedEvent 序列，使用 setTimeout 按 timestampOffset 调度每个事件
    - 实现 pause()：清除所有未触发的 timer，记录 currentIndex 和 pausedAt 时间
    - 实现 resume()：从 currentIndex 重新计算剩余事件的延迟并重新调度
    - 实现 stop() 和 dispose()：清理所有定时器，重置状态
    - 异常处理：事件回调抛出异常时捕获，调用 onError，状态转为 failed
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

  - [ ]* 1.2 编写 DemoPlaybackEngine 属性测试
    - 创建 `client/src/runtime/demo-playback/__tests__/engine.property.test.ts`
    - 构建 DemoTimedEvent 序列的 fast-check Arbitrary 生成器
    - **Property 1: 事件按时间戳顺序发射**
    - **Validates: Requirements 3.2, 3.4**
    - **Property 2: 暂停恢复不丢失不重复事件**
    - **Validates: Requirements 3.5**
    - **Property 3: 异常导致 failed 状态转换**
    - **Validates: Requirements 3.7**

  - [ ]* 1.3 编写 DemoPlaybackEngine 单元测试
    - 创建 `client/src/runtime/demo-playback/__tests__/engine.test.ts`
    - 测试 start() 后状态转为 playing
    - 测试所有事件播放完毕后状态转为 completed
    - 测试空事件序列的回放行为
    - 测试连续快速 pause/resume 操作
    - _Requirements: 3.1, 3.3, 3.6_

- [ ] 2. 实现 Store 集成层
  - [ ] 2.1 创建 `client/src/lib/demo-store.ts`，实现 Demo 专属 Zustand store
    - 定义 DemoState 接口：isActive、playbackState、memoryTimeline、evolutionLogs、currentStage
    - 实现 activate/deactivate、appendMemoryEntry、setEvolutionLogs、reset 等方法
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 2.2 创建 `client/src/runtime/demo-playback/store-adapter.ts`，实现 DemoStoreAdapter 类
    - 实现 initializeDemoMission()：通过 tasks-store 的 createMission 创建 kind="demo" 的 MissionRecord，设置为当前选中任务
    - 实现 handleEvent()：将 DemoTimedEvent 的 AgentEvent 通过 runtimeEventBus.emit() 分发到 workflow-store
    - 实现记忆条目调度：根据 timestampOffset 将 DemoMemoryEntry 写入 demo-store
    - 实现进化日志调度：在 evolution 阶段将 DemoEvolutionLog 写入 demo-store
    - 实现 cleanup()：移除 demo mission，恢复 selectedTaskId，重置 demo-store
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 2.3 编写 Store 集成属性测试
    - 创建 `client/src/runtime/demo-playback/__tests__/store-adapter.property.test.ts`
    - **Property 4: Demo 退出恢复 Store 状态**
    - **Validates: Requirements 4.5**

  - [ ]* 2.4 编写 Store 集成单元测试
    - 创建 `client/src/runtime/demo-playback/__tests__/store-adapter.test.ts`
    - 测试 initializeDemoMission 创建的 MissionRecord 的 kind 为 "demo"
    - 测试 demo mission 被设置为当前选中任务
    - 测试 cleanup 后 tasks 列表不包含 demo 记录
    - _Requirements: 4.3, 4.4, 4.5_

- [ ] 3. Checkpoint - 确保引擎和 Store 集成测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. 实现 UI 入口与展示组件
  - [ ] 4.1 创建 `client/src/hooks/useDemoMode.ts`，实现 Demo 模式 React Hook
    - 封装 DemoPlaybackEngine 和 DemoStoreAdapter 的生命周期
    - 暴露 startDemo/pauseDemo/resumeDemo/stopDemo 方法
    - 组件卸载时自动调用 dispose 和 cleanup
    - _Requirements: 3.1, 3.5, 4.5_

  - [ ] 4.2 修改 `client/src/pages/Home.tsx`，添加 Live Demo 入口按钮
    - 在 Mission 入口卡片下方添加"🎬 Live Demo"按钮
    - 点击后调用 useDemoMode 的 startDemo 方法
    - 按钮样式醒目但不喧宾夺主（蓝色调边框 + 浅蓝背景）
    - 支持中英文 locale 切换
    - _Requirements: 5.3_

  - [ ] 4.3 创建 `client/src/components/demo/MemoryTimeline.tsx`，实现记忆时间线组件
    - 从 demo-store 读取 memoryTimeline 数据
    - 每条记忆条目显示：类型标签（短期/中期/长期，不同颜色）、Agent 名称、阶段标签、内容摘要
    - 时间线按 timestampOffset 排序展示
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 4.4 创建 `client/src/components/demo/EvolutionScoreCard.tsx`，实现进化评分卡组件
    - 从 demo-store 读取 evolutionLogs 数据
    - 展示每个 Agent 的四维评分变化（accuracy、completeness、actionability、format）
    - 数值从 oldScore 到 newScore 的平滑过渡动画（CSS transition）
    - _Requirements: 7.5, 7.6_

  - [ ]* 4.5 编写展示组件属性测试
    - 创建 `client/src/components/demo/__tests__/MemoryTimeline.property.test.ts`
    - **Property 5: 记忆时间线条目包含完整标注**
    - **Validates: Requirements 7.4**
    - 创建 `client/src/components/demo/__tests__/EvolutionScoreCard.property.test.ts`
    - **Property 6: 进化评分卡包含全维度数据**
    - **Validates: Requirements 7.5**

- [ ] 5. 集成联调与 WorkflowPanel 接入
  - [ ] 5.1 创建 `client/src/runtime/demo-playback/index.ts`，统一导出模块
    - 导出 DemoPlaybackEngine、DemoStoreAdapter、PlaybackState、PlaybackCallbacks 类型
    - _Requirements: 3.1, 4.1_

  - [ ] 5.2 在 WorkflowPanel 的 memory 视图中集成 MemoryTimeline 组件
    - 当 demo-store.isActive 为 true 时，在 memory 视图中渲染 MemoryTimeline
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 5.3 在 WorkflowPanel 中集成 EvolutionScoreCard 组件
    - 当 demo-store.isActive 为 true 且 currentStage 为 evolution 时，渲染 EvolutionScoreCard
    - _Requirements: 7.5, 7.6_

  - [ ] 5.4 添加 Demo 模式的暂停/恢复控制 UI
    - 在 WorkflowPanel 或 Toolbar 中添加暂停/恢复按钮，仅在 demo-store.isActive 时显示
    - _Requirements: 3.5_

- [ ] 6. Final checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 回放引擎依赖 demo-data-engine spec 提供的 DemoDataBundle 和 DEMO_BUNDLE 常量
- 3D 场景联动（需求 6）通过 RuntimeEventBus → workflow-store → Scene3D 的现有事件链路自动实现，无需额外代码
- 属性测试使用 fast-check 库，单元测试使用 vitest
- 所有新文件位于 `client/src/runtime/demo-playback/` 和 `client/src/components/demo/` 目录下
