import dotenv from 'dotenv';

import { getAIConfig } from './ai-config.js';

dotenv.config();

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface SSEEvent {
  event?: string;
  data: string;
}

interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  wireApi: 'responses' | 'chat_completions';
  defaultModel: string;
  timeoutMs: number;
  reasoningEffort?: string;
  forceModel: boolean;
  stream: boolean;
  chatThinkingType?: string;
}

const MAX_CONCURRENT = Math.max(1, Number(process.env.LLM_MAX_CONCURRENT || 1));
let activeRequests = 0;
const requestQueue: Array<() => void> = [];

function buildProviders(): ProviderConfig[] {
  const aiConfig = getAIConfig();
  const primary: ProviderConfig = {
    name: 'primary',
    apiKey: aiConfig.apiKey,
    baseUrl: aiConfig.baseUrl,
    wireApi: aiConfig.wireApi,
    defaultModel: aiConfig.model,
    timeoutMs: aiConfig.timeoutMs,
    reasoningEffort: aiConfig.modelReasoningEffort || undefined,
    forceModel: false,
    stream: aiConfig.stream,
    chatThinkingType: aiConfig.chatThinkingType || undefined,
  };

  const fallbackApiKey = process.env.FALLBACK_LLM_API_KEY || '';
  const fallbackBaseUrl = process.env.FALLBACK_LLM_BASE_URL || '';

  const providers = [primary];
  if (fallbackApiKey && fallbackBaseUrl) {
    providers.push({
      name: 'fallback',
      apiKey: fallbackApiKey,
      baseUrl: fallbackBaseUrl,
      wireApi: ((process.env.FALLBACK_LLM_WIRE_API || 'chat_completions').toLowerCase() === 'responses'
        ? 'responses'
        : 'chat_completions'),
      defaultModel: process.env.FALLBACK_LLM_MODEL || 'glm-4.6',
      timeoutMs: Number(process.env.FALLBACK_LLM_TIMEOUT_MS || 60000),
      reasoningEffort: process.env.FALLBACK_LLM_REASONING_EFFORT || undefined,
      forceModel: (process.env.FALLBACK_LLM_FORCE_MODEL || 'true').toLowerCase() !== 'false',
      stream: (process.env.FALLBACK_LLM_STREAM || 'false').toLowerCase() !== 'false',
      chatThinkingType: process.env.FALLBACK_LLM_CHAT_THINKING_TYPE || 'disabled',
    });
  }

  return providers.filter((provider) => provider.apiKey && provider.baseUrl);
}

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    requestQueue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests--;
  if (requestQueue.length > 0) {
    requestQueue.shift()?.();
  }
}

function getProviderName(provider: ProviderConfig): string {
  try {
    return new URL(provider.baseUrl).host || provider.baseUrl;
  } catch {
    return provider.baseUrl;
  }
}

function resolveModel(provider: ProviderConfig, requestedModel?: string): string {
  if (provider.forceModel) {
    return provider.defaultModel;
  }
  return requestedModel || provider.defaultModel;
}

function missingKeyError(): Error {
  return new Error('No LLM provider is configured. Check .env provider keys.');
}

function malformedResponseError(bodyPreview: string): Error {
  const preview = bodyPreview ? ` Preview: ${bodyPreview}` : '';
  return new Error(`LLM service returned a malformed response.${preview}`);
}

function normalizeLLMError(provider: ProviderConfig, status: number, errText: string): Error {
  const trimmed = errText.trim();
  const lower = trimmed.toLowerCase();
  const providerName = getProviderName(provider);

  if (!provider.apiKey) {
    return missingKeyError();
  }
  if (status === 401 || status === 403) {
    return new Error(`LLM authentication failed for ${providerName}. Check the API key.`);
  }
  if (status === 429) {
    return new Error(`LLM rate limited or out of quota on ${providerName}.`);
  }
  if (status >= 500 && lower.includes('no clients available')) {
    return new Error(`The LLM service is temporarily unavailable: ${providerName} has no available clients.`);
  }
  if (status >= 500) {
    return new Error(`LLM service error from ${providerName}: HTTP ${status}.${trimmed ? ` Details: ${trimmed.substring(0, 160)}` : ''}`);
  }

  return new Error(`LLM API ${status} from ${providerName}: ${trimmed.substring(0, 200)}`);
}

function normalizeNetworkError(provider: ProviderConfig, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const providerName = getProviderName(provider);

  if (!provider.apiKey) {
    return missingKeyError();
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(`LLM request to ${providerName} timed out after ${provider.timeoutMs}ms.`);
  }
  if (/fetch failed|network|timeout|econnrefused|enotfound/i.test(message)) {
    return new Error(`Cannot reach LLM service ${providerName}. Check network access or base URL.`);
  }

  return error instanceof Error ? error : new Error(message);
}

function shouldTryNextProvider(error: Error): boolean {
  return /no available clients|temporarily unavailable|timed out|Cannot reach LLM service|rate limited|out of quota|malformed response|empty response/i.test(error.message);
}

function shouldStopRetryingProvider(error: Error): boolean {
  return /no available clients|authentication failed|invalid_request_error|timed out/i.test(error.message);
}

function buildResponsesInput(messages: LLMMessage[]) {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');

  const input = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: [{ type: 'input_text', text: message.content }],
    }));

  return { instructions: instructions || undefined, input };
}

function extractResponsesText(data: any): string {
  if (typeof data.output_text === 'string' && data.output_text.length > 0) {
    return data.output_text;
  }

  const texts: string[] = [];
  for (const item of data.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text);
      }
    }
  }

  return texts.join('\n').trim();
}

function parseSSE(raw: string): SSEEvent[] {
  const normalized = raw.replace(/\r\n/g, '\n');
  const chunks = normalized.split('\n\n');
  const events: SSEEvent[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n').filter(Boolean);
    if (lines.length === 0) continue;

    let eventName: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length > 0) {
      events.push({ event: eventName, data: dataLines.join('\n') });
    }
  }

  return events;
}

function parseJsonSafely(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    throw malformedResponseError(raw.substring(0, 200));
  }
}

function parseResponsesStream(raw: string): LLMResponse {
  const events = parseSSE(raw);
  let content = '';
  let usage: LLMResponse['usage'];
  let completedPayload: any = null;

  for (const event of events) {
    if (event.data === '[DONE]') continue;
    const payload = parseJsonSafely(event.data);

    if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
      content += payload.delta;
    }

    if (payload.type === 'response.output_text.done' && typeof payload.text === 'string' && !content) {
      content = payload.text;
    }

    if (payload.type === 'response.completed') {
      completedPayload = payload.response;
      if (!content) {
        content = extractResponsesText(payload.response || {});
      }
      if (payload.response?.usage) {
        usage = {
          prompt_tokens: payload.response.usage.input_tokens ?? 0,
          completion_tokens: payload.response.usage.output_tokens ?? 0,
          total_tokens: payload.response.usage.total_tokens ?? 0,
        };
      }
    }
  }

  if (completedPayload?.error) {
    throw new Error(`LLM response failed: ${JSON.stringify(completedPayload.error)}`);
  }
  if (!content.trim()) {
    throw malformedResponseError(raw.substring(0, 200));
  }

  return { content: content.trim(), usage };
}

function parseChatCompletionsStream(raw: string): LLMResponse {
  const events = parseSSE(raw);
  let content = '';
  let usage: LLMResponse['usage'];

  for (const event of events) {
    if (event.data === '[DONE]') continue;
    const payload = parseJsonSafely(event.data);
    const choice = payload.choices?.[0];
    const deltaText = choice?.delta?.content;

    if (typeof deltaText === 'string') {
      content += deltaText;
    }

    if (payload.usage) {
      usage = {
        prompt_tokens: payload.usage.prompt_tokens ?? 0,
        completion_tokens: payload.usage.completion_tokens ?? 0,
        total_tokens: payload.usage.total_tokens ?? 0,
      };
    }
  }

  if (!content.trim()) {
    throw malformedResponseError(raw.substring(0, 200));
  }

  return { content: content.trim(), usage };
}

async function withTimeout<T>(provider: ProviderConfig, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeoutMs);

  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response: Response): Promise<{ raw: string; contentType: string }> {
  const raw = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!raw.trim()) {
    throw new Error('LLM service returned an empty response body.');
  }

  return { raw, contentType };
}

async function createChatCompletion(
  provider: ProviderConfig,
  messages: LLMMessage[],
  options: { model: string; temperature: number; maxTokens: number; jsonMode: boolean }
): Promise<LLMResponse> {
  return withTimeout(provider, async (signal) => {
    const body: any = {
      model: options.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: provider.stream,
    };

    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    if (provider.chatThinkingType) {
      body.thinking = { type: provider.chatThinkingType };
    }

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw normalizeLLMError(provider, response.status, errText);
    }

    const { raw, contentType } = await readBody(response);
    if (provider.stream && contentType.includes('text/event-stream')) {
      return parseChatCompletionsStream(raw);
    }

    const data = parseJsonSafely(raw);
    return {
      content: data.choices?.[0]?.message?.content || '',
      usage: data.usage,
    };
  });
}

async function createResponse(
  provider: ProviderConfig,
  messages: LLMMessage[],
  options: { model: string; temperature: number; maxTokens: number; jsonMode: boolean }
): Promise<LLMResponse> {
  return withTimeout(provider, async (signal) => {
    const { instructions, input } = buildResponsesInput(messages);
    const body: any = {
      model: options.model,
      input,
      instructions,
      temperature: options.temperature,
      max_output_tokens: options.maxTokens,
      stream: true,
    };

    if (provider.reasoningEffort) {
      body.reasoning = { effort: provider.reasoningEffort };
    }

    if (options.jsonMode) {
      body.text = { format: { type: 'json_object' } };
    }

    const response = await fetch(`${provider.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw normalizeLLMError(provider, response.status, errText);
    }

    const { raw, contentType } = await readBody(response);
    if (contentType.includes('text/event-stream')) {
      return parseResponsesStream(raw);
    }

    const data = parseJsonSafely(raw);
    return {
      content: extractResponsesText(data),
      usage: data.usage
        ? {
            prompt_tokens: data.usage.input_tokens ?? 0,
            completion_tokens: data.usage.output_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  });
}

async function callProvider(
  provider: ProviderConfig,
  messages: LLMMessage[],
  options: LLMOptions
): Promise<LLMResponse> {
  const model = resolveModel(provider, options.model);
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 2000;
  const jsonMode = options.jsonMode ?? false;

  if (provider.wireApi === 'responses') {
    return createResponse(provider, messages, { model, temperature, maxTokens, jsonMode });
  }
  return createChatCompletion(provider, messages, { model, temperature, maxTokens, jsonMode });
}

export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  await acquireSlot();

  try {
    const providers = buildProviders();
    if (providers.length === 0) {
      throw missingKeyError();
    }

    let lastError: Error | null = null;

    for (const provider of providers) {
      const attempts = Math.max(
        1,
        Number(
          provider.name === 'fallback'
            ? process.env.FALLBACK_LLM_RETRIES || 3
            : process.env.LLM_RETRIES || 3
        )
      );

      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          return await callProvider(provider, messages, options);
        } catch (error) {
          lastError = normalizeNetworkError(provider, error);
          console.error(`[LLM:${provider.name}] Attempt ${attempt + 1} failed:`, lastError.message);

          if (shouldStopRetryingProvider(lastError)) {
            break;
          }
          if (attempt < attempts - 1) {
            const backoffMs = /rate limited|out of quota/i.test(lastError.message)
              ? 5000 * (attempt + 1)
              : 1000 * (attempt + 1);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }
      }

      if (lastError && !shouldTryNextProvider(lastError)) {
        throw lastError;
      }
    }

    throw lastError || new Error('LLM call failed');
  } finally {
    releaseSlot();
  }
}

export async function callLLMJson<T = any>(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<T> {
  const response = await callLLM(messages, { ...options, jsonMode: true });

  try {
    let content = response.content.trim();
    const jsonBlock = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlock) {
      content = jsonBlock[1].trim();
    }
    return JSON.parse(content);
  } catch {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    console.error('[LLM] Failed to parse JSON response:', response.content.substring(0, 200));
    throw new Error('Failed to parse LLM JSON response');
  }
}
