import { createServer } from "node:http";
import dotenv from "dotenv";
import Dockerode from "dockerode";
import { createLobsterExecutorApp } from "./app.js";
import { readLobsterExecutorConfig } from "./config.js";
import { createLobsterExecutorService } from "./service.js";

dotenv.config();

/**
 * Parse a DOCKER_HOST value into Dockerode connection options.
 * Supports: unix socket paths, npipe, tcp:// URLs.
 */
function parseDockerHost(dockerHost: string | undefined): Dockerode.DockerOptions {
  if (!dockerHost) return {};
  if (dockerHost.startsWith("/") || dockerHost.startsWith("npipe:")) {
    return { socketPath: dockerHost };
  }
  // tcp://host:port or http://host:port
  try {
    const url = new URL(dockerHost.replace(/^tcp:\/\//, "http://"));
    return {
      host: url.hostname,
      port: url.port || "2375",
      protocol: "http",
    };
  } catch {
    return { host: dockerHost };
  }
}

export async function startLobsterExecutorServer(): Promise<void> {
  const config = readLobsterExecutorConfig();

  // Validate Docker daemon connectivity in "real" mode before starting
  if (config.executionMode === "real") {
    const docker = new Dockerode(parseDockerHost(config.dockerHost));
    try {
      await docker.ping();
      console.log("[lobster-executor] Docker daemon connected");
    } catch (err) {
      console.error(
        `[lobster-executor] Docker daemon is not available at "${config.dockerHost}". ` +
        `Cannot start in "real" mode. Ensure Docker is running or set LOBSTER_EXECUTION_MODE=mock.`,
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }
  }

  const service = createLobsterExecutorService({
    dataRoot: config.dataRoot,
    config,
  });
  const app = createLobsterExecutorApp(service);
  const server = createServer(app);

  await new Promise<void>(resolve => {
    server.listen(config.port, config.host, () => {
      console.log(
        `[lobster-executor] listening on http://${config.host}:${config.port}`
      );
      console.log(
        `[lobster-executor] health: http://${config.host}:${config.port}/health`
      );
      resolve();
    });
  });
}

startLobsterExecutorServer().catch(error => {
  console.error("[lobster-executor] failed to start", error);
  process.exitCode = 1;
});
