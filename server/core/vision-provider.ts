import dotenv from "dotenv";

import { getAIConfig } from "./ai-config.js";
import { callLLM } from "./llm-client.js";
import type { LLMMessageContentPart } from "../../shared/workflow-runtime.js";

dotenv.config();

export interface VisionProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  wireApi: "responses" | "chat_completions";
  maxTokens: number;
  detail: "low" | "high" | "auto";
  timeoutMs: number;
}

/**
 * Resolve Vision LLM configuration using a three-tier fallback chain:
 *   VISION_LLM_* → FALLBACK_LLM_* → main LLM_* (via getAIConfig)
 *
 * Vision-specific defaults:
 *   maxTokens = 1000, detail = "low", timeoutMs = 30000
 */
export function getVisionConfig(): VisionProviderConfig {
  const aiConfig = getAIConfig();

  // --- apiKey ---
  const apiKey =
    process.env.VISION_LLM_API_KEY ||
    process.env.FALLBACK_LLM_API_KEY ||
    aiConfig.apiKey;

  // --- baseUrl ---
  const baseUrl =
    process.env.VISION_LLM_BASE_URL ||
    process.env.FALLBACK_LLM_BASE_URL ||
    aiConfig.baseUrl;

  // --- model ---
  const model =
    process.env.VISION_LLM_MODEL ||
    process.env.FALLBACK_LLM_MODEL ||
    aiConfig.model;

  // --- wireApi ---
  const rawWireApi =
    process.env.VISION_LLM_WIRE_API ||
    process.env.FALLBACK_LLM_WIRE_API;
  const wireApi: "responses" | "chat_completions" =
    rawWireApi
      ? rawWireApi.toLowerCase() === "responses"
        ? "responses"
        : "chat_completions"
      : aiConfig.wireApi;

  // --- maxTokens (vision-specific, default 1000) ---
  const rawMaxTokens = process.env.VISION_LLM_MAX_TOKENS;
  const parsedMaxTokens = Number(rawMaxTokens);
  const maxTokens =
    rawMaxTokens && Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0
      ? parsedMaxTokens
      : 1000;

  // --- detail (vision-specific, default "low") ---
  const rawDetail = (process.env.VISION_LLM_DETAIL || "").toLowerCase();
  const detail: "low" | "high" | "auto" =
    rawDetail === "high" ? "high" : rawDetail === "auto" ? "auto" : "low";

  // --- timeoutMs (vision-specific, default 30000) ---
  const rawTimeout = process.env.VISION_LLM_TIMEOUT_MS;
  const parsedTimeout = Number(rawTimeout);
  const timeoutMs =
    rawTimeout && Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : 30000;

  return { apiKey, baseUrl, model, wireApi, maxTokens, detail, timeoutMs };
}

export interface VisionAnalysisResult {
  description: string;
  elements: string[];
  textContent: string;
  rawResponse: string;
}

const DEFAULT_VISION_PROMPT =
  "Analyze this image. Provide:\n" +
  "1. A brief overall description\n" +
  "2. Key visual elements (list each on its own line prefixed with '- ')\n" +
  "3. Any text visible in the image\n\n" +
  "Format your response exactly as:\n" +
  "DESCRIPTION: <description>\n" +
  "ELEMENTS:\n- <element1>\n- <element2>\n" +
  "TEXT: <any text found, or NONE>";

/**
 * Parse the raw LLM response text into a structured VisionAnalysisResult.
 * Gracefully handles responses that don't follow the expected format.
 */
export function parseVisionResponse(raw: string): VisionAnalysisResult {
  const trimmed = raw.trim();

  let description = "";
  let elements: string[] = [];
  let textContent = "";

  const descMatch = trimmed.match(/DESCRIPTION:\s*([\s\S]*?)(?=\nELEMENTS:|\nTEXT:|$)/i);
  if (descMatch) {
    description = descMatch[1].trim();
  }

  const elemMatch = trimmed.match(/ELEMENTS:\s*([\s\S]*?)(?=\n\s*TEXT:|\n\s*$|$)/i);
  if (elemMatch) {
    elements = elemMatch[1]
      .split("\n")
      .map(line => line.replace(/^[-*•]\s*/, "").trim())
      .filter(line => Boolean(line) && !/^TEXT:/i.test(line));
  }

  const textMatch = trimmed.match(/TEXT:\s*([\s\S]*?)$/i);
  if (textMatch) {
    const t = textMatch[1].trim();
    textContent = /^none$/i.test(t) ? "" : t;
  }

  // Fallback: if structured parsing found nothing, use the whole response as description
  if (!description && elements.length === 0 && !textContent) {
    description = trimmed;
  }

  return { description, elements, textContent, rawResponse: trimmed };
}

/**
 * Analyze a single image using the Vision LLM.
 *
 * Builds a multimodal message containing the image as a base64 data URL
 * and sends it to the configured Vision LLM via callLLM.
 *
 * Requirements: 4.1, 4.4, 4.5
 */
export async function analyzeImage(
  base64DataUrl: string,
  prompt?: string
): Promise<VisionAnalysisResult> {
  const config = getVisionConfig();

  const contentParts: LLMMessageContentPart[] = [
    { type: "text", text: prompt || DEFAULT_VISION_PROMPT },
    {
      type: "image_url",
      image_url: { url: base64DataUrl, detail: config.detail },
    },
  ];

  const messages = [
    {
      role: "user" as const,
      content: contentParts,
    },
  ];

  const response = await callLLM(messages, {
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: 0.3,
  });

  return parseVisionResponse(response.content);
}

/**
 * Analyze multiple images in parallel using Promise.allSettled.
 *
 * Each image is processed independently — a failure on one image
 * does not affect the others (Requirement 4.5).
 *
 * Requirements: 4.1, 4.4, 4.5
 */
export async function analyzeImages(
  images: Array<{ base64DataUrl: string; name: string }>,
  prompt?: string
): Promise<Map<string, VisionAnalysisResult>> {
  const results = await Promise.allSettled(
    images.map(img => analyzeImage(img.base64DataUrl, prompt))
  );

  const map = new Map<string, VisionAnalysisResult>();
  for (let i = 0; i < images.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      map.set(images[i].name, result.value);
    } else {
      console.error(
        `[Vision] Failed to analyze image "${images[i].name}":`,
        result.reason
      );
    }
  }

  return map;
}
