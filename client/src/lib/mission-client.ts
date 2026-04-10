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

function withQuery(path: string, query?: Record<string, string | number | null | undefined>) {
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

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    const error =
      typeof data?.error === "string" ? data.error : `Mission API ${response.status}`;
    throw new Error(error);
  }
  return data as T;
}

export async function listMissions(limit = 200): Promise<ListMissionsResponse> {
  const response = await fetch(
    withQuery(MISSION_API_ROUTES.listTasks, { limit })
  );
  return parseJson<ListMissionsResponse>(response);
}

export async function getMission(id: string): Promise<GetMissionResponse> {
  const response = await fetch(routeFor(MISSION_API_ROUTES.getTask, { id }));
  return parseJson<GetMissionResponse>(response);
}

export async function cancelMission(
  id: string,
  request: CancelMissionRequest
): Promise<CancelMissionResponse> {
  const response = await fetch(routeFor(MISSION_API_ROUTES.cancelTask, { id }), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return parseJson<CancelMissionResponse>(response);
}

export async function submitMissionOperatorAction(
  id: string,
  request: SubmitMissionOperatorActionRequest
): Promise<SubmitMissionOperatorActionResponse> {
  const response = await fetch(
    routeFor(MISSION_API_ROUTES.submitTaskOperatorAction, { id }),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  return parseJson<SubmitMissionOperatorActionResponse>(response);
}

export async function listMissionEvents(
  id: string,
  limit = 40
): Promise<ListMissionEventsResponse> {
  const response = await fetch(
    withQuery(routeFor(MISSION_API_ROUTES.listTaskEvents, { id }), { limit })
  );
  return parseJson<ListMissionEventsResponse>(response);
}

export async function createMission(
  request: CreateMissionRequest
): Promise<CreateMissionResponse> {
  const response = await fetch(MISSION_API_ROUTES.createTask, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return parseJson<CreateMissionResponse>(response);
}

export async function submitMissionDecision(
  id: string,
  request: SubmitMissionDecisionRequest
): Promise<SubmitMissionDecisionResponse> {
  const response = await fetch(routeFor(MISSION_API_ROUTES.submitTaskDecision, { id }), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return parseJson<SubmitMissionDecisionResponse>(response);
}

export async function listPlanets(limit = 200): Promise<ListMissionPlanetsResponse> {
  const response = await fetch(
    withQuery(MISSION_API_ROUTES.listPlanets, { limit })
  );
  return parseJson<ListMissionPlanetsResponse>(response);
}

export async function getPlanet(id: string): Promise<GetMissionPlanetResponse> {
  const response = await fetch(routeFor(MISSION_API_ROUTES.getPlanet, { id }));
  return parseJson<GetMissionPlanetResponse>(response);
}

export async function getPlanetInterior(id: string): Promise<GetMissionPlanetInteriorResponse> {
  const response = await fetch(routeFor(MISSION_API_ROUTES.getPlanetInterior, { id }));
  return parseJson<GetMissionPlanetInteriorResponse>(response);
}
