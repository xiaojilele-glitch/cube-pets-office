import { describe, it, expect } from "vitest";
import { PerformanceAnalyzer } from "../performance-analyzer";
import type {
  ExecutionEvent,
  ExecutionTimeline,
} from "../../../../../shared/replay/contracts";

function makeEvent(
  overrides: Partial<ExecutionEvent> & { eventId: string }
): ExecutionEvent {
  return {
    missionId: "m1",
    timestamp: 1000,
    eventType: "CODE_EXECUTED",
    sourceAgent: "agent-a",
    eventData: {},
    ...overrides,
  };
}

function makeTimeline(
  events: ExecutionEvent[],
  overrides?: Partial<ExecutionTimeline>
): ExecutionTimeline {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const start = sorted.length > 0 ? sorted[0].timestamp : 0;
  const end = sorted.length > 0 ? sorted[sorted.length - 1].timestamp : 0;
  return {
    missionId: "m1",
    events: sorted,
    startTime: start,
    endTime: end,
    totalDuration: end - start,
    eventCount: sorted.length,
    indices: {
      byTime: new Map(),
      byAgent: new Map(),
      byType: new Map(),
      byResource: new Map(),
    },
    version: 1,
    checksum: "test",
    ...overrides,
  };
}

describe("PerformanceAnalyzer", () => {
  const analyzer = new PerformanceAnalyzer();

  describe("calculateMetrics", () => {
    it("returns totalDuration from timeline", () => {
      const tl = makeTimeline([
        makeEvent({ eventId: "1", timestamp: 100 }),
        makeEvent({ eventId: "2", timestamp: 500 }),
      ]);
      const metrics = analyzer.calculateMetrics(tl);
      expect(metrics.totalDuration).toBe(400);
    });

    it("computes stage metrics grouped by metadata.stageKey", () => {
      const events = [
        makeEvent({
          eventId: "1",
          timestamp: 100,
          metadata: { stageKey: "plan" },
        }),
        makeEvent({
          eventId: "2",
          timestamp: 300,
          metadata: { stageKey: "plan" },
        }),
        makeEvent({
          eventId: "3",
          timestamp: 400,
          metadata: { stageKey: "exec" },
        }),
        makeEvent({
          eventId: "4",
          timestamp: 500,
          metadata: { stageKey: "exec" },
        }),
      ];
      const tl = makeTimeline(events);
      const metrics = analyzer.calculateMetrics(tl);

      expect(metrics.stageMetrics).toHaveLength(2);
      const plan = metrics.stageMetrics.find(s => s.stageKey === "plan");
      const exec = metrics.stageMetrics.find(s => s.stageKey === "exec");
      expect(plan?.duration).toBe(200);
      expect(exec?.duration).toBe(100);
    });

    it("counts DECISION_MADE events as LLM calls", () => {
      const events = [
        makeEvent({
          eventId: "1",
          timestamp: 100,
          eventType: "DECISION_MADE",
          eventData: { executionTime: 50 },
        }),
        makeEvent({
          eventId: "2",
          timestamp: 200,
          eventType: "DECISION_MADE",
          eventData: { executionTime: 150 },
        }),
        makeEvent({ eventId: "3", timestamp: 300, eventType: "CODE_EXECUTED" }),
      ];
      const tl = makeTimeline(events);
      const metrics = analyzer.calculateMetrics(tl);

      expect(metrics.llmMetrics.callCount).toBe(2);
      expect(metrics.llmMetrics.avgResponseTime).toBe(100);
    });

    it("sums token usage from metadata", () => {
      const events = [
        makeEvent({
          eventId: "1",
          timestamp: 100,
          eventType: "DECISION_MADE",
          eventData: {},
          metadata: { tokenUsage: { prompt: 100, completion: 50 } },
        }),
        makeEvent({
          eventId: "2",
          timestamp: 200,
          eventType: "DECISION_MADE",
          eventData: {},
          metadata: { tokenUsage: { prompt: 200, completion: 100 } },
        }),
      ];
      const tl = makeTimeline(events);
      const metrics = analyzer.calculateMetrics(tl);
      expect(metrics.llmMetrics.totalTokens).toBe(450);
    });

    it("handles empty timeline", () => {
      const tl = makeTimeline([]);
      const metrics = analyzer.calculateMetrics(tl);
      expect(metrics.totalDuration).toBe(0);
      expect(metrics.stageMetrics).toEqual([]);
      expect(metrics.llmMetrics.callCount).toBe(0);
    });
  });

  describe("detectBottlenecks", () => {
    it("marks stages with duration > 2x average as bottlenecks", () => {
      const events = [
        makeEvent({
          eventId: "1",
          timestamp: 100,
          metadata: { stageKey: "fast1" },
        }),
        makeEvent({
          eventId: "2",
          timestamp: 110,
          metadata: { stageKey: "fast1" },
        }),
        makeEvent({
          eventId: "3",
          timestamp: 200,
          metadata: { stageKey: "fast2" },
        }),
        makeEvent({
          eventId: "4",
          timestamp: 210,
          metadata: { stageKey: "fast2" },
        }),
        makeEvent({
          eventId: "5",
          timestamp: 300,
          metadata: { stageKey: "slow" },
        }),
        makeEvent({
          eventId: "6",
          timestamp: 600,
          metadata: { stageKey: "slow" },
        }),
      ];
      const tl = makeTimeline(events);
      const bottlenecks = analyzer.detectBottlenecks(tl);

      // fast1=10, fast2=10, slow=300 → avg=~106.67 → 2x=~213.33
      // Only slow (300) exceeds 2x average
      expect(bottlenecks).toHaveLength(1);
      expect(bottlenecks[0].stageKey).toBe("slow");
      expect(bottlenecks[0].duration).toBe(300);
      expect(bottlenecks[0].ratio).toBeGreaterThan(2);
    });

    it("returns empty when no stages exceed 2x average", () => {
      const events = [
        makeEvent({
          eventId: "1",
          timestamp: 100,
          metadata: { stageKey: "a" },
        }),
        makeEvent({
          eventId: "2",
          timestamp: 200,
          metadata: { stageKey: "a" },
        }),
        makeEvent({
          eventId: "3",
          timestamp: 300,
          metadata: { stageKey: "b" },
        }),
        makeEvent({
          eventId: "4",
          timestamp: 400,
          metadata: { stageKey: "b" },
        }),
      ];
      const tl = makeTimeline(events);
      const bottlenecks = analyzer.detectBottlenecks(tl);
      expect(bottlenecks).toEqual([]);
    });

    it("returns empty for timeline with no stage keys", () => {
      const events = [
        makeEvent({ eventId: "1", timestamp: 100 }),
        makeEvent({ eventId: "2", timestamp: 200 }),
      ];
      const tl = makeTimeline(events);
      expect(analyzer.detectBottlenecks(tl)).toEqual([]);
    });
  });

  describe("analyzeConcurrency", () => {
    it("tracks concurrent agents from AGENT_STARTED/STOPPED events", () => {
      const events = [
        makeEvent({
          eventId: "1",
          timestamp: 100,
          eventType: "AGENT_STARTED",
          sourceAgent: "a",
        }),
        makeEvent({
          eventId: "2",
          timestamp: 200,
          eventType: "AGENT_STARTED",
          sourceAgent: "b",
        }),
        makeEvent({
          eventId: "3",
          timestamp: 300,
          eventType: "AGENT_STOPPED",
          sourceAgent: "a",
        }),
        makeEvent({
          eventId: "4",
          timestamp: 400,
          eventType: "AGENT_STOPPED",
          sourceAgent: "b",
        }),
      ];
      const tl = makeTimeline(events);
      const profile = analyzer.analyzeConcurrency(tl);

      expect(profile.maxConcurrentAgents).toBe(2);
      expect(profile.timeline.length).toBeGreaterThan(0);
    });

    it("falls back to event-based inference when no lifecycle events", () => {
      const events = [
        makeEvent({ eventId: "1", timestamp: 100, sourceAgent: "a" }),
        makeEvent({ eventId: "2", timestamp: 150, sourceAgent: "b" }),
        makeEvent({ eventId: "3", timestamp: 200, sourceAgent: "a" }),
        makeEvent({ eventId: "4", timestamp: 250, sourceAgent: "b" }),
      ];
      const tl = makeTimeline(events);
      const profile = analyzer.analyzeConcurrency(tl);

      expect(profile.maxConcurrentAgents).toBeGreaterThanOrEqual(1);
      expect(profile.timeline.length).toBeGreaterThan(0);
    });

    it("returns zeros for empty timeline", () => {
      const tl = makeTimeline([]);
      const profile = analyzer.analyzeConcurrency(tl);
      expect(profile.maxConcurrentAgents).toBe(0);
      expect(profile.avgConcurrentAgents).toBe(0);
      expect(profile.timeline).toEqual([]);
    });

    it("ensures activeAgents >= 0 at all timeline points", () => {
      const events = [
        makeEvent({
          eventId: "1",
          timestamp: 100,
          eventType: "AGENT_STARTED",
          sourceAgent: "a",
        }),
        makeEvent({
          eventId: "2",
          timestamp: 200,
          eventType: "AGENT_STOPPED",
          sourceAgent: "a",
        }),
        makeEvent({
          eventId: "3",
          timestamp: 250,
          eventType: "AGENT_STOPPED",
          sourceAgent: "b",
        }),
      ];
      const tl = makeTimeline(events);
      const profile = analyzer.analyzeConcurrency(tl);

      for (const point of profile.timeline) {
        expect(point.activeAgents).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("comparePerformance", () => {
    it("computes diffs between two timelines", () => {
      const tlA = makeTimeline([
        makeEvent({
          eventId: "1",
          timestamp: 100,
          eventType: "DECISION_MADE",
          eventData: { executionTime: 50 },
        }),
        makeEvent({ eventId: "2", timestamp: 300 }),
      ]);
      const tlB = makeTimeline([
        makeEvent({
          eventId: "3",
          timestamp: 100,
          eventType: "DECISION_MADE",
          eventData: { executionTime: 100 },
        }),
        makeEvent({
          eventId: "4",
          timestamp: 200,
          eventType: "DECISION_MADE",
          eventData: { executionTime: 200 },
        }),
        makeEvent({ eventId: "5", timestamp: 500 }),
      ]);

      const comparison = analyzer.comparePerformance(tlA, tlB);

      expect(comparison.a.totalDuration).toBe(200);
      expect(comparison.b.totalDuration).toBe(400);
      expect(comparison.durationDiff).toBe(200);
      expect(comparison.llmCallCountDiff).toBe(1); // 2 - 1
    });

    it("handles two empty timelines", () => {
      const tlA = makeTimeline([]);
      const tlB = makeTimeline([]);
      const comparison = analyzer.comparePerformance(tlA, tlB);

      expect(comparison.durationDiff).toBe(0);
      expect(comparison.llmCallCountDiff).toBe(0);
    });
  });
});
