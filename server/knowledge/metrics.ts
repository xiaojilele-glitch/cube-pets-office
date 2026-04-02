/**
 * 知识图谱 Prometheus 指标
 *
 * 轻量级内存指标收集器，无外部依赖。
 * 支持 JSON 导出和 Prometheus text format 导出。
 *
 * 指标列表：
 * - knowledge_graph_entity_total (gauge, labels: entityType, status)
 * - knowledge_graph_relation_total (gauge, labels: relationType)
 * - knowledge_graph_query_total (counter, labels: queryType)
 * - knowledge_graph_query_duration_ms (histogram, labels: queryType)
 * - knowledge_extraction_total (counter, labels: source)
 * - knowledge_review_queue_size (gauge)
 * - knowledge_confidence_distribution (histogram)
 *
 * Requirements: 8.1
 */

// ---------------------------------------------------------------------------
// Histogram bucket helpers
// ---------------------------------------------------------------------------

const DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const CONFIDENCE_BUCKETS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

interface HistogramData {
  buckets: Map<number, number>; // upper bound → count
  sum: number;
  count: number;
}

function createHistogram(bucketBounds: number[]): HistogramData {
  const buckets = new Map<number, number>();
  for (const b of bucketBounds) {
    buckets.set(b, 0);
  }
  return { buckets, sum: 0, count: 0 };
}

function observeHistogram(h: HistogramData, value: number): void {
  h.sum += value;
  h.count += 1;
  for (const [bound] of Array.from(h.buckets.entries())) {
    if (value <= bound) {
      h.buckets.set(bound, (h.buckets.get(bound) ?? 0) + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// KnowledgeMetrics
// ---------------------------------------------------------------------------

export class KnowledgeMetrics {
  /** gauge: entityType:status → count */
  private entityTotal = new Map<string, number>();

  /** gauge: relationType → count */
  private relationTotal = new Map<string, number>();

  /** counter: queryType → count */
  private queryTotal = new Map<string, number>();

  /** histogram: queryType → histogram data */
  private queryDuration = new Map<string, HistogramData>();

  /** counter: source → count */
  private extractionTotal = new Map<string, number>();

  /** gauge: single value */
  private reviewQueueSize = 0;

  /** histogram: confidence distribution */
  private confidenceDistribution: HistogramData = createHistogram(CONFIDENCE_BUCKETS);

  // -------------------------------------------------------------------------
  // Setters / Incrementers
  // -------------------------------------------------------------------------

  setEntityTotal(entityType: string, status: string, count: number): void {
    this.entityTotal.set(`${entityType}:${status}`, count);
  }

  setRelationTotal(relationType: string, count: number): void {
    this.relationTotal.set(relationType, count);
  }

  incrementQueryTotal(queryType: string): void {
    this.queryTotal.set(queryType, (this.queryTotal.get(queryType) ?? 0) + 1);
  }

  recordQueryDuration(queryType: string, durationMs: number): void {
    if (!this.queryDuration.has(queryType)) {
      this.queryDuration.set(queryType, createHistogram(DURATION_BUCKETS));
    }
    observeHistogram(this.queryDuration.get(queryType)!, durationMs);
  }

  incrementExtractionTotal(source: string): void {
    this.extractionTotal.set(source, (this.extractionTotal.get(source) ?? 0) + 1);
  }

  setReviewQueueSize(size: number): void {
    this.reviewQueueSize = size;
  }

  recordConfidence(confidence: number): void {
    observeHistogram(this.confidenceDistribution, confidence);
  }

  // -------------------------------------------------------------------------
  // Export: plain object (JSON)
  // -------------------------------------------------------------------------

  getMetrics(): Record<string, unknown> {
    return {
      knowledge_graph_entity_total: Object.fromEntries(this.entityTotal),
      knowledge_graph_relation_total: Object.fromEntries(this.relationTotal),
      knowledge_graph_query_total: Object.fromEntries(this.queryTotal),
      knowledge_graph_query_duration_ms: this.histogramMapToJSON(this.queryDuration),
      knowledge_extraction_total: Object.fromEntries(this.extractionTotal),
      knowledge_review_queue_size: this.reviewQueueSize,
      knowledge_confidence_distribution: this.histogramToJSON(this.confidenceDistribution),
    };
  }

  // -------------------------------------------------------------------------
  // Export: Prometheus text format
  // -------------------------------------------------------------------------

  toPrometheusText(): string {
    const lines: string[] = [];

    // entity total (gauge)
    lines.push("# HELP knowledge_graph_entity_total Total entities by type and status");
    lines.push("# TYPE knowledge_graph_entity_total gauge");
    for (const [key, value] of Array.from(this.entityTotal.entries())) {
      const [entityType, status] = key.split(":");
      lines.push(`knowledge_graph_entity_total{entityType="${entityType}",status="${status}"} ${value}`);
    }

    // relation total (gauge)
    lines.push("# HELP knowledge_graph_relation_total Total relations by type");
    lines.push("# TYPE knowledge_graph_relation_total gauge");
    for (const [relationType, value] of Array.from(this.relationTotal.entries())) {
      lines.push(`knowledge_graph_relation_total{relationType="${relationType}"} ${value}`);
    }

    // query total (counter)
    lines.push("# HELP knowledge_graph_query_total Total queries by type");
    lines.push("# TYPE knowledge_graph_query_total counter");
    for (const [queryType, value] of Array.from(this.queryTotal.entries())) {
      lines.push(`knowledge_graph_query_total{queryType="${queryType}"} ${value}`);
    }

    // query duration (histogram)
    lines.push("# HELP knowledge_graph_query_duration_ms Query duration in milliseconds");
    lines.push("# TYPE knowledge_graph_query_duration_ms histogram");
    for (const [queryType, h] of Array.from(this.queryDuration.entries())) {
      for (const [bound, count] of Array.from(h.buckets.entries())) {
        lines.push(`knowledge_graph_query_duration_ms_bucket{queryType="${queryType}",le="${bound}"} ${count}`);
      }
      lines.push(`knowledge_graph_query_duration_ms_bucket{queryType="${queryType}",le="+Inf"} ${h.count}`);
      lines.push(`knowledge_graph_query_duration_ms_sum{queryType="${queryType}"} ${h.sum}`);
      lines.push(`knowledge_graph_query_duration_ms_count{queryType="${queryType}"} ${h.count}`);
    }

    // extraction total (counter)
    lines.push("# HELP knowledge_extraction_total Total extractions by source");
    lines.push("# TYPE knowledge_extraction_total counter");
    for (const [source, value] of Array.from(this.extractionTotal.entries())) {
      lines.push(`knowledge_extraction_total{source="${source}"} ${value}`);
    }

    // review queue size (gauge)
    lines.push("# HELP knowledge_review_queue_size Current review queue size");
    lines.push("# TYPE knowledge_review_queue_size gauge");
    lines.push(`knowledge_review_queue_size ${this.reviewQueueSize}`);

    // confidence distribution (histogram)
    lines.push("# HELP knowledge_confidence_distribution Distribution of entity confidence scores");
    lines.push("# TYPE knowledge_confidence_distribution histogram");
    const cd = this.confidenceDistribution;
    for (const [bound, count] of Array.from(cd.buckets.entries())) {
      lines.push(`knowledge_confidence_distribution_bucket{le="${bound}"} ${count}`);
    }
    lines.push(`knowledge_confidence_distribution_bucket{le="+Inf"} ${cd.count}`);
    lines.push(`knowledge_confidence_distribution_sum ${cd.sum}`);
    lines.push(`knowledge_confidence_distribution_count ${cd.count}`);

    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Reset (useful for testing)
  // -------------------------------------------------------------------------

  reset(): void {
    this.entityTotal.clear();
    this.relationTotal.clear();
    this.queryTotal.clear();
    this.queryDuration.clear();
    this.extractionTotal.clear();
    this.reviewQueueSize = 0;
    this.confidenceDistribution = createHistogram(CONFIDENCE_BUCKETS);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private histogramToJSON(h: HistogramData): Record<string, unknown> {
    return {
      buckets: Object.fromEntries(h.buckets),
      sum: h.sum,
      count: h.count,
    };
  }

  private histogramMapToJSON(m: Map<string, HistogramData>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, h] of Array.from(m.entries())) {
      result[key] = this.histogramToJSON(h);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: KnowledgeMetrics | null = null;

export function getKnowledgeMetrics(): KnowledgeMetrics {
  if (!_instance) {
    _instance = new KnowledgeMetrics();
  }
  return _instance;
}
