/**
 * Property-Based Test: 排行榜排序正确性
 *
 * **Feature: agent-reputation, Property 20: 排行榜排序正确性**
 * **Validates: Requirements 8.4**
 *
 * For any 排行榜查询结果，返回的 Agent 列表应按指定维度严格降序排列。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ReputationService, LeaderboardEntry } from '../core/reputation/reputation-service.js';
import { ReputationCalculator } from '../core/reputation/reputation-calculator.js';
import { TrustTierEvaluator } from '../core/reputation/trust-tier-evaluator.js';
import { AnomalyDetector } from '../core/reputation/anomaly-detector.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { DimensionScores, ReputationConfig, TrustTier } from '../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
function uniqueAgentId(): string {
  return `pbt20-agent-${++counter}-${Date.now()}`;
}

function createService(config: ReputationConfig = DEFAULT_REPUTATION_CONFIG): ReputationService {
  return new ReputationService(
    new ReputationCalculator(config),
    new TrustTierEvaluator(config),
    new AnomalyDetector(config),
    config,
  );
}

type SortByOption = keyof DimensionScores | 'overallScore';

/** Extract the sort value from a leaderboard entry */
function getSortValue(entry: LeaderboardEntry, sortBy: SortByOption): number {
  return sortBy === 'overallScore' ? entry.overallScore : entry.dimensions[sortBy];
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const sortByArb: fc.Arbitrary<SortByOption> = fc.constantFrom(
  'overallScore' as SortByOption,
  'qualityScore' as SortByOption,
  'speedScore' as SortByOption,
  'efficiencyScore' as SortByOption,
  'collaborationScore' as SortByOption,
  'reliabilityScore' as SortByOption,
);

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 20: 排行榜排序正确性', () => {
  it('leaderboard results are in descending order by the specified sortBy dimension', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 15 }),
        sortByArb,
        fc.array(fc.integer({ min: -400, max: 400 }), { minLength: 2, maxLength: 15 }),
        (agentCount: number, sortBy: SortByOption, deltas: number[]) => {
          const service = createService();
          const count = Math.min(agentCount, deltas.length);

          for (let i = 0; i < count; i++) {
            const agentId = uniqueAgentId();
            service.initializeProfile(agentId, false);
            const dimension: keyof DimensionScores =
              sortBy === 'overallScore' ? 'qualityScore' : sortBy;
            service.adjustReputation(agentId, dimension, deltas[i], 'pbt-setup');
          }

          const entries = service.getLeaderboard({ sortBy, limit: count });

          for (let i = 1; i < entries.length; i++) {
            expect(getSortValue(entries[i - 1], sortBy))
              .toBeGreaterThanOrEqual(getSortValue(entries[i], sortBy));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('leaderboard results are in ascending order when order=asc', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 15 }),
        sortByArb,
        fc.array(fc.integer({ min: -400, max: 400 }), { minLength: 2, maxLength: 15 }),
        (agentCount: number, sortBy: SortByOption, deltas: number[]) => {
          const service = createService();
          const count = Math.min(agentCount, deltas.length);

          for (let i = 0; i < count; i++) {
            const agentId = uniqueAgentId();
            service.initializeProfile(agentId, false);
            const dimension: keyof DimensionScores =
              sortBy === 'overallScore' ? 'qualityScore' : sortBy;
            service.adjustReputation(agentId, dimension, deltas[i], 'pbt-setup');
          }

          const entries = service.getLeaderboard({ sortBy, order: 'asc', limit: count });

          for (let i = 1; i < entries.length; i++) {
            expect(getSortValue(entries[i - 1], sortBy))
              .toBeLessThanOrEqual(getSortValue(entries[i], sortBy));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('leaderboard with trustTier filter returns only matching agents, still sorted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        sortByArb,
        (agentCount: number, sortBy: SortByOption) => {
          const service = createService();

          for (let i = 0; i < agentCount; i++) {
            const agentId = uniqueAgentId();
            const isExternal = i % 2 === 0;
            service.initializeProfile(agentId, isExternal);
            service.adjustReputation(agentId, 'qualityScore', (i - agentCount / 2) * 50, 'pbt-setup');
          }

          const tier: TrustTier = 'standard';
          const entries = service.getLeaderboard({ sortBy, trustTier: tier, limit: 50 });

          for (const entry of entries) {
            expect(entry.trustTier).toBe(tier);
          }

          for (let i = 1; i < entries.length; i++) {
            expect(getSortValue(entries[i - 1], sortBy))
              .toBeGreaterThanOrEqual(getSortValue(entries[i], sortBy));
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('pagination returns a subset that preserves sort order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 12 }),
        sortByArb,
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        (agentCount: number, sortBy: SortByOption, pageSize: number, pageIndex: number) => {
          const service = createService();

          for (let i = 0; i < agentCount; i++) {
            const agentId = uniqueAgentId();
            service.initializeProfile(agentId, false);
            service.adjustReputation(agentId, 'qualityScore', (i - agentCount / 2) * 40, 'pbt-setup');
          }

          const offset = pageIndex * pageSize;
          const entries = service.getLeaderboard({ sortBy, limit: pageSize, offset });

          expect(entries.length).toBeLessThanOrEqual(pageSize);

          for (let i = 1; i < entries.length; i++) {
            expect(getSortValue(entries[i - 1], sortBy))
              .toBeGreaterThanOrEqual(getSortValue(entries[i], sortBy));
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
