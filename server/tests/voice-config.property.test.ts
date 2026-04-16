import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";

/**
 * Property 1: Voice 配置解析与可用性标记
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
 *
 * For any combination of TTS_* and STT_* environment variables,
 * getVoiceConfig() returns a config where:
 * - tts.available === (Boolean(TTS_API_URL) && Boolean(TTS_API_KEY))
 * - stt.available === (Boolean(STT_API_URL) && Boolean(STT_API_KEY))
 * - All configured values are correctly mapped to corresponding config fields
 */

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

/** Arbitrary that produces either a non-empty string or empty string */
const optionalString = fc.option(fc.string({ minLength: 1 }), { nil: "" });

describe("Feature: multi-modal-agent, Property 1: Voice 配置解析与可用性标记", () => {
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

  it("tts.available is true iff both TTS_API_URL and TTS_API_KEY are non-empty", async () => {
    const getVoiceConfig = await loadGetVoiceConfig();

    fc.assert(
      fc.property(optionalString, optionalString, (ttsApiUrl, ttsApiKey) => {
        clearVoiceEnv();
        if (ttsApiUrl) process.env.TTS_API_URL = ttsApiUrl;
        if (ttsApiKey) process.env.TTS_API_KEY = ttsApiKey;

        const cfg = getVoiceConfig();
        const expected = Boolean(ttsApiUrl) && Boolean(ttsApiKey);

        expect(cfg.tts.available).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it("stt.available is true iff both STT_API_URL and STT_API_KEY are non-empty", async () => {
    const getVoiceConfig = await loadGetVoiceConfig();

    fc.assert(
      fc.property(optionalString, optionalString, (sttApiUrl, sttApiKey) => {
        clearVoiceEnv();
        if (sttApiUrl) process.env.STT_API_URL = sttApiUrl;
        if (sttApiKey) process.env.STT_API_KEY = sttApiKey;

        const cfg = getVoiceConfig();
        const expected = Boolean(sttApiUrl) && Boolean(sttApiKey);

        expect(cfg.stt.available).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it("all configured env values are correctly mapped to config fields", async () => {
    const getVoiceConfig = await loadGetVoiceConfig();

    fc.assert(
      fc.property(
        optionalString,
        optionalString,
        optionalString,
        optionalString,
        optionalString,
        optionalString,
        optionalString,
        (
          ttsApiUrl,
          ttsApiKey,
          ttsModel,
          ttsVoice,
          sttApiUrl,
          sttApiKey,
          sttModel
        ) => {
          clearVoiceEnv();
          if (ttsApiUrl) process.env.TTS_API_URL = ttsApiUrl;
          if (ttsApiKey) process.env.TTS_API_KEY = ttsApiKey;
          if (ttsModel) process.env.TTS_MODEL = ttsModel;
          if (ttsVoice) process.env.TTS_VOICE = ttsVoice;
          if (sttApiUrl) process.env.STT_API_URL = sttApiUrl;
          if (sttApiKey) process.env.STT_API_KEY = sttApiKey;
          if (sttModel) process.env.STT_MODEL = sttModel;

          const cfg = getVoiceConfig();

          // TTS fields
          expect(cfg.tts.apiUrl).toBe(ttsApiUrl);
          expect(cfg.tts.apiKey).toBe(ttsApiKey);
          expect(cfg.tts.model).toBe(ttsModel || "tts-1");
          expect(cfg.tts.voice).toBe(ttsVoice || "alloy");

          // STT fields
          expect(cfg.stt.apiUrl).toBe(sttApiUrl);
          expect(cfg.stt.apiKey).toBe(sttApiKey);
          expect(cfg.stt.model).toBe(sttModel || "whisper-1");

          // Availability
          expect(cfg.tts.available).toBe(
            Boolean(ttsApiUrl) && Boolean(ttsApiKey)
          );
          expect(cfg.stt.available).toBe(
            Boolean(sttApiUrl) && Boolean(sttApiKey)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
