import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getVisionConfig } from "../core/vision-provider.js";

/** Snapshot current env so we can restore after each test */
function snapshotEnv() {
  return { ...process.env };
}

function clearVisionEnv() {
  const keys = [
    "VISION_LLM_API_KEY",
    "VISION_LLM_BASE_URL",
    "VISION_LLM_MODEL",
    "VISION_LLM_WIRE_API",
    "VISION_LLM_MAX_TOKENS",
    "VISION_LLM_DETAIL",
    "VISION_LLM_TIMEOUT_MS",
    "FALLBACK_LLM_API_KEY",
    "FALLBACK_LLM_BASE_URL",
    "FALLBACK_LLM_MODEL",
    "FALLBACK_LLM_WIRE_API",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAI_WIRE_API",
    "OPENAI_TIMEOUT_MS",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_WIRE_API",
    "LLM_TIMEOUT_MS",
    "LLM_STREAM",
  ];
  for (const k of keys) {
    delete process.env[k];
  }
}

describe("getVisionConfig", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = snapshotEnv();
    clearVisionEnv();
    // Set a baseline main LLM config so getAIConfig() returns known values
    process.env.LLM_API_KEY = "main-key";
    process.env.LLM_BASE_URL = "https://main.example.com/v1";
    process.env.LLM_MODEL = "main-model";
    process.env.LLM_WIRE_API = "chat_completions";
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
  });

  it("falls back to main LLM config when no VISION or FALLBACK vars are set", () => {
    const cfg = getVisionConfig();

    expect(cfg.apiKey).toBe("main-key");
    expect(cfg.baseUrl).toBe("https://main.example.com/v1");
    expect(cfg.model).toBe("main-model");
    expect(cfg.wireApi).toBe("chat_completions");
    // Vision-specific defaults
    expect(cfg.maxTokens).toBe(1000);
    expect(cfg.detail).toBe("low");
    expect(cfg.timeoutMs).toBe(30000);
  });

  it("uses FALLBACK_LLM_* when VISION_LLM_* is not set", () => {
    process.env.FALLBACK_LLM_API_KEY = "fallback-key";
    process.env.FALLBACK_LLM_BASE_URL = "https://fallback.example.com/v1";
    process.env.FALLBACK_LLM_MODEL = "fallback-model";
    process.env.FALLBACK_LLM_WIRE_API = "responses";

    const cfg = getVisionConfig();

    expect(cfg.apiKey).toBe("fallback-key");
    expect(cfg.baseUrl).toBe("https://fallback.example.com/v1");
    expect(cfg.model).toBe("fallback-model");
    expect(cfg.wireApi).toBe("responses");
  });

  it("uses VISION_LLM_* when all three tiers are set", () => {
    process.env.FALLBACK_LLM_API_KEY = "fallback-key";
    process.env.FALLBACK_LLM_BASE_URL = "https://fallback.example.com/v1";
    process.env.FALLBACK_LLM_MODEL = "fallback-model";

    process.env.VISION_LLM_API_KEY = "vision-key";
    process.env.VISION_LLM_BASE_URL = "https://vision.example.com/v1";
    process.env.VISION_LLM_MODEL = "vision-model";
    process.env.VISION_LLM_WIRE_API = "responses";

    const cfg = getVisionConfig();

    expect(cfg.apiKey).toBe("vision-key");
    expect(cfg.baseUrl).toBe("https://vision.example.com/v1");
    expect(cfg.model).toBe("vision-model");
    expect(cfg.wireApi).toBe("responses");
  });

  it("respects VISION_LLM_MAX_TOKENS", () => {
    process.env.VISION_LLM_MAX_TOKENS = "2048";
    const cfg = getVisionConfig();

    expect(cfg.maxTokens).toBe(2048);
  });

  it("defaults maxTokens to 1000 for invalid values", () => {
    process.env.VISION_LLM_MAX_TOKENS = "not-a-number";
    const cfg = getVisionConfig();

    expect(cfg.maxTokens).toBe(1000);
  });

  it("respects VISION_LLM_DETAIL", () => {
    process.env.VISION_LLM_DETAIL = "high";
    expect(getVisionConfig().detail).toBe("high");

    process.env.VISION_LLM_DETAIL = "auto";
    expect(getVisionConfig().detail).toBe("auto");

    process.env.VISION_LLM_DETAIL = "LOW";
    expect(getVisionConfig().detail).toBe("low");
  });

  it("defaults detail to 'low' for unrecognized values", () => {
    process.env.VISION_LLM_DETAIL = "ultra";
    const cfg = getVisionConfig();

    expect(cfg.detail).toBe("low");
  });

  it("respects VISION_LLM_TIMEOUT_MS", () => {
    process.env.VISION_LLM_TIMEOUT_MS = "60000";
    const cfg = getVisionConfig();

    expect(cfg.timeoutMs).toBe(60000);
  });

  it("defaults timeoutMs to 30000 for invalid values", () => {
    process.env.VISION_LLM_TIMEOUT_MS = "-5";
    const cfg = getVisionConfig();

    expect(cfg.timeoutMs).toBe(30000);
  });

  it("mixes tiers: VISION apiKey + FALLBACK baseUrl + main model", () => {
    process.env.VISION_LLM_API_KEY = "vision-key";
    process.env.FALLBACK_LLM_BASE_URL = "https://fallback.example.com/v1";
    // model falls through to main
    const cfg = getVisionConfig();

    expect(cfg.apiKey).toBe("vision-key");
    expect(cfg.baseUrl).toBe("https://fallback.example.com/v1");
    expect(cfg.model).toBe("main-model");
  });
});
