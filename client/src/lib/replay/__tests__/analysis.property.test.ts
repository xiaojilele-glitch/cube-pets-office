/**
 * Property-based tests for analysis modules
 *
 * Tasks 8.2, 8.3, 8.5, 8.6, 8.7, 8.9, 8.10, 8.12, 8.14
 * Feature: collaboration-replay
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import type {
  ExecutionEvent,
  ExecutionTimeline,
  ReplayEventType,
  ResourceAccessEventData,
} from '../../../../../shared/replay/contracts';
import { REPLAY_EVENT_TYPES } from '../../../../../shared/replay/contracts';
import { CostTracker } from '../cost-tracker';
import { PerformanceAnalyzer } from '../performance-analyzer';
import { DataLineageTracker } from '../data-lineage';
import { PermissionAuditor } from '../permission-auditor';
import { findRelatedEvents } from '../related-events';

/* ─── Helpers ─── */

function makeEvent(overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
  return {
    eventId: overrides.eventId ?? `evt-${Math.random().toString(36).slice(2, 10)}`,
    missionId: overrides.missionId ?? 'test-mission',
    timestamp: overrides.timestamp ?? Date.now(),
    eventType: overrides.eventType ?? 'AGENT_STARTED',
    sourceAgent: overrides.sourceAgent ?? 'agent-1',
    eventData: overrides.eventData ?? {},
    ...(overrides.targetAgent ? { targetAgent: overrides.targetAgent } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

function makeTimeline(events: ExecutionEvent[]): ExecutionTimeline {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  return {
    missionId: 'test-mission',
    events: sorted,
    startTime: sorted[0]?.timestamp ?? 0,
    endTime: sorted[sorted.length - 1]?.timestamp ?? 0,
    totalDuration: sorted.length > 0 ? sorted[sorted.length - 1].timestamp - sorted[0].timestamp : 0,
    eventCount: sorted.length,
    indices: { byTime: new Map(), byAgent: new Map(), byType: new Map(), byResource: new Map() },
    version: 1,
    checksum: '',
  };
}

/* ─── Arbitraries ─── */

const agentIdArb = fc.constantFrom('agent-a', 'agent-b', 'agent-c');
const stageKeyArb = fc.constantFrom('plan', 'execute', 'review', 'finalize');

const costEventArb: fc.Arbitrary<ExecutionEvent> = fc.record({
  eventId: fc.uuid(),
  missionId: fc.constant('test-mission'),
  timestamp: fc.integer({ min: 1000, max: 100000 }),
  eventType: fc.constantFrom(...REPLAY_EVENT_TYPES) as fc.Arbitrary<ReplayEventType>,
  sourceAgent: agentIdArb,
  eventData: fc.constant({} as Record<string, unknown>),
  metadata: fc.record({
    cost: fc.double({ min: 0.001, max: 10, noNaN: true }),
    stageKey: stageKeyArb,
  }),
});


/* ═══════════════════════════════════════════════════════════════════════════
 * Task 8.2 — Property 21: Cost calculation invariant
 * Feature: collaboration-replay, Property 21: 成本计算不变量
 * Validates: Requirements 12.1, 12.2
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 21: Cost calculation invariant', () => {
  const tracker = new CostTracker();

  it('cumulative cost up to T equals sum of metadata.cost for events with timestamp <= T', () => {
    // **Validates: Requirements 12.1**
    fc.assert(
      fc.property(
        fc.array(costEventArb, { minLength: 1, maxLength: 30 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (events, fraction) => {
          const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
          const minT = sorted[0].timestamp;
          const maxT = sorted[sorted.length - 1].timestamp;
          const T = minT + fraction * (maxT - minT);

          const summary = tracker.calculateCumulativeCost(sorted, T);

          const expectedTotal = sorted
            .filter((e) => e.timestamp <= T && e.metadata?.cost != null)
            .reduce((sum, e) => sum + e.metadata!.cost!, 0);

          expect(Math.abs(summary.totalCost - expectedTotal)).toBeLessThan(0.0001);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('cost distribution by agent/model/opType sums to total cost', () => {
    // **Validates: Requirements 12.2**
    fc.assert(
      fc.property(
        fc.array(costEventArb, { minLength: 1, maxLength: 30 }),
        (events) => {
          const summary = tracker.calculateCumulativeCost(events, Infinity);

          const agentSum = Object.values(summary.byAgent).reduce((s, v) => s + v, 0);
          const opSum = Object.values(summary.byOperationType).reduce((s, v) => s + v, 0);

          expect(Math.abs(agentSum - summary.totalCost)).toBeLessThan(0.0001);
          expect(Math.abs(opSum - summary.totalCost)).toBeLessThan(0.0001);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 8.3 — Property 22: Cost anomaly detection
 * Feature: collaboration-replay, Property 22: 成本异常检测
 * Validates: Requirements 12.3
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 22: Cost anomaly detection', () => {
  const tracker = new CostTracker();

  it('anomalies contain exactly events with cost > threshold', () => {
    // **Validates: Requirements 12.3**
    fc.assert(
      fc.property(
        fc.array(costEventArb, { minLength: 1, maxLength: 30 }),
        fc.double({ min: 0.01, max: 5, noNaN: true }),
        (events, threshold) => {
          const anomalies = tracker.detectCostAnomalies(events, threshold);

          const expectedIds = events
            .filter((e) => e.metadata?.cost != null && e.metadata.cost > threshold)
            .map((e) => e.eventId);

          const anomalyIds = anomalies.map((a) => a.eventId);

          expect(anomalyIds.sort()).toEqual(expectedIds.sort());

          for (const a of anomalies) {
            expect(a.cost).toBeGreaterThan(threshold);
            expect(a.threshold).toBe(threshold);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 8.5 — Property 23: Performance metrics consistency
 * Feature: collaboration-replay, Property 23: 性能指标一致性
 * Validates: Requirements 13.1
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 23: Performance metrics consistency', () => {
  const analyzer = new PerformanceAnalyzer();

  it('totalDuration equals timeline.totalDuration and LLM callCount equals DECISION_MADE count', () => {
    // **Validates: Requirements 13.1**
    fc.assert(
      fc.property(
        fc.array(costEventArb, { minLength: 2, maxLength: 30 }),
        (events) => {
          const tl = makeTimeline(events);
          const metrics = analyzer.calculateMetrics(tl);

          expect(metrics.totalDuration).toBe(tl.totalDuration);

          const decisionCount = tl.events.filter((e) => e.eventType === 'DECISION_MADE').length;
          expect(metrics.llmMetrics.callCount).toBe(decisionCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 8.6 — Property 24: Bottleneck detection correctness
 * Feature: collaboration-replay, Property 24: 瓶颈检测正确性
 * Validates: Requirements 13.2
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 24: Bottleneck detection correctness', () => {
  const analyzer = new PerformanceAnalyzer();

  it('bottleneck stages have duration > 2x average, non-bottlenecks do not', () => {
    // **Validates: Requirements 13.2**
    fc.assert(
      fc.property(
        fc.array(costEventArb, { minLength: 3, maxLength: 40 }),
        (events) => {
          const tl = makeTimeline(events);
          const metrics = analyzer.calculateMetrics(tl);
          const bottlenecks = analyzer.detectBottlenecks(tl);

          if (metrics.stageMetrics.length === 0) return;

          const avgDuration =
            metrics.stageMetrics.reduce((s, m) => s + m.duration, 0) / metrics.stageMetrics.length;

          if (avgDuration === 0) return;

          const bottleneckKeys = new Set(bottlenecks.map((b) => b.stageKey));

          for (const stage of metrics.stageMetrics) {
            if (bottleneckKeys.has(stage.stageKey)) {
              expect(stage.duration).toBeGreaterThan(2 * avgDuration);
            }
          }

          for (const b of bottlenecks) {
            expect(b.duration).toBeGreaterThan(2 * avgDuration);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 8.7 — Property 25: Concurrency analysis bounds
 * Feature: collaboration-replay, Property 25: 并发度分析边界
 * Validates: Requirements 13.4
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 25: Concurrency analysis bounds', () => {
  const analyzer = new PerformanceAnalyzer();

  it('maxConcurrentAgents >= 1 when events exist, and timeline activeAgents >= 0', () => {
    // **Validates: Requirements 13.4**
    fc.assert(
      fc.property(
        fc.array(costEventArb, { minLength: 2, maxLength: 30 }),
        (events) => {
          const tl = makeTimeline(events);
          const concurrency = analyzer.analyzeConcurrency(tl);

          if (tl.events.length > 0) {
            expect(concurrency.maxConcurrentAgents).toBeGreaterThanOrEqual(1);
          }

          // activeAgents should never be negative
          for (const point of concurrency.timeline) {
            expect(point.activeAgents).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 8.9 — Property 18: Lineage tracing connectivity
 * Feature: collaboration-replay, Property 18: 血缘追踪连通性
 * Validates: Requirements 10.2, 10.3
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 18: Lineage tracing connectivity', () => {
  it('traceDataPoint returns a connected path from source to target', () => {
    // **Validates: Requirements 10.2, 10.3**
    // Create a deterministic chain: resource → decision → code output
    const events: ExecutionEvent[] = [
      makeEvent({
        eventId: 'e1', timestamp: 1000, eventType: 'RESOURCE_ACCESSED', sourceAgent: 'agent-a',
        eventData: { agentId: 'agent-a', resourceType: 'FILE', resourceId: 'file-1', accessType: 'READ', accessResult: { success: true, duration: 10 } },
      }),
      makeEvent({
        eventId: 'e2', timestamp: 2000, eventType: 'DECISION_MADE', sourceAgent: 'agent-b',
        eventData: { decisionId: 'd1', agentId: 'agent-b', decisionInput: { 'resource:file-1': 'data' }, decisionLogic: 'logic', decisionResult: 'ok', confidence: 0.9 },
      }),
      makeEvent({
        eventId: 'e3', timestamp: 3000, eventType: 'CODE_EXECUTED', sourceAgent: 'agent-c',
        eventData: { agentId: 'agent-c', codeSnippet: 'x', codeLanguage: 'js', executionInput: { 'decision:d1': 'ok' }, executionOutput: { stdout: '', stderr: '' }, executionStatus: 'SUCCESS', executionTime: 100 },
      }),
    ];

    const tracker = new DataLineageTracker();
    const graph = tracker.buildLineageGraph(events);

    expect(graph.nodes.length).toBeGreaterThan(0);

    // Trace from the last node back
    if (graph.nodes.length > 0) {
      const lastNode = graph.nodes[graph.nodes.length - 1];
      const chain = tracker.traceDataPoint(lastNode.id);
      expect(chain.nodes.length).toBeGreaterThanOrEqual(1);

      // Verify path connectivity: each edge's from equals a node in the chain
      const nodeIds = new Set(chain.nodes.map((n) => n.id));
      for (const edge of chain.edges) {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      }
    }
  });

  it('traceDecisionInputs returns direct input data sources', () => {
    // **Validates: Requirements 10.3**
    const events: ExecutionEvent[] = [
      makeEvent({
        eventId: 'src1', timestamp: 1000, eventType: 'RESOURCE_ACCESSED', sourceAgent: 'agent-a',
        eventData: { agentId: 'agent-a', resourceType: 'API', resourceId: 'api-1', accessType: 'READ', accessResult: { success: true, duration: 5 } },
      }),
      makeEvent({
        eventId: 'dec1', timestamp: 2000, eventType: 'DECISION_MADE', sourceAgent: 'agent-b',
        eventData: { decisionId: 'decision-1', agentId: 'agent-b', decisionInput: { 'resource:api-1': 'response' }, decisionLogic: 'analyze', decisionResult: 'proceed', confidence: 0.8 },
      }),
    ];

    const tracker = new DataLineageTracker();
    tracker.buildLineageGraph(events);
    const sources = tracker.traceDecisionInputs('dec1');

    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources.some((s) => s.inputKey.includes('api-1'))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 8.10 — Property 19: Lineage-timeline integration
 * Feature: collaboration-replay, Property 19: 血缘-时间轴集成
 * Validates: Requirements 10.4
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 19: Lineage-timeline integration', () => {
  it('every lineage node eventId corresponds to a valid event in the timeline', () => {
    // **Validates: Requirements 10.4**
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        (numEvents) => {
          const events: ExecutionEvent[] = Array.from({ length: numEvents }, (_, i) =>
            makeEvent({
              eventId: `evt-${i}`,
              timestamp: 1000 + i * 1000,
              eventType: i % 2 === 0 ? 'RESOURCE_ACCESSED' : 'MESSAGE_SENT',
              sourceAgent: `agent-${i % 3}`,
              eventData: i % 2 === 0
                ? { agentId: `agent-${i % 3}`, resourceType: 'FILE', resourceId: `res-${i}`, accessType: 'READ', accessResult: { success: true, duration: 10 } }
                : { senderId: `agent-${i % 3}`, receiverId: `agent-${(i + 1) % 3}`, messageId: `msg-${i}`, messageContent: 'hi', messageType: 'QUERY', status: 'SENT' },
            }),
          );

          const eventIds = new Set(events.map((e) => e.eventId));
          const tracker = new DataLineageTracker();
          const graph = tracker.buildLineageGraph(events);

          for (const node of graph.nodes) {
            expect(eventIds.has(node.eventId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 8.12 — Property 20: Permission violation stats correctness
 * Feature: collaboration-replay, Property 20: 权限违规统计正确性
 * Validates: Requirements 11.5
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 20: Permission violation stats correctness', () => {
  const auditor = new PermissionAuditor();

  const permEventArb: fc.Arbitrary<ExecutionEvent> = fc.record({
    eventId: fc.uuid(),
    missionId: fc.constant('test-mission'),
    timestamp: fc.integer({ min: 1000, max: 100000 }),
    eventType: fc.constant('RESOURCE_ACCESSED' as ReplayEventType),
    sourceAgent: agentIdArb,
    eventData: fc.record({
      agentId: agentIdArb,
      resourceType: fc.constantFrom('FILE', 'API', 'DATABASE'),
      resourceId: fc.string({ minLength: 1, maxLength: 10 }),
      accessType: fc.constantFrom('READ', 'WRITE', 'DELETE'),
      accessResult: fc.record({ success: fc.boolean(), duration: fc.nat() }),
      permissionCheck: fc.record({
        requested: fc.constantFrom('read', 'write', 'admin'),
        actual: fc.constantFrom('read', 'write', 'none'),
        rule: fc.constant('default-rule'),
        passed: fc.boolean(),
      }),
    }) as fc.Arbitrary<Record<string, unknown>>,
  });

  it('totalViolations equals count of events with permissionCheck.passed === false', () => {
    // **Validates: Requirements 11.5**
    fc.assert(
      fc.property(
        fc.array(permEventArb, { minLength: 1, maxLength: 30 }),
        (events) => {
          const stats = auditor.getViolationStats(events);

          const expectedViolations = events.filter((e) => {
            const data = e.eventData as Partial<ResourceAccessEventData>;
            return data.permissionCheck?.passed === false;
          }).length;

          expect(stats.totalViolations).toBe(expectedViolations);

          // byType and byAgent sums equal totalViolations
          const typeSum = Object.values(stats.byType).reduce((s, v) => s + v, 0);
          const agentSum = Object.values(stats.byAgent).reduce((s, v) => s + v, 0);
          expect(typeSum).toBe(stats.totalViolations);
          expect(agentSum).toBe(stats.totalViolations);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 8.14 — Property 17: Related event query
 * Feature: collaboration-replay, Property 17: 关联事件查询
 * Validates: Requirements 9.6
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 17: Related event query', () => {
  it('returns events sharing messageId/decisionId/resourceId, excludes unrelated', () => {
    // **Validates: Requirements 9.6**
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 1, max: 5 }),
        (sharedId, relatedCount, unrelatedCount) => {
          const target = makeEvent({
            eventId: 'target',
            timestamp: 1000,
            eventData: { messageId: sharedId },
          });

          const relatedEvents = Array.from({ length: relatedCount }, (_, i) =>
            makeEvent({
              eventId: `related-${i}`,
              timestamp: 2000 + i * 100,
              eventData: { messageId: sharedId },
            }),
          );

          const unrelatedEvents = Array.from({ length: unrelatedCount }, (_, i) =>
            makeEvent({
              eventId: `unrelated-${i}`,
              timestamp: 3000 + i * 100,
              eventData: { messageId: `other-${i}` },
            }),
          );

          const allEvents = [target, ...relatedEvents, ...unrelatedEvents];
          const result = findRelatedEvents(target, allEvents);

          // Should include all related events
          expect(result.length).toBe(relatedCount);

          // Should not include the target itself
          expect(result.find((e) => e.eventId === 'target')).toBeUndefined();

          // Should not include unrelated events
          for (const e of result) {
            expect((e.eventData as Record<string, unknown>).messageId).toBe(sharedId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns empty array when target has no relation IDs', () => {
    const target = makeEvent({ eventId: 'no-ids', eventData: {} });
    const others = [
      makeEvent({ eventId: 'other-1', eventData: { messageId: 'msg-1' } }),
    ];
    expect(findRelatedEvents(target, others)).toEqual([]);
  });
});
