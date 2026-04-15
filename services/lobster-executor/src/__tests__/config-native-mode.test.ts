import { describe, expect, it } from "vitest";

import { readLobsterExecutorConfig } from "../config.js";

describe("readLobsterExecutorConfig executionMode", () => {
  it("parses LOBSTER_EXECUTION_MODE=native", () => {
    const config = readLobsterExecutorConfig(
      {
        LOBSTER_EXECUTION_MODE: "native",
        LOBSTER_EXECUTOR_PORT: "3031",
        LOBSTER_EXECUTOR_HOST: "0.0.0.0",
      },
      "linux",
    );

    expect(config.executionMode).toBe("native");
  });
});

