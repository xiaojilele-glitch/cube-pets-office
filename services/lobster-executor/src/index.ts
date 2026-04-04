import { createServer } from "node:http";
import Dockerode from "dockerode";
import { createLobsterExecutorApp } from "./app.js";
import { readLobsterExecutorConfig } from "./config.js";
import { createLobsterExecutorService } from "./service.js";

export async function startLobsterExecutorServer(): Promise<void> {
  const config = readLobsterExecutorConfig();

  // Validate Docker daemon connectivity in "real" mode before starting
  if (config.executionMode === "real") {
    const docker = new Dockerode({
      socketPath: config.dockerHost?.startsWith("/") ? config.dockerHost : undefined,
      host: config.dockerHost && !config.dockerHost.startsWith("/") ? config.dockerHost : undefined,
    });
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
