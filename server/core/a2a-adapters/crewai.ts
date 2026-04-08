import type { A2AInvokeParams, A2AResult } from "../../../shared/a2a-protocol";
import type { FrameworkAdapter } from "./types";

/** CrewAI 框架适配器 */
export class CrewAIAdapter implements FrameworkAdapter {
  frameworkType = "crewai" as const;

  adaptRequest(params: A2AInvokeParams): {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  } {
    return {
      url: "",
      headers: { "Content-Type": "application/json" },
      body: {
        agent_role: params.targetAgent,
        task_description: params.task,
        expected_output: "completion",
        context: params.context,
        tools: params.capabilities,
      },
    };
  }

  adaptResponse(rawResponse: unknown): A2AResult {
    const raw = rawResponse as Record<string, unknown> | null | undefined;
    let output = "";

    if (raw && typeof raw === "object") {
      if (typeof raw.result === "string") {
        output = raw.result;
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
