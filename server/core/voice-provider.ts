import dotenv from "dotenv";

dotenv.config();

/**
 * Voice service configuration for TTS and STT providers.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */
export interface VoiceConfig {
  tts: {
    available: boolean;
    apiUrl: string;
    apiKey: string;
    model: string;
    voice: string;
  };
  stt: {
    available: boolean;
    apiUrl: string;
    apiKey: string;
    model: string;
  };
}

/**
 * Read TTS/STT configuration from environment variables.
 *
 * - TTS: TTS_API_URL, TTS_API_KEY, TTS_MODEL (default "tts-1"), TTS_VOICE (default "alloy")
 * - STT: STT_API_URL, STT_API_KEY, STT_MODEL (default "whisper-1")
 *
 * If either API_URL or API_KEY is missing for a service, that service is
 * marked as `available: false`.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */
export function getVoiceConfig(): VoiceConfig {
  const ttsApiUrl = process.env.TTS_API_URL || "";
  const ttsApiKey = process.env.TTS_API_KEY || "";
  const ttsModel = process.env.TTS_MODEL || "tts-1";
  const ttsVoice = process.env.TTS_VOICE || "alloy";

  const sttApiUrl = process.env.STT_API_URL || "";
  const sttApiKey = process.env.STT_API_KEY || "";
  const sttModel = process.env.STT_MODEL || "whisper-1";

  return {
    tts: {
      available: Boolean(ttsApiUrl) && Boolean(ttsApiKey),
      apiUrl: ttsApiUrl,
      apiKey: ttsApiKey,
      model: ttsModel,
      voice: ttsVoice,
    },
    stt: {
      available: Boolean(sttApiUrl) && Boolean(sttApiKey),
      apiUrl: sttApiUrl,
      apiKey: sttApiKey,
      model: sttModel,
    },
  };
}

/**
 * Synthesize speech from text using the configured TTS service.
 *
 * Posts JSON { model, voice, input } to TTS_API_URL and returns the audio
 * response as a Buffer (audio/mpeg).
 *
 * Requirements: 8.1
 */
export async function synthesizeSpeech(
  text: string,
  voice?: string,
): Promise<Buffer> {
  const config = getVoiceConfig();
  if (!config.tts.available) {
    throw new Error("TTS service is not configured");
  }

  const res = await fetch(config.tts.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.tts.apiKey}`,
    },
    body: JSON.stringify({
      model: config.tts.model,
      voice: voice || config.tts.voice,
      input: text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "unknown error");
    throw new Error(`TTS service error (${res.status}): ${detail}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Recognise speech from an audio buffer using the configured STT service.
 *
 * Posts multipart/form-data with the audio file and model to STT_API_URL,
 * expects JSON { text } in the response.
 *
 * Requirements: 8.2
 */
export async function recognizeSpeech(
  audioBuffer: Buffer,
  mimeType = "audio/webm",
): Promise<{ transcript: string }> {
  const config = getVoiceConfig();
  if (!config.stt.available) {
    throw new Error("STT service is not configured");
  }

  const ext = mimeType === "audio/mpeg" ? "mp3" : "webm";
  const blob = new Blob([audioBuffer], { type: mimeType });

  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", config.stt.model);

  const res = await fetch(config.stt.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.stt.apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "unknown error");
    throw new Error(`STT service error (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as { text: string };
  return { transcript: json.text };
}
