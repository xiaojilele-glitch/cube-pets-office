/**
 * 评论管理器 (Comment Manager)
 *
 * 管理 NL Command Center 中实体（command/mission/task/plan）上的评论。
 * 支持版本历史、@mention 解析、权限控制和审计记录。
 *
 * @see Requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { randomUUID } from "node:crypto";

import type {
  AuditEntry,
  Comment,
  CommentVersion,
} from "../../../shared/nl-command/contracts.js";
import type { AuditTrail } from "./audit-trail.js";
import type { PermissionGuard } from "./permission-guard.js";
import type { UserRole } from "../../../shared/nl-command/contracts.js";

export interface CommentManagerOptions {
  auditTrail: AuditTrail;
  permissionGuard: PermissionGuard;
}

export class CommentManager {
  private readonly comments = new Map<string, Comment>();
  private readonly auditTrail: AuditTrail;
  private readonly permissionGuard: PermissionGuard;

  constructor(options: CommentManagerOptions) {
    this.auditTrail = options.auditTrail;
    this.permissionGuard = options.permissionGuard;
  }

  /**
   * 添加评论到指定实体。
   * 自动解析 @mention，记录审计。
   *
   * @see Requirement 12.1, 12.2, 12.5
   */
  async addComment(
    entityId: string,
    entityType: Comment["entityType"],
    authorId: string,
    content: string,
    authorRole: UserRole = "operator"
  ): Promise<Comment> {
    // Permission check: need 'create' permission
    const allowed = this.permissionGuard.checkPermission(
      authorId,
      authorRole,
      "create",
      entityType,
      entityId
    );
    if (!allowed) {
      throw new Error(
        `User ${authorId} does not have permission to create comments on ${entityType}:${entityId}`
      );
    }

    const now = Date.now();
    const mentions = this.parseMentions(content);

    const comment: Comment = {
      commentId: randomUUID(),
      entityId,
      entityType,
      authorId,
      content,
      mentions,
      versions: [],
      createdAt: now,
      updatedAt: now,
    };

    this.comments.set(comment.commentId, comment);

    // Audit
    await this.auditTrail.record({
      entryId: randomUUID(),
      operationType: "comment_created",
      operator: authorId,
      content: `Comment added on ${entityType}:${entityId}`,
      timestamp: now,
      result: "success",
      entityId: comment.commentId,
      entityType: "comment",
    } satisfies AuditEntry);

    return comment;
  }

  /**
   * 编辑评论，保留版本历史。
   * 自动重新解析 @mention，记录审计。
   *
   * @see Requirement 12.3, 12.5
   */
  async editComment(
    commentId: string,
    editorId: string,
    newContent: string,
    editorRole: UserRole = "operator"
  ): Promise<Comment> {
    const comment = this.comments.get(commentId);
    if (!comment) {
      throw new Error(`Comment ${commentId} not found`);
    }

    // Permission check: need 'edit' permission
    const allowed = this.permissionGuard.checkPermission(
      editorId,
      editorRole,
      "edit",
      comment.entityType,
      comment.entityId
    );
    if (!allowed) {
      throw new Error(
        `User ${editorId} does not have permission to edit comments on ${comment.entityType}:${comment.entityId}`
      );
    }

    const now = Date.now();

    // Preserve previous content in version history
    const version: CommentVersion = {
      content: comment.content,
      editedAt: now,
      editedBy: editorId,
    };
    comment.versions.push(version);

    // Update content and mentions
    comment.content = newContent;
    comment.mentions = this.parseMentions(newContent);
    comment.updatedAt = now;

    // Audit
    await this.auditTrail.record({
      entryId: randomUUID(),
      operationType: "comment_edited",
      operator: editorId,
      content: `Comment ${commentId} edited`,
      timestamp: now,
      result: "success",
      entityId: commentId,
      entityType: "comment",
    } satisfies AuditEntry);

    return comment;
  }

  /**
   * 获取指定实体的所有评论。
   * 可选按 entityType 过滤。
   *
   * @see Requirement 12.1, 12.4
   */
  getComments(entityId: string, entityType?: Comment["entityType"]): Comment[] {
    const results: Comment[] = [];
    for (const comment of this.comments.values()) {
      if (comment.entityId !== entityId) continue;
      if (entityType && comment.entityType !== entityType) continue;
      results.push(comment);
    }
    // Sort by createdAt ascending (oldest first)
    results.sort((a, b) => a.createdAt - b.createdAt);
    return results;
  }

  /**
   * 解析评论内容中的 @mention 模式，提取用户 ID。
   * 匹配 @userId 格式（字母、数字、连字符、下划线）。
   *
   * @see Requirement 12.2
   */
  parseMentions(content: string): string[] {
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    const mentions: string[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(content)) !== null) {
      const userId = match[1];
      if (!seen.has(userId)) {
        seen.add(userId);
        mentions.push(userId);
      }
    }

    return mentions;
  }

  /**
   * 根据 commentId 获取单条评论。
   */
  getComment(commentId: string): Comment | undefined {
    return this.comments.get(commentId);
  }
}
