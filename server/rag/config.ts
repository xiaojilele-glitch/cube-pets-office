/**
 * RAG 配置管理
 *
 * 从环境变量读取 RAGConfig，支持 rag.enabled 全局开关
 * 和 rag.chunking 按 sourceType 独立配置。
 *
 * 环境变量前缀：RAG_
 * 分块配置通过 JSON 环境变量 RAG_CHUNKING_OVERRIDES 传入。
 */

import type { SourceType } from '../../shared/rag/contracts.js';

// ---------------------------------------------------------------------------
// RAGConfig 接口（与设计文档 "配置模型（rag.* 配置项）" 一致）
// ---------------------------------------------------------------------------

export interface ChunkingConfig {
  strategy: string;
  maxTokens: number;
  minTokens: number;
  overlap?: number;
  windowSize?: number;
}

export interface RAGConfig {
  enabled: boolean;
  embedding: {
    provider: 'openai' | 'local';
    model: string;
    dimension: number;
    batchSize: number;
    apiKey?: string;
    baseUrl?: string;
  };
  vectorStore: {
    backend: 'qdrant' | 'milvus' | 'pgvector';
    connectionUrl: string;
  };
  chunking: {
    [key in SourceType]?: ChunkingConfig;
  };
  retrieval: {
    defaultTopK: number;
    defaultMinScore: number;
    defaultMode: 'semantic' | 'keyword' | 'hybrid';
    contextWindowChunks: number;
  };
  augmentation: {
    mode: 'auto' | 'on_demand' | 'disabled';
    tokenBudget: number;
    reranker: 'noop' | 'llm' | 'cross_encoder';
  };
  lifecycle: {
    archiveAfterDays: number;
    deleteAfterDays: number;
    scheduleIntervalHours: number;
  };
  quota: {
    [projectId: string]: {
      maxVectors: number;
      maxDailyEmbeddingTokens: number;
    };
  };
}

// ---------------------------------------------------------------------------
// 环境变量解析辅助函数（与 feishu/config.ts、core/ai-config.ts 风格一致）
// ---------------------------------------------------------------------------

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!value?.trim()) return fallback;
  const v = value.trim().toLowerCase() as T;
  return allowed.includes(v) ? v : fallback;
}

function readJson<T>(value: string | undefined): T | undefined {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 默认分块配置（按 sourceType）
// ---------------------------------------------------------------------------

const DEFAULT_CHUNKING: RAGConfig['chunking'] = {
  code_snippet: {
    strategy: 'syntax_aware',
    maxTokens: 1024,
    minTokens: 64,
  },
  conversation: {
    strategy: 'conversation_turn',
    maxTokens: 1024,
    minTokens: 64,
  },
  document: {
    strategy: 'semantic_paragraph',
    maxTokens: 1024,
    minTokens: 64,
  },
  task_result: {
    strategy: 'sliding_window',
    maxTokens: 1024,
    minTokens: 64,
    windowSize: 512,
    overlap: 64,
  },
  mission_log: {
    strategy: 'sliding_window',
    maxTokens: 1024,
    minTokens: 64,
    windowSize: 512,
    overlap: 64,
  },
  architecture_decision: {
    strategy: 'passthrough',
    maxTokens: 1024,
    minTokens: 64,
  },
  bug_report: {
    strategy: 'sliding_window',
    maxTokens: 1024,
    minTokens: 64,
    windowSize: 512,
    overlap: 64,
  },
};

// ---------------------------------------------------------------------------
// getRAGConfig — 从环境变量构建 RAGConfig
// ---------------------------------------------------------------------------

let _cachedConfig: RAGConfig | null = null;

/**
 * 读取并返回 RAG 配置。首次调用后缓存结果。
 * 传入 env 参数可用于测试注入。
 */
export function getRAGConfig(
  env: NodeJS.ProcessEnv = process.env,
  { noCache = false }: { noCache?: boolean } = {},
): RAGConfig {
  if (_cachedConfig && !noCache) return _cachedConfig;

  // --- chunking: 合并默认 + 环境变量覆盖 ---
  const chunkingOverrides =
    readJson<Partial<RAGConfig['chunking']>>(env.RAG_CHUNKING_OVERRIDES) ?? {};
  const mergedChunking: RAGConfig['chunking'] = { ...DEFAULT_CHUNKING };
  for (const [key, override] of Object.entries(chunkingOverrides)) {
    const sourceType = key as SourceType;
    const base = mergedChunking[sourceType];
    if (base && override) {
      mergedChunking[sourceType] = { ...base, ...override };
    } else if (override) {
      mergedChunking[sourceType] = override as ChunkingConfig;
    }
  }

  // --- quota: 从 JSON 环境变量读取 ---
  const quota = readJson<RAGConfig['quota']>(env.RAG_QUOTA) ?? {};

  const config: RAGConfig = {
    enabled: readBoolean(env.RAG_ENABLED, false),

    embedding: {
      provider: readEnum(env.RAG_EMBEDDING_PROVIDER, ['openai', 'local'] as const, 'openai'),
      model: env.RAG_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
      dimension: readNumber(env.RAG_EMBEDDING_DIMENSION, 1536),
      batchSize: readNumber(env.RAG_EMBEDDING_BATCH_SIZE, 64),
      apiKey: env.RAG_EMBEDDING_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined,
      baseUrl: env.RAG_EMBEDDING_BASE_URL?.trim() || env.OPENAI_BASE_URL?.trim() || undefined,
    },

    vectorStore: {
      backend: readEnum(
        env.RAG_VECTOR_STORE_BACKEND,
        ['qdrant', 'milvus', 'pgvector'] as const,
        'qdrant',
      ),
      connectionUrl: env.RAG_VECTOR_STORE_URL?.trim() || 'http://localhost:6333',
    },

    chunking: mergedChunking,

    retrieval: {
      defaultTopK: readNumber(env.RAG_RETRIEVAL_TOP_K, 10),
      defaultMinScore: readNumber(env.RAG_RETRIEVAL_MIN_SCORE, 0.5),
      defaultMode: readEnum(
        env.RAG_RETRIEVAL_MODE,
        ['semantic', 'keyword', 'hybrid'] as const,
        'hybrid',
      ),
      contextWindowChunks: readNumber(env.RAG_RETRIEVAL_CONTEXT_WINDOW, 1),
    },

    augmentation: {
      mode: readEnum(
        env.RAG_AUGMENTATION_MODE,
        ['auto', 'on_demand', 'disabled'] as const,
        'auto',
      ),
      tokenBudget: readNumber(env.RAG_AUGMENTATION_TOKEN_BUDGET, 4096),
      reranker: readEnum(
        env.RAG_AUGMENTATION_RERANKER,
        ['noop', 'llm', 'cross_encoder'] as const,
        'noop',
      ),
    },

    lifecycle: {
      archiveAfterDays: readNumber(env.RAG_LIFECYCLE_ARCHIVE_DAYS, 90),
      deleteAfterDays: readNumber(env.RAG_LIFECYCLE_DELETE_DAYS, 365),
      scheduleIntervalHours: readNumber(env.RAG_LIFECYCLE_SCHEDULE_HOURS, 24),
    },

    quota,
  };

  _cachedConfig = config;
  return config;
}

/**
 * 清除缓存的配置（用于测试或运行时重载）。
 */
export function resetRAGConfigCache(): void {
  _cachedConfig = null;
}
