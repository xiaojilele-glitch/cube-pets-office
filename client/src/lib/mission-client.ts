import {
  type CancelMissionRequest,
  type CancelMissionResponse,
  MISSION_API_ROUTES,
  type CreateMissionRequest,
  type CreateMissionResponse,
  type GetMissionPlanetResponse,
  type GetMissionPlanetInteriorResponse,
  type GetMissionResponse,
  type ListMissionEventsResponse,
  type ListMissionPlanetsResponse,
  type ListMissionsResponse,
  type SubmitMissionOperatorActionRequest,
  type SubmitMissionOperatorActionResponse,
  type SubmitMissionDecisionRequest,
  type SubmitMissionDecisionResponse,
} from "@shared/mission/api";

import { fetchJsonSafe, type ApiRequestError } from "./api-client";

export class MissionApiError extends Error {
  requestError: ApiRequestError;

  constructor(requestError: ApiRequestError) {
    super(requestError.message);
    this.name = "MissionApiError";
    this.requestError = requestError;
  }
}

function withQuery(
  path: string,
  query?: Record<string, string | number | null | undefined>
) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function routeFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((resolved, [key, value]) => {
    return resolved.replace(`:${key}`, encodeURIComponent(value));
  }, path);
}

export function getMissionApiError(error: unknown): ApiRequestError | null {
  return error instanceof MissionApiError ? error.requestError : null;
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const result = await fetchJsonSafe<T>(input, init);
  if (!result.ok) {
    throw new MissionApiError(result.error);
  }

  return result.data;
}

export async function listMissions(limit = 200): Promise<ListMissionsResponse> {
  return requestJson<ListMissionsResponse>(
    withQuery(MISSION_API_ROUTES.listTasks, { limit })
  );
}

export async function getMission(id: string): Promise<GetMissionResponse> {
  return requestJson<GetMissionResponse>(
    routeFor(MISSION_API_ROUTES.getTask, { id })
  );
}

export async function cancelMission(
  id: string,
  request: CancelMissionRequest
): Promise<CancelMissionResponse> {
  return requestJson<CancelMissionResponse>(
    routeFor(MISSION_API_ROUTES.cancelTask, { id }),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
}

export async function submitMissionOperatorAction(
  id: string,
  request: SubmitMissionOperatorActionRequest
): Promise<SubmitMissionOperatorActionResponse> {
  return requestJson<SubmitMissionOperatorActionResponse>(
    routeFor(MISSION_API_ROUTES.submitTaskOperatorAction, { id }),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
}

export async function listMissionEvents(
  id: string,
  limit = 40
): Promise<ListMissionEventsResponse> {
  return requestJson<ListMissionEventsResponse>(
    withQuery(routeFor(MISSION_API_ROUTES.listTaskEvents, { id }), { limit })
  );
}

export async function createMission(
  request: CreateMissionRequest
): Promise<CreateMissionResponse> {
  return requestJson<CreateMissionResponse>(MISSION_API_ROUTES.createTask, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

export async function submitMissionDecision(
  id: string,
  request: SubmitMissionDecisionRequest
): Promise<SubmitMissionDecisionResponse> {
  return requestJson<SubmitMissionDecisionResponse>(
    routeFor(MISSION_API_ROUTES.submitTaskDecision, { id }),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
}

export async function listPlanets(
  limit = 200
): Promise<ListMissionPlanetsResponse> {
  return requestJson<ListMissionPlanetsResponse>(
    withQuery(MISSION_API_ROUTES.listPlanets, { limit })
  );
}

export async function getPlanet(id: string): Promise<GetMissionPlanetResponse> {
  return requestJson<GetMissionPlanetResponse>(
    routeFor(MISSION_API_ROUTES.getPlanet, { id })
  );
}

export async function getPlanetInterior(
  id: string
): Promise<GetMissionPlanetInteriorResponse> {
  return requestJson<GetMissionPlanetInteriorResponse>(
    routeFor(MISSION_API_ROUTES.getPlanetInterior, { id })
  );
}
