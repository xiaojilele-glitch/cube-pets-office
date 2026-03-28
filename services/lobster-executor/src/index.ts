import { createServer } from "node:http";
import { createLobsterExecutorApp } from "./app.js";
import { readLobsterExecutorConfig } from "./config.js";
import { createLobsterExecutorService } from "./service.js";

export async function startLobsterExecutorServer(): Promise<void> {
  const config = readLobsterExecutorConfig();
  const service = createLobsterExecutorService({
    dataRoot: config.dataRoot,
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
