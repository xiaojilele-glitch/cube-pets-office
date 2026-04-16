import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";

const { callLLMJson, isLLMTemporarilyUnavailableError } = vi.hoisted(() => ({
  callLLMJson: vi.fn(),
  isLLMTemporarilyUnavailableError: vi.fn(),
}));

vi.mock("../../core/llm-client.js", () => ({
  callLLMJson,
  isLLMTemporarilyUnavailableError,
}));

let server: http.Server;
let baseUrl: string;

function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload
            ? { "Content-Length": Buffer.byteLength(payload).toString() }
            : {}),
        },
      },
      res => {
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 500,
              body: data ? JSON.parse(data) : null,
            });
          } catch {
            resolve({ status: res.statusCode ?? 500, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  const { createNLCommandRouter } = await import("../../routes/nl-command.js");
  const app = express();
  app.use(express.json());
  app.use("/api/nl-command", createNLCommandRouter());

  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  isLLMTemporarilyUnavailableError.mockReturnValue(false);
});

describe("NL command clarification preview retry", () => {
  it("retries question generation when the first LLM pass returns no questions", async () => {
    callLLMJson
      .mockResolvedValueOnce({
        needsClarification: true,
        questions: [],
      })
      .mockResolvedValueOnce({
        needsClarification: true,
        questions: [
          {
            questionId: "timeline",
            text: "希望按哪个时间窗口推进？",
            type: "single_choice",
            options: ["今天内", "本周内", "时间灵活"],
          },
        ],
      });

    const res = await request("POST", "/api/nl-command/clarification-preview", {
      commandText: "帮我把办公室首页优化一下，尽快上线。",
      userId: "u1",
      locale: "zh-CN",
    });

    expect(res.status).toBe(200);
    expect(callLLMJson).toHaveBeenCalledTimes(2);
    expect((res.body as { needsClarification: boolean }).needsClarification).toBe(
      true,
    );
    expect(
      ((res.body as { questions?: unknown[] }).questions ?? []).length,
    ).toBe(1);
    expect(
      (
        res.body as {
          questions: Array<{ type: string; options?: string[] }>;
        }
      ).questions[0]?.type,
    ).toBe("single_choice");
  });

  it("repairs free-text questions into choice questions before returning them", async () => {
    callLLMJson
      .mockResolvedValueOnce({
        needsClarification: true,
        questions: [
          {
            questionId: "timeline",
            text: "什么时候交付比较合适？",
            type: "free_text",
          },
        ],
      })
      .mockResolvedValueOnce({
        needsClarification: true,
        questions: [
          {
            questionId: "timeline",
            text: "希望按哪个时间窗口推进？",
            type: "single_choice",
            options: ["今天内", "本周内", "时间灵活"],
          },
        ],
      });

    const res = await request("POST", "/api/nl-command/clarification-preview", {
      commandText: "帮我把办公室首页优化一下，尽快上线。",
      userId: "u1",
      locale: "zh-CN",
    });

    const questions =
      (
        res.body as {
          questions?: Array<{ type: string; options?: string[] }>;
        }
      ).questions ?? [];

    expect(res.status).toBe(200);
    expect(callLLMJson).toHaveBeenCalledTimes(2);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.type).toBe("single_choice");
    expect((questions[0]?.options ?? []).length).toBeGreaterThan(1);
  });

  it("accepts AI questions when options are returned as objects instead of strings", async () => {
    callLLMJson.mockResolvedValueOnce({
      needsClarification: true,
      questions: [
        {
          id: "q1",
          text: "您期望的交付时间窗口是？",
          type: "single_choice",
          options: [
            { id: "opt1", text: "尽快处理（高优先级）" },
            { id: "opt2", text: "本周内完成" },
            { id: "opt3", text: "暂无明确时间要求" },
          ],
        },
      ],
    });

    const res = await request("POST", "/api/nl-command/clarification-preview", {
      commandText: "帮我把办公室首页优化一下，尽快上线。",
      userId: "u1",
      locale: "zh-CN",
    });

    const questions =
      (
        res.body as {
          questions?: Array<{
            questionId: string;
            type: string;
            options?: string[];
          }>;
        }
      ).questions ?? [];

    expect(res.status).toBe(200);
    expect(callLLMJson).toHaveBeenCalledTimes(1);
    expect(questions).toEqual([
      {
        questionId: "q1",
        text: "您期望的交付时间窗口是？",
        type: "single_choice",
        options: ["尽快处理（高优先级）", "本周内完成", "暂无明确时间要求"],
      },
    ]);
  });

  it("repairs a second-pass free-text result before falling back", async () => {
    callLLMJson
      .mockResolvedValueOnce({
        needsClarification: true,
        questions: [],
      })
      .mockResolvedValueOnce({
        needsClarification: true,
        questions: [
          {
            questionId: "constraints",
            text: "还有什么限制条件？",
            type: "free_text",
          },
        ],
      })
      .mockResolvedValueOnce({
        needsClarification: true,
        questions: [
          {
            questionId: "constraints",
            text: "这次执行最需要守住哪类约束？",
            type: "single_choice",
            options: ["尽量快交付", "可回滚更重要", "兼容稳定更重要"],
          },
        ],
      });

    const res = await request("POST", "/api/nl-command/clarification-preview", {
      commandText: "帮我把办公室首页优化一下，尽快上线。",
      userId: "u1",
      locale: "zh-CN",
    });

    const questions =
      (
        res.body as {
          questions?: Array<{ type: string; options?: string[] }>;
        }
      ).questions ?? [];

    expect(res.status).toBe(200);
    expect(callLLMJson).toHaveBeenCalledTimes(3);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.type).toBe("single_choice");
    expect((questions[0]?.options ?? []).length).toBeGreaterThan(1);
  });

  it("returns fallback choice questions when AI still cannot produce usable options", async () => {
    callLLMJson
      .mockResolvedValueOnce({
        needsClarification: true,
        questions: [],
      })
      .mockResolvedValueOnce({
        needsClarification: true,
        questions: [],
      });

    const res = await request("POST", "/api/nl-command/clarification-preview", {
      commandText: "帮我把办公室首页优化一下，尽快上线。",
      userId: "u1",
      locale: "zh-CN",
    });

    expect(res.status).toBe(200);
    expect(callLLMJson).toHaveBeenCalledTimes(2);
    expect((res.body as { needsClarification: boolean }).needsClarification).toBe(
      true,
    );
    const questions =
      (
        res.body as {
          questions?: Array<{ type: string; options?: string[] }>;
        }
      ).questions ?? [];
    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0]?.type).toBe("single_choice");
    expect((questions[0]?.options ?? []).length).toBeGreaterThan(1);
  });
});
