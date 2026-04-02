/**
 * Vision analysis REST API route.
 *
 * POST /api/vision/analyze — Accept base64 image array, return vision analysis results.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { analyzeImages, type VisionAnalysisResult } from "../core/vision-provider.js";

interface VisionAnalyzeRequestBody {
  images: Array<{ base64DataUrl: string; name: string }>;
  prompt?: string;
}

interface VisionAnalyzeResponseBody {
  results: Array<{ name: string; analysis: VisionAnalysisResult }>;
}

const router = Router();

/**
 * POST /api/vision/analyze
 *
 * Body: { images: Array<{ base64DataUrl: string; name: string }>, prompt?: string }
 * Response: { results: Array<{ name: string; analysis: VisionAnalysisResult }> }
 *
 * Requirements: 4.1
 */
router.post("/analyze", async (req: Request, res: Response) => {
  const body = req.body as VisionAnalyzeRequestBody | undefined;

  // --- Validate request body ---
  if (!body || !Array.isArray(body.images) || body.images.length === 0) {
    return res.status(400).json({
      error: "Request body must include a non-empty 'images' array.",
    });
  }

  for (let i = 0; i < body.images.length; i++) {
    const img = body.images[i];
    if (!img || typeof img.base64DataUrl !== "string" || !img.base64DataUrl) {
      return res.status(400).json({
        error: `images[${i}].base64DataUrl is required and must be a non-empty string.`,
      });
    }
    if (!img.name || typeof img.name !== "string") {
      return res.status(400).json({
        error: `images[${i}].name is required and must be a non-empty string.`,
      });
    }
  }

  if (body.prompt !== undefined && typeof body.prompt !== "string") {
    return res.status(400).json({
      error: "'prompt' must be a string when provided.",
    });
  }

  try {
    const resultMap = await analyzeImages(body.images, body.prompt);

    const results: VisionAnalyzeResponseBody["results"] = body.images.map(img => ({
      name: img.name,
      analysis: resultMap.get(img.name) ?? {
        description: "",
        elements: [],
        textContent: "",
        rawResponse: "",
      },
    }));

    return res.json({ results } satisfies VisionAnalyzeResponseBody);
  } catch (error) {
    console.error("[Vision] /api/vision/analyze error:", error);
    return res.status(500).json({
      error: "Vision analysis failed. Please try again later.",
    });
  }
});

export default router;
