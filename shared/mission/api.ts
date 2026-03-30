import type {
  MissionEvent,
  MissionDecisionResolved,
  MissionDecisionSubmission,
  MissionPlanetEdge,
  MissionPlanetEdgeType,
  MissionPlanetInteriorData,
  MissionPlanetOverviewItem,
  MissionRecord,
} from "./contracts.js";

export const MISSION_API_ROUTES = {
  createTask: "/api/tasks",
  listTasks: "/api/tasks",
  getTask: "/api/tasks/:id",
  listTaskEvents: "/api/tasks/:id/events",
  submitTaskDecision: "/api/tasks/:id/decision",
  listPlanets: "/api/planets",
  getPlanet: "/api/planets/:id",
  getPlanetInterior: "/api/planets/:id/interior",
  createPlanetEdge: "/api/planets/edges",
  updatePlanetEdge: "/api/planets/edges/:fromId/:toId",
  deletePlanetEdge: "/api/planets/edges/:fromId/:toId",
} as const;

export interface MissionApiErrorResponse {
  ok?: false;
  error: string;
}

export interface ListMissionsQuery {
  limit?: number;
}

export interface ListMissionsResponse {
  ok: true;
  tasks: MissionRecord[];
}

export interface CreateMissionRequest {
  kind?: string;
  title?: string;
  sourceText?: string;
  topicId?: string;
}

export interface CreateMissionResponse {
  ok: true;
  task: MissionRecord;
}

export interface GetMissionResponse {
  ok: true;
  task: MissionRecord;
}

export interface ListMissionEventsQuery {
  limit?: number;
}

export interface ListMissionEventsResponse {
  ok: true;
  missionId: string;
  events: MissionEvent[];
}

export type SubmitMissionDecisionRequest = MissionDecisionSubmission;

export interface SubmitMissionDecisionResponse {
  ok: true;
  alreadyResolved?: boolean;
  detail: string;
  decision: MissionDecisionResolved;
  task: MissionRecord;
}

export interface ListMissionPlanetsQuery {
  limit?: number;
}

export interface ListMissionPlanetsResponse {
  ok: true;
  planets: MissionPlanetOverviewItem[];
  edges: MissionPlanetEdge[];
}

export interface GetMissionPlanetResponse {
  ok: true;
  planet: MissionPlanetOverviewItem;
  task: MissionRecord;
}

export interface GetMissionPlanetInteriorResponse {
  ok: true;
  planet: MissionPlanetOverviewItem;
  interior: MissionPlanetInteriorData;
}

export interface UpsertMissionPlanetEdgeRequest {
  from: string;
  to: string;
  type?: MissionPlanetEdgeType;
  reason?: string;
}

export interface UpdateMissionPlanetEdgeRequest {
  type?: MissionPlanetEdgeType;
  reason?: string;
}

export interface UpsertMissionPlanetEdgeResponse {
  ok: true;
  edge: MissionPlanetEdge;
}

export interface DeleteMissionPlanetEdgeResponse {
  ok: true;
}
