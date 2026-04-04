/**
 * AI Bridge — 容器内统一 AI 调用桥接层
 *
 * 支持两种 wire API:
 *   - "chat" (默认): OpenAI Chat Completions API (/v1/chat/completions)
 *   - "responses": OpenAI Responses API (/v1/responses)
 *
 * 通过环境变量配置:
 *   AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_WIRE_API
 */

const fs = require("fs");
const path = require("path");

const ARTIFACT_DIR = "/workspace/artifacts";
const ARTIFACT_FILE = path.join(ARTIFACT_DIR, "ai-result.json");

function getWireApi() {
  return (process.env.AI_WIRE_API || "chat").toLowerCase();
}

function getBaseUrl() {
  return process.env.AI_BASE_URL || "https://api.openai.com/v1";
}

function getModel() {
  return process.env.AI_MODEL || "gpt-4";
}

/**
 * Call LLM via raw fetch — works with both chat completions and responses API.
 */
async function generate(messages, options = {}) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY environment variable is not set");

  const wireApi = getWireApi();
  const baseUrl = getBaseUrl().replace(/\/+$/, "");
  const model = getModel();

  let url, body;

  if (wireApi === "responses") {
    // OpenAI Responses API format
    url = `${baseUrl}/responses`;
    const systemMsg = messages.find(m => m.role === "system");
    const userMsg = messages.find(m => m.role === "user");
    body = {
      model,
      instructions: systemMsg?.content || "",
      input: userMsg?.content || "",
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_output_tokens = options.maxTokens;
  } else {
    // Standard Chat Completions API format
    url = `${baseUrl}/chat/completions`;
    body = { model, messages };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.jsonMode) body.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  let content, usage;

  if (wireApi === "responses") {
    // Responses API: output is in data.output
    content = "";
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text") content += c.text;
          }
        }
      }
    }
    if (!content) content = data.output_text || data.text || JSON.stringify(data.output || "");
    usage = {
      promptTokens: data.usage?.input_tokens || 0,
      completionTokens: data.usage?.output_tokens || 0,
      totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  } else {
    // Chat Completions API
    const choice = data.choices?.[0];
    content = choice?.message?.content || "";
    usage = {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    };
  }

  const result = { content, usage, model: data.model || model };

  // Write result artifact
  try {
    if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(ARTIFACT_FILE, JSON.stringify(result, null, 2) + "\n", "utf-8");
  } catch {}

  return result;
}

module.exports = { generate };
