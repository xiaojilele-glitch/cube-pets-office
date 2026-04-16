/**
 * Voice API routes for TTS and STT services.
 *
 * POST /api/voice/tts  — Synthesize speech from text
 * POST /api/voice/stt  — Recognize speech from audio
 * GET  /api/voice/config — Return TTS/STT availability
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import { Router } from "express";
import type { Request, Response } from "express";

import {
  getVoiceConfig,
  synthesizeSpeech,
  recognizeSpeech,
} from "../core/voice-provider.js";

const router = Router();

/**
 * GET /api/voice/config
 * Response: { tts: { available: boolean }, stt: { available: boolean } }
 */
router.get("/config", (_req: Request, res: Response) => {
  const config = getVoiceConfig();
  return res.json({
    tts: { available: config.tts.available },
    stt: { available: config.stt.available },
  });
});

/**
 * POST /api/voice/tts
 * Body: { text: string, voice?: string }
 * Response: audio/mpeg binary
 * Error: 501 (not configured) | 503 (service failure)
 */
router.post("/tts", async (req: Request, res: Response) => {
  const config = getVoiceConfig();
  if (!config.tts.available) {
    return res.status(501).json({ error: "TTS service is not configured." });
  }

  const { text, voice } = req.body as { text?: string; voice?: string };
  if (!text || typeof text !== "string") {
    return res
      .status(400)
      .json({ error: "'text' is required and must be a non-empty string." });
  }

  try {
    const audioBuffer = await synthesizeSpeech(text, voice);
    res.set("Content-Type", "audio/mpeg");
    return res.send(audioBuffer);
  } catch (error) {
    console.error("[Voice] /api/voice/tts error:", error);
    return res.status(503).json({
      error: `TTS synthesis failed: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
});

/**
 * POST /api/voice/stt
 * Body: multipart/form-data with "audio" field, or raw audio body
 * Response: { transcript: string }
 * Error: 501 (not configured) | 503 (service failure)
 */
router.post("/stt", async (req: Request, res: Response) => {
  const config = getVoiceConfig();
  if (!config.stt.available) {
    return res.status(501).json({ error: "STT service is not configured." });
  }

  try {
    // Collect raw body as Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      return res.status(400).json({ error: "Audio data is required." });
    }

    if (audioBuffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: "Audio data exceeds 10 MB limit." });
    }

    const mimeType = req.headers["content-type"] || "audio/webm";
    const result = await recognizeSpeech(audioBuffer, mimeType);
    return res.json(result);
  } catch (error) {
    console.error("[Voice] /api/voice/stt error:", error);
    return res.status(503).json({
      error: `STT recognition failed: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
});

export default router;
