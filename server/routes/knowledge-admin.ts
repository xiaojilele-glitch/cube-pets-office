/**
 * 知识图谱运维 API 路由
 *
 * GET  /api/admin/knowledge/stats            → 图谱统计
 * POST /api/admin/knowledge/reindex          → 触发向量索引重建
 * GET  /api/admin/knowledge/reindex/:taskId  → 查询重建进度
 * GET  /api/admin/knowledge/export           → 导出项目图谱
 *
 * Requirements: 8.2, 8.3, 8.4, 8.5
 */

import { Router } from "express";
import { randomUUID } from "crypto";

import { KNOWLEDGE_API } from "../../shared/knowledge/api.js";
import type {
  GetKnowledgeStatsResponse,
  PostReindexResponse,
  GetReindexStatusResponse,
  GetKnowledgeExportResponse,
  ProjectStats,
  EntityTypeCount,
  StatusDistribution,
  DailyTrend,
  KnowledgeApiErrorResponse,
} from "../../shared/knowledge/api.js";
import type {
  Entity,
  Relation,
  EntityStatus,
} from "../../shared/knowledge/types.js";
import type { GraphStore } from "../knowledge/graph-store.js";
import type { OntologyRegistry } from "../knowledge/ontology-registry.js";
import type { KnowledgeReviewQueue } from "../knowledge/review-queue.js";

// ---------------------------------------------------------------------------
// Reindex task tracking (in-memory, placeholder)
// ---------------------------------------------------------------------------

interface ReindexTask {
  taskId: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

const reindexTasks = new Map<string, ReindexTask>();

// ---------------------------------------------------------------------------
// Helper: collect all entities / relations across projects
// ---------------------------------------------------------------------------

function collectAllEntities(graphStore: GraphStore): Entity[] {
  const dataByProject = (graphStore as any).dataByProject as
    | Map<string, { entities: Entity[] }>
    | undefined;
  if (!dataByProject) return [];
  const all: Entity[] = [];
  for (const data of Array.from(dataByProject.values())) {
    all.push(...data.entities);
  }
  return all;
}

function collectAllRelations(graphStore: GraphStore): Relation[] {
  const dataByProject = (graphStore as any).dataByProject as
    | Map<string, { relations: Relation[] }>
    | undefined;
  if (!dataByProject) return [];
  const all: Relation[] = [];
  for (const data of Array.from(dataByProject.values())) {
    all.push(...data.relations);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Route prefix — strip the common prefix so we can mount at /api/admin/knowledge
// ---------------------------------------------------------------------------

const PREFIX = "/api/admin/knowledge";

function stripPrefix(route: string): string {
  return route.startsWith(PREFIX) ? route.slice(PREFIX.length) || "/" : route;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createKnowledgeAdminRouter(deps: {
  graphStore: GraphStore;
  ontologyRegistry: OntologyRegistry;
  reviewQueue: KnowledgeReviewQueue;
}): Router {
  const { graphStore, ontologyRegistry } = deps;
  const router = Router();

  // -----------------------------------------------------------------------
  // GET /api/admin/knowledge/stats — Req 8.2
  // -----------------------------------------------------------------------
  router.get(stripPrefix(KNOWLEDGE_API.stats), (_req, res) => {
    try {
      const entities = collectAllEntities(graphStore);
      const relations = collectAllRelations(graphStore);

      // By project
      const projectMap = new Map<
        string,
        { entities: number; relations: number }
      >();
      for (const e of entities) {
        const p = projectMap.get(e.projectId) ?? { entities: 0, relations: 0 };
        p.entities++;
        projectMap.set(e.projectId, p);
      }
      for (const r of relations) {
        // Find the project from source entity
        const srcEntity = entities.find(e => e.entityId === r.sourceEntityId);
        if (srcEntity) {
          const p = projectMap.get(srcEntity.projectId) ?? {
            entities: 0,
            relations: 0,
          };
          p.relations++;
          projectMap.set(srcEntity.projectId, p);
        }
      }
      const byProject: ProjectStats[] = Array.from(projectMap.entries()).map(
        ([projectId, counts]) => ({
          projectId,
          entityCount: counts.entities,
          relationCount: counts.relations,
        })
      );

      // By entity type
      const typeMap = new Map<string, number>();
      for (const e of entities) {
        typeMap.set(e.entityType, (typeMap.get(e.entityType) ?? 0) + 1);
      }
      const byEntityType: EntityTypeCount[] = Array.from(typeMap.entries()).map(
        ([entityType, count]) => ({ entityType, count })
      );

      // Status distribution
      const statusMap = new Map<EntityStatus, number>();
      for (const e of entities) {
        statusMap.set(e.status, (statusMap.get(e.status) ?? 0) + 1);
      }
      const statusDistribution: StatusDistribution[] = Array.from(
        statusMap.entries()
      ).map(([status, count]) => ({ status, count }));

      // Average confidence
      const averageConfidence =
        entities.length > 0
          ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
          : 0;

      // 7-day trends (simplified: count entities/relations created per day)
      const now = new Date();
      const trends: DailyTrend[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = new Date(now);
        day.setDate(day.getDate() - i);
        const dateStr = day.toISOString().slice(0, 10);
        const entitiesCreated = entities.filter(
          e => e.createdAt.slice(0, 10) === dateStr
        ).length;
        const relationsCreated = relations.filter(
          r => r.createdAt.slice(0, 10) === dateStr
        ).length;
        trends.push({ date: dateStr, entitiesCreated, relationsCreated });
      }

      const response: GetKnowledgeStatsResponse = {
        ok: true,
        stats: {
          totalEntities: entities.length,
          totalRelations: relations.length,
          byProject,
          byEntityType,
          statusDistribution,
          averageConfidence: Math.round(averageConfidence * 1000) / 1000,
          trends,
        },
      };

      res.json(response);
    } catch (err) {
      const errResp: KnowledgeApiErrorResponse = {
        error: err instanceof Error ? err.message : "Unknown error",
      };
      res.status(500).json(errResp);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/admin/knowledge/reindex — Req 8.3
  // -----------------------------------------------------------------------
  router.post(stripPrefix(KNOWLEDGE_API.reindex), (_req, res) => {
    try {
      const taskId = randomUUID();
      const task: ReindexTask = {
        taskId,
        status: "completed",
        progress: 100,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      reindexTasks.set(taskId, task);

      const response: PostReindexResponse = { ok: true, taskId };
      res.json(response);
    } catch (err) {
      const errResp: KnowledgeApiErrorResponse = {
        error: err instanceof Error ? err.message : "Unknown error",
      };
      res.status(500).json(errResp);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/admin/knowledge/reindex/:taskId — Req 8.3
  // -----------------------------------------------------------------------
  router.get(stripPrefix(KNOWLEDGE_API.reindexStatus), (req, res) => {
    const { taskId } = req.params;
    const task = reindexTasks.get(taskId);

    if (!task) {
      const errResp: KnowledgeApiErrorResponse = {
        error: `Task not found: ${taskId}`,
      };
      return res.status(404).json(errResp);
    }

    const response: GetReindexStatusResponse = {
      ok: true,
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      error: task.error,
    };
    res.json(response);
  });

  // -----------------------------------------------------------------------
  // GET /api/admin/knowledge/export — Req 8.5
  // -----------------------------------------------------------------------
  router.get(stripPrefix(KNOWLEDGE_API.export), (req, res) => {
    try {
      const projectId = req.query.projectId as string | undefined;

      if (!projectId) {
        const errResp: KnowledgeApiErrorResponse = {
          error: "Query parameter 'projectId' is required",
        };
        return res.status(400).json(errResp);
      }

      // Load project data (ensures it's in memory)
      graphStore.load(projectId);

      const entities = graphStore.getAllEntities(projectId);
      const relations = graphStore.getAllRelations(projectId);

      const response: GetKnowledgeExportResponse = {
        ok: true,
        projectId,
        exportedAt: new Date().toISOString(),
        ontology: {
          entityTypes: ontologyRegistry.getEntityTypes(),
          relationTypes: ontologyRegistry.getRelationTypes(),
        },
        entities,
        relations,
      };

      res.json(response);
    } catch (err) {
      const errResp: KnowledgeApiErrorResponse = {
        error: err instanceof Error ? err.message : "Unknown error",
      };
      res.status(500).json(errResp);
    }
  });

  return router;
}
