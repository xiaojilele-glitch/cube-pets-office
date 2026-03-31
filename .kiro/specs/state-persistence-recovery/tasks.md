# 实现计划：状态持久化与恢复

## 概述

基于现有 IndexedDB 持久化层，增量实现快照存储、自动恢复、会话导出/导入功能。按照数据层→逻辑层→UI 层的顺序推进，每个阶段都有对应的测试任务。

## 任务

- [ ] 1. 扩展数据层：SnapshotRecord 类型与 SnapshotStore
  - [ ] 1.1 在 `shared/mission/contracts.ts` 中新增 SnapshotRecord、SnapshotPayload 及相关接口类型
    - 新增 SnapshotRecord、SnapshotPayload、AgentMemorySummary、SceneLayoutState、MissionDecisionEntry、AttachmentIndexEntry、ZustandRecoverySlice 接口
    - 新增 SNAPSHOT_VERSION 常量
    - _Requirements: 1.3, 1.4, 5.1_

  - [ ] 1.2 扩展 `client/src/lib/browser-runtime-storage.ts`，新增 snapshots object store
    - DB_VERSION 从 1 升级到 2
    - 在 STORE_NAMES 中新增 snapshots
    - 在 onupgradeneeded 中创建 snapshots store（keyPath: "id"），添加 missionId 和 createdAt 索引
    - 实现 saveSnapshot、getSnapshot、getLatestSnapshot、listSnapshots、deleteSnapshot、pruneSnapshots 函数
    - _Requirements: 1.5, 1.6_

  - [ ]* 1.3 为 SnapshotStore 编写属性测试
    - **Property 3: 快照修剪不变量**
    - **Validates: Requirements 1.5**

  - [ ]* 1.4 为 SnapshotStore 编写属性测试
    - **Property 7: 丢弃操作移除快照**
    - **Validates: Requirements 2.4**

- [ ] 2. 实现快照序列化与校验
  - [ ] 2.1 创建 `client/src/workers/snapshot-worker.ts`，实现 Web Worker 中的序列化和 SHA-256 校验和计算
    - 接收 WorkerRequest 消息，序列化 payload 为 JSON，计算 SHA-256 checksum
    - 构建完整 SnapshotRecord 并通过 WorkerResponse 返回
    - 错误时返回 error 类型消息
    - _Requirements: 5.1, 5.2, 8.1_

  - [ ] 2.2 创建 `client/src/lib/snapshot-serializer.ts`，封装 Worker 通信和回退逻辑
    - 提供 serializeSnapshot(payload, meta) → Promise<SnapshotRecord> 函数
    - Worker 创建失败时回退到主线程同步序列化
    - 提供 validateChecksum(record) → boolean 校验函数
    - _Requirements: 5.1, 5.2, 5.3, 8.1_

  - [ ]* 2.3 为快照序列化编写属性测试
    - **Property 1: 快照序列化往返一致性**
    - **Validates: Requirements 5.3**

  - [ ]* 2.4 为快照结构编写属性测试
    - **Property 2: 快照结构完整性**
    - **Validates: Requirements 1.3, 1.4**

- [ ] 3. Checkpoint - 确保数据层测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 4. 实现快照调度器
  - [ ] 4.1 创建 `client/src/lib/snapshot-scheduler.ts`，实现定时和事件驱动的快照触发
    - createSnapshotScheduler 工厂函数，接收 intervalMs、collectState、onError 参数
    - start(missionId) 启动 30 秒定时器
    - stop() 清除定时器
    - triggerImmediate() 立即触发一次快照
    - 内部调用 snapshot-serializer 序列化，然后调用 SnapshotStore 保存和修剪
    - _Requirements: 1.1, 1.2, 8.2_

  - [ ] 4.2 在 `client/src/runtime/browser-runtime.ts` 中集成 SnapshotScheduler
    - 在 createBrowserRuntime 中创建 collectState 函数，收集 MissionRecord、Agent 记忆、3D 布局、决策历史
    - Mission 进入 running/waiting 时启动调度器，Mission 完成/失败时停止
    - 监听 MissionStage 状态变更事件，调用 triggerImmediate()
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 4.3 为快照错误韧性编写属性测试
    - **Property 12: 快照错误不中断任务**
    - **Validates: Requirements 8.2**

- [ ] 5. 实现自动恢复检测与恢复逻辑
  - [ ] 5.1 创建 `client/src/lib/recovery-detector.ts`，实现启动时恢复检测
    - detectRecoveryCandidate()：读取最新快照，校验 checksum 和 version，返回 RecoveryCandidate 或 null
    - restoreFromSnapshot(snapshot)：从快照恢复 Zustand store、3D 场景布局、Agent 状态
    - discardSnapshot(id)：删除指定快照
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6_

  - [ ] 5.2 在 `client/src/runtime/browser-runtime.ts` 启动流程中集成恢复检测
    - createBrowserRuntime 启动时调用 detectRecoveryCandidate()
    - 根据 runtimeMode 决定恢复源优先级（Advanced 模式服务端优先）
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 5.3 为恢复检测编写属性测试
    - **Property 4: 损坏/不兼容快照检测**
    - **Property 5: 恢复候选检测正确性**
    - **Validates: Requirements 2.1, 2.5, 2.6**

  - [ ]* 5.4 为状态恢复编写属性测试
    - **Property 6: 状态恢复正确性**
    - **Validates: Requirements 2.3**

  - [ ]* 5.5 为恢复源优先级编写属性测试
    - **Property 10: 恢复源优先级**
    - **Property 11: 模式切换保留快照**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [ ] 6. Checkpoint - 确保恢复逻辑测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 7. 实现会话导出/导入
  - [ ] 7.1 创建 `client/src/lib/session-export.ts`，实现导出功能
    - exportSession(missionId?)：读取最新快照，使用 JSZip 打包为 ZIP（manifest.json + snapshot.json + attachments/）
    - 触发浏览器文件下载
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ] 7.2 在 `client/src/lib/session-export.ts` 中实现导入功能
    - importSession(file)：解析 ZIP，校验 manifest 中的 checksum 和 version，写入 SnapshotStore
    - importSessionFromBase64(encoded)：解码 URL 参数并触发导入
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 7.3 为导出包编写属性测试
    - **Property 8: 导出包完整性**
    - **Validates: Requirements 3.1, 3.3**

  - [ ]* 7.4 为导入验证编写属性测试
    - **Property 9: 导入验证与存储**
    - **Validates: Requirements 4.1, 4.4**

- [ ] 8. 实现 UI 组件
  - [ ] 8.1 创建 `client/src/components/RecoveryDialog.tsx` 恢复对话框组件
    - 显示 Mission 标题、保存时间、进度信息
    - Resume 和 Discard 按钮
    - 恢复进度条和阶段描述
    - 损坏/不兼容快照的错误提示
    - _Requirements: 2.2, 2.5, 2.6, 7.1, 7.2, 7.3_

  - [ ] 8.2 在 `client/src/components/Scene3D.tsx` 中添加恢复状态提示
    - 恢复加载时显示"正在恢复上一次任务…"覆盖层
    - _Requirements: 7.2_

  - [ ] 8.3 在配置面板或工作流面板中添加 Export/Import Session 按钮
    - Export Session 按钮调用 exportSession()
    - Import Session 按钮打开文件选择器，调用 importSession(file)
    - _Requirements: 3.1, 4.1_

  - [ ] 8.4 在 Tasks 页面添加"历史会话"标签
    - 列出所有本地快照（Mission 标题、保存时间、进度百分比）
    - 选择快照后显示 RecoveryDialog（Resume/Delete）
    - _Requirements: 9.1, 9.2, 9.3_

- [ ] 9. 集成与连接
  - [ ] 9.1 在 App 启动流程中集成恢复检测
    - App.tsx 或 main.tsx 中，在 React 渲染前调用 detectRecoveryCandidate()
    - 检测到候选时渲染 RecoveryDialog
    - 处理 URL 参数 `?restore=`
    - _Requirements: 2.1, 4.5_

  - [ ] 9.2 在 browser-runtime 中连接快照调度器与 Mission 生命周期
    - Mission 状态变更时启动/停止调度器
    - MissionStage 变更时触发即时快照
    - _Requirements: 1.1, 1.2_

- [ ] 10. 最终 Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP
- 每个任务引用了具体的需求编号以确保可追溯性
- Checkpoint 任务确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 使用 fast-check 作为属性测试库，fake-indexeddb 作为 IndexedDB mock
- 使用 JSZip 处理 ZIP 打包/解析
