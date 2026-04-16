/**
 * KnowledgeGarbageCollector — 知识垃圾回收器
 *
 * 定时清理过期、低质量和重复的知识条目：
 * - archiveExpiredDeprecated(): deprecated 超过 archiveAfterDays → archived
 * - deleteLowQualityEntities(): confidence < 0.3 且 > 30 天且无关系引用 → 删除
 * - mergeDuplicateEntities(): name + entityType + projectId 相似度 > 0.9 → 合并
 *
 * Requirements: 6.3
 */

import type {
  Entity,
  GCConfig,
  GCResult,
} from "../../shared/knowledge/types.js";
import type { GraphStore } from "./graph-store.js";
import type { LifecycleLog } from "./lifecycle-log.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: GCConfig = {
  archiveAfterDays: 90,
  lowConfidenceThreshold: 0.3,
  lowConfidenceMaxAgeDays: 30,
  duplicateSimilarityThreshold: 0.9,
};

// ---------------------------------------------------------------------------
// KnowledgeGarbageCollector
// ---------------------------------------------------------------------------

export class KnowledgeGarbageCollector {
  private readonly graphStore: GraphStore;
  private readonly lifecycleLog: LifecycleLog;
  private readonly config: GCConfig;

  constructor(
    graphStore: GraphStore,
    lifecycleLog: LifecycleLog,
    config?: Partial<GCConfig>
  ) {
    this.graphStore = graphStore;
    this.lifecycleLog = lifecycleLog;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run all three GC phases in sequence and return combined results.
   */
  run(): GCResult {
    const start = Date.now();

    const archived = this.archiveExpiredDeprecated();
    const deleted = this.deleteLowQualityEntities();
    const merged = this.mergeDuplicateEntities();

    return {
      archived,
      deleted,
      merged,
      duration: Date.now() - start,
    };
  }

  /**
   * Phase 1: Archive expired deprecated entities.
   *
   * Find all entities with status="deprecated" where
   * (now - updatedAt) > archiveAfterDays, then transition to "archived".
   */
  archiveExpiredDeprecated(): number {
    const now = Date.now();
    const thresholdMs = this.config.archiveAfterDays * 24 * 60 * 60 * 1000;
    let count = 0;

    const deprecated = this.findAllEntitiesByStatus("deprecated");

    for (const entity of deprecated) {
      const updatedAt = new Date(entity.updatedAt).getTime();
      const age = now - updatedAt;

      if (age > thresholdMs) {
        try {
          this.graphStore.enforceStatusTransition(
            entity.entityId,
            "archived",
            `Auto-archived: deprecated for ${Math.floor(age / (24 * 60 * 60 * 1000))} days (threshold: ${this.config.archiveAfterDays})`,
            "auto_cleanup",
            this.lifecycleLog
          );
          count++;
        } catch {
          // Entity may have been modified concurrently — skip
        }
      }
    }

    return count;
  }

  /**
   * Phase 2: Delete low-quality entities.
   *
   * Find entities with confidence < lowConfidenceThreshold,
   * age > lowConfidenceMaxAgeDays, and no relations referencing them.
   * "Delete" = transition to archived, then physically remove from data array.
   */
  deleteLowQualityEntities(): number {
    const now = Date.now();
    const maxAgeMs = this.config.lowConfidenceMaxAgeDays * 24 * 60 * 60 * 1000;
    let count = 0;

    // Collect all active entities across all projects
    const candidates = this.findAllEntitiesByStatus("active").filter(
      e =>
        e.confidence < this.config.lowConfidenceThreshold &&
        now - new Date(e.createdAt).getTime() > maxAgeMs
    );

    for (const entity of candidates) {
      // Check if entity has any relations (as source or target)
      if (this.entityHasRelations(entity)) {
        continue;
      }

      // Log the deletion
      this.lifecycleLog.append({
        entityId: entity.entityId,
        action: "garbage_collect",
        reason: `Low quality: confidence=${entity.confidence.toFixed(2)}, age > ${this.config.lowConfidenceMaxAgeDays} days, no relations`,
        previousStatus: entity.status,
        newStatus: "archived",
        timestamp: new Date().toISOString(),
        triggeredBy: "auto_cleanup",
      });

      // Remove from graph data array
      this.removeEntityFromStore(entity);
      count++;
    }

    return count;
  }

  /**
   * Phase 3: Merge duplicate entities.
   *
   * Group entities by (entityType, projectId). Within each group, find pairs
   * where name similarity > duplicateSimilarityThreshold. Keep the entity
   * with higher confidence, merge extendedAttributes.
   */
  mergeDuplicateEntities(): number {
    let count = 0;

    const allActive = this.findAllEntitiesByStatus("active");

    // Group by (entityType, projectId)
    const groups = new Map<string, Entity[]>();
    for (const entity of allActive) {
      const key = `${entity.entityType}::${entity.projectId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entity);
    }

    for (const group of Array.from(groups.values())) {
      if (group.length < 2) continue;

      // Track which entities have been merged away (by entityId)
      const merged = new Set<string>();

      for (let i = 0; i < group.length; i++) {
        if (merged.has(group[i].entityId)) continue;

        for (let j = i + 1; j < group.length; j++) {
          if (merged.has(group[j].entityId)) continue;

          const similarity = this.nameSimilarity(group[i].name, group[j].name);
          if (similarity < this.config.duplicateSimilarityThreshold) continue;

          // Determine winner (higher confidence) and loser
          const [winner, loser] =
            group[i].confidence >= group[j].confidence
              ? [group[i], group[j]]
              : [group[j], group[i]];

          // Merge extendedAttributes: loser's attrs fill in gaps
          const mergedAttrs = {
            ...loser.extendedAttributes,
            ...winner.extendedAttributes,
          };

          // Update winner with merged attributes and max confidence
          this.graphStore.updateEntity(winner.entityId, {
            extendedAttributes: mergedAttrs,
            confidence: Math.max(winner.confidence, loser.confidence),
          });

          // Log the merge
          this.lifecycleLog.append({
            entityId: loser.entityId,
            action: "merge",
            reason: `Merged into ${winner.entityId} (name similarity: ${similarity.toFixed(2)})`,
            previousStatus: loser.status,
            newStatus: "archived",
            timestamp: new Date().toISOString(),
            triggeredBy: "auto_cleanup",
          });

          // Remove loser from store
          this.removeEntityFromStore(loser);
          merged.add(loser.entityId);
          count++;
        }
      }
    }

    return count;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Find all entities with a given status across all loaded projects.
   */
  private findAllEntitiesByStatus(status: Entity["status"]): Entity[] {
    const results: Entity[] = [];
    // Access the internal dataByProject map via getGraphData for each known project
    // We use a workaround: findEntities requires projectId, so we iterate known projects
    // by accessing the store's data accessor.
    const projects = this.getKnownProjectIds();
    for (const projectId of projects) {
      const entities = this.graphStore.getAllEntities(projectId);
      results.push(...entities.filter(e => e.status === status));
    }
    return results;
  }

  /**
   * Check if an entity has any relations (as source or target).
   */
  private entityHasRelations(entity: Entity): boolean {
    const asSource = this.graphStore.findRelations({
      sourceEntityId: entity.entityId,
    });
    if (asSource.length > 0) return true;

    const asTarget = this.graphStore.findRelations({
      targetEntityId: entity.entityId,
    });
    return asTarget.length > 0;
  }

  /**
   * Physically remove an entity from the GraphStore data array.
   */
  private removeEntityFromStore(entity: Entity): void {
    const data = this.graphStore.getGraphData(entity.projectId);
    const idx = data.entities.findIndex(e => e.entityId === entity.entityId);
    if (idx !== -1) {
      data.entities.splice(idx, 1);
      data._counters.entities = Math.max(0, data._counters.entities - 1);
      data.lastUpdated = new Date().toISOString();
      this.graphStore.save(entity.projectId);
    }
  }

  /**
   * Get all known project IDs from the GraphStore.
   * Uses the getGraphData accessor to probe loaded projects.
   */
  private getKnownProjectIds(): string[] {
    // Access the internal map via a cast — GraphStore exposes getGraphData
    // but not a list of project IDs. We use the dataByProject map directly.
    const store = this.graphStore as unknown as {
      dataByProject: Map<string, unknown>;
    };
    return Array.from(store.dataByProject.keys());
  }

  /**
   * Compute name similarity between two strings.
   *
   * Uses a combination of:
   * 1. Exact match (after normalization) → 1.0
   * 2. Containment check → 0.9
   * 3. Levenshtein distance ratio for general similarity
   */
  private nameSimilarity(a: string, b: string): number {
    const na = a.toLowerCase().trim();
    const nb = b.toLowerCase().trim();

    if (na === nb) return 1.0;
    if (na.includes(nb) || nb.includes(na)) return 0.95;

    return this.levenshteinRatio(na, nb);
  }

  /**
   * Levenshtein distance ratio: 1 - (distance / maxLength).
   * Returns a value between 0.0 (completely different) and 1.0 (identical).
   */
  private levenshteinRatio(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    return 1 - this.levenshteinDistance(a, b) / maxLen;
  }

  /**
   * Classic Levenshtein distance (edit distance) between two strings.
   */
  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    // Use a single-row DP approach for space efficiency
    const prev = new Array<number>(n + 1);
    const curr = new Array<number>(n + 1);

    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1, // deletion
          curr[j - 1] + 1, // insertion
          prev[j - 1] + cost // substitution
        );
      }
      for (let j = 0; j <= n; j++) prev[j] = curr[j];
    }

    return prev[n];
  }
}
