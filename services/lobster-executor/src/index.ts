import { createServer } from "node:http";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import Dockerode from "dockerode";
import { createLobsterExecutorApp } from "./app.js";
import { parseDockerHost, readLobsterExecutorConfig } from "./config.js";
import { createLobsterExecutorService } from "./service.js";
import type { LobsterExecutorConfig } from "./types.js";

dotenv.config();

export function resolveEffectiveExecutionMode(
  requestedMode: LobsterExecutorConfig["executionMode"],
  dockerAvailable: boolean,
): LobsterExecutorConfig["executionMode"] {
  if (requestedMode !== "real") return requestedMode;
  return dockerAvailable ? "real" : "native";
}

export async function startLobsterExecutorServer(): Promise<void> {
  const config = readLobsterExecutorConfig();
  let dockerAvailable = true;
  let effectiveConfig = config;

  if (config.executionMode === "real") {
    const docker = new Dockerode(parseDockerHost(config.dockerHost));
    try {
      await docker.ping();
      console.log("[lobster-executor] Docker daemon connected");
    } catch (err) {
      dockerAvailable = false;
      console.warn(
        `[lobster-executor] Docker daemon is not available at "${config.dockerHost}". Falling back to native execution.`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const effectiveMode = resolveEffectiveExecutionMode(
    config.executionMode,
    dockerAvailable,
  );
  if (effectiveMode !== config.executionMode) {
    effectiveConfig = { ...config, executionMode: effectiveMode };
  }

  const service = createLobsterExecutorService({
    dataRoot: effectiveConfig.dataRoot,
    config: effectiveConfig,
  });
  const app = createLobsterExecutorApp(service);
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(effectiveConfig.port, effectiveConfig.host, () => {
      console.log(
        `[lobster-executor] listening on http://${effectiveConfig.host}:${effectiveConfig.port}`,
      );
      console.log(
        `[lobster-executor] health: http://${effectiveConfig.host}:${effectiveConfig.port}/health`,
      );
      resolve();
    });
  });
}

const isMain = process.argv.slice(1).some((arg) => {
  if (!arg) return false;
  try {
    return pathToFileURL(resolvePath(arg)).href === import.meta.url;
  } catch {
    return false;
  }
});
if (isMain) {
  startLobsterExecutorServer().catch((error) => {
    console.error("[lobster-executor] failed to start", error);
    process.exitCode = 1;
  });
}
