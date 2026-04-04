# 设计文档：AI-Enabled Sandbox

## 概述

本设计为 Lobster Executor 的 Docker 容器添加 AI 能力。核心思路是在现有 `DockerRunner` 的容器创建流程中增加一个 AI 增强层：当 Job 的 `payload.aiEnabled` 为 true 时，自动切换到预装 AI SDK 的基础镜像、注入 LLM 凭证、并在容器内提供统一的 AI 调用桥接模块。

设计遵循项目的"策略模式"架构——`DockerRunner` 和 `MockRunner` 实现 `JobRunner` 接口，本设计在 runner 层面增加 AI 感知逻辑，而非创建新的 runner 类型。

### 依赖关系

- **L22 lobster-executor-real**（严格依赖）：Docker 容器生命周期管理
- **C06 shared/llm/contracts.ts**（使用）：LLM 类型定义
- **L23 secure-sandbox**（可选依赖）：如已实现，AI 容器也应用安全策略

## 架构

```mermaid
graph TB
    subgraph "Cube Brain (服务端)"
        Mission[Mission Runtime] --> EP[ExecutionPlan Builder]
        EP -->|"payload.aiEnabled=true"| Executor[Lobster Executor Service]
    end

    subgraph "Lobster Executor"
        Executor --> CI[Credential Injector]
        CI --> DR[DockerRunner]
        DR -->|"AI Image"| Container
        DR --> CS[Credential Scrubber]
        CS -->|"过滤日志"| CB[Callback Sender]
    end

    subgraph "Docker Container"
        Container --> Bridge[AI Bridge /opt/ai-bridge/]
        Bridge -->|"AI_API_KEY"| LLM[LLM API]
        Bridge --> Artifacts[/workspace/artifacts/ai-result.json]
    end

    CB -->|"HMAC 签名回调"| Mission
    Artifacts -->|"收集"| DR

    style CI fill:#f9f,stroke:#333
    style CS fill:#f9f,stroke:#333
    style Bridge fill:#bbf,stroke:#333
```

### 数据流

1. Mission Runtime 构建 ExecutionPlan，Job payload 中设置 `aiEnabled: true` 和 `aiTaskType`
2. Executor Service 接收 Job，`CredentialInjector` 从宿主机 env 读取 LLM 凭证
3. `DockerRunner.buildContainerOptions()` 检测 `aiEnabled`，切换镜像并注入凭证环境变量
4. 容器启动后，任务脚本通过 `require('/opt/ai-bridge')` 调用 AI Bridge
5. AI Bridge 读取 `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` 环境变量，调用 LLM API
6. 结果写入 `/workspace/artifacts/ai-result.json`
7. DockerRunner 收集 artifacts，`CredentialScrubber` 清洗日志和 artifact 中的凭证
8. 通过 HMAC 签名回调将结果推送回 Cube Brain

## 组件与接口

### 1. CredentialInjector（凭证注入器）

新增模块 `services/lobster-executor/src/credential-injector.ts`

```typescript
export interface AICredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface CredentialInjectorConfig {
  /** 宿主机环境变量（默认 process.env） */
  hostEnv?: Record<string, string | undefined>;
}

/**
 * 从宿主机 env 或 Job payload 解析 AI 凭证，
 * 返回注入到容器的环境变量 map。
 */
export function resolveAICredentials(
  payload: Record<string, unknown>,
  hostEnv?: Record<string, string | undefined>,
): AICredentials;

/**
 * 将 AICredentials 转换为容器环境变量数组。
 * 使用 AI_ 前缀避免与宿主机变量冲突。
 */
export function buildAIEnvVars(creds: AICredentials): string[];

/**
 * 验证凭证有效性（非空、长度 > 8）。
 * 无效时抛出 CredentialValidationError。
 */
export function validateCredentials(creds: AICredentials): void;
```

### 2. CredentialScrubber（凭证清洗器）

新增模块 `services/lobster-executor/src/credential-scrubber.ts`

```typescript
export class CredentialScrubber {
  constructor(secrets: string[]);

  /** 清洗单行文本，替换匹配的凭证为 [REDACTED] */
  scrubLine(line: string): string;

  /** 清洗文件内容（读取 → 清洗 → 覆写） */
  scrubFile(filePath: string): { scrubbed: boolean; replacements: number };

  /** 清洗目录下所有文本文件 */
  scrubDirectory(dirPath: string): { totalReplacements: number; filesProcessed: number };
}
```

清洗规则：
- 精确匹配已注入的 API Key 值
- 模式匹配：`sk-[a-zA-Z0-9]{20,}` (OpenAI 格式)
- 模式匹配：`clp_[a-zA-Z0-9]{20,}` (自定义格式)

### 3. AI Bridge（容器内桥接层）

新增目录 `services/lobster-executor/ai-bridge/`，构建时复制到 Docker 镜像的 `/opt/ai-bridge/`。

```typescript
// ai-bridge/index.js — 容器内 Node.js 模块
export interface AIBridgeOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface AIBridgeResult {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

/** 同步生成 */
export async function generate(
  messages: Array<{ role: string; content: string | object[] }>,
  options?: AIBridgeOptions,
): Promise<AIBridgeResult>;

/** 流式生成 */
export async function* streamGenerate(
  messages: Array<{ role: string; content: string | object[] }>,
  options?: AIBridgeOptions,
): AsyncGenerator<string>;

/** 文本向量化 */
export async function embed(texts: string[]): Promise<{ vectors: number[][] }>;
```

AI Bridge 内部使用 `openai` npm 包，通过环境变量 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL` 初始化客户端。接口设计与 `shared/llm/contracts.ts` 的 `LLMMessage`、`LLMGenerateResult` 类型兼容。

### 4. AI Task Type 预设配置

```typescript
// services/lobster-executor/src/ai-task-presets.ts

export interface AITaskPreset {
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
  supportsImageInput: boolean;
}

export const AI_TASK_PRESETS: Record<string, AITaskPreset> = {
  "text-generation":      { temperature: 0.7, maxTokens: 2048, jsonMode: false, supportsImageInput: false },
  "code-generation":      { temperature: 0.2, maxTokens: 4096, jsonMode: false, supportsImageInput: false },
  "data-analysis":        { temperature: 0.1, maxTokens: 4096, jsonMode: true,  supportsImageInput: false },
  "image-understanding":  { temperature: 0.5, maxTokens: 2048, jsonMode: false, supportsImageInput: true  },
};

export function getAITaskPreset(taskType: string): AITaskPreset;
```

### 5. DockerRunner 扩展

修改 `services/lobster-executor/src/docker-runner.ts` 的 `buildContainerOptions()` 方法：

```typescript
// 在 buildContainerOptions 中增加 AI 感知逻辑
buildContainerOptions(record: StoredJobRecord, workspaceDir: string): Dockerode.ContainerCreateOptions {
  const payload = (record.planJob.payload ?? {}) as Record<string, unknown>;
  const aiEnabled = payload.aiEnabled === true;

  // 镜像选择：aiEnabled → AI_Image，否则原逻辑
  const image = aiEnabled
    ? (payload.image as string) || this.config.aiImage || "cube-ai-sandbox:latest"
    : (payload.image as string) || this.config.defaultImage || "node:20-slim";

  // 环境变量：原有 + AI 凭证
  const envMap = (payload.env ?? {}) as Record<string, string>;
  const envArray = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);

  if (aiEnabled) {
    const creds = resolveAICredentials(payload, process.env);
    validateCredentials(creds);
    envArray.push(...buildAIEnvVars(creds));
  }

  // ... 其余逻辑不变
}
```

### 6. MockRunner AI 模拟

修改 `services/lobster-executor/src/mock-runner.ts`，当 `payload.aiEnabled` 为 true 时返回模拟 AI 响应：

```typescript
// mock AI 响应
const MOCK_AI_RESULT = {
  content: "This is a mock AI response for testing purposes.",
  usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
  model: "mock-model",
  taskType: "text-generation",
};
```

### 7. LobsterExecutorConfig 扩展

在 `types.ts` 的 `LobsterExecutorConfig` 中新增：

```typescript
export interface LobsterExecutorConfig {
  // ... 现有字段
  aiImage: string;          // LOBSTER_AI_IMAGE，默认 "cube-ai-sandbox:latest"
}
```

在 `config.ts` 的 `readLobsterExecutorConfig()` 中新增：

```typescript
aiImage: env.LOBSTER_AI_IMAGE || "cube-ai-sandbox:latest",
```

## 数据模型

### Job Payload 扩展

在现有 `ExecutionPlanJob.payload` 中新增以下可选字段：

```typescript
interface AIJobPayload {
  /** 是否启用 AI 能力 */
  aiEnabled?: boolean;
  /** AI 任务类型 */
  aiTaskType?: "text-generation" | "code-generation" | "data-analysis" | "image-understanding";
  /** 覆盖默认 LLM 配置 */
  llmConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
}
```

### AI Result Artifact 格式

`/workspace/artifacts/ai-result.json` 的结构：

```typescript
interface AIResultArtifact {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  taskType: string;
  completedAt: string;
}
```

### Health 端点扩展

```typescript
interface LobsterExecutorHealthResponse {
  // ... 现有字段
  aiCapability: {
    enabled: boolean;
    image: string;
    llmProvider: string;  // 从 LLM_BASE_URL 推断
  };
}
```

### 回调事件 payload 扩展

`job.started` 事件的 `payload` 字段：

```typescript
{
  aiTaskType: "text-generation",
  aiModel: "gpt-5.4"
}
```

`job.completed` 事件的 `payload` 字段：

```typescript
{
  aiResult: {
    tokenUsage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    model: "gpt-5.4",
    contentPreview: "前 200 字符..."
  }
}
```



## 正确性属性

*正确性属性是系统在所有合法执行路径上都应保持为真的特征或行为——本质上是人类可读规格与机器可验证正确性保证之间的桥梁。*

### Property 1: AI 镜像选择正确性

*For any* Job payload 和 executor 配置组合，当 `payload.aiEnabled` 为 true 且 `payload.image` 未设置时，`buildContainerOptions` 应返回 AI 镜像（来自 config.aiImage 或默认 "cube-ai-sandbox:latest"）；当 `payload.aiEnabled` 为 false 或未设置时，应返回默认镜像（来自 config.defaultImage 或 "node:20-slim"）；当 `payload.image` 显式设置时，无论 aiEnabled 值如何，应使用 payload.image。

**Validates: Requirements 1.3, 1.4, 7.1**

### Property 2: 凭证解析与覆盖优先级

*For any* 宿主机环境变量（LLM_API_KEY、LLM_BASE_URL、LLM_MODEL）和 payload.llmConfig 的组合，`resolveAICredentials` 应遵循以下优先级：payload.llmConfig 中的值优先于宿主机环境变量。输出的环境变量数组应使用 AI_ 前缀（AI_API_KEY、AI_BASE_URL、AI_MODEL）。

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: 凭证验证拒绝无效输入

*For any* API Key 字符串，若为空或长度 ≤ 8，`validateCredentials` 应抛出错误；若长度 > 8 且非空，应通过验证。当 aiEnabled 为 true 但无任何来源提供 API Key 时，系统应拒绝 Job。

**Validates: Requirements 2.4, 2.5**

### Property 4: AI 任务预设映射

*For any* 字符串作为 aiTaskType，`getAITaskPreset` 应返回正确的预设配置：已知类型（text-generation、code-generation、data-analysis、image-understanding）返回对应的 temperature/maxTokens/jsonMode 组合；未知类型回退到 text-generation 的默认配置。

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6**

### Property 5: 凭证清洗完整性

*For any* 包含已注入 API Key 值、或匹配 `sk-[a-zA-Z0-9]{20,}` 模式、或匹配 `clp_[a-zA-Z0-9]{20,}` 模式的字符串，`CredentialScrubber.scrubLine` 应将匹配部分替换为 "[REDACTED]"，且不修改不包含凭证的文本部分。

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 6: AI 结果 Artifact 完整性

*For any* 成功的 AI 执行结果，写入 `/workspace/artifacts/ai-result.json` 的 JSON 对象应包含 content（string）、usage（含 promptTokens、completionTokens、totalTokens）、model（string）、taskType（string）四个必需字段，且反序列化后与原始结果等价。

**Validates: Requirements 3.6, 5.4**

### Property 7: Artifact 文件凭证清洗

*For any* 文本文件内容包含已注入的 API Key，经过 `CredentialScrubber.scrubFile` 处理后，文件内容不应包含原始 API Key 字符串。

**Validates: Requirements 6.4**

### Property 8: 非 AI Job 行为不变

*For any* payload.aiEnabled 为 false 或未设置的 Job，`buildContainerOptions` 的输出应与未引入 AI 功能前的原始逻辑完全一致——不包含 AI_ 前缀的环境变量，不使用 AI 镜像。

**Validates: Requirements 7.1**

### Property 9: AI 完成事件 contentPreview 截断

*For any* AI 生成结果，job.completed 事件 payload 中的 `contentPreview` 字段长度应 ≤ 200 字符。若原始 content 长度 > 200，contentPreview 应为 content 的前 200 个字符。

**Validates: Requirements 5.3**

### Property 10: Mock 模式 AI 响应一致性

*For any* aiEnabled 为 true 的 Job 在 mock 模式下执行，完成事件应包含固定的模拟 AI 响应（content、usage、model 字段均为预定义值），且 artifact 中应包含 ai-result.json。

**Validates: Requirements 7.4**

## 错误处理

| 错误场景 | errorCode | 处理方式 |
|---------|-----------|---------|
| AI 凭证缺失（无 API Key） | `AI_CREDENTIALS_MISSING` | 拒绝 Job，发出 job.failed 事件 |
| AI 凭证无效（长度 ≤ 8） | `AI_CREDENTIALS_INVALID` | 拒绝 Job，发出 job.failed 事件 |
| AI API 调用失败 | `AI_API_ERROR` | 发出 job.failed 事件，detail 中包含脱敏后的错误信息 |
| AI 镜像不存在 | `IMAGE_PULL_FAILED` | 复用现有 DockerRunner 的镜像拉取失败处理 |
| 未知 aiTaskType | 无错误 | 回退到 text-generation 默认配置，记录警告日志 |
| 凭证泄露检测 | 无错误 | CredentialScrubber 替换为 [REDACTED]，记录审计事件 |

### 错误脱敏规则

所有错误信息在通过回调发送前，必须经过 `CredentialScrubber` 处理：
- job.failed 事件的 `message` 和 `detail` 字段
- 日志文件中的每一行
- artifact 文件中的文本内容

## 测试策略

### 属性测试（Property-Based Testing）

使用 `fast-check` 库（项目已有依赖），每个属性测试运行至少 100 次迭代。

| 属性 | 测试文件 | 标签 |
|------|---------|------|
| Property 1 | `ai-image-selection.property.test.ts` | Feature: ai-enabled-sandbox, Property 1: AI 镜像选择正确性 |
| Property 2 | `credential-injector.property.test.ts` | Feature: ai-enabled-sandbox, Property 2: 凭证解析与覆盖优先级 |
| Property 3 | `credential-injector.property.test.ts` | Feature: ai-enabled-sandbox, Property 3: 凭证验证拒绝无效输入 |
| Property 4 | `ai-task-presets.property.test.ts` | Feature: ai-enabled-sandbox, Property 4: AI 任务预设映射 |
| Property 5 | `credential-scrubber.property.test.ts` | Feature: ai-enabled-sandbox, Property 5: 凭证清洗完整性 |
| Property 6 | `ai-result-artifact.property.test.ts` | Feature: ai-enabled-sandbox, Property 6: AI 结果 Artifact 完整性 |
| Property 7 | `credential-scrubber.property.test.ts` | Feature: ai-enabled-sandbox, Property 7: Artifact 文件凭证清洗 |
| Property 8 | `ai-image-selection.property.test.ts` | Feature: ai-enabled-sandbox, Property 8: 非 AI Job 行为不变 |
| Property 9 | `ai-event-payload.property.test.ts` | Feature: ai-enabled-sandbox, Property 9: AI 完成事件 contentPreview 截断 |
| Property 10 | `mock-ai-runner.property.test.ts` | Feature: ai-enabled-sandbox, Property 10: Mock 模式 AI 响应一致性 |

### 单元测试

单元测试覆盖具体示例和边界情况：

- **AI Bridge 模块导出验证**：验证 `/opt/ai-bridge/index.js` 导出 generate、streamGenerate、embed 函数
- **AI Bridge 缺少 API Key 错误**：验证未设置 AI_API_KEY 时抛出描述性错误
- **Health 端点 aiCapability 字段**：验证 /health 响应包含 aiCapability 字段
- **向后兼容性**：验证现有请求格式在新代码下仍然有效
- **image-understanding 消息类型**：验证 AI Bridge 正确处理 LLMImageContent 类型消息

### 测试配置

```typescript
// vitest.config.ts 中已有 fast-check 支持
// 每个属性测试使用 fc.assert(fc.property(...), { numRuns: 100 })
```

属性测试和单元测试互补：属性测试验证通用正确性（覆盖大量随机输入），单元测试验证具体示例和边界情况。
