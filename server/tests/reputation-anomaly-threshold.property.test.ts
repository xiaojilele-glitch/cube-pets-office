/**
 * Property-Based Test: 异常波动检测
 *
 * **Feature: agent-reputation, Property 16: 异常波动检测**
 * **Validates: Requirements 7.1**
 *
 * For any Agent 在 24 小时内的信誉变动序列，当累计变动绝对值超过 anomalyThreshold 时，
 * 系统应检测到异常。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { AnomalyDetector } from '../core/reputation/anomaly-detector.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationChangeEvent, ReputationConfig } from '../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const AGENT_ID = 'agent-anomaly-test';

/** Generate a timestamp within the last 24 hours */
const recentTimestampArb = fc.integer({ min: 1, max: 24 * 60 * 60 * 1000 - 1 }).map(
  (msAgo) => new Date(Date.now() - msAgo).toISOString(),
);

/** Generate a timestamp older than 24 hours */
const oldTimestampArb = fc.integer({ min: 24 * 60 * 60 * 1000 + 1, max: 7 * 24 * 60 * 60 * 1000 }).map(
  (msAgo) => new Date(Date.now() - msAgo).toISOString(),
);

/** Generate a single ReputationChangeEvent with configurable agentId and timestamp */
function eventArb(
  agentId: string,
  timestampArb: fc.Arbitrary<string>,
): fc.Arbitrary<ReputationChangeEvent> {
  return fc.record({
    id: fc.integer({ min: 1, max: 100_000 }),
    agentId: fc.constant(agentId),
    taskId: fc.constant('task-1'),
    dimensionDeltas: fc.record({
      qualityDelta: fc.integer({ min: -50, max: 50 }),
      speedDelta: fc.integer({ min: -50, max: 50 }),
      efficiencyDelta: fc.integer({ min: -50, max: 50 }),
      collaborationDelta: fc.integer({ min: -50, max: 50 }),
      reliabilityDelta: fc.integer({ min: -50, max: 50 }),
    }),
    oldOverallScore: fc.integer({ min: 0, max: 1000 }),
    newOverallScore: fc.integer({ min: 0, max: 1000 }),
    reason: fc.constant('task_completed'),
    timestamp: timestampArb,
  });
}

/** Generate a list of recent events for the target agent */
const recentEventsArb = fc.array(eventArb(AGENT_ID, recentTimestampArb), { minLength: 0, maxLength: 20 });

/** Configurable anomaly threshold */
const thresholdArb = fc.integer({ min: 10, max: 500 });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 16: 异常波动检测', () => {
  const config = DEFAULT_REPUTATION_CONFIG;
  const detector = new AnomalyDetector(config);

  it('detects anomaly when cumulative absolute delta exceeds threshold', () => {
    fc.assert(
      fc.property(recentEventsArb, (events) => {
        const result = detector.checkAnomalyThreshold(AGENT_ID, events);

        // Manually compute expected totalDelta
        const now = Date.now();
        const twentyFourHoursMs = 24 * 60 * 60 * 1000;
        let expectedTotal = 0;
        for (const e of events) {
          if (e.agentId !== AGENT_ID) continue;
          const eventTime = new Date(e.timestamp).getTime();
          if (now - eventTime > twentyFourHoursMs) continue;
          expectedTotal += Math.abs(e.newOverallScore - e.oldOverallScore);
        }

        expect(result.totalDelta).toBe(expectedTotal);
        expect(result.isAnomaly).toBe(expectedTotal > config.anomaly.threshold);
      }),
      { numRuns: 200 },
    );
  });

  it('does not flag anomaly when total delta is at or below threshold', () => {
    // Generate events whose cumulative |delta| is exactly at the threshold
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: config.anomaly.threshold }),
        fc.integer({ min: 1, max: 10 }),
        (totalTarget, numEvents) => {
          // Distribute totalTarget across numEvents events, each within 24h
          const perEvent = Math.floor(totalTarget / numEvents);
          const remainder = totalTarget - perEvent * numEvents;

          const events: ReputationChangeEvent[] = [];
          for (let i = 0; i < numEvents; i++) {
            const delta = i === 0 ? perEvent + remainder : perEvent;
            const oldScore = 500;
            events.push({
              id: i + 1,
              agentId: AGENT_ID,
              taskId: `task-${i}`,
              dimensionDeltas: {
                qualityDelta: 0,
                speedDelta: 0,
                efficiencyDelta: 0,
                collaborationDelta: 0,
                reliabilityDelta: 0,
              },
              oldOverallScore: oldScore,
              newOverallScore: oldScore + delta,
              reason: 'task_completed',
              timestamp: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
            });
          }

          const result = detector.checkAnomalyThreshold(AGENT_ID, events);
          // totalTarget <= threshold, so should NOT be anomaly
          expect(result.isAnomaly).toBe(false);
          expect(result.totalDelta).toBe(totalTarget);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('ignores events from other agents', () => {
    fc.assert(
      fc.property(
        fc.array(eventArb('other-agent', recentTimestampArb), { minLength: 1, maxLength: 10 }),
        (otherEvents) => {
          const result = detector.checkAnomalyThreshold(AGENT_ID, otherEvents);
          expect(result.totalDelta).toBe(0);
          expect(result.isAnomaly).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ignores events older than 24 hours', () => {
    fc.assert(
      fc.property(
        fc.array(eventArb(AGENT_ID, oldTimestampArb), { minLength: 1, maxLength: 10 }),
        (oldEvents) => {
          const result = detector.checkAnomalyThreshold(AGENT_ID, oldEvents);
          expect(result.totalDelta).toBe(0);
          expect(result.isAnomaly).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('works correctly with configurable threshold values', () => {
    fc.assert(
      fc.property(thresholdArb, recentEventsArb, (threshold, events) => {
        const customConfig: ReputationConfig = {
          ...config,
          anomaly: { ...config.anomaly, threshold },
        };
        const customDetector = new AnomalyDetector(customConfig);
        const result = customDetector.checkAnomalyThreshold(AGENT_ID, events);

        // Recompute expected
        const now = Date.now();
        const twentyFourHoursMs = 24 * 60 * 60 * 1000;
        let expectedTotal = 0;
        for (const e of events) {
          if (e.agentId !== AGENT_ID) continue;
          const eventTime = new Date(e.timestamp).getTime();
          if (now - eventTime > twentyFourHoursMs) continue;
          expectedTotal += Math.abs(e.newOverallScore - e.oldOverallScore);
        }

        expect(result.totalDelta).toBe(expectedTotal);
        expect(result.isAnomaly).toBe(expectedTotal > threshold);
      }),
      { numRuns: 200 },
    );
  });
});
