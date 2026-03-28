import express from "express";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFeishuRouter } from "../routes/feishu.js";
import { createFeishuBridgeRuntime } from "../feishu/runtime.js";
import type { FeishuOutboundMessage } from "../feishu/bridge.js";
import {
  buildFeishuRelayAuthHeaders,
} from "../feishu/relay-auth.js";
import {
  buildFeishuWebhookSignatureHeaders,
  encryptFeishuWebhookPayload,
} from "../feishu/webhook-security.js";
import { FileFeishuWebhookDedupStore } from "../feishu/webhook-dedup-store.js";

async function withServer(
  handler: (
    baseUrl: string,
    runtime: ReturnType<typeof createFeishuBridgeRuntime>,
    send: ReturnType<typeof vi.fn>
  ) => Promise<void>,
  runtimeOptions: Parameters<typeof createFeishuBridgeRuntime>[0]
): Promise<{
  runtime: ReturnType<typeof createFeishuBridgeRuntime>;
  send: ReturnType<typeof vi.fn>;
}> {
  const send = vi.fn(async (_message: FeishuOutboundMessage) => ({
    messageId: `om_${send.mock.calls.length + 1}`,
  }));
  const runtime = createFeishuBridgeRuntime({
    ...runtimeOptions,
    delivery: {
      send,
    },
  });
  const app = express();
  app.use(express.json());
  app.use("/api/feishu", createFeishuRouter(runtime));
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", error => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl, runtime, send);
  } finally {
    runtime.workflowTracker?.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  return { runtime, send };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Feishu routes", () => {
  it("responds to Feishu url verification challenge", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/feishu/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "url_verification", challenge: "hello-challenge" }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ challenge: "hello-challenge" });
    }, {});
  });

  it("creates a task for complex webhook messages and returns before slow dispatch completes", async () => {
    const dispatcher = {
      start: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return {};
      }),
    };

    const { runtime, send } = await withServer(
      async baseUrl => {
        const startedAt = Date.now();
        const response = await fetch(`${baseUrl}/api/feishu/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema: "2.0",
            header: { event_type: "im.message.receive_v1" },
            event: {
              message: {
                message_id: "om_123",
                chat_id: "oc_456",
                message_type: "text",
                content: JSON.stringify({
                  text: "帮我分析 OpenCroc 的平台定位和下一步 roadmap",
                }),
              },
            },
          }),
        });
        const duration = Date.now() - startedAt;

        expect(response.status).toBe(200);
        expect(duration).toBeLessThan(180);

        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(payload.result.kind).toBe("task-start");
        expect(payload.result.taskId).toBeTruthy();
      },
      { dispatcher }
    );

    expect(runtime.taskStore.listTasks(10)).toHaveLength(1);
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[0]?.[0].kind).toBe("task-ack");
  });

  it("ignores duplicate webhook deliveries by event id", async () => {
    const payload = {
      schema: "2.0",
      header: { event_type: "im.message.receive_v1", event_id: "evt_dup_1" },
      event: {
        message: {
          message_id: "om_dup_1",
          chat_id: "oc_dup_1",
          message_type: "text",
          content: JSON.stringify({ text: "帮我分析 OpenCroc 的平台定位和下一步 roadmap" }),
        },
      },
    };

    const { runtime } = await withServer(async baseUrl => {
      const first = await fetch(`${baseUrl}/api/feishu/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const second = await fetch(`${baseUrl}/api/feishu/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(first.status).toBe(200);
      expect((await first.json()).result.kind).toBe("task-start");
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({
        ok: true,
        ignored: true,
      });
    }, {});

    expect(runtime.taskStore.listTasks(10)).toHaveLength(1);
  });

  it("submits a waiting decision from a Feishu card callback", async () => {
    const { runtime } = await withServer(async (baseUrl, runtime) => {
      const task = runtime.taskStore.createTask({
        kind: "chat",
        title: "Decision task",
      });
      await runtime.taskStore.waitOnTask(task.id, {
        waitingFor: "product direction",
        detail: "Need a direction choice",
        progress: 68,
        decision: {
          prompt: "Choose a path",
          options: [
            { id: "continue", label: "继续执行" },
            { id: "report", label: "只生成报告" },
          ],
        },
      });

      const response = await fetch(`${baseUrl}/api/feishu/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema: "2.0",
          header: { event_type: "card.action.trigger", event_id: "evt_card_1" },
          event: {
            action: {
              value: {
                kind: "task-decision",
                taskId: task.id,
                optionId: "continue",
                optionLabel: "继续执行",
              },
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        result: {
          kind: "task-decision",
          taskId: task.id,
          accepted: true,
          decision: {
            optionId: "continue",
            optionLabel: "继续执行",
          },
        },
        toast: {
          type: "success",
        },
      });
    }, {});

    const updated = runtime.taskStore.listTasks(10)[0];
    expect(updated?.status).toBe("running");
    expect(updated?.waitingFor).toBeUndefined();
  });

  it("accepts signed webhook events and rejects invalid verification tokens", async () => {
    const config = {
      webhookEncryptKey: "webhook-encrypt-key",
      webhookVerificationToken: "verification-token",
    };

    await withServer(async baseUrl => {
      const validPayload = {
        schema: "2.0",
        header: {
          event_type: "im.message.receive_v1",
          token: "verification-token",
        },
        event: {
          message: {
            message_id: "om_signed",
            chat_id: "oc_signed",
            message_type: "text",
            content: JSON.stringify({ text: "帮我分析 OpenCroc 的平台定位和下一步 roadmap" }),
          },
        },
      };

      const accepted = await fetch(`${baseUrl}/api/feishu/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildFeishuWebhookSignatureHeaders({
            encryptKey: config.webhookEncryptKey,
            body: validPayload,
          }),
        },
        body: JSON.stringify(validPayload),
      });
      expect(accepted.status).toBe(200);
      expect((await accepted.json()).ok).toBe(true);

      const rejected = await fetch(`${baseUrl}/api/feishu/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildFeishuWebhookSignatureHeaders({
            encryptKey: config.webhookEncryptKey,
            body: {
              schema: "2.0",
              header: { event_type: "im.message.receive_v1", token: "wrong-token" },
              event: {
                message: {
                  message_id: "om_bad_token",
                  chat_id: "oc_bad_token",
                  message_type: "text",
                  content: JSON.stringify({
                    text: "帮我分析 OpenCroc 的平台定位和下一步 roadmap",
                  }),
                },
              },
            },
          }),
        },
        body: JSON.stringify({
          schema: "2.0",
          header: { event_type: "im.message.receive_v1", token: "wrong-token" },
          event: {
            message: {
              message_id: "om_bad_token",
              chat_id: "oc_bad_token",
              message_type: "text",
              content: JSON.stringify({ text: "帮我分析 OpenCroc 的平台定位和下一步 roadmap" }),
            },
          },
        }),
      });

      expect(rejected.status).toBe(401);
      expect(await rejected.json()).toEqual({
        ok: false,
        error: "Feishu webhook verification token mismatch",
      });
    }, { config });
  });

  it("decrypts encrypted webhook payloads before processing", async () => {
    const config = {
      webhookEncryptKey: "webhook-encrypt-key",
      webhookVerificationToken: "verification-token",
    };

    await withServer(async baseUrl => {
      const decryptedPayload = {
        schema: "2.0",
        header: {
          event_type: "im.message.receive_v1",
          token: "verification-token",
        },
        event: {
          message: {
            message_id: "om_encrypted",
            chat_id: "oc_encrypted",
            message_type: "text",
            content: JSON.stringify({ text: "帮我分析 OpenCroc 的平台定位和下一步 roadmap" }),
          },
        },
      };
      const rawPayload = {
        encrypt: encryptFeishuWebhookPayload(config.webhookEncryptKey, decryptedPayload),
      };

      const response = await fetch(`${baseUrl}/api/feishu/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildFeishuWebhookSignatureHeaders({
            encryptKey: config.webhookEncryptKey,
            body: rawPayload,
          }),
        },
        body: JSON.stringify(rawPayload),
      });

      expect(response.status).toBe(200);
      expect((await response.json()).ok).toBe(true);
    }, { config });
  });

  it("persists webhook dedup state across runtime restarts", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "feishu-webhook-dedup-"));
    const storePath = join(tempDir, "dedup.json");

    const payload = {
      schema: "2.0",
      header: { event_type: "im.message.receive_v1", event_id: "evt_persist_1" },
      event: {
        message: {
          message_id: "om_persist_1",
          chat_id: "oc_persist_1",
          message_type: "text",
          content: JSON.stringify({ text: "帮我分析 OpenCroc 的平台定位和下一步 roadmap" }),
        },
      },
    };

    try {
      await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/api/feishu/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        expect(response.status).toBe(200);
      }, {
        webhookDedupStore: new FileFeishuWebhookDedupStore(storePath),
      });

      await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/api/feishu/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          ok: true,
          ignored: true,
        });
      }, {
        webhookDedupStore: new FileFeishuWebhookDedupStore(storePath),
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects replayed relay requests with the same nonce and timestamp", async () => {
    const payload = {
      chatId: "oc_relay_auth_5",
      requestId: "om_relay_auth_5",
      text: "帮我分析 OpenCroc 的平台定位和下一步 roadmap",
    };

    await withServer(async baseUrl => {
      const headers = buildFeishuRelayAuthHeaders({
        secret: "relay-secret",
        method: "POST",
        path: "/api/feishu/relay",
        body: payload,
        nonce: "fixed-nonce",
      });

      const first = await fetch(`${baseUrl}/api/feishu/relay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      });
      const second = await fetch(`${baseUrl}/api/feishu/relay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({
        ok: false,
        error: "Relay request replay detected",
      });
    }, {
      config: { relaySecret: "relay-secret" },
    });
  });
});
