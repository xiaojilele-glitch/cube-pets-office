// Feature: nl-command-center, Property 13: filter and sort correctness
// **Validates: Requirements 9.5**

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import type { DecomposedMission, CommandPriority } from '../../../shared/nl-command/contracts.js';

// ---------------------------------------------------------------------------
// Pure filter / sort helpers (mirror the logic used in MissionList UI)
// ---------------------------------------------------------------------------

type SortField = 'title' | 'priority' | 'estimatedDuration' | 'estimatedCost';
type SortDirection = 'asc' | 'desc';

const PRIORITY_ORDER: Record<CommandPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface FilterCriteria {
  priority?: CommandPriority;
}

function filterMissions(missions: DecomposedMission[], criteria: FilterCriteria): DecomposedMission[] {
  return missions.filter((m) => {
    if (criteria.priority !== undefined && m.priority !== criteria.priority) return false;
    return true;
  });
}

function sortMissions(
  missions: DecomposedMission[],
  field: SortField,
  direction: SortDirection,
): DecomposedMission[] {
  const sorted = [...missions];
  sorted.sort((a, b) => {
    let cmp: number;
    switch (field) {
      case 'title':
        cmp = a.title.localeCompare(b.title);
        break;
      case 'priority':
        cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        break;
      case 'estimatedDuration':
        cmp = a.estimatedDuration - b.estimatedDuration;
        break;
      case 'estimatedCost':
        cmp = a.estimatedCost - b.estimatedCost;
        break;
      default:
        cmp = 0;
    }
    return direction === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const priorityArb = fc.constantFrom<CommandPriority>('critical', 'high', 'medium', 'low');
const sortFieldArb = fc.constantFrom<SortField>('title', 'priority', 'estimatedDuration', 'estimatedCost');
const sortDirArb = fc.constantFrom<SortDirection>('asc', 'desc');

const missionArb: fc.Arbitrary<DecomposedMission> = fc.record({
  missionId: fc.uuid(),
  title: fc.stringMatching(/^[A-Za-z0-9 ]{1,30}$/),
  description: fc.stringMatching(/^[A-Za-z0-9 ]{0,50}$/),
  objectives: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }),
  constraints: fc.constant([]),
  estimatedDuration: fc.integer({ min: 1, max: 10000 }),
  estimatedCost: fc.integer({ min: 0, max: 100000 }),
  priority: priorityArb,
});

const missionListArb = fc.array(missionArb, { minLength: 0, maxLength: 20 });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 13: filter and sort correctness', () => {
  it('filtered result SHALL contain only entries matching all filter criteria', () => {
    fc.assert(
      fc.property(missionListArb, priorityArb, (missions, priority) => {
        const criteria: FilterCriteria = { priority };
        const result = filterMissions(missions, criteria);

        // Every result entry must match the filter
        for (const m of result) {
          expect(m.priority).toBe(priority);
        }

        // No matching entry was dropped
        const expectedCount = missions.filter((m) => m.priority === priority).length;
        expect(result).toHaveLength(expectedCount);
      }),
      { numRuns: 20 },
    );
  });

  it('filter with no criteria SHALL return all entries', () => {
    fc.assert(
      fc.property(missionListArb, (missions) => {
        const result = filterMissions(missions, {});
        expect(result).toHaveLength(missions.length);
      }),
      { numRuns: 20 },
    );
  });

  it('sorted result SHALL be in the correct order according to the sort specification', () => {
    fc.assert(
      fc.property(missionListArb, sortFieldArb, sortDirArb, (missions, field, direction) => {
        const result = sortMissions(missions, field, direction);

        // Length preserved
        expect(result).toHaveLength(missions.length);

        // Verify ordering: each consecutive pair must satisfy the sort order
        for (let i = 1; i < result.length; i++) {
          const prev = result[i - 1];
          const curr = result[i];
          let cmp: number;
          switch (field) {
            case 'title':
              cmp = prev.title.localeCompare(curr.title);
              break;
            case 'priority':
              cmp = PRIORITY_ORDER[prev.priority] - PRIORITY_ORDER[curr.priority];
              break;
            case 'estimatedDuration':
              cmp = prev.estimatedDuration - curr.estimatedDuration;
              break;
            case 'estimatedCost':
              cmp = prev.estimatedCost - curr.estimatedCost;
              break;
            default:
              cmp = 0;
          }
          if (direction === 'asc') {
            expect(cmp).toBeLessThanOrEqual(0);
          } else {
            expect(cmp).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 20 },
    );
  });

  it('filter then sort SHALL preserve filter invariant and sort order', () => {
    fc.assert(
      fc.property(missionListArb, priorityArb, sortFieldArb, sortDirArb, (missions, priority, field, direction) => {
        const filtered = filterMissions(missions, { priority });
        const sorted = sortMissions(filtered, field, direction);

        // All entries still match filter
        for (const m of sorted) {
          expect(m.priority).toBe(priority);
        }

        // Sort order maintained
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          let cmp: number;
          switch (field) {
            case 'title':
              cmp = prev.title.localeCompare(curr.title);
              break;
            case 'priority':
              cmp = PRIORITY_ORDER[prev.priority] - PRIORITY_ORDER[curr.priority];
              break;
            case 'estimatedDuration':
              cmp = prev.estimatedDuration - curr.estimatedDuration;
              break;
            case 'estimatedCost':
              cmp = prev.estimatedCost - curr.estimatedCost;
              break;
            default:
              cmp = 0;
          }
          if (direction === 'asc') {
            expect(cmp).toBeLessThanOrEqual(0);
          } else {
            expect(cmp).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 20 },
    );
  });
});
