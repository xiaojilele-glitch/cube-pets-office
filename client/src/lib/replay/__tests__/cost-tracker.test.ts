import { describe, it, expect } from "vitest";
import { CostTracker } from "../cost-tracker";
import type { ExecutionEvent } from "../../../../../shared/replay/contracts";

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

describe("CostTracker", () => {
  const tracker = new CostTracker();

  describe("calculateCumulativeCost", () => {
    it("sums costs for events up to the given time", () => {
      const events: ExecutionEvent[] = [
        makeEvent({ eventId: "1", timestamp: 100, metadata: { cost: 0.5 } }),
        makeEvent({ eventId: "2", timestamp: 200, metadata: { cost: 1.0 } }),
        makeEvent({ eventId: "3", timestamp: 300, metadata: { cost: 2.0 } }),
      ];

      const summary = tracker.calculateCumulativeCost(events, 200);
      expect(summary.totalCost).toBe(1.5);
    });

    it("groups costs by agent", () => {
      const events: ExecutionEvent[] = [
        makeEvent({
          eventId: "1",
          timestamp: 100,
          sourceAgent: "a",
          metadata: { cost: 1 },
        }),
        makeEvent({
          eventId: "2",
          timestamp: 200,
          sourceAgent: "b",
          metadata: { cost: 2 },
        }),
        makeEvent({
          eventId: "3",
          timestamp: 300,
          sourceAgent: "a",
          metadata: { cost: 3 },
        }),
      ];

      const summary = tracker.calculateCumulativeCost(events, 300);
      expect(summary.byAgent).toEqual({ a: 4, b: 2 });
    });

    it("groups costs by operation type (eventType)", () => {
      const events: ExecutionEvent[] = [
        makeEvent({
          eventId: "1",
          timestamp: 100,
          eventType: "CODE_EXECUTED",
          metadata: { cost: 1 },
        }),
        makeEvent({
          eventId: "2",
          timestamp: 200,
          eventType: "DECISION_MADE",
          metadata: { cost: 2 },
        }),
      ];

      const summary = tracker.calculateCumulativeCost(events, 200);
      expect(summary.byOperationType).toEqual({
        CODE_EXECUTED: 1,
        DECISION_MADE: 2,
      });
    });

    it("skips events without metadata.cost", () => {
      const events: ExecutionEvent[] = [
        makeEvent({ eventId: "1", timestamp: 100, metadata: { cost: 1 } }),
        makeEvent({ eventId: "2", timestamp: 200 }),
        makeEvent({ eventId: "3", timestamp: 300, metadata: {} }),
      ];

      const summary = tracker.calculateCumulativeCost(events, 300);
      expect(summary.totalCost).toBe(1);
    });

    it("returns zero totals for empty events", () => {
      const summary = tracker.calculateCumulativeCost([], 9999);
      expect(summary.totalCost).toBe(0);
      expect(summary.byAgent).toEqual({});
    });
  });

  describe("getCostDistribution", () => {
    it("produces agent/model/op keys", () => {
      const events: ExecutionEvent[] = [
        makeEvent({
          eventId: "1",
          sourceAgent: "x",
          eventType: "DECISION_MADE",
          metadata: { cost: 5, tokenUsage: { prompt: 10, completion: 20 } },
        }),
      ];

      const dist = tracker.getCostDistribution(events);
      expect(dist["agent:x"]).toBe(5);
      expect(dist["model:llm"]).toBe(5);
      expect(dist["op:DECISION_MADE"]).toBe(5);
    });

    it('uses "unknown" model when no tokenUsage', () => {
      const events: ExecutionEvent[] = [
        makeEvent({ eventId: "1", metadata: { cost: 3 } }),
      ];

      const dist = tracker.getCostDistribution(events);
      expect(dist["model:unknown"]).toBe(3);
    });
  });

  describe("detectCostAnomalies", () => {
    it("returns events exceeding the threshold", () => {
      const events: ExecutionEvent[] = [
        makeEvent({ eventId: "1", metadata: { cost: 0.5 } }),
        makeEvent({ eventId: "2", metadata: { cost: 5.0 } }),
        makeEvent({ eventId: "3", metadata: { cost: 10.0 } }),
      ];

      const anomalies = tracker.detectCostAnomalies(events, 2.0);
      expect(anomalies).toHaveLength(2);
      expect(anomalies.map(a => a.eventId)).toEqual(["2", "3"]);
      expect(anomalies[0].threshold).toBe(2.0);
    });

    it("returns empty array when no anomalies", () => {
      const events: ExecutionEvent[] = [
        makeEvent({ eventId: "1", metadata: { cost: 1 } }),
      ];
      expect(tracker.detectCostAnomalies(events, 10)).toEqual([]);
    });

    it("ignores events without cost", () => {
      const events: ExecutionEvent[] = [makeEvent({ eventId: "1" })];
      expect(tracker.detectCostAnomalies(events, 0)).toEqual([]);
    });
  });

  describe("generateOptimizationSuggestions", () => {
    it("suggests optimizing the top-cost agent", () => {
      const dist = { "agent:a": 10, "agent:b": 2 };
      const suggestions = tracker.generateOptimizationSuggestions(dist);
      expect(
        suggestions.some(s => s.includes("agent") || s.includes("Agent"))
      ).toBe(true);
    });

    it("suggests caching when LLM cost dominates", () => {
      const dist = { "model:llm": 90, "model:unknown": 10 };
      const suggestions = tracker.generateOptimizationSuggestions(dist);
      expect(suggestions.some(s => s.toLowerCase().includes("llm"))).toBe(true);
    });

    it("suggests reviewing expensive operation types", () => {
      const dist = { "op:CODE_EXECUTED": 50, "op:DECISION_MADE": 5 };
      const suggestions = tracker.generateOptimizationSuggestions(dist);
      expect(suggestions.some(s => s.includes("CODE_EXECUTED"))).toBe(true);
    });

    it("returns a fallback suggestion for empty distribution", () => {
      const suggestions = tracker.generateOptimizationSuggestions({});
      expect(suggestions.length).toBeGreaterThan(0);
    });
  });
});
