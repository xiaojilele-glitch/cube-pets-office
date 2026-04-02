import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Comment } from '../../../shared/nl-command/contracts.js';
import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import { PermissionGuard } from '../../core/nl-command/permission-guard.js';
import { CommentManager } from '../../core/nl-command/comment-manager.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(__test_dirname, '../../../data/__test_comment_audit__/nl-audit.json');

function createManager() {
  const dir = dirname(TEST_AUDIT_PATH);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  const auditTrail = new AuditTrail(TEST_AUDIT_PATH);
  const permissionGuard = new PermissionGuard();
  const manager = new CommentManager({ auditTrail, permissionGuard });
  return { manager, auditTrail, permissionGuard };
}

describe('CommentManager', () => {
  let manager: CommentManager;
  let auditTrail: AuditTrail;
  let permissionGuard: PermissionGuard;

  beforeEach(() => {
    const ctx = createManager();
    manager = ctx.manager;
    auditTrail = ctx.auditTrail;
    permissionGuard = ctx.permissionGuard;
  });

  describe('addComment()', () => {
    it('should create a comment with correct fields', async () => {
      const comment = await manager.addComment('mission-1', 'mission', 'user-1', 'Hello world');

      expect(comment.commentId).toBeTruthy();
      expect(comment.entityId).toBe('mission-1');
      expect(comment.entityType).toBe('mission');
      expect(comment.authorId).toBe('user-1');
      expect(comment.content).toBe('Hello world');
      expect(comment.mentions).toEqual([]);
      expect(comment.versions).toEqual([]);
      expect(comment.createdAt).toBeGreaterThan(0);
      expect(comment.updatedAt).toBe(comment.createdAt);
    });

    it('should auto-parse mentions from content', async () => {
      const comment = await manager.addComment(
        'task-1', 'task', 'user-1',
        'Hey @alice and @bob, please review this',
      );

      expect(comment.mentions).toEqual(['alice', 'bob']);
    });

    it('should record an audit entry on creation', async () => {
      await manager.addComment('cmd-1', 'command', 'user-1', 'A comment');

      const entries = await auditTrail.query({ operationType: 'comment_created' });
      expect(entries).toHaveLength(1);
      expect(entries[0].operator).toBe('user-1');
    });

    it('should reject if user lacks create permission', async () => {
      await expect(
        manager.addComment('plan-1', 'plan', 'viewer-1', 'Not allowed', 'viewer'),
      ).rejects.toThrow(/permission/i);
    });
  });

  describe('editComment()', () => {
    it('should update content and preserve version history', async () => {
      const original = await manager.addComment('mission-1', 'mission', 'user-1', 'Original text');

      const edited = await manager.editComment(original.commentId, 'user-1', 'Updated text');

      expect(edited.content).toBe('Updated text');
      expect(edited.versions).toHaveLength(1);
      expect(edited.versions[0].content).toBe('Original text');
      expect(edited.versions[0].editedBy).toBe('user-1');
    });

    it('should accumulate versions on multiple edits', async () => {
      const c = await manager.addComment('task-1', 'task', 'user-1', 'v1');
      await manager.editComment(c.commentId, 'user-1', 'v2');
      const final = await manager.editComment(c.commentId, 'user-1', 'v3');

      expect(final.content).toBe('v3');
      expect(final.versions).toHaveLength(2);
      expect(final.versions[0].content).toBe('v1');
      expect(final.versions[1].content).toBe('v2');
    });

    it('should re-parse mentions after edit', async () => {
      const c = await manager.addComment('task-1', 'task', 'user-1', 'Hello @alice');
      expect(c.mentions).toEqual(['alice']);

      const edited = await manager.editComment(c.commentId, 'user-1', 'Hello @bob and @charlie');
      expect(edited.mentions).toEqual(['bob', 'charlie']);
    });

    it('should update updatedAt timestamp', async () => {
      const c = await manager.addComment('task-1', 'task', 'user-1', 'text');
      const originalUpdatedAt = c.updatedAt;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 5));
      const edited = await manager.editComment(c.commentId, 'user-1', 'new text');

      expect(edited.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('should record an audit entry on edit', async () => {
      const c = await manager.addComment('cmd-1', 'command', 'user-1', 'text');
      await manager.editComment(c.commentId, 'user-1', 'edited');

      const entries = await auditTrail.query({ operationType: 'comment_edited' });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe(c.commentId);
    });

    it('should throw if comment does not exist', async () => {
      await expect(
        manager.editComment('nonexistent', 'user-1', 'text'),
      ).rejects.toThrow(/not found/i);
    });

    it('should reject if user lacks edit permission', async () => {
      const c = await manager.addComment('plan-1', 'plan', 'user-1', 'text', 'operator');

      await expect(
        manager.editComment(c.commentId, 'viewer-1', 'edited', 'viewer'),
      ).rejects.toThrow(/permission/i);
    });
  });

  describe('getComments()', () => {
    it('should return comments for a given entity', async () => {
      await manager.addComment('mission-1', 'mission', 'user-1', 'Comment 1');
      await manager.addComment('mission-1', 'mission', 'user-2', 'Comment 2');
      await manager.addComment('mission-2', 'mission', 'user-1', 'Other entity');

      const comments = manager.getComments('mission-1');
      expect(comments).toHaveLength(2);
      expect(comments.every((c) => c.entityId === 'mission-1')).toBe(true);
    });

    it('should filter by entityType when provided', async () => {
      await manager.addComment('entity-1', 'mission', 'user-1', 'Mission comment');
      await manager.addComment('entity-1', 'task', 'user-1', 'Task comment');

      const missionComments = manager.getComments('entity-1', 'mission');
      expect(missionComments).toHaveLength(1);
      expect(missionComments[0].entityType).toBe('mission');
    });

    it('should return comments sorted by createdAt ascending', async () => {
      const c1 = await manager.addComment('m-1', 'mission', 'user-1', 'First');
      await new Promise((r) => setTimeout(r, 5));
      const c2 = await manager.addComment('m-1', 'mission', 'user-2', 'Second');

      const comments = manager.getComments('m-1');
      expect(comments[0].commentId).toBe(c1.commentId);
      expect(comments[1].commentId).toBe(c2.commentId);
    });

    it('should return empty array when no comments exist', () => {
      const comments = manager.getComments('nonexistent');
      expect(comments).toEqual([]);
    });
  });

  describe('parseMentions()', () => {
    it('should extract single mention', () => {
      expect(manager.parseMentions('Hello @alice')).toEqual(['alice']);
    });

    it('should extract multiple mentions', () => {
      expect(manager.parseMentions('@alice @bob @charlie')).toEqual(['alice', 'bob', 'charlie']);
    });

    it('should deduplicate mentions', () => {
      expect(manager.parseMentions('@alice @bob @alice')).toEqual(['alice', 'bob']);
    });

    it('should return empty array when no mentions', () => {
      expect(manager.parseMentions('No mentions here')).toEqual([]);
    });

    it('should handle mentions with hyphens and underscores', () => {
      expect(manager.parseMentions('@user-1 @user_2')).toEqual(['user-1', 'user_2']);
    });

    it('should handle mentions at start, middle, and end', () => {
      expect(manager.parseMentions('@start middle @mid end @end')).toEqual(['start', 'mid', 'end']);
    });

    it('should handle empty string', () => {
      expect(manager.parseMentions('')).toEqual([]);
    });
  });

  describe('getComment()', () => {
    it('should return a comment by ID', async () => {
      const c = await manager.addComment('m-1', 'mission', 'user-1', 'text');
      expect(manager.getComment(c.commentId)).toEqual(c);
    });

    it('should return undefined for unknown ID', () => {
      expect(manager.getComment('nonexistent')).toBeUndefined();
    });
  });
});
