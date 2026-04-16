/**
 * Embedding 模型抽象接口与 OpenAI 兼容实现
 *
 * 设计文档 §3 EmbeddingGenerator：
 *   EmbeddingProvider 接口抽象允许热切换模型。
 *   默认使用 OpenAI 兼容接口（text-embedding-3-small），
 *   与现有 llm-client.ts 的 API 调用模式一致。
 *
 * Requirements: 3.1 — 支持运行时热切换模型
 */

import { getRAGConfig } from "../config.js";

// ---------------------------------------------------------------------------
// EmbeddingProvider 接口
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  /** 批量将文本转换为向量 */
  embed(texts: string[]): Promise<number[][]>;
  /** 向量维度 */
  readonly dimension: number;
  /** 模型名称 */
  readonly modelName: string;
}

// ---------------------------------------------------------------------------
// OpenAI 兼容 Embedding 实现
// ---------------------------------------------------------------------------

/** OpenAI /v1/embeddings 响应结构 */
interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens: number; total_tokens: number };
}

export interface OpenAIEmbeddingProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimension: number;
  /** 请求超时（毫秒），默认 30 000 */
  timeoutMs?: number;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimension: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAIEmbeddingProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.modelName = options.model;
    this.dimension = options.dimension;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          input: texts,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(
          `Embedding API error ${response.status}: ${errText.substring(0, 200)}`
        );
      }

      const data: OpenAIEmbeddingResponse =
        (await response.json()) as OpenAIEmbeddingResponse;

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error(
          "Embedding API returned malformed response: missing data array"
        );
      }

      // 按 index 排序，确保与输入顺序一致
      const sorted = [...data.data].sort((a, b) => a.index - b.index);
      return sorted.map(item => item.embedding);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Embedding request timed out after ${this.timeoutMs}ms`
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// 从 RAGConfig 创建默认 Provider 的工厂函数
// ---------------------------------------------------------------------------

/**
 * 根据当前 RAGConfig.embedding 配置创建 EmbeddingProvider。
 * 如果 apiKey 或 baseUrl 缺失，抛出错误。
 */
export function createEmbeddingProviderFromConfig(): EmbeddingProvider {
  const { embedding } = getRAGConfig();

  if (!embedding.apiKey) {
    throw new Error(
      "RAG embedding API key is not configured. Set RAG_EMBEDDING_API_KEY or OPENAI_API_KEY."
    );
  }
  if (!embedding.baseUrl) {
    throw new Error(
      "RAG embedding base URL is not configured. Set RAG_EMBEDDING_BASE_URL or OPENAI_BASE_URL."
    );
  }

  return new OpenAIEmbeddingProvider({
    apiKey: embedding.apiKey,
    baseUrl: embedding.baseUrl,
    model: embedding.model,
    dimension: embedding.dimension,
  });
}
