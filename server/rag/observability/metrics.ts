/**
 * RAG Metrics — Prometheus 兼容指标
 *
 * 暴露 ingestion/retrieval/augmentation/vector_count/embedding_cost 指标。
 * 使用简单的内存计数器（无外部依赖），通过 getMetrics() 导出文本格式。
 *
 * Requirements: 8.1
 */

export interface RAGMetricsSnapshot {
  ingestion: { total: number; failed: number; latencyMs: number[] };
  retrieval: { total: number; latencyMs: number[]; hitRate: number };
  augmentation: { total: number; tokenUsage: number };
  vectorCount: Record<string, number>;
  embeddingCost: { apiCalls: number; tokenCount: number };
}

export class RAGMetrics {
  private ingestionTotal = 0;
  private ingestionFailed = 0;
  private ingestionLatencies: number[] = [];
  private retrievalTotal = 0;
  private retrievalLatencies: number[] = [];
  private retrievalHits = 0;
  private augmentationTotal = 0;
  private augmentationTokens = 0;
  private vectorCounts = new Map<string, number>();
  private embeddingApiCalls = 0;
  private embeddingTokenCount = 0;

  recordIngestion(success: boolean, latencyMs: number): void {
    this.ingestionTotal++;
    if (!success) this.ingestionFailed++;
    this.ingestionLatencies.push(latencyMs);
    if (this.ingestionLatencies.length > 1000) this.ingestionLatencies.shift();
  }

  recordRetrieval(latencyMs: number, hasResults: boolean): void {
    this.retrievalTotal++;
    this.retrievalLatencies.push(latencyMs);
    if (hasResults) this.retrievalHits++;
    if (this.retrievalLatencies.length > 1000) this.retrievalLatencies.shift();
  }

  recordAugmentation(tokenUsage: number): void {
    this.augmentationTotal++;
    this.augmentationTokens += tokenUsage;
  }

  setVectorCount(collection: string, count: number): void {
    this.vectorCounts.set(collection, count);
  }

  recordEmbeddingCall(tokenCount: number): void {
    this.embeddingApiCalls++;
    this.embeddingTokenCount += tokenCount;
  }

  /** 获取当前指标快照 */
  snapshot(): RAGMetricsSnapshot {
    const vectorCount: Record<string, number> = {};
    this.vectorCounts.forEach((v, k) => { vectorCount[k] = v; });

    return {
      ingestion: {
        total: this.ingestionTotal,
        failed: this.ingestionFailed,
        latencyMs: [...this.ingestionLatencies],
      },
      retrieval: {
        total: this.retrievalTotal,
        latencyMs: [...this.retrievalLatencies],
        hitRate: this.retrievalTotal > 0 ? this.retrievalHits / this.retrievalTotal : 0,
      },
      augmentation: { total: this.augmentationTotal, tokenUsage: this.augmentationTokens },
      vectorCount,
      embeddingCost: { apiCalls: this.embeddingApiCalls, tokenCount: this.embeddingTokenCount },
    };
  }

  /** Prometheus 文本格式导出 */
  toPrometheusText(): string {
    const lines: string[] = [];
    lines.push(`# HELP rag_ingestion_total Total ingestion attempts`);
    lines.push(`# TYPE rag_ingestion_total counter`);
    lines.push(`rag_ingestion_total ${this.ingestionTotal}`);
    lines.push(`rag_ingestion_failed_total ${this.ingestionFailed}`);
    lines.push(`# HELP rag_retrieval_total Total retrieval queries`);
    lines.push(`# TYPE rag_retrieval_total counter`);
    lines.push(`rag_retrieval_total ${this.retrievalTotal}`);
    lines.push(`rag_retrieval_hit_rate ${this.retrievalTotal > 0 ? (this.retrievalHits / this.retrievalTotal).toFixed(4) : '0'}`);
    lines.push(`rag_augmentation_total ${this.augmentationTotal}`);
    lines.push(`rag_augmentation_token_usage ${this.augmentationTokens}`);
    this.vectorCounts.forEach((count, collection) => {
      lines.push(`rag_vector_count{collection="${collection}"} ${count}`);
    });
    lines.push(`rag_embedding_api_calls ${this.embeddingApiCalls}`);
    lines.push(`rag_embedding_token_count ${this.embeddingTokenCount}`);
    return lines.join('\n');
  }

  reset(): void {
    this.ingestionTotal = 0;
    this.ingestionFailed = 0;
    this.ingestionLatencies = [];
    this.retrievalTotal = 0;
    this.retrievalLatencies = [];
    this.retrievalHits = 0;
    this.augmentationTotal = 0;
    this.augmentationTokens = 0;
    this.vectorCounts.clear();
    this.embeddingApiCalls = 0;
    this.embeddingTokenCount = 0;
  }
}

/** Singleton metrics instance */
export const ragMetrics = new RAGMetrics();
