import type { AIConfig } from "./ai-config";
import { recordBrowserLLMCall } from "./browser-telemetry-store";

export interface BrowserLLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface BrowserLLMOptions {
  temperature?: number;
  maxTokens?: number;
}

function buildResponsesInput(messages: BrowserLLMMessage[]) {
  const instructions = messages
    .filter(message => message.role === "system")
    .map(message => message.content)
    .join("\n\n");

  const input = messages
    .filter(message => message.role !== "system")
    .map(message => ({
      role: message.role,
      content: [{ type: "input_text", text: message.content }],
    }));

  return { instructions: instructions || undefined, input };
}

function extractResponsesText(data: any): string {
  if (typeof data.output_text === "string" && data.output_text.length > 0) {
    return data.output_text;
  }

  const texts: string[] = [];
  for (const item of data.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }

  return texts.join("\n").trim();
}

function buildEndpoint(config: AIConfig, path: "/responses" | "/chat/completions"): string {
  const base = (config.proxyUrl || config.baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("Missing Base URL. Set a browser-direct provider or proxy URL first.");
  }

  return `${base}${path}`;
}

function normalizeError(status: number, text: string): Error {
  const detail = text.trim().substring(0, 220);
  if (status === 401 || status === 403) {
    return new Error("Authentication failed. Check the API key or proxy.");
  }
  if (status === 429) {
    return new Error("The provider is rate limited or out of quota.");
  }
  if (status >= 500) {
    return new Error(`The provider returned HTTP ${status}.${detail ? ` ${detail}` : ""}`);
  }
  return new Error(`Request failed with HTTP ${status}.${detail ? ` ${detail}` : ""}`);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`The browser request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function generateTelemetryId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tel_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function callBrowserLLM(
  messages: BrowserLLMMessage[],
  config: AIConfig,
  options: BrowserLLMOptions = {}
): Promise<{ content: string; model: string }> {
  const startTime = Date.now();

  if (!config.apiKey.trim() && !config.proxyUrl.trim()) {
    throw new Error("Missing API key. Add it locally, or provide a proxy URL that handles auth.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const timeoutMs = Math.max(1_000, Number(config.timeoutMs) || 600_000);

  try {
    if (config.wireApi === "responses") {
      const { instructions, input } = buildResponsesInput(messages);
      const body: any = {
        model: config.model,
        input,
        instructions,
        temperature: options.temperature ?? 0.7,
        max_output_tokens: options.maxTokens ?? 400,
        stream: false,
      };

      if (config.modelReasoningEffort) {
        body.reasoning = { effort: config.modelReasoningEffort };
      }

      const response = await fetchWithTimeout(
        buildEndpoint(config, "/responses"),
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        timeoutMs
      );

      if (!response.ok) {
        throw normalizeError(response.status, await response.text().catch(() => ""));
      }

      const data = await response.json();
      const content = extractResponsesText(data);
      if (!content) {
        throw new Error("The provider returned an empty response.");
      }

      const result = { content, model: data.model || config.model };

      recordBrowserLLMCall({
        id: generateTelemetryId(),
        timestamp: startTime,
        model: result.model,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        durationMs: Date.now() - startTime,
      });

      return result;
    }

    const body: any = {
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 400,
      stream: false,
    };

    if (config.chatThinkingType) {
      body.thinking = { type: config.chatThinkingType };
    }

    const response = await fetchWithTimeout(
      buildEndpoint(config, "/chat/completions"),
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      timeoutMs
    );

    if (!response.ok) {
      throw normalizeError(response.status, await response.text().catch(() => ""));
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("The provider returned an empty response.");
    }

    const result = { content, model: data.model || config.model };

    recordBrowserLLMCall({
      id: generateTelemetryId(),
      timestamp: startTime,
      model: result.model,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (error: any) {
    recordBrowserLLMCall({
      id: generateTelemetryId(),
      timestamp: startTime,
      model: config.model,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      durationMs: Date.now() - startTime,
      error: error?.message ?? String(error),
    });
    throw error;
  }
}

