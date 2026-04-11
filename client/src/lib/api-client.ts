import { useAppStore } from "./store";

export type ApiErrorKind = "demo" | "offline" | "error";
export type ApiErrorSource =
  | "network"
  | "http"
  | "html-fallback"
  | "non-json"
  | "parse"
  | "storage";

export interface ApiRequestError {
  kind: ApiErrorKind;
  source: ApiErrorSource;
  endpoint: string;
  message: string;
  detail: string;
  retryable: boolean;
  status?: number;
}

export type FetchJsonSafeResult<T> =
  | { ok: true; data: T; response: Response }
  | { ok: false; error: ApiRequestError; response?: Response };

function getEndpoint(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function getFallbackKind(): ApiErrorKind {
  return useAppStore.getState().runtimeMode === "frontend" ? "demo" : "offline";
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.startsWith("<body")
  );
}

function extractErrorDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.error,
    record.message,
    record.detail,
    typeof record.result === "object" && record.result
      ? (record.result as Record<string, unknown>).message
      : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function createApiError(
  endpoint: string,
  config: Omit<ApiRequestError, "endpoint">
): ApiRequestError {
  return {
    endpoint,
    ...config,
  };
}

export function isDemoModeFallback(
  error: ApiRequestError | null | undefined
): boolean {
  return error?.kind === "demo";
}

export function isOfflineApiError(
  error: ApiRequestError | null | undefined
): boolean {
  return error?.kind === "offline";
}

export async function fetchJsonSafe<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<FetchJsonSafeResult<T>> {
  const endpoint = getEndpoint(input);

  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    const fallbackKind = getFallbackKind();
    return {
      ok: false,
      error: createApiError(endpoint, {
        kind: fallbackKind,
        source: "network",
        message:
          fallbackKind === "demo"
            ? "The app is using local demo data because the API is unavailable."
            : "The API is currently unreachable.",
        detail:
          fallbackKind === "demo"
            ? "Switch to advanced mode after the server is ready, or keep browsing with local preview data."
            : "Check whether the backend service is running, then retry this request.",
        retryable: true,
      }),
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const rawText = await response.text();

  if (looksLikeHtml(rawText) || contentType.includes("text/html")) {
    const fallbackKind = getFallbackKind();
    return {
      ok: false,
      response,
      error: createApiError(endpoint, {
        kind: fallbackKind,
        source: "html-fallback",
        status: response.status,
        message:
          fallbackKind === "demo"
            ? "The browser preview is active because the API returned an HTML fallback page."
            : "The API returned an HTML fallback page instead of JSON.",
        detail:
          fallbackKind === "demo"
            ? "This usually means the frontend is running without the backend service."
            : "Start the backend service or restore the API proxy, then retry.",
        retryable: true,
      }),
    };
  }

  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      response,
      error: createApiError(endpoint, {
        kind: "error",
        source: "non-json",
        status: response.status,
        message: "The API did not return JSON data.",
        detail:
          "The response format was not recognized, so the UI kept the raw parser error hidden.",
        retryable: response.status >= 500 || response.status === 0,
      }),
    };
  }

  let payload: T;
  try {
    payload = rawText ? (JSON.parse(rawText) as T) : (null as T);
  } catch {
    return {
      ok: false,
      response,
      error: createApiError(endpoint, {
        kind: "error",
        source: "parse",
        status: response.status,
        message: "The API response could not be parsed.",
        detail:
          "The UI suppressed the raw JSON parse error and treated this as a structured request failure.",
        retryable: response.status >= 500 || response.status === 0,
      }),
    };
  }

  if (!response.ok) {
    const fallbackKind =
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504
        ? getFallbackKind()
        : "error";

    return {
      ok: false,
      response,
      error: createApiError(endpoint, {
        kind: fallbackKind,
        source: "http",
        status: response.status,
        message:
          extractErrorDetail(payload) ??
          (fallbackKind === "error"
            ? `Request failed with status ${response.status}.`
            : "The backend service is not ready yet."),
        detail:
          fallbackKind === "error"
            ? "The request completed, but the server reported an application error."
            : "Retry after the backend becomes available, or switch back to local preview mode.",
        retryable: response.status >= 500 || response.status === 429,
      }),
    };
  }

  return { ok: true, data: payload, response };
}
