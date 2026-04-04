# Implementation Plan: AI-Enabled Sandbox

## Overview

为 Lobster Executor 的 Docker 容器添加 AI 能力。按"底层模块先行 → 集成到 Runner → 测试验证"的顺序实现，每个核心模块实现后紧跟属性测试，确保增量正确性。所有代码位于 `services/lobster-executor/` 目录下。

## Tasks

- [x] 1. 扩展配置与类型定义
  - [x] 1.1 在 `types.ts` 的 `LobsterExecutorConfig` 中新增 `aiImage: string` 字段；在 `LobsterExecutorHealthResponse` 中新增 `aiCapability` 字段（enabled、image、llmProvider）
    - _Requirements: 1.3, 7.3_
  - [x] 1.2 在 `config.ts` 的 `readLobsterExecutorConfig()` 中读取 `LOBSTER_AI_IMAGE` 环境变量，默认值 `"cube-ai-sandbox:latest"`
    - _Requirements: 1.3_
  - [x] 1.3 定义 `AIJobPayload` 接口（aiEnabled、aiTaskType、llmConfig）和 `AIResultArtifact` 接口，放入 `types.ts`
    - _Requirements: 1.4, 4.1, 5.4_

- [x] 2. 实现 CredentialInjector 模块
  - [x] 2.1 创建 `credential-injector.ts`，实现 `resolveAICredentials(payload, hostEnv)`、`buildAIEnvVars(creds)`、`validateCredentials(creds)` 三个函数
    - `resolveAICredentials`：payload.llmConfig 优先于宿主机 env（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL）
    - `buildAIEnvVars`：输出 `AI_API_KEY=xxx`、`AI_BASE_URL=xxx`、`AI_MODEL=xxx` 格式数组
    - `validateCredentials`：apiKey 非空且长度 > 8，否则抛出 CredentialValidationError
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 2.2 编写属性测试：凭证解析与覆盖优先级
    - **Property 2: 凭证解析与覆盖优先级**
    - **Validates: Requirements 2.1, 2.2, 2.3**
  - [x] 2.3 编写属性测试：凭证验证拒绝无效输入
    - **Property 3: 凭证验证拒绝无效输入**
    - **Validates: Requirements 2.4, 2.5**

- [x] 3. 实现 CredentialScrubber 模块
  - [x] 3.1 创建 `credential-scrubber.ts`，实现 `CredentialScrubber` 类
    - 构造函数接收 `secrets: string[]`
    - `scrubLine(line)`：精确匹配已注入 key + 模式匹配 `sk-[a-zA-Z0-9]{20,}` 和 `clp_[a-zA-Z0-9]{20,}`，替换为 `[REDACTED]`
    - `scrubFile(filePath)`：读取文件 → 逐行清洗 → 覆写
    - `scrubDirectory(dirPath)`：遍历目录下所有文本文件调用 scrubFile
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 3.2 编写属性测试：凭证清洗完整性
    - **Property 5: 凭证清洗完整性**
    - **Validates: Requirements 6.1, 6.2, 6.3**
  - [x] 3.3 编写属性测试：Artifact 文件凭证清洗
    - **Property 7: Artifact 文件凭证清洗**
    - **Validates: Requirements 6.4**

- [x] 4. 实现 AI Task Presets 模块
  - [x] 4.1 创建 `ai-task-presets.ts`，定义 `AITaskPreset` 接口和 `AI_TASK_PRESETS` 常量 map，实现 `getAITaskPreset(taskType)` 函数
    - 四种预设：text-generation、code-generation、data-analysis、image-understanding
    - 未知类型回退到 text-generation
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 4.2 编写属性测试：AI 任务预设映射
    - **Property 4: AI 任务预设映射**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6**

- [x] 5. Checkpoint — 确保基础模块测试通过
  - 运行所有测试，确保 credential-injector、credential-scrubber、ai-task-presets 模块正确。如有问题请询问用户。

- [x] 6. 扩展 DockerRunner 支持 AI 容器
  - [x] 6.1 修改 `docker-runner.ts` 的 `buildContainerOptions()` 方法，增加 AI 感知逻辑
    - 检测 `payload.aiEnabled`，为 true 时切换到 `config.aiImage` 镜像
    - 调用 `resolveAICredentials` + `validateCredentials` + `buildAIEnvVars` 注入凭证环境变量
    - 尊重 `payload.image` 显式覆盖
    - _Requirements: 1.4, 2.1, 2.3, 7.1_
  - [x] 6.2 修改 `DockerRunner.run()` 方法，AI Job 完成后调用 `CredentialScrubber` 清洗 artifacts 目录和日志
    - _Requirements: 6.4, 6.5_
  - [x] 6.3 修改 `DockerRunner.emitCompleted()` 和 `emitFailed()`，AI Job 的事件 payload 中包含 aiTaskType、aiModel、aiResult 摘要（contentPreview 截断到 200 字符），事件内容经过 CredentialScrubber 清洗
    - _Requirements: 5.1, 5.3, 6.2_
  - [x] 6.4 编写属性测试：AI 镜像选择正确性
    - **Property 1: AI 镜像选择正确性**
    - **Validates: Requirements 1.3, 1.4, 7.1**
  - [x] 6.5 编写属性测试：非 AI Job 行为不变
    - **Property 8: 非 AI Job 行为不变**
    - **Validates: Requirements 7.1**
  - [x] 6.6 编写属性测试：AI 完成事件 contentPreview 截断
    - **Property 9: AI 完成事件 contentPreview 截断**
    - **Validates: Requirements 5.3**

- [x] 7. 扩展 MockRunner 支持 AI 模拟
  - [x] 7.1 修改 `mock-runner.ts`，当 `payload.aiEnabled` 为 true 时生成模拟 AI 响应
    - 返回固定的 MOCK_AI_RESULT（content、usage、model）
    - 写入 ai-result.json artifact
    - 事件 payload 包含 aiResult 摘要
    - _Requirements: 7.4_
  - [x] 7.2 编写属性测试：Mock 模式 AI 响应一致性
    - **Property 10: Mock 模式 AI 响应一致性**
    - **Validates: Requirements 7.4**

- [x] 8. 实现 AI Bridge 容器内模块
  - [x] 8.1 创建 `ai-bridge/` 目录，实现 `index.js`（Node.js 模块）
    - 导出 `generate(messages, options)`、`streamGenerate(messages, options)`、`embed(texts)` 三个异步函数
    - 从环境变量 AI_API_KEY / AI_BASE_URL / AI_MODEL 初始化 openai 客户端
    - 缺少 AI_API_KEY 时抛出描述性错误
    - generate 结果自动写入 `/workspace/artifacts/ai-result.json`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 8.2 编写属性测试：AI 结果 Artifact 完整性
    - **Property 6: AI 结果 Artifact 完整性**
    - **Validates: Requirements 3.6, 5.4**

- [x] 9. 创建 AI 基础镜像 Dockerfile
  - [x] 9.1 创建 `services/lobster-executor/Dockerfile.ai` 定义 AI_Image
    - 基于 node:20-slim，安装 openai 和 langchain npm 包（固定版本号）
    - 复制 ai-bridge/ 到 /opt/ai-bridge/
    - _Requirements: 1.1, 1.2, 1.5_

- [x] 10. 扩展 Health 端点
  - [x] 10.1 修改 `app.ts` 的 /health 路由，新增 `aiCapability` 字段
    - enabled: 基于 LLM_API_KEY 是否存在
    - image: config.aiImage
    - llmProvider: 从 LLM_BASE_URL 推断
    - _Requirements: 7.2, 7.3_

- [x] 11. Checkpoint — 全量测试验证
  - 运行所有测试（包括属性测试和单元测试），确保 10 个属性测试全部通过，AI 功能与现有非 AI 功能互不干扰。如有问题请询问用户。

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 属性测试使用 `fast-check` 库，每个属性至少 100 次迭代
- 所有属性测试文件命名遵循 `*.property.test.ts` 约定，与现有 L22 测试风格一致
- AI Bridge 是容器内模块（纯 JS），不参与 TypeScript 编译，独立于 executor 主代码
