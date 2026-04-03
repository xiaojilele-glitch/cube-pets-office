// Feature: nl-command-center, Property 15: @mention parsing correctness
// **Validates: Requirements 12.2**

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import { PermissionGuard } from '../../core/nl-command/permission-guard.js';
import { CommentManager } from '../../core/nl-command/comment-manager.js';

// We only need parseMentions which is a pure function; create a minimal manager instance.
function createManager(): CommentManager {
  // AuditTrail and PermissionGuard are not used by parseMentions, but required by constructor.
  const auditTrail = new AuditTrail(':memory:');
  const permissionGuard = new PermissionGuard();
  return new CommentManager({ auditTrail, permissionGuard });
}

// --- Generators ---

/** Generate a valid userId matching the regex [a-zA-Z0-9_-]+ */
const userIdArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,11}$/);

/** Generate filler text that does NOT contain @ */
const fillerArb = fc.stringMatching(/^[a-zA-Z0-9 .,!?]{0,20}$/);

// --- Tests ---

describe('Property 15: @mention parsing correctness', () => {
  const manager = createManager();

  it('parseMentions SHALL extract exactly the user IDs from @mention patterns', () => {
    fc.assert(
      fc.property(
        fc.array(userIdArb, { minLength: 1, maxLength: 6 }),
        fc.array(fillerArb, { minLength: 0, maxLength: 7 }),
        (userIds, fillers) => {
          // Build a content string with @mentions interspersed with filler text
          const parts: string[] = [];
          for (let i = 0; i < userIds.length; i++) {
            if (i < fillers.length) parts.push(fillers[i]);
            parts.push(`@${userIds[i]}`);
          }
          // Add trailing filler if available
          if (fillers.length > userIds.length) {
            parts.push(fillers[fillers.length - 1]);
          }
          const content = parts.join(' ');

          const mentions = manager.parseMentions(content);

          // Deduplicate expected userIds preserving order
          const expectedUnique: string[] = [];
          const seen = new Set<string>();
          for (const id of userIds) {
            if (!seen.has(id)) {
              seen.add(id);
              expectedUnique.push(id);
            }
          }

          // The extracted mentions SHALL contain exactly the user IDs present
          expect(mentions).toEqual(expectedUnique);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('content with no @mention patterns SHALL produce an empty mentions array', () => {
    fc.assert(
      fc.property(
        fillerArb,
        (content) => {
          const mentions = manager.parseMentions(content);
          expect(mentions).toEqual([]);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('duplicate @mentions SHALL be deduplicated in the result', () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.integer({ min: 2, max: 5 }),
        (userId, repeatCount) => {
          const content = Array.from({ length: repeatCount }, () => `@${userId}`).join(' ');
          const mentions = manager.parseMentions(content);

          // Duplicates SHALL be removed; result contains exactly one entry
          expect(mentions).toEqual([userId]);
        },
      ),
      { numRuns: 20 },
    );
  });
});
