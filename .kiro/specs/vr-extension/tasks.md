# 实现计划：AR/VR 扩展模块

## 概述

按分层架构自底向上实现：共享类型 → 数据模型 → 渲染管道 → 交互层 → 平台适配 → 性能优化 → 录制回放 → 前端面板。每层实现后通过属性测试和单元测试验证，最后集成到现有 Scene3D 架构中。

## Tasks

- [ ] 1. 搭建 VR 模块基础结构与共享类型定义
  - [ ] 1.1 创建目录结构 `shared/vr/` 和 `client/src/lib/vr/` 和 `client/src/components/vr/`
    - 创建所有必要的目录和入口文件
    - _Requirements: 7.1_
  - [ ] 1.2 定义所有共享类型 `shared/vr/types.ts`
    - 实现 VRSceneConfig、VRZone、VRSceneObject、GestureEvent、GestureType、InteractionCommand、CommandType、SpatialInteractionTarget、BoundingBox、VRBoardObject、VRTaskCard、VRBoardPanel、VRDataFlowGraph、DataFlowNode、DataFlowEdge、DataPacket、FlowAnimationParams、AgentAvatarConfig、AgentVRStatus、AgentDetailPanel、VRSessionState、VRUserState、VRPose、VRHandPose、VRAnnotation、VRRecordingEvent、VRRecordingData、RecordingFilter 等全部类型
    - _Requirements: 1.1, 2.1, 2.2, 3.1, 4.1, 5.1, 6.1, 9.1_
  - [ ]\* 1.3 编写共享类型的 Schema 验证属性测试
    - **Property 4: 手势与交互目标 Schema 验证**
    - **Validates: Requirements 2.1, 2.2**

- [ ] 2. 实现 VR 场景生成器
  - [ ] 2.1 实现 `shared/vr/scene-generator.ts` 中的 `generateVRScene()` 纯函数
    - 接收 WorkflowOrganizationSnapshot 和 TaskRecord[]，输出 VRSceneConfig
    - 实现部门到 zone 的空间映射算法
    - 实现 UI 元素到 3D 对象的转换逻辑
    - 实现调试日志记录
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [ ]\* 2.2 编写场景生成完整性属性测试
    - **Property 1: 场景生成完整性**
    - **Validates: Requirements 1.1, 1.3**
  - [ ]\* 2.3 编写部门映射守恒属性测试
    - **Property 2: 部门到区块的映射守恒**
    - **Validates: Requirements 1.2**
  - [ ]\* 2.4 编写 VRSceneConfig 序列化往返属性测试
    - **Property 3: VRSceneConfig 序列化往返一致性**
    - **Validates: Requirements 1.4**

- [ ] 3. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 4. 实现手势识别与交互分发
  - [ ] 4.1 实现 `client/src/lib/vr/gesture-interpreter.ts`
    - 实现 GestureInterpreter 类，支持可配置的手势映射表
    - 将原始手势数据映射到高级交互命令（select、drag、scale、rotate、delete）
    - 支持自定义手势映射配置
    - _Requirements: 2.3, 2.5_
  - [ ]\* 4.2 编写手势解释一致性属性测试
    - **Property 5: 手势解释一致性**
    - **Validates: Requirements 2.3, 2.5**
  - [ ] 4.3 实现 `client/src/lib/vr/interaction-dispatcher.ts`
    - 实现 InteractionDispatcher 类，支持 handler 注册和命令路由
    - _Requirements: 2.4_
  - [ ]\* 4.4 编写交互分发路由正确性属性测试
    - **Property 6: 交互分发路由正确性**
    - **Validates: Requirements 2.4**

- [ ] 5. 实现任务看板数据模型与渲染器
  - [ ] 5.1 实现 `shared/vr/board-model.ts` 中的看板数据转换函数
    - 将 TaskRecord[] 转换为 VRBoardObject
    - 支持 list、kanban、gantt 三种视图模式
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ]\* 5.2 编写任务看板转换完整性属性测试
    - **Property 7: 任务看板转换完整性**
    - **Validates: Requirements 3.1, 3.3**
  - [ ]\* 5.3 编写看板视图模式有效性属性测试
    - **Property 8: 看板视图模式有效性**
    - **Validates: Requirements 3.2**
  - [ ] 5.4 实现 `client/src/components/vr/TaskBoardRenderer.tsx` React Three Fiber 组件
    - 渲染 3D 任务看板面板和卡片
    - 支持手势切换视图模式
    - 支持拖拽任务卡片
    - _Requirements: 3.1, 3.2, 3.5_

- [ ] 6. 实现数据流数据模型与渲染器
  - [ ] 6.1 实现 `shared/vr/flow-model.ts` 中的数据流转换函数
    - 将消息记录和任务记录转换为 VRDataFlowGraph
    - 实现力导向、分层、圆形三种布局算法
    - _Requirements: 4.1, 4.2, 4.4_
  - [ ]\* 6.2 编写数据流图生成正确性属性测试
    - **Property 11: 数据流图生成正确性**
    - **Validates: Requirements 4.1, 4.2**
  - [ ]\* 6.3 编写数据包有效性属性测试
    - **Property 12: 数据包有效性**
    - **Validates: Requirements 4.3**
  - [ ]\* 6.4 编写布局算法有效性属性测试
    - **Property 13: 布局算法有效性**
    - **Validates: Requirements 4.4**
  - [ ] 6.5 实现 `client/src/components/vr/DataFlowRenderer.tsx` React Three Fiber 组件
    - 渲染 3D 数据流图（节点、边、数据包动画）
    - 支持手势切换布局和钻取
    - _Requirements: 4.1, 4.3, 4.5_

- [ ] 7. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 8. 实现 Agent 虚拟形象
  - [ ] 8.1 实现 `shared/vr/avatar-model.ts` 中的 Agent 形象生成函数
    - 将 AgentRecord 转换为 AgentAvatarConfig
    - 实现状态到颜色的映射（idle→绿、working→黄、error→红、offline→灰）
    - 生成 AgentDetailPanel 数据
    - _Requirements: 5.1, 5.2_
  - [ ]\* 8.2 编写 Agent 虚拟形象生成完整性属性测试
    - **Property 15: Agent 虚拟形象生成完整性**
    - **Validates: Requirements 5.1, 5.2**
  - [ ] 8.3 实现 `client/src/components/vr/AgentAvatarRenderer.tsx` React Three Fiber 组件
    - 渲染 Agent 3D 头像、状态指示灯、名称标签
    - 支持点击弹出详情面板
    - 支持通信气泡显示
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

- [ ] 9. 实现 VR 平台适配层
  - [ ] 9.1 定义 `client/src/lib/vr/adapters/platform-adapter.ts` 中的 VRPlatformAdapter 接口
    - 定义初始化、手势识别、渲染、输入处理、会话管理方法
    - 定义 VRAdapterConfig、VRSessionHandle 等辅助类型
    - _Requirements: 7.1_
  - [ ] 9.2 实现 `client/src/lib/vr/adapters/mock-adapter.ts` MockVRAdapter
    - 实现完整的模拟 VR 适配器，用鼠标/键盘模拟手势输入
    - 支持开发和测试场景
    - _Requirements: 7.2_
  - [ ] 9.3 实现 `client/src/lib/vr/adapters/webxr-adapter.ts` WebXRAdapter 骨架
    - 基于 WebXR API 实现适配器接口（当前阶段为骨架实现）
    - _Requirements: 7.2_
  - [ ]\* 9.4 编写适配器行为一致性属性测试
    - **Property 20: 适配器行为一致性**
    - **Validates: Requirements 7.2**
  - [ ] 9.5 实现适配器工厂和依赖注入机制
    - 实现 createVRAdapter() 工厂函数，支持运行时动态切换
    - _Requirements: 7.5_
  - [ ]\* 9.6 编写运行时适配器切换属性测试
    - **Property 21: 运行时适配器切换**
    - **Validates: Requirements 7.5**

- [ ] 10. 实现场景性能优化器
  - [ ] 10.1 实现 `client/src/lib/vr/scene-optimizer.ts` SceneOptimizer
    - 实现帧率监控和自适应质量调整
    - 实现 LOD 级别计算
    - 实现基于视锥体的流式加载/卸载判断
    - _Requirements: 8.1, 8.2, 8.3, 8.5_
  - [ ]\* 10.2 编写优化器自适应调整属性测试
    - **Property 22: 优化器自适应调整**
    - **Validates: Requirements 8.1, 8.5**
  - [ ]\* 10.3 编写 LOD 单调性属性测试
    - **Property 23: LOD 单调性**
    - **Validates: Requirements 8.2**
  - [ ]\* 10.4 编写流式加载/卸载正确性属性测试
    - **Property 24: 流式加载/卸载正确性**
    - **Validates: Requirements 8.3**

- [ ] 11. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 12. 实现多用户会话管理
  - [ ] 12.1 实现 `shared/vr/session-model.ts` 会话数据模型
    - 定义会话创建、加入、离开的数据操作函数
    - _Requirements: 6.1_
  - [ ] 12.2 实现 `client/src/lib/vr/session-manager.ts` VRSessionManager
    - 实现会话生命周期管理（创建、加入、离开）
    - 实现用户姿态和操作广播（通过 Socket.IO）
    - 实现标注创建和同步
    - _Requirements: 6.1, 6.2, 6.3, 6.5_
  - [ ]\* 12.3 编写会话管理不变量属性测试
    - **Property 17: 会话管理不变量**
    - **Validates: Requirements 6.1**
  - [ ]\* 12.4 编写多用户状态复制属性测试
    - **Property 18: 多用户状态复制**
    - **Validates: Requirements 6.2, 6.3, 6.5**
  - [ ] 12.5 实现 CRDT 状态同步机制
    - 实现看板和场景状态的 CRDT 合并逻辑
    - _Requirements: 3.6, 6.6_
  - [ ]\* 12.6 编写看板 CRDT 汇聚性属性测试
    - **Property 10: 看板 CRDT 汇聚性**
    - **Validates: Requirements 3.6**
  - [ ]\* 12.7 编写会话 CRDT 汇聚性属性测试
    - **Property 19: 会话 CRDT 汇聚性**
    - **Validates: Requirements 6.6**

- [ ] 13. 实现 WebSocket 实时同步层
  - [ ] 13.1 实现 `client/src/lib/vr/vr-store.ts` VR Zustand Store
    - 管理 VR 场景状态、会话状态、用户列表
    - 集成 Socket.IO 事件监听（vr_session_update、vr_user_pose、vr_user_action）
    - _Requirements: 3.4, 4.6, 5.3, 10.4_
  - [ ]\* 13.2 编写看板 WebSocket 同步一致性属性测试
    - **Property 9: 看板 WebSocket 同步一致性**
    - **Validates: Requirements 3.4**
  - [ ]\* 13.3 编写数据流 WebSocket 同步一致性属性测试
    - **Property 14: 数据流 WebSocket 同步一致性**
    - **Validates: Requirements 4.6**
  - [ ]\* 13.4 编写 Agent 状态 WebSocket 同步属性测试
    - **Property 16: Agent 状态 WebSocket 同步**
    - **Validates: Requirements 5.3**

- [ ] 14. 实现 VR 会话录制与回放
  - [ ] 14.1 实现 `shared/vr/recording-model.ts` 录制数据模型
    - 定义录制事件序列化/反序列化函数
    - 定义过滤函数
    - _Requirements: 9.1, 9.2, 9.4_
  - [ ] 14.2 实现 `client/src/lib/vr/session-recorder.ts` VRSessionRecorder
    - 实现录制开始/停止、事件记录
    - 实现回放控制（播放、暂停、快进、慢放、跳转）
    - 实现过滤和标注功能
    - _Requirements: 9.1, 9.2, 9.3, 9.5_
  - [ ]\* 14.3 编写录制往返一致性属性测试
    - **Property 25: 录制往返一致性**
    - **Validates: Requirements 9.1, 9.4**
  - [ ]\* 14.4 编写录制过滤正确性属性测试
    - **Property 26: 录制过滤正确性**
    - **Validates: Requirements 9.2**
  - [ ]\* 14.5 编写回放跳转一致性属性测试
    - **Property 27: 回放跳转一致性**
    - **Validates: Requirements 9.3**

- [ ] 15. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 16. 实现后端 VR 会话 API
  - [ ] 16.1 实现 `server/routes/vr-sessions.ts` API 路由
    - GET /api/vr-sessions - 获取会话列表
    - POST /api/vr-sessions - 创建新会话
    - POST /api/vr-sessions/:id/join - 加入会话
    - POST /api/vr-sessions/:id/leave - 离开会话
    - POST /api/vr-sessions/:id/notify - 发送通知
    - _Requirements: 10.4, 10.5_
  - [ ] 16.2 注册 VR 会话 Socket.IO 事件
    - 在 server/index.ts 中注册 vr_session_update、vr_user_pose、vr_user_action、vr_notification 事件
    - _Requirements: 6.2, 6.3, 10.4_
  - [ ]\* 16.3 编写 VR 会话 API 单元测试
    - 测试 API 端点的请求/响应格式
    - 测试错误处理（无效会话 ID、重复加入等）
    - _Requirements: 10.4_

- [ ] 17. 实现前端 VR 管理面板
  - [ ] 17.1 实现 `client/src/components/vr/VRManagementPanel.tsx`
    - 显示 VR 会话列表、在线用户、场景状态
    - 支持启动/停止会话、邀请用户、配置场景参数
    - 提供 2D 场景预览
    - 支持向 VR 用户发送通知
    - _Requirements: 10.1, 10.2, 10.3, 10.5_

- [ ] 18. 集成 VR 场景到现有架构
  - [ ] 18.1 实现 `client/src/components/vr/VRScene.tsx` VR 场景根组件
    - 整合 TaskBoardRenderer、DataFlowRenderer、AgentAvatarRenderer
    - 集成 GestureInterpreter 和 InteractionDispatcher
    - 集成 SceneOptimizer
    - 集成 VRSessionManager
    - _Requirements: 1.1, 2.3, 2.4, 8.1_
  - [ ] 18.2 在 Scene3D.tsx 中添加 VR 模式入口
    - 添加 VR 模式切换按钮
    - 根据适配器状态切换 2D/VR 渲染模式
    - _Requirements: 7.5_
  - [ ] 18.3 在 App.tsx 路由中集成 VR 管理面板
    - 添加 VR 管理面板到工具栏或独立路由
    - _Requirements: 10.1_

- [ ] 19. 最终 Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。
  - 验证 VR 模块与现有 Scene3D 架构的集成
  - 验证 TypeScript 类型检查通过（tsc --noEmit）

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用具体需求以确保可追溯性
- Checkpoint 确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 当前阶段 WebXRAdapter 为骨架实现，完整 VR 硬件集成为远期目标
