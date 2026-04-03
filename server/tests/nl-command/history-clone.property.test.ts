// Feature: nl-command-center, Property 20: historical command clone produces new ID
// **Validates: Requirements 19.2**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';

import type {
  StrategicCommand,
  CommandPriority,
  CommandStatus,
  CommandConstraint,
  CommandTimeframe,
} from '../../../shared/nl-command/contracts.js';

// --- Clone function under test ---

/**
 * Clone a historical StrategicCommand to create a new command.
 * Produces a new commandId, resets status to 'draft', updates timestamp,
 * but preserves commandText, constraints, objectives, and priority.
 */
function cloneStrategicCommand(source: StrategicCommand): StrategicCommand {
  return {
    ...source,
    commandId: uuidv4(),
    status: 'draft',
    timestamp: Date.now(),
    constraints: source.constraints.map((c) => ({ ...c })),
    objectives: [...source.objectives],
  };
}

// --- Generators ---

const priorityArb: fc.Arbitrary<CommandPriority> = fc.constantFrom('critical', 'high', 'medium', 'low');

const statusArb: fc.Arbitrary<CommandStatus> = fc.constantFrom(
  'draft', 'analyzing', 'clarifying', 'finalized', 'decomposing',
  'planning', 'approving', 'executing', 'completed', 'failed', 'cancelled',
);

const nonEmptyStr = fc.string({ minLength: 1, maxLength: 60 });

const constraintArb: fc.Arbitrary<CommandConstraint> = fc.record({
  type: fc.constantFrom('budget' as const, 'time' as const, 'quality' as const, 'resource' as const, 'custom' as const),
  description: nonEmptyStr,
  value: fc.option(nonEmptyStr, { nil: undefined }),
  unit: fc.option(nonEmptyStr, { nil: undefined }),
});

const timeframeArb: fc.Arbitrary<CommandTimeframe> = fc.record({
  startDate: fc.option(nonEmptyStr, { nil: undefined }),
  endDate: fc.option(nonEmptyStr, { nil: undefined }),
  durationEstimate: fc.option(nonEmptyStr, { nil: undefined }),
});

const strategicCommandArb: fc.Arbitrary<StrategicCommand> = fc.record({
  commandId: fc.uuid(),
  commandText: nonEmptyStr,
  userId: nonEmptyStr,
  timestamp: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  status: statusArb,
  parsedIntent: fc.option(nonEmptyStr, { nil: undefined }),
  constraints: fc.array(constraintArb, { minLength: 0, maxLength: 5 }),
  objectives: fc.array(nonEmptyStr, { minLength: 0, maxLength: 5 }),
  priority: priorityArb,
  timeframe: fc.option(timeframeArb, { nil: undefined }),
});

// --- Tests ---

describe('Property 20: historical command clone produces new ID', () => {
  it('cloning a StrategicCommand SHALL produce a new commandId but identical commandText, constraints, objectives, and priority', () => {
    fc.assert(
      fc.property(strategicCommandArb, (original) => {
        const cloned = cloneStrategicCommand(original);

        // New commandId
        expect(cloned.commandId).toBeDefined();
        expect(cloned.commandId).not.toBe(original.commandId);

        // Identical content fields
        expect(cloned.commandText).toBe(original.commandText);
        expect(cloned.constraints).toEqual(original.constraints);
        expect(cloned.objectives).toEqual(original.objectives);
        expect(cloned.priority).toBe(original.priority);
      }),
      { numRuns: 20 },
    );
  });

  it('cloned command constraints SHALL be a deep copy (no shared references)', () => {
    fc.assert(
      fc.property(strategicCommandArb, (original) => {
        const cloned = cloneStrategicCommand(original);

        // Arrays should not be the same reference
        expect(cloned.constraints).not.toBe(original.constraints);
        expect(cloned.objectives).not.toBe(original.objectives);

        // Individual constraint objects should not be the same reference
        for (let i = 0; i < original.constraints.length; i++) {
          expect(cloned.constraints[i]).not.toBe(original.constraints[i]);
          expect(cloned.constraints[i]).toEqual(original.constraints[i]);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('cloned command SHALL have status reset to draft', () => {
    fc.assert(
      fc.property(strategicCommandArb, (original) => {
        const cloned = cloneStrategicCommand(original);
        expect(cloned.status).toBe('draft');
      }),
      { numRuns: 20 },
    );
  });
});
