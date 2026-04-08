import type { A2AInvokeParams, A2AResult } from "../../../shared/a2a-protocol";
import type { FrameworkAdapter } from "./types";

/** LangGraph 框架适配器 */
export class LangGraphAdapter implements FrameworkAdapter {
  frameworkType = "langgraph" as const;

  adaptRequest(params: A2AInvokeParams): {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  } {
    return {
      url: "",
      headers: { "Content-Type": "application/json" },
      body: {
        input: {
          task: params.task,
          context: params.context,
          capabilities: params.capabilities,
        },
        config: {
          configurable: {
            agent_id: params.targetAgent,
            stream_mode: params.streamMode,
          },
        },
      },
    };
  }

  adaptResponse(rawResponse: unknown): A2AResult {
    const raw = rawResponse as Record<string, unknown> | null | undefined;
    let output = "";

    if (raw && typeof raw === "object") {
      if (typeof raw.output === "string") {
        output = raw.output;
      } else if (
        raw.result &&
        typeof raw.result === "object" &&
        typeof (raw.result as Record<string, unknown>).output === "string"
      ) {
        output = (raw.result as Record<string, unknown>).output as string;
      }
    }

    return {
      output,
      artifacts: [],
      metadata: {},
    };
  }
}
