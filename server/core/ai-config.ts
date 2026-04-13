import dotenv from 'dotenv';

dotenv.config();

export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  modelReasoningEffort: string;
  maxContext: number;
  providerName: string;
  wireApi: 'responses' | 'chat_completions';
  timeoutMs: number;
  stream: boolean;
  chatThinkingType?: string;
}

function normalizeWireApi(value?: string): 'responses' | 'chat_completions' {
  return value?.toLowerCase() === 'responses' ? 'responses' : 'chat_completions';
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  return fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function deriveProviderName(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

export function getAIConfig(): AIConfig {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
  const baseUrl = process.env.OPENAI_API_KEY
    ? (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    : (process.env.LLM_BASE_URL || 'https://api.openai.com/v1');
  const model =
    process.env.OPENAI_MODEL ||
    process.env.LLM_MODEL ||
    (process.env.OPENAI_API_KEY ? 'gpt-4.1-mini' : 'gpt-4o-mini');

  return {
    apiKey,
    baseUrl,
    model,
    modelReasoningEffort:
      process.env.OPENAI_REASONING_EFFORT ||
      process.env.LLM_REASONING_EFFORT ||
      'medium',
    maxContext: normalizeNumber(process.env.LLM_MAX_CONTEXT, 1_000_000),
    providerName: deriveProviderName(baseUrl),
    wireApi: normalizeWireApi(process.env.OPENAI_WIRE_API || process.env.LLM_WIRE_API),
    timeoutMs: normalizeNumber(process.env.OPENAI_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS, 600000),
    stream: normalizeBoolean(process.env.OPENAI_STREAM || process.env.LLM_STREAM, true),
    chatThinkingType:
      process.env.OPENAI_CHAT_THINKING_TYPE ||
      process.env.LLM_CHAT_THINKING_TYPE ||
      undefined,
  };
}
