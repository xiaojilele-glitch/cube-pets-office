/**
 * GuestAgent — Temporary external agent with independent LLM configuration.
 *
 * Extends the base Agent class but overrides the LLM provider to use
 * the guest's own model/baseUrl/apiKey instead of the system default.
 *
 * @see Requirements 6.1, 6.2
 */
import type { RuntimeAgentDependencies } from "../../shared/runtime-agent.js";
import { RuntimeAgent } from "../../shared/runtime-agent.js";
import type {
  GuestAgentConfig,
  GuestAgentNode,
  GuestSkillDescriptor,
} from "../../shared/organization-schema.js";
import type { LLMProvider, LLMMessage, LLMCallOptions, LLMResponse } from "../../shared/workflow-runtime.js";
import { sessionStore } from "../memory/session-store.js";
import { emitEvent } from "./socket.js";
import { telemetryStore } from "./telemetry-store.js";

/**
 * Build a soul prompt for a guest agent based on its org node and skills.
 */
export function buildGuestSoulMd(orgNode: GuestAgentNode): string {
  const skillLines = orgNode.guestConfig.skills
    .map((s: GuestSkillDescriptor) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `You are ${orgNode.name}, a guest agent invited to assist with this mission.

Role: ${orgNode.role}
Department: ${orgNode.departmentLabel}
Responsibility: ${orgNode.responsibility}

Skills:
${skillLines || "- General assistance"}

You are a temporary participant. Focus on your assigned tasks and collaborate with your manager.`;
}

/**
 * Build prompt context for a guest agent, restricted to the current workflow only.
 *
 * Unlike the regular sessionStore.buildPromptContext, this does NOT search
 * cross-workflow memories — guest agents are ephemeral and should only see
 * context from their current mission (Requirement 5.4).
 *
 * @see Requirements 5.3, 5.4
 */
export function buildGuestPromptContext(agentId: string, workflowId?: string): string[] {
  if (!workflowId) return [];

  const entries = sessionStore.getWorkflowEntries(agentId, workflowId);
  if (entries.length === 0) return [];

  const relevant = entries.filter((e) => e.type !== "llm_prompt");
  const recent = relevant.slice(-12);
  const lines = recent
    .map((e) => {
      const stage = e.stage || "general";
      const dir = e.direction ? ` ${e.direction}` : "";
      const rel = e.otherAgentId ? ` ${e.otherAgentId}` : "";
      const content = e.content.length > 320 ? `${e.content.slice(0, 320)}...` : e.content;
      return `[${e.timestamp}] [${stage}] [${e.type}${dir}${rel}] ${content}`;
    })
    .join("\n\n");

  return [`以下是你在当前 workflow 中的上下文记录：\n${lines}`];
}

/**
 * Create an independent LLM provider using the guest agent's own configuration.
 * This ensures guest agents use their own model/baseUrl/apiKey, isolated from
 * the system default LLM configuration.
 *
 * @see Requirements 6.1
 */
export function createGuestLLMProvider(config: GuestAgentConfig): LLMProvider {
  const { baseUrl, apiKey, model } = config;

  async function callGuestLLM(
    messages: LLMMessage[],
    options?: LLMCallOptions,
  ): Promise<LLMResponse> {
    const resolvedModel = options?.model ?? model;
    const body = {
      model: resolvedModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 3000,
    };

    const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Guest LLM call failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as any;
    const content = data.choices?.[0]?.message?.content ?? "";
    return {
      content,
      usage: data.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  return {
    call: callGuestLLM,
    callJson: async <T = unknown>(
      messages: LLMMessage[],
      options?: LLMCallOptions,
    ): Promise<T> => {
      const response = await callGuestLLM(messages, options);
      return JSON.parse(response.content) as T;
    },
  };
}

/**
 * GuestAgent extends RuntimeAgent with an independent LLM provider.
 *
 * Unlike regular Agent (which uses the system-wide callLLM), GuestAgent
 * creates its own LLM provider from GuestAgentConfig, ensuring complete
 * isolation of model/baseUrl/apiKey.
 *
 * @see Requirements 6.1, 6.2
 */
export class GuestAgent extends RuntimeAgent {
  readonly guestConfig: GuestAgentConfig;

  constructor(id: string, config: GuestAgentConfig, orgNode: GuestAgentNode) {
    const guestLLMProvider = createGuestLLMProvider(config);

    // Wrap with telemetry instrumentation (same pattern as Agent)
    const instrumentedProvider: LLMProvider = {
      call: async (messages, options) => {
        const start = Date.now();
        try {
          return await guestLLMProvider.call(messages, options);
        } finally {
          telemetryStore.recordAgentTiming({
            agentId: id,
            agentName: orgNode.name,
            durationMs: Date.now() - start,
            timestamp: start,
          });
        }
      },
      callJson: async (messages, options) => {
        const start = Date.now();
        try {
          return await guestLLMProvider.callJson(messages, options);
        } finally {
          telemetryStore.recordAgentTiming({
            agentId: id,
            agentName: orgNode.name,
            durationMs: Date.now() - start,
            timestamp: start,
          });
        }
      },
    };

    const deps: RuntimeAgentDependencies = {
      memoryRepo: {
        buildPromptContext: (agentId, _query, workflowId) =>
          buildGuestPromptContext(agentId, workflowId),
        appendLLMExchange: (agentId, options) =>
          sessionStore.appendLLMExchange(agentId, options),
        appendMessageLog: (agentId, opts) =>
          sessionStore.appendMessageLog(agentId, opts),
        materializeWorkflowMemories: (_workflowId) => {
          /* Guest agents are ephemeral — no cross-workflow memory materialization */
        },
        getSoulText: (_agentId, fallback) => fallback ?? "",
        appendLearnedBehaviors: (_agentId, _behaviors) => "",
      },
      llmProvider: instrumentedProvider,
      eventEmitter: {
        emit: (event) => emitEvent(event),
      },
    };

    super(
      {
        id,
        name: orgNode.name,
        department: orgNode.departmentId,
        role: orgNode.role,
        managerId: orgNode.parentId,
        model: config.model,
        soulMd: buildGuestSoulMd(orgNode),
        isGuest: true,
      },
      deps,
    );

    this.guestConfig = config;
  }
}
