/**
 * Property-based tests for ReplayExporter and ReplayComparison
 *
 * Tasks 10.2, 10.3, 10.5, 10.6
 * Feature: collaboration-replay
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import type {
  ExecutionEvent,
  ExecutionTimeline,
  ReplayEventType,
} from '../../../../../shared/replay/contracts';
import { REPLAY_EVENT_TYPES } from '../../../../../shared/replay/contracts';
import { ReplayExporter } from '../exporter';
import type { ReportSection } from '../exporter';
import { ReplayComparison } from '../comparison';

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

function makeTimeline(events: ExecutionEvent[], missionId = 'test-mission'): ExecutionTimeline {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  return {
    missionId,
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

const eventArb: fc.Arbitrary<ExecutionEvent> = fc.record({
  eventId: fc.uuid(),
  missionId: fc.constant('test-mission'),
  timestamp: fc.integer({ min: 1000, max: 100000 }),
  eventType: fc.constantFrom(...REPLAY_EVENT_TYPES) as fc.Arbitrary<ReplayEventType>,
  sourceAgent: fc.constantFrom('agent-a', 'agent-b', 'agent-c'),
  eventData: fc.constant({} as Record<string, unknown>),
  metadata: fc.record({ cost: fc.double({ min: 0.001, max: 10, noNaN: true }), stageKey: fc.constantFrom('plan', 'execute') }),
});

const sortedEventsArb = (min = 2, max = 20): fc.Arbitrary<ExecutionEvent[]> =>
  fc.array(eventArb, { minLength: min, maxLength: max }).map((events) =>
    [...events].sort((a, b) => a.timestamp - b.timestamp).map((e, i) => ({ ...e, eventId: `evt-${i}` })),
  );

const ALL_SECTIONS: ReportSection[] = ['summary', 'events', 'performance', 'cost', 'anomalies'];

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 10.2 — Property 28: Report content customization
 * Feature: collaboration-replay, Property 28: 报告内容定制
 * Validates: Requirements 15.3
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 28: Report content customization', () => {
  const exporter = new ReplayExporter();

  it('generated report contains only selected sections', () => {
    // **Validates: Requirements 15.3**
    fc.assert(
      fc.property(
        sortedEventsArb(),
        fc.subarray(ALL_SECTIONS, { minLength: 1 }),
        (events, sections) => {
          const tl = makeTimeline(events);
          const report = exporter.generateReport(tl, { sections });

          // Report sections should match exactly what was requested
          expect(report.sections).toEqual(sections);

          // Content should only have keys for selected sections
          for (const key of Object.keys(report.content)) {
            expect(sections).toContain(key);
          }

          // Each selected section should have content
          for (const section of sections) {
            expect(report.content[section]).toBeDefined();
            expect(typeof report.content[section]).toBe('string');
          }

          // Unselected sections should not be present
          for (const section of ALL_SECTIONS) {
            if (!sections.includes(section)) {
              expect(report.content[section]).toBeUndefined();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 10.3 — Property 29: Interactive HTML contains event data
 * Feature: collaboration-replay, Property 29: 交互式 HTML 包含事件数据
 * Validates: Requirements 15.5
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 29: Interactive HTML contains event data', () => {
  const exporter = new ReplayExporter();

  it('exported HTML contains embedded event data that can be extracted', () => {
    // **Validates: Requirements 15.5**
    fc.assert(
      fc.property(sortedEventsArb(1, 15), (events) => {
        const tl = makeTimeline(events);
        const html = exporter.exportInteractiveHTML(tl);

        // HTML should contain the DATA variable with embedded events
        expect(html).toContain('var DATA=');
        expect(html).toContain('<!DOCTYPE html>');

        // Extract the JSON data from the HTML
        const dataMatch = html.match(/var DATA=(\[.*?\]);/s);
        expect(dataMatch).not.toBeNull();

        if (dataMatch) {
          const parsed: ExecutionEvent[] = JSON.parse(dataMatch[1]);
          expect(parsed).toHaveLength(tl.events.length);

          // Verify each event is present
          for (let i = 0; i < tl.events.length; i++) {
            expect(parsed[i].eventId).toBe(tl.events[i].eventId);
            expect(parsed[i].timestamp).toBe(tl.events[i].timestamp);
            expect(parsed[i].eventType).toBe(tl.events[i].eventType);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 10.5 — Property 30: Event stream diff correctness
 * Feature: collaboration-replay, Property 30: 事件流差异正确性
 * Validates: Requirements 16.4
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 30: Event stream diff correctness', () => {
  const comparison = new ReplayComparison();

  it('onlyInA ∪ onlyInB ∪ common equals the union of event types from A and B', () => {
    // **Validates: Requirements 16.4**
    fc.assert(
      fc.property(
        sortedEventsArb(1, 15),
        sortedEventsArb(1, 15),
        (eventsA, eventsB) => {
          const tlA = makeTimeline(eventsA, 'mission-a');
          const tlB = makeTimeline(eventsB, 'mission-b');
          const diff = comparison.diffEventStreams(tlA, tlB);

          const typesA = new Set(tlA.events.map((e) => e.eventType));
          const typesB = new Set(tlB.events.map((e) => e.eventType));
          const union = new Set([...typesA, ...typesB]);

          // onlyInA: types in A but not B
          for (const t of diff.onlyInA) {
            expect(typesA.has(t)).toBe(true);
            expect(typesB.has(t)).toBe(false);
          }

          // onlyInB: types in B but not A
          for (const t of diff.onlyInB) {
            expect(typesB.has(t)).toBe(true);
            expect(typesA.has(t)).toBe(false);
          }

          // common: types in both A and B
          for (const t of diff.common) {
            expect(typesA.has(t)).toBe(true);
            expect(typesB.has(t)).toBe(true);
          }

          // Union of all three sets equals the full union
          const diffUnion = new Set([...diff.onlyInA, ...diff.onlyInB, ...diff.common]);
          expect(diffUnion.size).toBe(union.size);
          for (const t of union) {
            expect(diffUnion.has(t)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 10.6 — Property 31: Comparison result export roundtrip
 * Feature: collaboration-replay, Property 31: 对比结果导出往返
 * Validates: Requirements 16.5
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Property 31: Comparison result export roundtrip', () => {
  const comparison = new ReplayComparison();

  it('exportComparison JSON roundtrip preserves diff and metrics', () => {
    // **Validates: Requirements 16.5**
    fc.assert(
      fc.property(
        sortedEventsArb(2, 15),
        sortedEventsArb(2, 15),
        (eventsA, eventsB) => {
          const tlA = makeTimeline(eventsA, 'mission-a');
          const tlB = makeTimeline(eventsB, 'mission-b');

          const exported = comparison.exportComparison(tlA, tlB);
          const parsed = JSON.parse(exported);

          expect(parsed.missionIdA).toBe('mission-a');
          expect(parsed.missionIdB).toBe('mission-b');
          expect(parsed.diff).toBeDefined();
          expect(parsed.diff.onlyInA).toBeDefined();
          expect(parsed.diff.onlyInB).toBeDefined();
          expect(parsed.diff.common).toBeDefined();
          expect(parsed.metrics).toBeDefined();
          expect(parsed.metrics.durationDiff).toBeDefined();
          expect(typeof parsed.generatedAt).toBe('number');
        },
      ),
      { numRuns: 100 },
    );
  });
});
