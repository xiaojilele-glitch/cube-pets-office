import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type express from "express";

import { createLobsterExecutorApp } from "../app.js";
import { createLobsterExecutorService } from "../service.js";
import type { LobsterExecutorConfig } from "../types.js";

async function request(app: express.Express, method: string, path: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        return reject(new Error("Failed to get server address"));
      }
      const url = `http://127.0.0.1:${addr.port}${path}`;
      fetch(url, { method })
        .then(async (res) => {
          const json = await res.json().catch(() => null);
          resolve({ status: res.status, body: json });
        })
        .catch(reject)
        .finally(() => server.close());
    });
  });
}

describe("/health execution mode", () => {
  it("reports dockerLifecycle=false when effective executionMode is native", async () => {
    const prevMode = process.env.LOBSTER_EXECUTION_MODE;
    process.env.LOBSTER_EXECUTION_MODE = "real";

    const dataRoot = mkdtempSync(join(tmpdir(), "lobster-health-"));
    try {
      const config: LobsterExecutorConfig = {
        host: "127.0.0.1",
        port: 0,
        dataRoot,
        serviceName: "lobster-executor",
        executionMode: "native",
        defaultImage: "node:20-slim",
        maxConcurrentJobs: 1,
        callbackSecret: "",
        aiImage: "cube-ai-sandbox:latest",
        securityLevel: "strict",
        containerUser: "65534",
        maxMemory: "512m",
        maxCpus: "1.0",
        maxPids: 256,
        tmpfsSize: "64m",
        networkWhitelist: [],
        dockerHost: "/var/run/docker.sock",
      };

      const service = createLobsterExecutorService({ dataRoot, config });
      const app = createLobsterExecutorApp(service);

      const res = await request(app, "GET", "/health");
      expect(res.status).toBe(200);
      expect(res.body?.features?.dockerLifecycle).toBe(false);
    } finally {
      if (prevMode === undefined) {
        delete process.env.LOBSTER_EXECUTION_MODE;
      } else {
        process.env.LOBSTER_EXECUTION_MODE = prevMode;
      }
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

