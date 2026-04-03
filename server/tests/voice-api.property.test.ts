import { describe, expect, it, vi, beforeAll } from "vitest";
import fc from "fast-check";
import express from "express";
import http from "node:http";

/**
 * Property 10: Voice API 服务失败返回 503
 *
 * **Validates: Requirements 8.3**
 *
 * For any POST /api/voice/tts or POST /api/voice/stt request, when the
 * underlying voice service call throws an exception, the API route should
 * return HTTP 503 status code and a JSON response body containing an error
 * description.
 *
 * Feature: multi-modal-agent, Property 10: Voice API 服务失败返回 503
 */

/* ---------- mock voice-provider so we control failures ---------- */

let mockSynthesize: (...args: unknown[]) => Promise<Buffer>;
let mockRecognize: (...args: unknown[]) => Promise<{ transcript: string }>;

vi.mock("../core/voice-provider.js", () => ({
  getVoiceConfig: () => ({
    tts: { available: true, apiUrl: "http://x", apiKey: "k", model: "m", voice: "v" },
    stt: { available: true, apiUrl: "http://x", apiKey: "k", model: "m" },
  }),
  synthesizeSpeech: (...args: unknown[]) => mockSynthesize(...args),
  recognizeSpeech: (...args: unknown[]) => mockRecognize(...args),
}));

/* ---------- helpers ---------- */

/** Create a fresh Express app with the voice router mounted. */
async function createApp() {
  const { default: voiceRouter } = await import("../routes/voice.js");
  const app = express();
  app.use(express.json());
  app.use("/api/voice", voiceRouter);
  return app;
}

/** Make an HTTP request to a running server and return { status, body }. */
function request(
  server: http.Server,
  method: string,
  path: string,
  body?: string | Buffer,
  contentType = "application/json",
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method, headers: { "content-type": contentType } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("Feature: multi-modal-agent, Property 10: Voice API 服务失败返回 503", () => {
  let server: http.Server;

  beforeAll(async () => {
    // Default stubs — overridden per-property-run
    mockSynthesize = () => Promise.reject(new Error("default"));
    mockRecognize = () => Promise.reject(new Error("default"));

    const app = await createApp();
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });

    return () => {
      server.close();
    };
  });

  it("POST /api/voice/tts returns 503 with error description when synthesizeSpeech throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (errorMsg, text) => {
          mockSynthesize = () => Promise.reject(new Error(errorMsg));

          const res = await request(
            server,
            "POST",
            "/api/voice/tts",
            JSON.stringify({ text }),
          );

          expect(res.status).toBe(503);
          const json = JSON.parse(res.body);
          expect(json).toHaveProperty("error");
          expect(typeof json.error).toBe("string");
          expect(json.error.length).toBeGreaterThan(0);
          expect(json.error).toContain(errorMsg);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("POST /api/voice/stt returns 503 with error description when recognizeSpeech throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (errorMsg) => {
          mockRecognize = () => Promise.reject(new Error(errorMsg));

          // Send a small non-empty audio payload
          const audioPayload = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
          const res = await request(
            server,
            "POST",
            "/api/voice/stt",
            audioPayload,
            "audio/webm",
          );

          expect(res.status).toBe(503);
          const json = JSON.parse(res.body);
          expect(json).toHaveProperty("error");
          expect(typeof json.error).toBe("string");
          expect(json.error.length).toBeGreaterThan(0);
          expect(json.error).toContain(errorMsg);
        },
      ),
      { numRuns: 100 },
    );
  });
});
