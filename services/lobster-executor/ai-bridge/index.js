/**
 * AI Bridge — 容器内统一 AI 调用桥接层
 *
 * 支持两种 wire API:
 *   - "chat" (默认): OpenAI Chat Completions API
 *   - "responses": OpenAI Responses API (with SSE streaming)
 */

const fs = require("fs");
const path = require("path");

const ARTIFACT_DIR = "/workspace/artifacts";
const ARTIFACT_FILE = path.join(ARTIFACT_DIR, "ai-result.json");

function getWireApi() {
  return (process.env.AI_WIRE_API || "chat").toLowerCase();
}

function getBaseUrl() {
  return (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

function getModel() {
  return process.env.AI_MODEL || "gpt-4";
}

/**
 * Parse SSE stream and extract text content from Responses API.
 */
async function parseSSEStream(response) {
  const text = await response.text();
  let content = "";
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") break;

    try {
      const evt = JSON.parse(payload);

      // response.output_text.delta — streaming text chunks
      if (evt.type === "response.output_text.delta" && evt.delta) {
        content += evt.delta;
      }

      // response.completed — final event with usage
      if (evt.type === "response.completed" && evt.response) {
        if (evt.response.usage) {
          usage.promptTokens = evt.response.usage.input_tokens || 0;
          usage.completionTokens = evt.response.usage.output_tokens || 0;
          usage.totalTokens = (usage.promptTokens + usage.completionTokens);
        }
        // Also try to get content from completed response
        if (!content && Array.isArray(evt.response.output)) {
          for (const item of evt.response.output) {
            if (item.type === "message" && Array.isArray(item.content)) {
              for (const c of item.content) {
                if (c.type === "output_text") content += c.text;
              }
            }
          }
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return { content, usage };
}

/**
 * Call LLM — supports both Chat Completions and Responses API.
 */
async function generate(messages, options = {}) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY environment variable is not set");

  const wireApi = getWireApi();
  const baseUrl = getBaseUrl();
  const model = getModel();

  let url, body;

  if (wireApi === "responses") {
    url = `${baseUrl}/responses`;
    const systemMsg = messages.find(m => m.role === "system");
    const userMsg = messages.find(m => m.role === "user");
    body = {
      model,
      input: userMsg?.content || "",
      instructions: systemMsg?.content || "",
      stream: true,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_output_tokens = options.maxTokens;
  } else {
    url = `${baseUrl}/chat/completions`;
    body = { model, messages };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
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
    throw new Error(`${response.status} ${response.statusText}: ${errText.slice(0, 300)}`);
  }

  let content, usage;
  const contentType = response.headers.get("content-type") || "";

  if (wireApi === "responses" || contentType.includes("text/event-stream")) {
    // SSE streaming response
    const parsed = await parseSSEStream(response);
    content = parsed.content;
    usage = parsed.usage;
  } else {
    // Standard JSON response (Chat Completions)
    const data = await response.json();
    const choice = data.choices?.[0];
    content = choice?.message?.content || "";
    usage = {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    };
  }

  const result = { content, usage, model };

  // Write result artifact
  try {
    if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(ARTIFACT_FILE, JSON.stringify(result, null, 2) + "\n", "utf-8");
  } catch {}

  return result;
}

module.exports = { generate };
