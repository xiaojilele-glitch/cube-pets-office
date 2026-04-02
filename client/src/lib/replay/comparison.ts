import type {
  ExecutionTimeline,
  ExecutionEvent,
  ReplayEventType,
  PerformanceMetrics,
} from '../../../../shared/replay/contracts';
import { PerformanceAnalyzer } from './performance-analyzer';

/* ─── Comparison Types ─── */

export interface ComparisonPair {
  a: ExecutionTimeline;
  b: ExecutionTimeline;
}

export interface EventStreamDiff {
  onlyInA: ReplayEventType[];
  onlyInB: ReplayEventType[];
  common: ReplayEventType[];
  /** Per-type count difference: positive means B has more */
  countDiff: Record<string, number>;
}

export interface MetricsComparison {
  a: PerformanceMetrics;
  b: PerformanceMetrics;
  durationDiff: number;
  llmCallCountDiff: number;
  totalTokensDiff: number;
  concurrencyDiff: number;
}

export interface ComparisonResult {
  missionIdA: string;
  missionIdB: string;
  diff: EventStreamDiff;
  metrics: MetricsComparison;
  generatedAt: number;
}

/* ─── Helpers ─── */

function countByType(events: ExecutionEvent[]): Map<ReplayEventType, number> {
  const map = new Map<ReplayEventType, number>();
  for (const e of events) {
    map.set(e.eventType, (map.get(e.eventType) ?? 0) + 1);
  }
  return map;
}

/**
 * ReplayComparison — 对比分析功能
 *
 * 支持同时加载两个 Mission 时间轴、计算事件流差异、
 * 性能指标对比和导出对比结果。
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */
export class ReplayComparison {
  private pair: ComparisonPair | null = null;
  private analyzer = new PerformanceAnalyzer();

  /**
   * 同时加载两个 Mission 时间轴用于对比。
   * Requirement 16.1
   */
  loadComparison(a: ExecutionTimeline, b: ExecutionTimeline): ComparisonPair {
    this.pair = { a, b };
    return this.pair;
  }

  /** Get the currently loaded pair, or throw if none loaded. */
  getPair(): ComparisonPair {
    if (!this.pair) {
      throw new Error('No comparison loaded. Call loadComparison() first.');
    }
    return this.pair;
  }

  /**
   * 计算两个事件流的差异：
   * - 仅在 A 中出现的事件类型
   * - 仅在 B 中出现的事件类型
   * - 两者共有的事件类型
   * - 每种类型的数量差异
   * Requirement 16.2, 16.4
   */
  diffEventStreams(a: ExecutionTimeline, b: ExecutionTimeline): EventStreamDiff {
    const countsA = countByType(a.events);
    const countsB = countByType(b.events);

    const typesA = new Set(countsA.keys());
    const typesB = new Set(countsB.keys());

    const onlyInA: ReplayEventType[] = [];
    const onlyInB: ReplayEventType[] = [];
    const common: ReplayEventType[] = [];

    for (const t of Array.from(typesA)) {
      if (typesB.has(t)) {
        common.push(t);
      } else {
        onlyInA.push(t);
      }
    }
    for (const t of Array.from(typesB)) {
      if (!typesA.has(t)) {
        onlyInB.push(t);
      }
    }

    // Count diff: B count - A count for all types in union
    const allTypes = new Set([...Array.from(typesA), ...Array.from(typesB)]);
    const countDiff: Record<string, number> = {};
    for (const t of Array.from(allTypes)) {
      countDiff[t] = (countsB.get(t) ?? 0) - (countsA.get(t) ?? 0);
    }

    return { onlyInA, onlyInB, common, countDiff };
  }

  /**
   * 性能指标对比。
   * Requirement 16.3
   */
  compareMetrics(
    a: ExecutionTimeline,
    b: ExecutionTimeline,
  ): MetricsComparison {
    const metricsA = this.analyzer.calculateMetrics(a);
    const metricsB = this.analyzer.calculateMetrics(b);

    return {
      a: metricsA,
      b: metricsB,
      durationDiff: metricsB.totalDuration - metricsA.totalDuration,
      llmCallCountDiff:
        metricsB.llmMetrics.callCount - metricsA.llmMetrics.callCount,
      totalTokensDiff:
        metricsB.llmMetrics.totalTokens - metricsA.llmMetrics.totalTokens,
      concurrencyDiff:
        metricsB.concurrency.maxConcurrentAgents -
        metricsA.concurrency.maxConcurrentAgents,
    };
  }

  /**
   * 导出对比结果为 JSON 字符串。
   * Requirement 16.5
   */
  exportComparison(
    a: ExecutionTimeline,
    b: ExecutionTimeline,
  ): string {
    const diff = this.diffEventStreams(a, b);
    const metrics = this.compareMetrics(a, b);

    const result: ComparisonResult = {
      missionIdA: a.missionId,
      missionIdB: b.missionId,
      diff,
      metrics,
      generatedAt: Date.now(),
    };

    return JSON.stringify(result, null, 2);
  }
}
