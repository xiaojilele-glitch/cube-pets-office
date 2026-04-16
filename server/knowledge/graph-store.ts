/**
 * GraphStore — 图谱存储引擎
 *
 * 管理实体和关系的 CRUD 操作，持久化为 JSON 文件。
 * 存储路径：data/knowledge/graph-{projectId}.json
 *
 * Requirements: 1.3, 1.4, 2.6
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

import type {
  Entity,
  Relation,
  EntityFilters,
  RelationFilters,
  GraphData,
  EntitySource,
  EntityStatus,
  LifecycleLogEntry,
} from "../../shared/knowledge/types.js";

import type { LifecycleLog } from "./lifecycle-log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data/knowledge");

// ---------------------------------------------------------------------------
// Debounce delay for JSON persistence (ms)
// ---------------------------------------------------------------------------
const SAVE_DEBOUNCE_MS = 1000;

// ---------------------------------------------------------------------------
// Entity change listener type
// ---------------------------------------------------------------------------
type EntityChangeAction = "created" | "updated" | "deleted";
type EntityChangeListener = (
  entity: Entity,
  action: EntityChangeAction
) => void;

// ---------------------------------------------------------------------------
// GraphStore
// ---------------------------------------------------------------------------

export class GraphStore {
  private dataByProject: Map<string, GraphData> = new Map();
  private saveTimers: Map<string, NodeJS.Timeout> = new Map();
  private entityChangeListeners: EntityChangeListener[] = [];

  /** Optional lifecycle log — set after construction or passed to enforceStatusTransition */
  lifecycleLog?: LifecycleLog;

  constructor() {
    // Data is loaded lazily per-project via ensureProject()
  }

  // -----------------------------------------------------------------------
  // 实体 CRUD (Requirement 1.3)
  // -----------------------------------------------------------------------

  createEntity(
    input: Omit<Entity, "entityId" | "createdAt" | "updatedAt" | "status">
  ): Entity {
    const data = this.ensureProject(input.projectId);
    const now = new Date().toISOString();

    const entity: Entity = {
      ...input,
      entityId: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "active",
      // user_defined entities get confidence 1.0
      confidence: input.source === "user_defined" ? 1.0 : input.confidence,
    };

    data.entities.push(entity);
    data._counters.entities++;
    data.lastUpdated = now;

    this.scheduleSave(input.projectId);
    this.notifyEntityChanged(entity, "created");

    return entity;
  }

  getEntity(entityId: string): Entity | undefined {
    for (const data of Array.from(this.dataByProject.values())) {
      const found = data.entities.find((e: Entity) => e.entityId === entityId);
      if (found) return found;
    }
    return undefined;
  }

  findEntities(filters: EntityFilters): Entity[] {
    const data = this.ensureProject(filters.projectId);
    let results = data.entities.filter(e => e.projectId === filters.projectId);

    if (filters.entityType) {
      results = results.filter(e => e.entityType === filters.entityType);
    }
    if (filters.name) {
      const needle = filters.name.toLowerCase();
      results = results.filter(e => e.name.toLowerCase().includes(needle));
    }
    if (filters.confidenceMin !== undefined) {
      results = results.filter(e => e.confidence >= filters.confidenceMin!);
    }
    if (filters.status) {
      results = results.filter(e => e.status === filters.status);
    }

    return results;
  }

  updateEntity(entityId: string, updates: Partial<Entity>): Entity | undefined {
    for (const [projectId, data] of Array.from(this.dataByProject.entries())) {
      const idx = data.entities.findIndex(
        (e: Entity) => e.entityId === entityId
      );
      if (idx !== -1) {
        const entity = data.entities[idx];
        const updated: Entity = {
          ...entity,
          ...updates,
          entityId: entity.entityId, // immutable
          createdAt: entity.createdAt, // immutable
          updatedAt: new Date().toISOString(),
        };
        data.entities[idx] = updated;
        data.lastUpdated = updated.updatedAt;

        this.scheduleSave(projectId);
        this.notifyEntityChanged(updated, "updated");

        return updated;
      }
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // 实体状态机 (Requirement 6.1)
  // -----------------------------------------------------------------------

  /**
   * Allowed status transitions:
   *   active → deprecated
   *   deprecated → archived
   *   archived → active
   */
  private static readonly ALLOWED_TRANSITIONS: ReadonlyMap<
    EntityStatus,
    EntityStatus
  > = new Map([
    ["active", "deprecated"],
    ["deprecated", "archived"],
    ["archived", "active"],
  ]);

  /**
   * enforceStatusTransition — 强制执行实体状态转换
   *
   * 仅允许 active → deprecated、deprecated → archived、archived → active。
   * 状态变更时写入 lifecycle log。
   *
   * @throws Error if entity not found or transition is invalid
   */
  enforceStatusTransition(
    entityId: string,
    newStatus: EntityStatus,
    reason: string,
    triggeredBy: LifecycleLogEntry["triggeredBy"],
    lifecycleLog?: LifecycleLog
  ): Entity {
    const entity = this.getEntity(entityId);
    if (!entity) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    const currentStatus = entity.status;
    const allowedTarget = GraphStore.ALLOWED_TRANSITIONS.get(currentStatus);

    if (allowedTarget !== newStatus) {
      throw new Error(
        `Invalid status transition: ${currentStatus} → ${newStatus}. ` +
          `Allowed: ${currentStatus} → ${allowedTarget ?? "none"}`
      );
    }

    const updated = this.updateEntity(entityId, { status: newStatus })!;

    // Write lifecycle log entry
    const log = lifecycleLog ?? this.lifecycleLog;
    if (log) {
      log.append({
        entityId,
        action: "status_change",
        reason,
        previousStatus: currentStatus,
        newStatus,
        timestamp: new Date().toISOString(),
        triggeredBy,
      });
    }

    return updated;
  }

  /**
   * mergeEntity — 去重合并 (Requirement 2.6)
   *
   * 唯一键：entityType + projectId + name
   * 如果已存在，合并属性并保留更高 confidence；否则创建新实体。
   */
  mergeEntity(
    input: Partial<Entity> & {
      entityType: string;
      projectId: string;
      name: string;
    }
  ): Entity {
    const existing = this.findDuplicate(input);

    if (existing) {
      // Merge: keep higher confidence
      const mergedConfidence =
        input.confidence !== undefined
          ? Math.max(existing.confidence, input.confidence)
          : existing.confidence;

      const mergedExtended = {
        ...existing.extendedAttributes,
        ...(input.extendedAttributes ?? {}),
      };

      return this.updateEntity(existing.entityId, {
        ...input,
        confidence: mergedConfidence,
        extendedAttributes: mergedExtended,
      })!;
    }

    // No duplicate — create new
    return this.createEntity({
      entityType: input.entityType,
      name: input.name,
      description: input.description ?? "",
      source: input.source ?? ("code_analysis" as EntitySource),
      confidence: input.confidence ?? 0.5,
      projectId: input.projectId,
      needsReview: input.needsReview ?? false,
      linkedMemoryIds: input.linkedMemoryIds ?? [],
      extendedAttributes: input.extendedAttributes ?? {},
    });
  }

  // -----------------------------------------------------------------------
  // 关系 CRUD (Requirement 1.4)
  // -----------------------------------------------------------------------

  createRelation(input: Omit<Relation, "relationId" | "createdAt">): Relation {
    const now = new Date().toISOString();

    const relation: Relation = {
      ...input,
      relationId: crypto.randomUUID(),
      createdAt: now,
    };

    // Determine projectId from source entity to store in the right project file
    const sourceEntity = this.getEntity(input.sourceEntityId);
    const projectId = sourceEntity?.projectId ?? "_global";
    const data = this.ensureProject(projectId);

    data.relations.push(relation);
    data._counters.relations++;
    data.lastUpdated = now;

    this.scheduleSave(projectId);

    return relation;
  }

  getRelation(relationId: string): Relation | undefined {
    for (const data of Array.from(this.dataByProject.values())) {
      const found = data.relations.find(
        (r: Relation) => r.relationId === relationId
      );
      if (found) return found;
    }
    return undefined;
  }

  findRelations(filters: RelationFilters): Relation[] {
    let results: Relation[] = [];

    if (filters.projectId) {
      const data = this.ensureProject(filters.projectId);
      results = [...data.relations];
    } else {
      // Search all projects
      for (const data of Array.from(this.dataByProject.values())) {
        results.push(...data.relations);
      }
    }

    if (filters.relationType) {
      results = results.filter(r => r.relationType === filters.relationType);
    }
    if (filters.sourceEntityId) {
      results = results.filter(
        r => r.sourceEntityId === filters.sourceEntityId
      );
    }
    if (filters.targetEntityId) {
      results = results.filter(
        r => r.targetEntityId === filters.targetEntityId
      );
    }

    return results;
  }

  updateRelation(
    relationId: string,
    updates: Partial<Relation>
  ): Relation | undefined {
    for (const [projectId, data] of Array.from(this.dataByProject.entries())) {
      const idx = data.relations.findIndex(
        (r: Relation) => r.relationId === relationId
      );
      if (idx !== -1) {
        const relation = data.relations[idx];
        const updated: Relation = {
          ...relation,
          ...updates,
          relationId: relation.relationId, // immutable
          createdAt: relation.createdAt, // immutable
        };
        data.relations[idx] = updated;
        data.lastUpdated = new Date().toISOString();

        this.scheduleSave(projectId);
        return updated;
      }
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // 去重 (Requirement 2.6)
  // -----------------------------------------------------------------------

  /**
   * deduplicateEntity — 查找并合并重复实体
   *
   * 唯一键：entityType + projectId + filePath (extendedAttributes) + name
   */
  deduplicateEntity(entity: Partial<Entity>): Entity {
    if (!entity.entityType || !entity.projectId || !entity.name) {
      throw new Error(
        "deduplicateEntity requires entityType, projectId, and name"
      );
    }
    return this.mergeEntity(
      entity as Partial<Entity> & {
        entityType: string;
        projectId: string;
        name: string;
      }
    );
  }

  // -----------------------------------------------------------------------
  // 图遍历 (Requirement 4.1)
  // -----------------------------------------------------------------------

  /**
   * getNeighbors — BFS N-hop traversal from a starting entity.
   *
   * Traverses relations bidirectionally (both as source and target).
   * Uses a visited set to prevent cycles.
   *
   * @param entityId  Starting entity ID
   * @param relationTypes  Optional filter — only traverse edges of these types
   * @param depth  Max hops (default 1)
   */
  getNeighbors(
    entityId: string,
    relationTypes?: string[],
    depth: number = 1
  ): { entities: Entity[]; relations: Relation[] } {
    const allRelations = this.collectAllRelations();
    const visited = new Set<string>();
    const resultRelations: Relation[] = [];
    const resultRelationIds = new Set<string>();

    // BFS
    let frontier = [entityId];
    visited.add(entityId);

    for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
      const nextFrontier: string[] = [];

      for (const currentId of frontier) {
        for (const rel of allRelations) {
          if (relationTypes && !relationTypes.includes(rel.relationType)) {
            continue;
          }

          let neighborId: string | null = null;
          if (rel.sourceEntityId === currentId) {
            neighborId = rel.targetEntityId;
          } else if (rel.targetEntityId === currentId) {
            neighborId = rel.sourceEntityId;
          }

          if (neighborId !== null) {
            if (!resultRelationIds.has(rel.relationId)) {
              resultRelations.push(rel);
              resultRelationIds.add(rel.relationId);
            }

            if (!visited.has(neighborId)) {
              visited.add(neighborId);
              nextFrontier.push(neighborId);
            }
          }
        }
      }

      frontier = nextFrontier;
    }

    // Resolve entity objects (exclude the starting entity itself)
    const entities: Entity[] = [];
    for (const eid of Array.from(visited)) {
      if (eid === entityId) continue;
      const entity = this.getEntity(eid);
      if (entity) entities.push(entity);
    }

    return { entities, relations: resultRelations };
  }

  /**
   * findPath — BFS shortest path between two entities.
   *
   * Traverses relations bidirectionally. Uses a visited set to prevent cycles.
   * Returns the path as entities and connecting relations, or null if no path.
   */
  findPath(
    sourceId: string,
    targetId: string
  ): { entities: Entity[]; relations: Relation[] } | null {
    if (sourceId === targetId) {
      const entity = this.getEntity(sourceId);
      return entity ? { entities: [entity], relations: [] } : null;
    }

    const allRelations = this.collectAllRelations();

    // Build adjacency: entityId → [{ neighborId, relation }]
    const adjacency = new Map<
      string,
      Array<{ neighborId: string; relation: Relation }>
    >();
    for (const rel of allRelations) {
      if (!adjacency.has(rel.sourceEntityId))
        adjacency.set(rel.sourceEntityId, []);
      if (!adjacency.has(rel.targetEntityId))
        adjacency.set(rel.targetEntityId, []);
      adjacency
        .get(rel.sourceEntityId)!
        .push({ neighborId: rel.targetEntityId, relation: rel });
      adjacency
        .get(rel.targetEntityId)!
        .push({ neighborId: rel.sourceEntityId, relation: rel });
    }

    // BFS with parent tracking
    const visited = new Set<string>();
    const parent = new Map<string, { entityId: string; relation: Relation }>();
    const queue: string[] = [sourceId];
    visited.add(sourceId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacency.get(current) ?? [];

      for (const { neighborId, relation } of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        parent.set(neighborId, { entityId: current, relation });

        if (neighborId === targetId) {
          return this.reconstructPath(sourceId, targetId, parent);
        }

        queue.push(neighborId);
      }
    }

    return null;
  }

  /**
   * getSubgraph — Given a set of entity IDs, return those entities and ALL
   * relations between them.
   */
  getSubgraph(entityIds: string[]): {
    entities: Entity[];
    relations: Relation[];
  } {
    const idSet = new Set(entityIds);
    const allRelations = this.collectAllRelations();

    const entities: Entity[] = [];
    for (const eid of Array.from(idSet)) {
      const entity = this.getEntity(eid);
      if (entity) entities.push(entity);
    }

    const relations = allRelations.filter(
      r => idSet.has(r.sourceEntityId) && idSet.has(r.targetEntityId)
    );

    return { entities, relations };
  }

  // -----------------------------------------------------------------------
  // 持久化
  // -----------------------------------------------------------------------

  /** Load graph data for a specific project from disk */
  load(projectId: string): void {
    const filePath = this.getFilePath(projectId);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data: GraphData = JSON.parse(raw);
        this.dataByProject.set(projectId, data);
      }
    } catch (e) {
      console.error(
        `[GraphStore] Failed to load graph for project ${projectId}:`,
        e
      );
      // Return empty graph on failure — don't crash
    }
  }

  /** Debounced save — schedules a write after SAVE_DEBOUNCE_MS */
  save(projectId: string): void {
    this.scheduleSave(projectId);
  }

  /** Immediate save — bypasses debounce */
  forceSave(projectId?: string): void {
    if (projectId) {
      this.clearSaveTimer(projectId);
      this.writeToDisk(projectId);
    } else {
      // Save all loaded projects
      for (const pid of Array.from(this.dataByProject.keys())) {
        this.clearSaveTimer(pid);
        this.writeToDisk(pid);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 事件
  // -----------------------------------------------------------------------

  onEntityChanged(listener: EntityChangeListener): () => void {
    this.entityChangeListeners.push(listener);
    return () => {
      const idx = this.entityChangeListeners.indexOf(listener);
      if (idx !== -1) this.entityChangeListeners.splice(idx, 1);
    };
  }

  // -----------------------------------------------------------------------
  // Accessors (for tests and downstream consumers)
  // -----------------------------------------------------------------------

  getGraphData(projectId: string): GraphData {
    return this.ensureProject(projectId);
  }

  getAllEntities(projectId: string): Entity[] {
    return this.ensureProject(projectId).entities;
  }

  getAllRelations(projectId: string): Relation[] {
    return this.ensureProject(projectId).relations;
  }

  // -----------------------------------------------------------------------
  // Graph traversal helpers
  // -----------------------------------------------------------------------

  /** Collect all relations across all loaded projects */
  private collectAllRelations(): Relation[] {
    const all: Relation[] = [];
    for (const data of Array.from(this.dataByProject.values())) {
      all.push(...data.relations);
    }
    return all;
  }

  /** Reconstruct BFS shortest path from parent map */
  private reconstructPath(
    sourceId: string,
    targetId: string,
    parent: Map<string, { entityId: string; relation: Relation }>
  ): { entities: Entity[]; relations: Relation[] } {
    const pathEntityIds: string[] = [];
    const pathRelations: Relation[] = [];

    let current = targetId;
    while (current !== sourceId) {
      pathEntityIds.push(current);
      const p = parent.get(current)!;
      pathRelations.push(p.relation);
      current = p.entityId;
    }
    pathEntityIds.push(sourceId);

    pathEntityIds.reverse();
    pathRelations.reverse();

    const entities: Entity[] = [];
    for (const eid of pathEntityIds) {
      const entity = this.getEntity(eid);
      if (entity) entities.push(entity);
    }

    return { entities, relations: pathRelations };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private ensureProject(projectId: string): GraphData {
    if (!this.dataByProject.has(projectId)) {
      // Try loading from disk first
      this.load(projectId);

      // If still not loaded, create empty
      if (!this.dataByProject.has(projectId)) {
        const empty: GraphData = {
          version: 1,
          projectId,
          lastUpdated: new Date().toISOString(),
          entities: [],
          relations: [],
          _counters: { entities: 0, relations: 0 },
        };
        this.dataByProject.set(projectId, empty);
      }
    }
    return this.dataByProject.get(projectId)!;
  }

  /**
   * Find duplicate entity by unique key:
   * entityType + projectId + filePath (from extendedAttributes) + name
   */
  private findDuplicate(
    input: Partial<Entity> & {
      entityType: string;
      projectId: string;
      name: string;
    }
  ): Entity | undefined {
    const data = this.ensureProject(input.projectId);
    const inputFilePath = (input.extendedAttributes as Record<string, unknown>)
      ?.filePath as string | undefined;

    return data.entities.find(e => {
      if (
        e.entityType !== input.entityType ||
        e.projectId !== input.projectId ||
        e.name !== input.name
      ) {
        return false;
      }
      // Match filePath from extendedAttributes if present
      const existingFilePath = (e.extendedAttributes as Record<string, unknown>)
        ?.filePath as string | undefined;
      if (inputFilePath || existingFilePath) {
        return existingFilePath === inputFilePath;
      }
      return true;
    });
  }

  private getFilePath(projectId: string): string {
    return path.join(DATA_DIR, `graph-${projectId}.json`);
  }

  private scheduleSave(projectId: string): void {
    this.clearSaveTimer(projectId);
    const timer = setTimeout(() => {
      this.saveTimers.delete(projectId);
      this.writeToDisk(projectId);
    }, SAVE_DEBOUNCE_MS);
    this.saveTimers.set(projectId, timer);
  }

  private clearSaveTimer(projectId: string): void {
    const existing = this.saveTimers.get(projectId);
    if (existing) {
      clearTimeout(existing);
      this.saveTimers.delete(projectId);
    }
  }

  private writeToDisk(projectId: string): void {
    const data = this.dataByProject.get(projectId);
    if (!data) return;

    const filePath = this.getFilePath(projectId);
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.error(
        `[GraphStore] Failed to save graph for project ${projectId}:`,
        e
      );
    }
  }

  private notifyEntityChanged(
    entity: Entity,
    action: EntityChangeAction
  ): void {
    for (const listener of this.entityChangeListeners) {
      try {
        listener(entity, action);
      } catch (e) {
        console.error("[GraphStore] Entity change listener error:", e);
      }
    }
  }
}
