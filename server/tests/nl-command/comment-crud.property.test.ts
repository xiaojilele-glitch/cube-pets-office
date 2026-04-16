// Feature: nl-command-center, Property 14: comment CRUD and version history
// **Validates: Requirements 12.1, 12.3**

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AuditTrail } from "../../core/nl-command/audit-trail.js";
import { PermissionGuard } from "../../core/nl-command/permission-guard.js";
import { CommentManager } from "../../core/nl-command/comment-manager.js";
import type { Comment } from "../../../shared/nl-command/contracts.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(
  __test_dirname,
  "../../../data/__test_comment_crud_prop__/nl-audit.json"
);

// --- Generators ---

const entityTypeArb: fc.Arbitrary<Comment["entityType"]> = fc.constantFrom(
  "command",
  "mission",
  "task",
  "plan"
);
const entityIdArb = fc.stringMatching(/^[a-z]{3,8}-[0-9]{1,4}$/);
const userIdArb = fc.stringMatching(/^[a-z]{3,8}$/);
const contentArb = fc.stringMatching(/^[a-zA-Z0-9 .,!?]{1,80}$/);

// --- Tests ---

describe("Property 14: comment CRUD and version history", () => {
  let auditTrail: AuditTrail;
  let permissionGuard: PermissionGuard;

  beforeEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
    permissionGuard = new PermissionGuard();
  });

  afterEach(() => {
    const dir = dirname(TEST_AUDIT_PATH);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("addComment + getComments round-trip: querying SHALL return the created comment", async () => {
    await fc.assert(
      fc.asyncProperty(
        entityIdArb,
        entityTypeArb,
        userIdArb,
        contentArb,
        async (entityId, entityType, authorId, content) => {
          const manager = new CommentManager({ auditTrail, permissionGuard });

          const created = await manager.addComment(
            entityId,
            entityType,
            authorId,
            content,
            "operator"
          );
          const comments = manager.getComments(entityId, entityType);

          // The created comment SHALL be returned when querying by entity
          expect(comments.length).toBeGreaterThanOrEqual(1);
          const found = comments.find(c => c.commentId === created.commentId);
          expect(found).toBeDefined();
          expect(found!.entityId).toBe(entityId);
          expect(found!.entityType).toBe(entityType);
          expect(found!.authorId).toBe(authorId);
          expect(found!.content).toBe(content);
          expect(found!.versions).toEqual([]);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("editComment SHALL add a version entry preserving previous content", async () => {
    await fc.assert(
      fc.asyncProperty(
        entityIdArb,
        entityTypeArb,
        userIdArb,
        contentArb,
        contentArb,
        async (entityId, entityType, authorId, originalContent, newContent) => {
          const manager = new CommentManager({ auditTrail, permissionGuard });

          const created = await manager.addComment(
            entityId,
            entityType,
            authorId,
            originalContent,
            "operator"
          );
          expect(created.versions).toHaveLength(0);

          const edited = await manager.editComment(
            created.commentId,
            authorId,
            newContent,
            "operator"
          );

          // After editing, the comment SHALL have a new version entry
          expect(edited.versions.length).toBeGreaterThanOrEqual(1);
          // The previous content SHALL be preserved in the version history
          expect(edited.versions[0].content).toBe(originalContent);
          expect(edited.versions[0].editedBy).toBe(authorId);
          // Current content is the new content
          expect(edited.content).toBe(newContent);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("multiple edits SHALL accumulate version entries preserving all previous content", async () => {
    await fc.assert(
      fc.asyncProperty(
        entityIdArb,
        entityTypeArb,
        userIdArb,
        fc.array(contentArb, { minLength: 2, maxLength: 5 }),
        async (entityId, entityType, authorId, contentVersions) => {
          const manager = new CommentManager({ auditTrail, permissionGuard });

          const created = await manager.addComment(
            entityId,
            entityType,
            authorId,
            contentVersions[0],
            "operator"
          );

          let current = created;
          for (let i = 1; i < contentVersions.length; i++) {
            current = await manager.editComment(
              current.commentId,
              authorId,
              contentVersions[i],
              "operator"
            );
          }

          // versions array SHALL have (contentVersions.length - 1) entries
          expect(current.versions).toHaveLength(contentVersions.length - 1);
          // Each version SHALL preserve the previous content in order
          for (let i = 0; i < current.versions.length; i++) {
            expect(current.versions[i].content).toBe(contentVersions[i]);
          }
          // Current content is the last version
          expect(current.content).toBe(
            contentVersions[contentVersions.length - 1]
          );
        }
      ),
      { numRuns: 20 }
    );
  });
});
