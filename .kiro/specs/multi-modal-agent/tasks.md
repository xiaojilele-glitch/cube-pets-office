# 实现计划：多模态 Agent（Multi-Modal Agent）

## 概述

在 multi-modal-vision 的基础上，按渐进增强方式实现 TTS/STT 语音能力和统一多模态编排。先扩展共享类型和配置，再实现服务端 Voice Provider 和 API 路由，然后实现前端 TTS/STT 引擎，接着集成 ChatPanel/WorkflowPanel 语音控件和 3D 动画，最后扩展动态组织能力标签。每一步确保现有功能不受影响。

## 任务

- [x] 1. 扩展共享类型定义
  - [x] 1.1 扩展 AgentInvokeOptions 和新增 MultimodalContext 接口
    - 修改 `shared/runtime-agent.ts`
    - 新增 `MultimodalContext` 接口（visionContexts?: VisionContext[], voiceTranscript?: string, voiceLanguage?: string）
    - 扩展 `AgentInvokeOptions` 新增 `multimodalContext?: MultimodalContext` 字段
    - 新增 `VisionContext` 接口（如 multi-modal-vision 尚未定义）
    - _Requirements: 5.1_
  - [x] 1.2 扩展 AgentRecord 接口新增 capabilities 字段
    - 修改 `shared/workflow-runtime.ts`
    - 在 `AgentRecord` 接口中新增 `capabilities?: string[]` 可选字段
    - _Requirements: 6.2_
  - [x] 1.3 扩展 STATUS_BUBBLES 和 animateWorker 新增 listening/speaking 状态
    - 修改 `client/src/components/three/PetWorkers.tsx`
    - 在 STATUS_BUBBLES 的 zh-CN 和 en-US 中新增 listening 和 speaking 文案
    - 在 animateWorker 中新增 'listening' 和 'speaking' 动画 case
    - _Requirements: 4.2, 4.4_
  - [ ]* 1.4 编写语音状态气泡文案完整性属性测试
    - **Property 6: 语音状态气泡文案完整性**
    - **Validates: Requirements 4.2, 4.4**
  - [ ]* 1.5 编写 MultimodalContext 序列化 round-trip 属性测试
    - **Property 4: MultimodalContext 序列化 round-trip**
    - **Validates: Requirements 5.4**

- [x] 2. 实现 Voice Provider 配置与服务端语音服务
  - [x] 2.1 新增 Voice Provider 配置模块
    - 新建 `server/core/voice-provider.ts`
    - 实现 `getVoiceConfig()` 函数，从 TTS_* 和 STT_* 环境变量读取配置
    - 导出 `VoiceConfig` 接口
    - 当 TTS_API_URL + TTS_API_KEY 均存在时 tts.available = true，否则 false；STT 同理
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [ ]* 2.2 编写 Voice 配置解析与可用性标记属性测试
    - **Property 1: Voice 配置解析与可用性标记**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
  - [x] 2.3 实现 synthesizeSpeech 和 recognizeSpeech 函数
    - 在 `server/core/voice-provider.ts` 中实现
    - `synthesizeSpeech(text, voice?)`: 调用 TTS_API_URL，返回音频 Buffer
    - `recognizeSpeech(audioBuffer, mimeType?)`: 调用 STT_API_URL，返回 { transcript }
    - _Requirements: 8.1, 8.2_
  - [x] 2.4 新增服务端 Voice API 路由
    - 新建 `server/routes/voice.ts`
    - 实现 POST /api/voice/tts（接收 { text, voice? }，返回 audio/mpeg）
    - 实现 POST /api/voice/stt（接收 multipart audio，返回 { transcript }）
    - 实现 GET /api/voice/config（返回 TTS/STT 可用性状态）
    - 未配置时返回 501，服务失败返回 503
    - 在 `server/index.ts` 中注册路由
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [ ]* 2.5 编写 Voice API 服务失败返回 503 属性测试
    - **Property 10: Voice API 服务失败返回 503**
    - **Validates: Requirements 8.3**

- [x] 3. Checkpoint - 确保服务端代码通过检查
  - 运行 `npm run check` 确保类型检查通过
  - 运行现有测试确保无回归
  - 如有问题请询问用户

- [x] 4. 实现前端 TTS 引擎
  - [x] 4.1 实现 TTS 引擎抽象层
    - 新建 `client/src/lib/tts-engine.ts`
    - 定义 `TTSEngine` 接口（isAvailable, isSpeaking, speak, pause, resume, stop, onStateChange）
    - 实现 `createBrowserTTSEngine()`：基于 window.speechSynthesis
    - 实现 `createServerTTSEngine(apiUrl)`：POST /api/voice/tts + AudioContext 播放
    - 实现 `createTTSEngine(config)`：根据 VoiceConfig 选择实现，服务端不可用时回退到浏览器
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_
  - [ ]* 4.2 编写语音引擎错误恢复属性测试（TTS 部分）
    - **Property 7: 语音引擎错误恢复**
    - **Validates: Requirements 1.5, 2.7**

- [x] 5. 实现前端 STT 引擎
  - [x] 5.1 实现 STT 引擎抽象层
    - 新建 `client/src/lib/stt-engine.ts`
    - 定义 `STTEngine` 接口（isAvailable, isListening, startListening, stopListening）
    - 定义 `STTEngineCallbacks` 接口（onInterimTranscript, onFinalTranscript, onError, onStateChange）
    - 实现 `createBrowserSTTEngine(lang?)`：基于 SpeechRecognition API，3 秒静默超时
    - 实现 `createServerSTTEngine(apiUrl, lang?)`：MediaRecorder 录音 + POST /api/voice/stt
    - 实现 `createSTTEngine(config)`：根据 VoiceConfig 选择实现，服务端不可用时回退到浏览器
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8_

- [x] 6. 扩展 Agent Invoke 层多模态上下文注入
  - [x] 6.1 修改 composeAgentMessages 函数支持 MultimodalContext
    - 修改 `shared/runtime-agent.ts`
    - 在现有 context 注入之后、用户 prompt 之前：
      - 如有 visionContexts，注入 "[Vision Analysis]" 消息（兼容 multi-modal-vision）
      - 如有 voiceTranscript，注入 "[Voice Input] {transcript}" 消息
    - 确保顺序：visionContexts → voiceTranscript → user prompt
    - _Requirements: 5.2, 5.3_
  - [ ]* 6.2 编写语音转录文本注入格式属性测试
    - **Property 2: 语音转录文本注入格式**
    - **Validates: Requirements 5.2**
  - [ ]* 6.3 编写多模态消息序列排序属性测试
    - **Property 3: 多模态消息序列排序**
    - **Validates: Requirements 5.3**
  - [x] 6.4 修改 RuntimeAgent.invoke 发出 listening/speaking 事件
    - 修改 `shared/runtime-agent.ts`
    - 在 Voice 相关流程中 emit { type: "agent_active", action: "listening" } 和 { type: "agent_active", action: "speaking" }
    - 流程结束后恢复 "idle"
    - _Requirements: 4.1, 4.3, 4.5_

- [x] 7. Checkpoint - 确保共享层和引擎代码通过检查
  - 运行 `npm run check` 确保类型检查通过
  - 运行所有测试确保无回归
  - 如有问题请询问用户

- [x] 8. 集成 ChatPanel 语音控件
  - [x] 8.1 扩展 Zustand store 新增语音状态
    - 修改 `client/src/lib/store.ts`
    - 新增 ttsEnabled、sttAvailable、ttsAvailable 状态及 setter
    - _Requirements: 3.1_
  - [x] 8.2 在 ChatPanel 中集成麦克风按钮和 TTS 开关
    - 修改 `client/src/components/ChatPanel.tsx`
    - 输入框左侧新增麦克风按钮（点击开始/停止 STT 录音）
    - 输入框右侧新增 TTS 开关 toggle
    - 录音时显示脉冲动画指示器
    - 根据 sttAvailable/ttsAvailable 控制按钮可见性
    - _Requirements: 3.1, 3.2, 3.6, 3.7_
  - [x] 8.3 在 ChatPanel 中集成 TTS 播放按钮
    - 修改 `client/src/components/ChatPanel.tsx`
    - TTS 开启时，每条 Agent 回复旁显示播放/停止按钮
    - 播放中按钮变为停止按钮并显示进度指示
    - _Requirements: 3.3, 3.5_
  - [ ]* 8.4 编写语音能力检测驱动 UI 可见性属性测试
    - **Property 5: 语音能力检测驱动 UI 可见性**
    - **Validates: Requirements 3.6, 3.7**

- [x] 9. 集成 WorkflowPanel TTS 播放
  - [x] 9.1 在 WorkflowPanel 中新增 TTS 播放按钮
    - 修改 `client/src/components/WorkflowPanel.tsx`
    - 在 Agent 回复内容区域新增播放按钮，复用 ChatPanel 的 TTS 播放逻辑
    - _Requirements: 3.4_

- [x] 10. 扩展动态组织多模态能力标签
  - [x] 10.1 扩展 inferTaskProfile 检测多模态关键词
    - 修改 `server/core/dynamic-organization.ts`
    - 在 inferTaskProfile 中检测"语音""朗读""图片""截图""看一下"等关键词
    - 输出中标记多模态需求
    - _Requirements: 6.1_
  - [ ]* 10.2 编写多模态关键词检测属性测试
    - **Property 8: 多模态关键词检测**
    - **Validates: Requirements 6.1**
  - [x] 10.3 扩展 buildPlannerPrompt 包含 Agent 能力标签
    - 修改 `server/core/dynamic-organization.ts`
    - 在 plannerCatalogSummary 中为每个 Agent 附加 capabilities 标签信息
    - _Requirements: 6.3_
  - [ ]* 10.4 编写 Planner Prompt 包含能力标签属性测试
    - **Property 9: Planner Prompt 包含能力标签**
    - **Validates: Requirements 6.3**

- [x] 11. 环境变量与文档更新
  - [x] 11.1 在 .env.example 中新增 TTS_* 和 STT_* 环境变量模板
    - 修改 `.env.example`
    - 新增 TTS_API_URL、TTS_API_KEY、TTS_MODEL、TTS_VOICE、STT_API_URL、STT_API_KEY、STT_MODEL
    - _Requirements: 7.1, 7.2_
  - [x] 11.2 更新 .kiro/steering/project-overview.md 模块清单
    - 修改 `.kiro/steering/project-overview.md`
    - 在模块清单表格中新增 multi-modal-agent 行
    - 在环境变量分组表格中新增 Voice 配置组
    - _Requirements: 文档更新_

- [x] 12. Final Checkpoint - 确保所有测试通过
  - 运行 `npm run check` 确保类型检查通过
  - 运行所有测试（包括新增的属性测试和单元测试）
  - 确认无回归，如有问题请询问用户

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP
- 每个任务引用了具体的需求编号以确保可追溯性
- Checkpoint 任务确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 本 Spec 依赖 multi-modal-vision，Vision 相关功能不在此重复实现
- 语音功能设计为渐进增强：所有语音失败都优雅降级（TTS→纯文本，STT→手动输入），不中断现有工作流
