// Feature: nl-command-center, Property 18: ???? JSON ?????
// **Validates: Requirements 16.4**

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import type { AuditEntry, AuditOperationType } from '../../../shared/nl-command/contracts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_AUDIT_PATH = resolve(__dirname, '../../../data/test-audit-export-prop.json');

// ??? Generators ???

const auditOperationTypeArb: fc.Arbitrary<AuditOperationType> = fc.constantFrom(
  'command_created',
  'command_analyzed',
  'command_finalized',
  'clarification_question',
  'clarification_answer',
  'decomposition_completed',
  'plan_generated',
  'approval_submitted',
  'approval_completed',
  'adjustment_proposed',
  'adjustment_applied',
  'alert_triggered',
  'comment_created',
  'comment_edited',
  'permission_changed',
  'report_generated',
  'suggestion_applied',
  'template_saved',
);

const resultArb = fc.constantFrom('success' as const, 'failure' as const);

const jsonSafeValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  leaf: fc.oneof(
    fc.string({ maxLength: 20 }),
    fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
    fc.constant(null),
  ),
  array: fc.array(tie('leaf'), { maxLength: 3 }),
  object: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0),
    tie('leaf'),
    { maxKeys: 3 },
  ),
  value: fc.oneof(tie('leaf'), tie('array'), tie('object')),
})).value;

const metadataArb: fc.Arbitrary<Record<string, unknown> | undefined> = fc.option(
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
    jsonSafeValueArb,
    { minKeys: 0, maxKeys: 4 },
  ),
  { nil: undefined },
);

const auditEntryArb: fc.Arbitrary<AuditEntry> = fc.record({
  entryId: fc.uuid(),
  operationType: auditOperationTypeArb,
  operator: fc.constantFrom('user-a', 'user-b', 'user-c', 'system'),
  content: fc.string({ minLength: 1, maxLength: 60 }),
  timestamp: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  result: resultArb,
  entityId: fc.option(fc.constantFrom('ent-1', 'ent-2', 'ent-3'), { nil: undefined }),
  entityType: fc.option(fc.constantFrom('command', 'mission', 'task', 'plan'), { nil: undefined }),
  metadata: metadataArb,
});

const auditEntriesArb = fc.array(auditEntryArb, { minLength: 1, maxLength: 25 });

// ??? Helpers ???

function cleanup(): void {
  try {
    if (existsSync(TEST_AUDIT_PATH)) unlinkSync(TEST_AUDIT_PATH);
  } catch { /* ignore */ }
}

function normalize(entry: AuditEntry): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (value !== undefined) {
      obj[key] = value;
    }
  }
  return obj;
}

// ??? Tests ???

describe('Property 18: audit export JSON round-trip', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('exporting to JSON and parsing back SHALL produce equivalent AuditEntry records', async () => {
    await fc.assert(
      fc.asyncProperty(auditEntriesArb, async (entries) => {
        cleanup();
        const trail = new AuditTrail(TEST_AUDIT_PATH);

        for (const entry of entries) {
          await trail.record(entry);
        }

        const jsonStr = await trail.export({}, 'json');
        const parsed: AuditEntry[] = JSON.parse(jsonStr);
        const expectedSorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);

        expect(parsed.length).toBe(expectedSorted.length);

        for (let i = 0; i < parsed.length; i++) {
          const original = normalize(expectedSorted[i]);
          const roundTripped = parsed[i];

          expect(roundTripped.entryId).toBe(original.entryId);
          expect(roundTripped.operationType).toBe(original.operationType);
          expect(roundTripped.operator).toBe(original.operator);
          expect(roundTripped.content).toBe(original.content);
          expect(roundTripped.timestamp).toBe(original.timestamp);
          expect(roundTripped.result).toBe(original.result);
          expect(roundTripped.entityId).toEqual(original.entityId);
          expect(roundTripped.entityType).toEqual(original.entityType);
          expect(roundTripped).toEqual(original);
        }

        const reExported = JSON.stringify(parsed, null, 2);
        const reParsed: AuditEntry[] = JSON.parse(reExported);
        expect(reParsed).toEqual(parsed);
      }),
      { numRuns: 20 },
    );
  });
});
