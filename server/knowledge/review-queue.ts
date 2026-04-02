/**
 * 知识审核队列
 *
 * 管理低置信度或需人工审核的实体，支持人工和 Agent 审核。
 * - getQueue: 按 projectId、entityType 筛选，按 confidence 排序
 * - review: approve / reject / edit 操作
 * - checkBacklogAlert: 队列积压告警
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import type { Entity, ReviewAction } from "../../shared/knowledge/types.js";
import type { GraphStore } from "./graph-store.js";

/** Default threshold for backlog alert (Req 7.4) */
const DEFAULT_REVIEW_QUEUE_ALERT_THRESHOLD = 200;

/** Confidence floor for human approval (Req 7.2) */
const HUMAN_APPROVE_CONFIDENCE = 0.8;

/** Confidence floor for trusted agent approval (Req 7.3) */
const AGENT_APPROVE_CONFIDENCE = 0.7;

export class KnowledgeReviewQueue {
  constructor(private readonly graphStore: GraphStore) {}

  /**
   * Return entities that need review, optionally filtered and sorted.
   *
   * An entity needs review when confidence < 0.5 OR needsReview === true.
   * Results are sorted by confidence ascending (lowest first) by default.
   *
   * Requirement 7.1
   */
  getQueue(
    filters?: { projectId?: string; entityType?: string; sortBy?: string },
  ): Entity[] {
    const allEntities = this.collectAllEntities();

    let queue = allEntities.filter(
      (e) =>
        e.status !== "archived" &&
        (e.confidence < 0.5 || e.needsReview === true),
    );

    if (filters?.projectId) {
      queue = queue.filter((e) => e.projectId === filters.projectId);
    }
    if (filters?.entityType) {
      queue = queue.filter((e) => e.entityType === filters.entityType);
    }

    // Default sort: confidence ascending (lowest first)
    const sortBy = filters?.sortBy ?? "confidence";
    if (sortBy === "confidence") {
      queue.sort((a, b) => a.confidence - b.confidence);
    }

    return queue;
  }

  /**
   * Execute a review action on an entity.
   *
   * - approve (human):  confidence → max(current, 0.8), needsReview → false
   * - approve (agent):  confidence → max(current, 0.7), needsReview → false
   * - reject:           status → archived, record rejectionReason
   * - edit:             update attributes, then approve
   *
   * Requirements 7.2, 7.3
   */
  review(entityId: string, action: ReviewAction): Entity {
    const entity = this.graphStore.getEntity(entityId);
    if (!entity) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    switch (action.action) {
      case "approve":
        return this.applyApprove(entity, action);

      case "reject":
        return this.applyReject(entity, action);

      case "edit":
        return this.applyEdit(entity, action);

      default:
        throw new Error(`Unknown review action: ${(action as ReviewAction).action}`);
    }
  }

  /** Number of entities currently in the review queue. */
  getQueueSize(): number {
    return this.getQueue().length;
  }

  /**
   * Return true if the queue size exceeds the given threshold.
   * Logs a warning when triggered.
   *
   * Requirement 7.4
   */
  checkBacklogAlert(
    threshold: number = DEFAULT_REVIEW_QUEUE_ALERT_THRESHOLD,
  ): boolean {
    const size = this.getQueueSize();
    if (size > threshold) {
      console.warn(
        `[KNOWLEDGE_REVIEW_BACKLOG] Review queue size (${size}) exceeds threshold (${threshold})`,
      );
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private applyApprove(entity: Entity, action: ReviewAction): Entity {
    const confidenceFloor =
      action.reviewerType === "human"
        ? HUMAN_APPROVE_CONFIDENCE
        : AGENT_APPROVE_CONFIDENCE;

    const updated = this.graphStore.updateEntity(entity.entityId, {
      confidence: Math.max(entity.confidence, confidenceFloor),
      needsReview: false,
    });

    if (!updated) {
      throw new Error(`Failed to update entity: ${entity.entityId}`);
    }
    return updated;
  }

  private applyReject(entity: Entity, action: ReviewAction): Entity {
    // Use enforceStatusTransition if entity is active → deprecated → archived,
    // but for review rejection we go straight to archived via updateEntity
    // since the entity may already be active and the spec says "mark as archived".
    const updated = this.graphStore.updateEntity(entity.entityId, {
      status: "archived",
      needsReview: false,
      deprecationReason: action.rejectionReason ?? "Rejected during review",
    });

    if (!updated) {
      throw new Error(`Failed to update entity: ${entity.entityId}`);
    }
    return updated;
  }

  private applyEdit(entity: Entity, action: ReviewAction): Entity {
    // First update the entity attributes
    if (action.editedAttributes) {
      const currentExtended = entity.extendedAttributes ?? {};
      this.graphStore.updateEntity(entity.entityId, {
        extendedAttributes: { ...currentExtended, ...action.editedAttributes },
      });
    }

    // Then approve (re-fetch to get latest state)
    const refreshed = this.graphStore.getEntity(entity.entityId);
    if (!refreshed) {
      throw new Error(`Entity not found after edit: ${entity.entityId}`);
    }
    return this.applyApprove(refreshed, action);
  }

  /** Collect all entities across all loaded projects. */
  private collectAllEntities(): Entity[] {
    const all: Entity[] = [];
    // Access the internal dataByProject map via getGraphData for each loaded project.
    // We iterate known projects by checking the graphStore's data.
    // GraphStore exposes getGraphData(projectId) but we need to iterate all projects.
    // Use the pattern from collectAllRelations — iterate dataByProject via a workaround.
    // Since GraphStore doesn't expose a "getAllProjects" method, we use the same
    // approach as other consumers: access via (graphStore as any).dataByProject
    const dataByProject = (this.graphStore as any).dataByProject as
      | Map<string, { entities: Entity[] }>
      | undefined;

    if (dataByProject) {
      for (const data of Array.from(dataByProject.values())) {
        all.push(...data.entities);
      }
    }
    return all;
  }
}
