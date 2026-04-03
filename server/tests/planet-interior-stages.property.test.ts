import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { MissionStage, MissionStageStatus } from '../../shared/mission/contracts.js';
import { MISSION_STAGE_STATUSES } from '../../shared/mission/contracts.js';
import { buildPlanetInteriorStages } from '../routes/planets.js';

/* ─── Arbitraries ─── */

const arbStageStatus: fc.Arbitrary<MissionStageStatus> = fc.constantFrom(...MISSION_STAGE_STATUSES);

const arbStage: fc.Arbitrary<MissionStage> = fc.record({
  key: fc.string({ minLength: 1, maxLength: 20 }).map(s => s.replace(/\s/g, '_') || 'stage'),
  label: fc.string({ minLength: 1, maxLength: 40 }),
  status: arbStageStatus,
  detail: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
  startedAt: fc.option(fc.nat({ max: 2000000000000 }), { nil: undefined }),
  completedAt: fc.option(fc.nat({ max: 2000000000000 }), { nil: undefined }),
});

const arbNonEmptyStages: fc.Arbitrary<MissionStage[]> = fc.array(arbStage, {
  minLength: 1,
  maxLength: 30,
});

/* ─── Property 3: 环形可视化几何不变量 ─── */
/* **Validates: Requirements 2.5** */

describe('Feature: mission-native-projection, Property 3: 环形可视化几何不变量', () => {
  it('arcStart of first stage equals 0', () => {
    fc.assert(
      fc.property(arbNonEmptyStages, (stages) => {
        const result = buildPlanetInteriorStages(stages);
        expect(result[0].arcStart).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('arcEnd of last stage equals 360', () => {
    fc.assert(
      fc.property(arbNonEmptyStages, (stages) => {
        const result = buildPlanetInteriorStages(stages);
        expect(result[result.length - 1].arcEnd).toBeCloseTo(360, 10);
      }),
      { numRuns: 100 },
    );
  });

  it('each stage arc size equals 360/N', () => {
    fc.assert(
      fc.property(arbNonEmptyStages, (stages) => {
        const N = stages.length;
        const expectedArc = 360 / N;
        const result = buildPlanetInteriorStages(stages);
        for (const s of result) {
          expect(s.arcEnd - s.arcStart).toBeCloseTo(expectedArc, 10);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('midAngle equals (arcStart + arcEnd) / 2 for each stage', () => {
    fc.assert(
      fc.property(arbNonEmptyStages, (stages) => {
        const result = buildPlanetInteriorStages(stages);
        for (const s of result) {
          expect(s.midAngle).toBeCloseTo((s.arcStart + s.arcEnd) / 2, 10);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('no gaps or overlaps between consecutive stages', () => {
    fc.assert(
      fc.property(arbNonEmptyStages, (stages) => {
        const result = buildPlanetInteriorStages(stages);
        for (let i = 0; i < result.length - 1; i++) {
          expect(result[i].arcEnd).toBeCloseTo(result[i + 1].arcStart, 10);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('produces N output stages for N input stages', () => {
    fc.assert(
      fc.property(arbNonEmptyStages, (stages) => {
        const result = buildPlanetInteriorStages(stages);
        expect(result).toHaveLength(stages.length);
      }),
      { numRuns: 100 },
    );
  });

  it('returns empty array for empty input', () => {
    expect(buildPlanetInteriorStages([])).toEqual([]);
  });
});
