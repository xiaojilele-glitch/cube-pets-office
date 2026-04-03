// Feature: nl-command-center, Property 17: audit query filter correctness
// **Validates: Requirements 16.1, 16.3**

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import type { AuditEntry, AuditQueryFilter, AuditOperationType } from '../../../shared/nl-command/contracts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_AUDIT_PATH = resolve(__dirname, '../../../data/test-audit-query-prop.json');

// --- Generators ---

const auditOperationTypeArb: fc.Arbitrary<AuditOperationType> = fc.constantFrom(
  'command_created', 'command_analyzed', 'command_finalized',
  'clarification_question', 'clarification_answer',
  'decomposition_completed', 'plan_generated',
  'approval_submitted', 'approval_completed',
  'adjustment_proposed', 'adjustment_applied',
  'alert_triggered', 'comment_created', 'comment_edited',
  'permission_changed', 'report_generated',
  'suggestion_applied', 'template_saved',
);

const resultArb = fc.constantFrom('success' as const, 'failure' as const);
const operatorArb = fc.constantFrom('user-a', 'user-b', 'user-c', 'system');
const entityIdArb = fc.constantFrom('ent-1', 'ent-2', 'ent-3', 'ent-4', undefined);

const auditEntryArb: fc.Arbitrary<AuditEntry> = fc.record({
  entryId: fc.uuid(),
  operationType: auditOperationTypeArb,
  operator: operatorArb,
  content: fc.string({ minLength: 1, maxLength: 50 }),
  timestamp: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  result: resultArb,
  entityId: entityIdArb,
  entityType: fc.option(fc.constantFrom('command', 'mission', 'task', 'plan'), { nil: undefined }),
  metadata: fc.constant(undefined),
});

const auditEntriesArb = fc.array(auditEntryArb, { minLength: 1, maxLength: 30 });

function buildFilterArb(entries: AuditEntry[]): fc.Arbitrary<AuditQueryFilter> {
  const timestamps = entries.map((e) => e.timestamp).sort((a, b) => a - b);
  const operators = [...new Set(entries.map((e) => e.operator))];
  const opTypes = [...new Set(entries.map((e) => e.operationType))];
  const entityIds = [...new Set(entries.map((e) => e.entityId).filter(Boolean))] as string[];

  return fc.record({
    startTime: fc.option(fc.constantFrom(...timestamps), { nil: undefined }),
    endTime: fc.option(fc.constantFrom(...timestamps), { nil: undefined }),
    operator: fc.option(fc.constantFrom(...operators), { nil: undefined }),
    operationType: fc.option(fc.constantFrom(...opTypes), { nil: undefined }),
    entityId: entityIds.length > 0
      ? fc.option(fc.constantFrom(...entityIds), { nil: undefined })
      : fc.constant(undefined),
    limit: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
    offset: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
  });
}

function cleanup(): void {
  try {
    if (existsSync(TEST_AUDIT_PATH)) unlinkSync(TEST_AUDIT_PATH);
  } catch { /* ignore */ }
}

function matchesFilter(entry: AuditEntry, filter: AuditQueryFilter): boolean {
  if (filter.startTime !== undefined && entry.timestamp < filter.startTime) return false;
  if (filter.endTime !== undefined && entry.timestamp > filter.endTime) return false;
  if (filter.operator !== undefined && entry.operator !== filter.operator) return false;
  if (filter.operationType !== undefined && entry.operationType !== filter.operationType) return false;
  if (filter.entityId !== undefined && entry.entityId !== filter.entityId) return false;
  return true;
}

// --- Tests ---

describe('Property 17: audit query filter correctness', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('query result SHALL contain only entries matching all filter criteria, ordered by timestamp desc', async () => {
    await fc.assert(
      fc.asyncProperty(
        auditEntriesArb.chain((entries) =>
          buildFilterArb(entries).map((filter) => ({ entries, filter })),
        ),
        async ({ entries, filter }) => {
          cleanup();
          const trail = new AuditTrail(TEST_AUDIT_PATH);

          for (const entry of entries) {
            await trail.record(entry);
          }

          const result = await trail.query(filter);

          for (const entry of result) {
            if (filter.startTime !== undefined) {
              expect(entry.timestamp).toBeGreaterThanOrEqual(filter.startTime);
            }
            if (filter.endTime !== undefined) {
              expect(entry.timestamp).toBeLessThanOrEqual(filter.endTime);
            }
            if (filter.operator !== undefined) {
              expect(entry.operator).toBe(filter.operator);
            }
            if (filter.operationType !== undefined) {
              expect(entry.operationType).toBe(filter.operationType);
            }
            if (filter.entityId !== undefined) {
              expect(entry.entityId).toBe(filter.entityId);
            }
          }

          const expectedMatching = entries.filter((e) => matchesFilter(e, filter));
          const expectedSorted = expectedMatching.sort((a, b) => b.timestamp - a.timestamp);
          const offset = filter.offset ?? 0;
          const limit = filter.limit ?? expectedSorted.length;
          const expectedPage = expectedSorted.slice(offset, offset + limit);

          expect(result.length).toBe(expectedPage.length);

          for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].timestamp).toBeGreaterThanOrEqual(result[i].timestamp);
          }

          expect(result.map((e) => e.entryId)).toEqual(expectedPage.map((e) => e.entryId));
        },
      ),
      { numRuns: 20 },
    );
  });
});
