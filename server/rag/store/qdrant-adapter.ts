/**
 * Qdrant 向量数据库适配器
 *
 * 使用 Qdrant HTTP REST API（fetch-based，无 SDK 依赖）。
 * collection 按 `rag_{projectId}` 命名，每个项目独立 collection。
 * 创建 collection 时自动建立 sourceType/agentId/timestamp/codeLanguage 过滤索引。
 *
 * Requirements: 3.3, 3.4
 */

import type { VectorRecord } from '../../../shared/rag/contracts.js';
import type {
  VectorStoreAdapter,
  SearchOptions,
  SearchHit,
  CollectionInfo,
  HealthStatus,
} from './vector-store-adapter.js';

// ---------------------------------------------------------------------------
// Qdrant REST API 响应类型
// ---------------------------------------------------------------------------

interface QdrantErrorResponse {
  status?: { error?: string };
  result?: unknown;
}

interface QdrantCollectionInfo {
  status: string;
  vectors_count?: number;
  points_count?: number;
  config?: {
    params?: {
      vectors?: { size?: number } | { size?: number };
    };
  };
}

interface QdrantSearchHit {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 辅助：构建 Qdrant filter 条件
// ---------------------------------------------------------------------------

function buildQdrantFilter(
  filter: Record<string, any>,
): Record<string, unknown> | undefined {
  const must: Record<string, unknown>[] = [];

  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue;

    if (key === 'timestamp' && typeof value === 'object') {
      // 时间范围过滤：{ gte?: string, lte?: string }
      const range: Record<string, unknown> = {};
      if (value.gte) range.gte = value.gte;
      if (value.lte) range.lte = value.lte;
      if (value.gt) range.gt = value.gt;
      if (value.lt) range.lt = value.lt;
      if (Object.keys(range).length > 0) {
        must.push({ key, range });
      }
    } else if (Array.isArray(value)) {
      // 多值匹配（如 sourceTypes 数组）
      must.push({
        key,
        match: { any: value },
      });
    } else {
      // 精确匹配
      must.push({
        key,
        match: { value },
      });
    }
  }

  return must.length > 0 ? { must } : undefined;
}

// ---------------------------------------------------------------------------
// QdrantAdapter
// ---------------------------------------------------------------------------

export class QdrantAdapter implements VectorStoreAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(connectionUrl: string, timeoutMs = 10_000) {
    this.baseUrl = connectionUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  // -----------------------------------------------------------------------
  // createCollection
  // -----------------------------------------------------------------------

  async createCollection(name: string, dimension: number): Promise<void> {
    // 1. 创建 collection（cosine 距离）
    await this.request('PUT', `/collections/${name}`, {
      vectors: {
        size: dimension,
        distance: 'Cosine',
      },
    });

    // 2. 创建过滤索引（sourceType / agentId / timestamp / codeLanguage）
    const keywordIndexes = ['sourceType', 'agentId', 'codeLanguage'];
    const integerIndexes = ['timestamp'];

    const indexPromises = [
      ...keywordIndexes.map((field) =>
        this.request('PUT', `/collections/${name}/index`, {
          field_name: field,
          field_schema: 'keyword',
        }),
      ),
      ...integerIndexes.map((field) =>
        this.request('PUT', `/collections/${name}/index`, {
          field_name: field,
          field_schema: 'integer',
        }),
      ),
    ];

    await Promise.all(indexPromises);
  }

  // -----------------------------------------------------------------------
  // upsert
  // -----------------------------------------------------------------------

  async upsert(
    collection: string,
    records: VectorRecord[],
  ): Promise<void> {
    if (records.length === 0) return;

    const points = records.map((r) => ({
      id: r.id,
      vector: r.vector,
      payload: {
        content: r.content,
        ...(r.metadata as Record<string, unknown> ?? {}),
      },
    }));

    await this.request('PUT', `/collections/${collection}/points`, {
      points,
    });
  }

  // -----------------------------------------------------------------------
  // search
  // -----------------------------------------------------------------------

  async search(
    collection: string,
    query: number[],
    options: SearchOptions,
  ): Promise<SearchHit[]> {
    const body: Record<string, unknown> = {
      vector: query,
      limit: options.topK,
      with_payload: true,
      score_threshold: options.minScore ?? undefined,
    };

    const filter = options.filter
      ? buildQdrantFilter(options.filter)
      : undefined;
    if (filter) {
      body.filter = filter;
    }

    const data = await this.request<{ result: QdrantSearchHit[] }>(
      'POST',
      `/collections/${collection}/points/search`,
      body,
    );

    const hits: SearchHit[] = (data.result ?? []).map((hit) => ({
      id: String(hit.id),
      score: hit.score,
      metadata: (hit.payload as Record<string, any>) ?? undefined,
    }));

    return hits;
  }

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------

  async delete(collection: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.request(
      'POST',
      `/collections/${collection}/points/delete`,
      { points: ids },
    );
  }

  // -----------------------------------------------------------------------
  // collectionInfo
  // -----------------------------------------------------------------------

  async collectionInfo(name: string): Promise<CollectionInfo> {
    const data = await this.request<{ result: QdrantCollectionInfo }>(
      'GET',
      `/collections/${name}`,
    );

    const info = data.result;
    const vectorCount = info.points_count ?? info.vectors_count ?? 0;

    // 从 config 中提取维度
    let dimension = 0;
    const params = info.config?.params;
    if (params?.vectors && typeof params.vectors === 'object') {
      dimension = (params.vectors as { size?: number }).size ?? 0;
    }

    return {
      name,
      vectorCount,
      dimension,
      status: info.status ?? 'unknown',
    };
  }

  // -----------------------------------------------------------------------
  // healthCheck
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.request('GET', '/healthz');
      return {
        connected: true,
        backend: 'qdrant',
        latencyMs: Date.now() - start,
      };
    } catch {
      return {
        connected: false,
        backend: 'qdrant',
        latencyMs: Date.now() - start,
      };
    }
  }

  // -----------------------------------------------------------------------
  // 内部 HTTP 请求方法
  // -----------------------------------------------------------------------

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const init: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      };

      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }

      const response = await fetch(url, init);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(
          `Qdrant API error ${response.status} ${method} ${path}: ${errText.substring(0, 300)}`,
        );
      }

      // 某些端点（如 healthz）可能返回非 JSON
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }

      return {} as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Qdrant request timed out after ${this.timeoutMs}ms: ${method} ${path}`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 根据 RAGConfig 创建 QdrantAdapter 实例。
 */
export function createQdrantAdapter(connectionUrl: string): QdrantAdapter {
  return new QdrantAdapter(connectionUrl);
}
