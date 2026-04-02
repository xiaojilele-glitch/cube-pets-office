import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Snapshot current env so we can restore after each test */
function snapshotEnv() {
  return { ...process.env };
}

const VOICE_ENV_KEYS = [
  "TTS_API_URL",
  "TTS_API_KEY",
  "TTS_MODEL",
  "TTS_VOICE",
  "STT_API_URL",
  "STT_API_KEY",
  "STT_MODEL",
];

function clearVoiceEnv() {
  for (const k of VOICE_ENV_KEYS) {
    delete process.env[k];
  }
}

describe("getVoiceConfig", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = snapshotEnv();
    clearVoiceEnv();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
  });

  async function loadGetVoiceConfig() {
    const mod = await import("../core/voice-provider.js");
    return mod.getVoiceConfig;
  }

  // --- TTS availability ---

  it("marks tts as available when both TTS_API_URL and TTS_API_KEY are set", async () => {
    process.env.TTS_API_URL = "https://tts.example.com/v1/audio/speech";
    process.env.TTS_API_KEY = "tts-secret";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.available).toBe(true);
    expect(cfg.tts.apiUrl).toBe("https://tts.example.com/v1/audio/speech");
    expect(cfg.tts.apiKey).toBe("tts-secret");
  });

  it("marks tts as unavailable when TTS_API_URL is missing", async () => {
    process.env.TTS_API_KEY = "tts-secret";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.available).toBe(false);
  });

  it("marks tts as unavailable when TTS_API_KEY is missing", async () => {
    process.env.TTS_API_URL = "https://tts.example.com/v1/audio/speech";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.available).toBe(false);
  });

  it("marks tts as unavailable when both TTS vars are missing", async () => {
    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.available).toBe(false);
  });

  // --- STT availability ---

  it("marks stt as available when both STT_API_URL and STT_API_KEY are set", async () => {
    process.env.STT_API_URL = "https://stt.example.com/v1/audio/transcriptions";
    process.env.STT_API_KEY = "stt-secret";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.stt.available).toBe(true);
    expect(cfg.stt.apiUrl).toBe("https://stt.example.com/v1/audio/transcriptions");
    expect(cfg.stt.apiKey).toBe("stt-secret");
  });

  it("marks stt as unavailable when STT_API_URL is missing", async () => {
    process.env.STT_API_KEY = "stt-secret";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.stt.available).toBe(false);
  });

  it("marks stt as unavailable when STT_API_KEY is missing", async () => {
    process.env.STT_API_URL = "https://stt.example.com/v1/audio/transcriptions";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.stt.available).toBe(false);
  });

  // --- Default values ---

  it("uses default model 'tts-1' and voice 'alloy' when TTS_MODEL and TTS_VOICE are not set", async () => {
    process.env.TTS_API_URL = "https://tts.example.com";
    process.env.TTS_API_KEY = "key";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.model).toBe("tts-1");
    expect(cfg.tts.voice).toBe("alloy");
  });

  it("uses default model 'whisper-1' when STT_MODEL is not set", async () => {
    process.env.STT_API_URL = "https://stt.example.com";
    process.env.STT_API_KEY = "key";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.stt.model).toBe("whisper-1");
  });

  // --- Custom values ---

  it("respects custom TTS_MODEL and TTS_VOICE", async () => {
    process.env.TTS_API_URL = "https://tts.example.com";
    process.env.TTS_API_KEY = "key";
    process.env.TTS_MODEL = "tts-1-hd";
    process.env.TTS_VOICE = "nova";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.model).toBe("tts-1-hd");
    expect(cfg.tts.voice).toBe("nova");
  });

  it("respects custom STT_MODEL", async () => {
    process.env.STT_API_URL = "https://stt.example.com";
    process.env.STT_API_KEY = "key";
    process.env.STT_MODEL = "whisper-large-v3";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.stt.model).toBe("whisper-large-v3");
  });

  // --- Mixed availability ---

  it("allows TTS available while STT unavailable", async () => {
    process.env.TTS_API_URL = "https://tts.example.com";
    process.env.TTS_API_KEY = "tts-key";
    // STT vars not set

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.available).toBe(true);
    expect(cfg.stt.available).toBe(false);
  });

  it("allows STT available while TTS unavailable", async () => {
    process.env.STT_API_URL = "https://stt.example.com";
    process.env.STT_API_KEY = "stt-key";
    // TTS vars not set

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.available).toBe(false);
    expect(cfg.stt.available).toBe(true);
  });

  // --- Empty string handling ---

  it("treats empty string TTS_API_URL as missing", async () => {
    process.env.TTS_API_URL = "";
    process.env.TTS_API_KEY = "key";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.available).toBe(false);
  });

  it("treats empty string TTS_API_KEY as missing", async () => {
    process.env.TTS_API_URL = "https://tts.example.com";
    process.env.TTS_API_KEY = "";

    const getVoiceConfig = await loadGetVoiceConfig();
    const cfg = getVoiceConfig();

    expect(cfg.tts.available).toBe(false);
  });
});
