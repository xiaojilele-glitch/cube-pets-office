/**
 * HealthChecker — 健康检查
 *
 * 检查向量数据库连接、Embedding 模型可用性、collection 状态、DLQ 积压。
 *
 * Requirements: 8.4
 */

import type { HealthResponse } from '../../../shared/rag/api.js';
import type { VectorStoreAdapter } from '../store/vector-store-adapter.js';
import type { EmbeddingProvider } from '../embedding/embedding-provider.js';
import type { DeadLetterQueue } from '../ingestion/dead-letter-queue.js';
import { getRAGConfig } from '../config.js';

export interface HealthCheckerDeps {
  vectorStore: VectorStoreAdapter;
  embeddingProvider: EmbeddingProvider;
  deadLetterQueue: DeadLetterQueue;
  /** Known collection names to check */
  collectionNames?: string[];
}

export class HealthChecker {
  constructor(private readonly deps: HealthCheckerDeps) {}

  async check(): Promise<HealthResponse> {
    const config = getRAGConfig();

    // 1. Vector store health
    let vectorStoreConnected = false;
    let vectorStoreBackend: string = config.vectorStore.backend;
    try {
      const health = await this.deps.vectorStore.healthCheck();
      vectorStoreConnected = health.connected;
      vectorStoreBackend = health.backend;
    } catch { /* disconnected */ }

    // 2. Embedding model availability
    let embeddingAvailable = false;
    try {
      await this.deps.embeddingProvider.embed(['health check']);
      embeddingAvailable = true;
    } catch { /* unavailable */ }

    // 3. Collection status
    const collections: HealthResponse['collections'] = [];
    for (const name of this.deps.collectionNames ?? []) {
      try {
        const info = await this.deps.vectorStore.collectionInfo(name);
        collections.push({
          name: info.name,
          vectorCount: info.vectorCount,
          status: info.status,
        });
      } catch {
        collections.push({ name, vectorCount: 0, status: 'error' });
      }
    }

    // 4. DLQ backlog
    const dlqCount = this.deps.deadLetterQueue.count();

    // Overall status
    let status: HealthResponse['status'] = 'healthy';
    if (!vectorStoreConnected || !embeddingAvailable) {
      status = 'unhealthy';
    } else if (dlqCount > 100) {
      status = 'degraded';
    }

    return {
      status,
      vectorStore: { connected: vectorStoreConnected, backend: vectorStoreBackend },
      embeddingModel: { available: embeddingAvailable, model: this.deps.embeddingProvider.modelName },
      collections,
      deadLetterQueue: { count: dlqCount },
    };
  }
}
