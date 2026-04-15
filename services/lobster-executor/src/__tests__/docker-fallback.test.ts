import { describe, expect, it } from "vitest";

import { resolveEffectiveExecutionMode } from "../index.js";

describe("lobster-executor docker fallback", () => {
  it("falls back to native when requested real but docker is unavailable", () => {
    expect(resolveEffectiveExecutionMode("real", false)).toBe("native");
  });

  it("keeps real when docker is available", () => {
    expect(resolveEffectiveExecutionMode("real", true)).toBe("real");
  });
});

