import type {
  ExecutionEvent,
  ExecutionTimeline,
  PerformanceMetrics,
} from "../../../../shared/replay/contracts";

/* ─── Local Types ─── */

export interface Bottleneck {
  stageKey: string;
  duration: number;
  averageDuration: number;
  ratio: number; // duration / averageDuration
}

export interface ConcurrencyProfile {
  maxConcurrentAgents: number;
  avgConcurrentAgents: number;
  timeline: Array<{ time: number; activeAgents: number }>;
}

export interface PerformanceComparison {
  a: PerformanceMetrics;
  b: PerformanceMetrics;
  durationDiff: number; // b.totalDuration - a.totalDuration
  llmCallCountDiff: number;
  avgResponseTimeDiff: number;
  concurrencyDiff: number; // max concurrent diff
}

/* ─── Helpers ─── */

/** Group events by metadata.stageKey, ignoring events without one. */
function groupByStage(events: ExecutionEvent[]): Map<string, ExecutionEvent[]> {
  const map = new Map<string, ExecutionEvent[]>();
  for (const e of events) {
    const key = e.metadata?.stageKey as string | undefined;
    if (!key) continue;
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(e);
  }
  return map;
}

/** Compute stage duration as max(timestamp) - min(timestamp) within the group. */
function stageDuration(events: ExecutionEvent[]): number {
  if (events.length === 0) return 0;
  let min = events[0].timestamp;
  let max = events[0].timestamp;
  for (let i = 1; i < events.length; i++) {
    const t = events[i].timestamp;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return max - min;
}

/**
 * PerformanceAnalyzer — 性能分析
 *
 * 基于 ExecutionTimeline 计算性能指标、检测瓶颈、
 * 分析并发度和对比两个时间轴的性能。
 */
export class PerformanceAnalyzer {
  /**
   * 计算性能指标：总耗时、阶段耗时、LLM 指标、并发度。
   * - stageMetrics: 按 metadata.stageKey 分组，计算每阶段耗时
   * - llmMetrics: 统计 DECISION_MADE 事件数量和平均响应时间
   * - concurrency: 跟踪活跃 Agent 数量随时间变化
   */
  calculateMetrics(timeline: ExecutionTimeline): PerformanceMetrics {
    const { events, totalDuration } = timeline;

    // ── Stage metrics ──
    const stageMap = groupByStage(events);
    const stageDurations: Array<{ stageKey: string; duration: number }> = [];
    for (const [key, stageEvents] of Array.from(stageMap.entries())) {
      stageDurations.push({
        stageKey: key,
        duration: stageDuration(stageEvents),
      });
    }

    const avgStageDuration =
      stageDurations.length > 0
        ? stageDurations.reduce((s, d) => s + d.duration, 0) /
          stageDurations.length
        : 0;

    const stageMetrics = stageDurations.map(s => ({
      stageKey: s.stageKey,
      duration: s.duration,
      isBottleneck: avgStageDuration > 0 && s.duration > 2 * avgStageDuration,
    }));

    // ── LLM metrics ──
    const decisionEvents = events.filter(e => e.eventType === "DECISION_MADE");
    const callCount = decisionEvents.length;

    let totalTokens = 0;
    let totalResponseTime = 0;
    for (const e of decisionEvents) {
      const tu = e.metadata?.tokenUsage;
      if (tu) {
        totalTokens += tu.prompt + tu.completion;
      }
      // Use executionTime from eventData if available, else 0
      const rt = (e.eventData as Record<string, unknown>).executionTime;
      if (typeof rt === "number") {
        totalResponseTime += rt;
      }
    }

    const avgResponseTime = callCount > 0 ? totalResponseTime / callCount : 0;

    // ── Concurrency ──
    const concurrency = this.analyzeConcurrency(timeline);

    return {
      totalDuration,
      stageMetrics,
      llmMetrics: { callCount, avgResponseTime, totalTokens },
      concurrency,
    };
  }

  /**
   * 检测性能瓶颈：耗时 > 2× 平均阶段耗时的阶段。
   */
  detectBottlenecks(timeline: ExecutionTimeline): Bottleneck[] {
    const stageMap = groupByStage(timeline.events);
    const stages: Array<{ stageKey: string; duration: number }> = [];
    for (const [key, stageEvents] of Array.from(stageMap.entries())) {
      stages.push({ stageKey: key, duration: stageDuration(stageEvents) });
    }

    if (stages.length === 0) return [];

    const avg = stages.reduce((s, d) => s + d.duration, 0) / stages.length;
    if (avg === 0) return [];

    return stages
      .filter(s => s.duration > 2 * avg)
      .map(s => ({
        stageKey: s.stageKey,
        duration: s.duration,
        averageDuration: avg,
        ratio: s.duration / avg,
      }));
  }

  /**
   * 分析并发度：跟踪活跃 Agent 数量随时间变化。
   * 使用 AGENT_STARTED / AGENT_STOPPED 事件构建时间线。
   * 如果没有这些事件，则基于所有事件的 sourceAgent 推断。
   */
  analyzeConcurrency(timeline: ExecutionTimeline): ConcurrencyProfile {
    const { events } = timeline;
    if (events.length === 0) {
      return { maxConcurrentAgents: 0, avgConcurrentAgents: 0, timeline: [] };
    }

    // Build change-point list from AGENT_STARTED / AGENT_STOPPED
    const hasLifecycleEvents = events.some(
      e => e.eventType === "AGENT_STARTED" || e.eventType === "AGENT_STOPPED"
    );

    type TimePoint = { time: number; delta: number };
    const points: TimePoint[] = [];

    if (hasLifecycleEvents) {
      for (const e of events) {
        if (e.eventType === "AGENT_STARTED") {
          points.push({ time: e.timestamp, delta: 1 });
        } else if (e.eventType === "AGENT_STOPPED") {
          points.push({ time: e.timestamp, delta: -1 });
        }
      }
    } else {
      // Fallback: treat each unique agent's first event as start, last as stop
      const agentRange = new Map<string, { first: number; last: number }>();
      for (const e of events) {
        const existing = agentRange.get(e.sourceAgent);
        if (!existing) {
          agentRange.set(e.sourceAgent, {
            first: e.timestamp,
            last: e.timestamp,
          });
        } else {
          if (e.timestamp < existing.first) existing.first = e.timestamp;
          if (e.timestamp > existing.last) existing.last = e.timestamp;
        }
      }
      for (const [, range] of Array.from(agentRange.entries())) {
        points.push({ time: range.first, delta: 1 });
        points.push({ time: range.last, delta: -1 });
      }
    }

    // Sort by time, starts before stops at same time
    points.sort((a, b) => a.time - b.time || b.delta - a.delta);

    let current = 0;
    let max = 0;
    const timelinePoints: Array<{ time: number; activeAgents: number }> = [];

    for (const p of points) {
      current += p.delta;
      if (current < 0) current = 0; // guard
      if (current > max) max = current;
      timelinePoints.push({ time: p.time, activeAgents: current });
    }

    // Average: weighted by time intervals
    let weightedSum = 0;
    let totalTime = 0;
    for (let i = 0; i < timelinePoints.length - 1; i++) {
      const dt = timelinePoints[i + 1].time - timelinePoints[i].time;
      weightedSum += timelinePoints[i].activeAgents * dt;
      totalTime += dt;
    }
    const avg = totalTime > 0 ? weightedSum / totalTime : max > 0 ? max : 0;

    return {
      maxConcurrentAgents: Math.max(
        max,
        max > 0 ? max : events.length > 0 ? 1 : 0
      ),
      avgConcurrentAgents: avg,
      timeline: timelinePoints,
    };
  }

  /**
   * 对比两个时间轴的性能指标。
   */
  comparePerformance(
    a: ExecutionTimeline,
    b: ExecutionTimeline
  ): PerformanceComparison {
    const metricsA = this.calculateMetrics(a);
    const metricsB = this.calculateMetrics(b);

    return {
      a: metricsA,
      b: metricsB,
      durationDiff: metricsB.totalDuration - metricsA.totalDuration,
      llmCallCountDiff:
        metricsB.llmMetrics.callCount - metricsA.llmMetrics.callCount,
      avgResponseTimeDiff:
        metricsB.llmMetrics.avgResponseTime -
        metricsA.llmMetrics.avgResponseTime,
      concurrencyDiff:
        metricsB.concurrency.maxConcurrentAgents -
        metricsA.concurrency.maxConcurrentAgents,
    };
  }
}
