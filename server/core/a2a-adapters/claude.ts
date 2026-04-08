import type { A2AInvokeParams, A2AResult } from "../../../shared/a2a-protocol";
import type { FrameworkAdapter } from "./types";

/** Claude Messages API 框架适配器 */
export class ClaudeAdapter implements FrameworkAdapter {
  frameworkType = "claude" as const;

  adaptRequest(params: A2AInvokeParams): {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  } {
    return {
      url: "",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: "claude-sonnet-4-20250514",
        system: params.context || "You are a helpful assistant.",
        messages: [{ role: "user", content: params.task }],
        tools: params.capabilities.map((c) => ({
          name: c,
          description: c,
          input_schema: { type: "object", properties: {} },
        })),
        max_tokens: 4096,
        stream: params.streamMode,
      },
    };
  }

  adaptResponse(rawResponse: unknown): A2AResult {
    const raw = rawResponse as Record<string, unknown> | null | undefined;
    let output = "";

    if (raw && typeof raw === "object") {
      if (Array.isArray(raw.content)) {
        const textBlock = raw.content.find(
          (block: unknown) =>
            block &&
            typeof block === "object" &&
            (block as Record<string, unknown>).type === "text",
        );
        if (
          textBlock &&
          typeof (textBlock as Record<string, unknown>).text === "string"
        ) {
          output = (textBlock as Record<string, unknown>).text as string;
        }
      } else if (typeof raw.output === "string") {
        output = raw.output;
      }
    }

    return {
      output,
      artifacts: [],
      metadata: {},
    };
  }
}
