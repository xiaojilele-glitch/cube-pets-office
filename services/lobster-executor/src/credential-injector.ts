/**
 * Credential Injector — resolves, validates, and formats AI credentials
 * for injection into Docker container environment variables.
 *
 * Priority: payload.llmConfig > host environment variables (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL)
 * Output:   AI_API_KEY, AI_BASE_URL, AI_MODEL (AI_ prefix to avoid host collision)
 */

export interface AICredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class CredentialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialValidationError";
  }
}

/**
 * Resolve AI credentials from Job payload and/or host env.
 * payload.llmConfig values take precedence over host env vars.
 */
export function resolveAICredentials(
  payload: Record<string, unknown>,
  hostEnv?: Record<string, string | undefined>
): AICredentials {
  const env = hostEnv ?? {};
  const llmConfig = (payload.llmConfig ?? {}) as Record<string, unknown>;

  return {
    apiKey:
      (typeof llmConfig.apiKey === "string" && llmConfig.apiKey) ||
      env.LLM_API_KEY ||
      "",
    baseUrl:
      (typeof llmConfig.baseUrl === "string" && llmConfig.baseUrl) ||
      env.LLM_BASE_URL ||
      "",
    model:
      (typeof llmConfig.model === "string" && llmConfig.model) ||
      env.LLM_MODEL ||
      "",
  };
}

/**
 * Convert AICredentials into container env var array with AI_ prefix.
 */
export function buildAIEnvVars(creds: AICredentials): string[] {
  return [
    `AI_API_KEY=${creds.apiKey}`,
    `AI_BASE_URL=${creds.baseUrl}`,
    `AI_MODEL=${creds.model}`,
    `AI_WIRE_API=${process.env.LLM_WIRE_API || "chat"}`,
  ];
}

/**
 * Validate credentials — apiKey must be non-empty and length > 8.
 * Throws CredentialValidationError on failure.
 */
export function validateCredentials(creds: AICredentials): void {
  if (!creds.apiKey || creds.apiKey.length <= 8) {
    throw new CredentialValidationError(
      "API Key must be non-empty and longer than 8 characters"
    );
  }
}
