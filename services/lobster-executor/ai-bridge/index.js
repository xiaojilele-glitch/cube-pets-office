/**
 * AI Bridge — 容器内统一 AI 调用桥接层
 *
 * 运行在 Docker 容器内（/opt/ai-bridge/），提供 generate、streamGenerate、embed 三个异步函数。
 * 通过环境变量 AI_API_KEY / AI_BASE_URL / AI_MODEL 初始化 OpenAI 客户端。
 * 接口与 shared/llm/contracts.ts 的 LLMMessage / LLMGenerateOptions / LLMGenerateResult 兼容。
 *
 * 这是纯 JavaScript CommonJS 模块，不参与 TypeScript 编译。
 */

const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const ARTIFACT_DIR = "/workspace/artifacts";
const ARTIFACT_FILE = path.join(ARTIFACT_DIR, "ai-result.json");

/** @type {OpenAI | null} */
let _client = null;

/**
 * Lazily initialise the OpenAI client.
 * Throws a descriptive error when AI_API_KEY is missing.
 */
function getClient() {
  if (_client) return _client;

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error("AI_API_KEY environment variable is not set");
  }

  const baseURL = process.env.AI_BASE_URL || "https://api.openai.com/v1";

  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

/**
 * Synchronous (non-streaming) text generation.
 *
 * @param {Array<{ role: string; content: string | object[] }>} messages
 * @param {{ temperature?: number; maxTokens?: number; jsonMode?: boolean }} [options]
 * @returns {Promise<{ content: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number }; model: string }>}
 */
async function generate(messages, options = {}) {
  if (!process.env.AI_API_KEY) {
    throw new Error("AI_API_KEY environment variable is not set");
  }

  const client = getClient();
  const model = process.env.AI_MODEL || "gpt-4";

  /** @type {import("openai").ChatCompletionCreateParamsNonStreaming} */
  const params = {
    model,
    messages,
  };

  if (options.temperature !== undefined) params.temperature = options.temperature;
  if (options.maxTokens !== undefined) params.max_tokens = options.maxTokens;
  if (options.jsonMode) params.response_format = { type: "json_object" };

  const response = await client.chat.completions.create(params);

  const choice = response.choices[0];
  const content = (choice && choice.message && choice.message.content) || "";
  const usage = response.usage || {};

  const result = {
    content,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
    model: response.model || model,
  };

  // Write result artifact
  try {
    if (!fs.existsSync(ARTIFACT_DIR)) {
      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    }
    fs.writeFileSync(ARTIFACT_FILE, JSON.stringify(result, null, 2) + "\n", "utf-8");
  } catch (_err) {
    // Best-effort artifact write — don't fail the generation
  }

  return result;
}

/**
 * Streaming text generation (async generator).
 *
 * @param {Array<{ role: string; content: string | object[] }>} messages
 * @param {{ temperature?: number; maxTokens?: number; jsonMode?: boolean }} [options]
 * @yields {string} content deltas
 */
async function* streamGenerate(messages, options = {}) {
  if (!process.env.AI_API_KEY) {
    throw new Error("AI_API_KEY environment variable is not set");
  }

  const client = getClient();
  const model = process.env.AI_MODEL || "gpt-4";

  /** @type {import("openai").ChatCompletionCreateParamsStreaming} */
  const params = {
    model,
    messages,
    stream: true,
  };

  if (options.temperature !== undefined) params.temperature = options.temperature;
  if (options.maxTokens !== undefined) params.max_tokens = options.maxTokens;
  if (options.jsonMode) params.response_format = { type: "json_object" };

  const stream = await client.chat.completions.create(params);

  for await (const chunk of stream) {
    const delta =
      chunk.choices &&
      chunk.choices[0] &&
      chunk.choices[0].delta &&
      chunk.choices[0].delta.content;
    if (delta) {
      yield delta;
    }
  }
}

/**
 * Text embedding.
 *
 * @param {string[]} texts
 * @returns {Promise<{ vectors: number[][] }>}
 */
async function embed(texts) {
  if (!process.env.AI_API_KEY) {
    throw new Error("AI_API_KEY environment variable is not set");
  }

  const client = getClient();
  const model = process.env.AI_MODEL || "text-embedding-ada-002";

  const response = await client.embeddings.create({
    model,
    input: texts,
  });

  const vectors = response.data.map((item) => item.embedding);

  return { vectors };
}

module.exports = { generate, streamGenerate, embed };
