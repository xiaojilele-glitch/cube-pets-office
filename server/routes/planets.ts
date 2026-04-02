import { Router } from 'express';

import type {
  MissionRecord,
  MissionPlanetOverviewItem,
  MissionPlanetEdge,
  MissionStage,
  MissionPlanetInteriorStage,
  MissionPlanetInteriorAgent,
  MissionAgentStatus,
  MissionWorkPackage,
} from '../../shared/mission/contracts.js';
import {
  missionRuntime,
  type MissionRuntime,
} from '../tasks/mission-runtime.js';

/* ─── Conversion: MissionRecord → MissionPlanetOverviewItem ─── */

const BASE_RADIUS = 30;
const RADIUS_PER_STAGE = 5;

export function missionToPlanetOverview(
  mission: MissionRecord,
): MissionPlanetOverviewItem {
  const stageCount = mission.stages.length;

  return {
    id: mission.id,
    title: mission.title,
    sourceText: mission.sourceText,
    summary: mission.summary,
    kind: mission.kind,
    status: mission.status,
    progress: mission.progress,
    complexity: stageCount,
    radius: BASE_RADIUS + stageCount * RADIUS_PER_STAGE,
    position: { x: 0, y: 0 },
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    completedAt: mission.completedAt,
    currentStageKey: mission.currentStageKey,
    currentStageLabel: mission.stages.find(
      (s) => s.key === mission.currentStageKey,
    )?.label,
    waitingFor: mission.waitingFor,
    taskUrl: `/tasks/${mission.id}`,
    tags: mission.organization?.departments.map((d) => d.label) ?? [],
  };
}

/* ─── Conversion: MissionStage[] → MissionPlanetInteriorStage[] ─── */

export function buildPlanetInteriorStages(
  stages: MissionStage[],
): MissionPlanetInteriorStage[] {
  const count = stages.length;
  if (count === 0) return [];
  const arcSize = 360 / count;
  return stages.map((stage, index) => {
    const arcStart = index * arcSize;
    const arcEnd = arcStart + arcSize;
    return {
      key: stage.key,
      label: stage.label,
      status: stage.status,
      progress: stage.status === 'done' ? 100 : stage.status === 'running' ? 50 : 0,
      detail: stage.detail,
      startedAt: stage.startedAt,
      completedAt: stage.completedAt,
      arcStart,
      arcEnd,
      midAngle: (arcStart + arcEnd) / 2,
    };
  });
}

/* ─── Agent Status Inference Helpers ─── */

function inferAgentStatus(
  wpStatus: MissionWorkPackage['status'],
): MissionAgentStatus {
  switch (wpStatus) {
    case 'running':
      return 'working';
    case 'pending':
      return 'idle';
    case 'passed':
    case 'verified':
      return 'done';
    case 'failed':
      return 'error';
    default:
      return 'idle';
  }
}

function inferCoreAgentStatus(
  missionStatus: MissionRecord['status'],
): MissionAgentStatus {
  switch (missionStatus) {
    case 'running':
      return 'thinking';
    case 'done':
      return 'done';
    case 'failed':
      return 'error';
    default:
      return 'idle';
  }
}

/* ─── Agent Angle Distribution ─── */

function withAgentAngles(
  agents: MissionPlanetInteriorAgent[],
  stages: MissionPlanetInteriorStage[],
): MissionPlanetInteriorAgent[] {
  const stageMap = new Map(stages.map((s) => [s.key, s]));
  const grouped = new Map<string, MissionPlanetInteriorAgent[]>();

  for (const agent of agents) {
    const list = grouped.get(agent.stageKey) ?? [];
    list.push(agent);
    grouped.set(agent.stageKey, list);
  }

  for (const [stageKey, stageAgents] of Array.from(grouped.entries())) {
    const stage = stageMap.get(stageKey);
    if (!stage) continue;
    const step = (stage.arcEnd - stage.arcStart) / (stageAgents.length + 1);
    stageAgents.forEach((agent: MissionPlanetInteriorAgent, i: number) => {
      agent.angle = (stage.arcStart + step * (i + 1)) % 360;
    });
  }

  return agents;
}

/* ─── Conversion: MissionRecord → MissionPlanetInteriorAgent[] ─── */

export function buildPlanetInteriorAgents(
  mission: MissionRecord,
  interiorStages: MissionPlanetInteriorStage[],
): MissionPlanetInteriorAgent[] {
  const agents: MissionPlanetInteriorAgent[] = [];

  // Infer worker agents from workPackages
  if (mission.workPackages) {
    const assignees = new Map<string, MissionWorkPackage[]>();
    for (const wp of mission.workPackages) {
      if (!wp.assignee) continue;
      const list = assignees.get(wp.assignee) ?? [];
      list.push(wp);
      assignees.set(wp.assignee, list);
    }
    for (const [name, packages] of Array.from(assignees.entries())) {
      const activePackage: MissionWorkPackage =
        packages.find((p: MissionWorkPackage) => p.status === 'running') ?? packages[0];
      const stage = interiorStages.find(
        (s) => s.key === activePackage.stageKey,
      );
      agents.push({
        id: name,
        name,
        role: 'worker',
        sprite: 'cube-worker',
        status: inferAgentStatus(activePackage.status),
        stageKey: activePackage.stageKey ?? 'execute',
        stageLabel: stage?.label ?? activePackage.stageKey ?? 'Execute',
        progress: activePackage.score,
        currentAction: activePackage.deliverable,
        angle: 0,
      });
    }
  }

  // Always include mission-core orchestrator agent
  const coreStageKey = mission.currentStageKey ?? 'receive';
  agents.push({
    id: 'mission-core',
    name: 'Mission Core',
    role: 'orchestrator',
    sprite: 'cube-brain',
    status: inferCoreAgentStatus(mission.status),
    stageKey: coreStageKey,
    stageLabel:
      interiorStages.find((s) => s.key === coreStageKey)?.label ?? 'Receive',
    angle: 0,
  });

  return withAgentAngles(agents, interiorStages);
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

function parseLimit(rawValue: unknown): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
}

/* ─── Router (endpoints added in tasks 3.1–3.4) ─── */

export function createPlanetRouter(
  _runtime: MissionRuntime = missionRuntime,
): Router {
  const router = Router();

  // GET /api/planets — list all missions as planet overviews
  router.get('/', (req, res) => {
    try {
      const limit = parseLimit(req.query.limit);
      const missions = _runtime.listTasks(limit);
      const planets = missions.map(missionToPlanetOverview);
      const edges: MissionPlanetEdge[] = [];

      res.json({
        ok: true,
        planets,
        edges,
      });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/planets/:id/interior — planet interior data (stages, agents, events)
  router.get('/:id/interior', (req, res) => {
    try {
      const mission = _runtime.getTask(req.params.id);
      if (!mission) {
        res.status(404).json({ error: 'Planet not found' });
        return;
      }

      const planet = missionToPlanetOverview(mission);
      const stages = buildPlanetInteriorStages(mission.stages);
      const agents = buildPlanetInteriorAgents(mission, stages);
      const events = _runtime.listTaskEvents(mission.id);

      res.json({
        ok: true,
        planet,
        interior: {
          stages,
          agents,
          events,
          summary: mission.summary,
          waitingFor: mission.waitingFor,
        },
      });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/planets/:id — single mission as planet overview
  router.get('/:id', (req, res) => {
    try {
      const mission = _runtime.getTask(req.params.id);
      if (!mission) {
        res.status(404).json({ error: 'Planet not found' });
        return;
      }
      const planet = missionToPlanetOverview(mission);
      res.json({ ok: true, planet, task: mission });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

export default createPlanetRouter();
