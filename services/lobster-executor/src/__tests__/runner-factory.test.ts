import { describe, expect, it } from "vitest";

import { createJobRunner } from "../runner.js";
import type { LobsterExecutorConfig } from "../types.js";

describe("createJobRunner", () => {
  it("returns NativeRunner when executionMode=native", () => {
    const config: LobsterExecutorConfig = {
      host: "0.0.0.0",
      port: 3031,
      dataRoot: "/tmp",
      serviceName: "lobster-executor",
      executionMode: "native",
      defaultImage: "node:20-slim",
      maxConcurrentJobs: 2,
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

    const runner = createJobRunner(config, { send: async () => {} } as any);
    expect(runner.constructor.name).toBe("NativeRunner");
  });
});

