import { resolve } from "node:path";
import type { LobsterExecutorConfig } from "./types.js";

function parsePort(rawPort: string | undefined, fallback: number): number {
  if (!rawPort) return fallback;
  const parsed = Number.parseInt(rawPort, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readLobsterExecutorConfig(
  env: NodeJS.ProcessEnv = process.env
): LobsterExecutorConfig {
  return {
    host: env.LOBSTER_EXECUTOR_HOST || "0.0.0.0",
    port: parsePort(env.LOBSTER_EXECUTOR_PORT, 3031),
    dataRoot: resolve(env.LOBSTER_EXECUTOR_DATA_ROOT || "tmp/lobster-executor"),
    serviceName: env.LOBSTER_EXECUTOR_NAME || "lobster-executor",
  };
}
