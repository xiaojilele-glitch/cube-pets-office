# 实现计划：多模态视觉能力（Multi-Modal Vision）

## 概述

按照渐进增强的方式实现 Vision 能力：先扩展共享类型和数据模型，再实现服务端 Vision Provider，然后扩展前端附件管道，最后接入 Agent 上下文注入和 3D 场景状态。每一步都确保现有功能不受影响。

## 任务

- [x] 1. 扩展共享类型定义
  - [x] 1.1 扩展 WorkflowInputAttachment 接口，新增 visionReady、base64DataUrl、visualDescription 可选字段；扩展 WorkflowAttachmentExcerptStatus 类型新增 "vision_analyzed" 和 "vision_fallback"
    - 修改 `shared/workflow-input.ts`
    - 确保 normalizeWorkflowAttachment 函数兼容新字段（可选字段不影响现有逻辑）
    - _Requirements: 1.1, 1.2, 4.2_
  - [x] 1.2 扩展 LLMMessage 接口，content 字段支持 string | LLMMessageContentPart[] 联合类型；新增 LLMMessageContentPart 类型定义
    - 修改 `shared/workflow-runtime.ts`
    - 确保现有使用 LLMMessage 的代码无需修改（string 类型向后兼容）
    - _Requirements: 3.1_
  - [ ]* 1.3 编写 LLMMessage 多模态消息序列化 round-trip 属性测试
    - **Property 6: 多模态消息序列化 round-trip**
    - **Validates: Requirements 3.4**

- [x] 2. 实现 Vision Provider 配置与调用
  - [x] 2.1 新增 Vision 配置读取函数 getVisionConfig()，实现 VISION_LLM_* → FALLBACK_LLM_* → LLM_* 的 fallback 链
    - 新建 `server/core/vision-provider.ts`
    - 从 `server/core/ai-config.ts` 读取基础配置，叠加 VISION_LLM_* 环境变量
    - 导出 VisionProviderConfig 接口和 getVisionConfig 函数
    - _Requirements: 2.1, 2.2, 7.1_
  - [ ]* 2.2 编写 Vision 配置解析与 Fallback 链属性测试
    - **Property 4: Vision 配置解析与 Fallback 链**
    - **Validates: Requirements 2.1, 2.2, 7.1**
  - [x] 2.3 实现 analyzeImage 和 analyzeImages 函数，复用 llm-client 的调用机制发送多模态消息到 Vision LLM
    - 在 `server/core/vision-provider.ts` 中实现
    - 构建包含 image_url 的 Multimodal_Message，调用 Vision LLM
    - 解析 LLM 响应为 VisionAnalysisResult 结构
    - analyzeImages 使用 Promise.allSettled 并行处理多张图片
    - _Requirements: 4.1, 4.4, 4.5_
  - [ ]* 2.4 编写多图分析时 detail 参数约束属性测试
    - **Property 11: 多图分析时 detail 参数约束**
    - **Validates: Requirements 7.2**

- [x] 3. 扩展 LLM Client 多模态消息支持
  - [x] 3.1 修改 llm-client.ts 中的 createChatCompletion 函数，当 LLMMessage.content 为数组时直接传递到请求体
    - 修改 `server/core/llm-client.ts`
    - 在构建 body.messages 时检查 content 类型，数组格式直接传递
    - _Requirements: 3.2_
  - [x] 3.2 修改 llm-client.ts 中的 buildResponsesInput 函数，将 image_url 条目转换为 responses API 的 input_image 格式
    - 修改 `server/core/llm-client.ts`
    - 当 content 为数组时，遍历条目：text → input_text，image_url → input_image
    - _Requirements: 3.3_
  - [ ]* 3.3 编写多模态消息格式转换属性测试
    - **Property 5: 多模态消息格式转换**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 4. Checkpoint - 确保所有测试通过
  - 运行 `npm run check` 确保类型检查通过
  - 运行现有测试确保无回归
  - 如有问题请询问用户

- [x] 5. 扩展前端附件管道
  - [x] 5.1 实现图片 Base64 编码函数 fileToBase64DataUrl，包含大图压缩逻辑（超过 4MB 时使用 Canvas 降采样）
    - 修改 `client/src/lib/workflow-attachments.ts`
    - 新增 fileToBase64DataUrl 函数：读取 File 为 ArrayBuffer，转 base64，拼接 data URL
    - 新增 compressImage 函数：使用 Canvas API 降采样大图
    - _Requirements: 1.2, 1.3_
  - [ ]* 5.2 编写 Base64 编码 round-trip 属性测试
    - **Property 2: Base64 编码 round-trip**
    - **Validates: Requirements 1.2**
  - [x] 5.3 扩展 parseImageFile 函数，增加 Vision 分析路径：先编码 Base64，通过服务端 API 请求 Vision 分析，失败时回退到 OCR
    - 修改 `client/src/lib/workflow-attachments.ts`
    - 新增 requestVisionAnalysis 函数：POST /api/vision/analyze
    - 修改 parseImageFile：先尝试 Vision 路径，catch 后走现有 OCR 路径
    - 标记 visionReady、base64DataUrl、visualDescription 字段
    - _Requirements: 1.1, 1.4, 4.1, 4.2, 4.5_
  - [ ]* 5.4 编写图片类型检测准确性属性测试
    - **Property 1: 图片类型检测准确性**
    - **Validates: Requirements 1.1**

- [x] 6. 实现 Vision 分析 API 路由
  - [x] 6.1 新建 POST /api/vision/analyze 路由，接收 base64 图片数组，调用 vision-provider 返回分析结果
    - 新建 `server/routes/vision.ts`
    - 在 `server/index.ts` 中注册路由
    - 请求体校验：images 数组（base64DataUrl + name），可选 prompt
    - 调用 analyzeImages，返回结果数组
    - _Requirements: 4.1_

- [x] 7. 扩展 Agent 上下文注入
  - [x] 7.1 扩展 AgentInvokeOptions 接口，新增 visionContexts 可选字段；修改 composeAgentMessages 函数，在用户 prompt 之前注入 Visual_Context 消息
    - 修改 `shared/runtime-agent.ts`
    - 新增 VisionContext 接口：{ imageName: string; visualDescription: string }
    - 在 composeAgentMessages 中，遍历 visionContexts 插入 user message
    - _Requirements: 5.1, 5.2_
  - [ ]* 7.2 编写视觉上下文注入与排序属性测试
    - **Property 9: Agent 消息序列中视觉上下文的注入与排序**
    - **Validates: Requirements 5.1, 5.2**
  - [x] 7.3 修改 RuntimeAgent.invoke 方法，当 options 包含 visionContexts 时增加 maxTokens
    - 修改 `shared/runtime-agent.ts`
    - 在 invoke 中检查 visionContexts，有则 maxTokens += 1000
    - _Requirements: 5.3_
  - [ ]* 7.4 编写 maxTokens 增加属性测试
    - **Property 10: 视觉上下文触发 maxTokens 增加**
    - **Validates: Requirements 5.3**

- [x] 8. 扩展工作流指令上下文构建
  - [x] 8.1 修改 buildWorkflowDirectiveContext 函数，当附件包含 visualDescription 时在附件区段中输出 "[Vision Analysis]" 格式的视觉分析内容
    - 修改 `shared/workflow-input.ts`
    - 在 attachmentSections 构建中检查 visualDescription 字段
    - _Requirements: 4.3_
  - [ ]* 8.2 编写指令上下文包含视觉分析属性测试
    - **Property 8: 指令上下文包含视觉分析**
    - **Validates: Requirements 4.3**

- [x] 9. Checkpoint - 确保所有测试通过
  - 运行 `npm run check` 确保类型检查通过
  - 运行所有测试确保无回归
  - 如有问题请询问用户

- [x] 10. 3D 场景"看图"状态
  - [x] 10.1 在 PetWorkers.tsx 的 STATUS_BUBBLES 中新增 analyzing_image 状态文案（中英文）；在 animateWorker 中新增 examining 动画类型
    - 修改 `client/src/components/three/PetWorkers.tsx`
    - 中文："正在看图...\n让我仔细看看这张图。"
    - 英文："Analyzing image...\nLet me take a closer look."
    - examining 动画：轻微前倾 + 左右扫视
    - _Requirements: 6.2, 6.4_
  - [x] 10.2 在 RuntimeAgent 的 Vision 分析流程中发出 analyzing_image 和 idle 事件
    - 修改 `shared/runtime-agent.ts` 或 `server/core/vision-provider.ts`
    - 分析开始时 emit { type: "agent_active", action: "analyzing_image" }
    - 分析结束时 emit { type: "agent_active", action: "idle" }
    - _Requirements: 6.1, 6.3_

- [x] 11. 环境变量与文档更新
  - [x] 11.1 在 .env.example 中新增 VISION_LLM_* 系列环境变量模板和注释
    - 修改 `.env.example`
    - 新增 VISION_LLM_API_KEY、VISION_LLM_BASE_URL、VISION_LLM_MODEL、VISION_LLM_WIRE_API、VISION_LLM_MAX_TOKENS、VISION_LLM_DETAIL、VISION_LLM_TIMEOUT_MS
    - _Requirements: 2.1_
  - [x] 11.2 更新 .kiro/steering/project-overview.md 模块清单表格，新增 multi-modal-vision 行
    - 修改 `.kiro/steering/project-overview.md`
    - 在模块清单表格中新增一行
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
- Vision 功能设计为渐进增强：所有 Vision 失败都优雅降级到 OCR，不中断现有工作流
