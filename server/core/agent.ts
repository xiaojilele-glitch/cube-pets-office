/**
 * Server-side agent wrapper built on top of the shared runtime agent core.
 */
import type { RuntimeAgentDependencies } from "../../shared/runtime-agent.js";
import {
  RuntimeAgent,
  type AgentInvokeOptions,
} from "../../shared/runtime-agent.js";
import db from "../db/index.js";
import { sessionStore } from "../memory/session-store.js";
import { soulStore } from "../memory/soul-store.js";
import {
  ensureAgentWorkspace,
  type AgentWorkspaceScope,
} from "../memory/workspace.js";
import { readAgentWorkspaceFile, writeAgentWorkspaceFile } from "./access-guard.js";
import { callLLM, callLLMJson } from "./llm-client.js";
import { messageBus } from "./message-bus.js";
import { emitEvent } from "./socket.js";
import { telemetryStore } from "./telemetry-store.js";
import { getRAGConfig } from "../rag/config.js";

export interface AgentConfig {
  id: string;
  name: string;
  department: string;
  role: "ceo" | "manager" | "worker";
  managerId: string | null;
  model: string;
  soulMd: string;
}

const sharedAgentDependencies: RuntimeAgentDependencies = {
  memoryRepo: {
    buildPromptContext: (agentId, query, workflowId) =>
      sessionStore.buildPromptContext(agentId, query, workflowId),
    appendLLMExchange: (agentId, options) =>
      sessionStore.appendLLMExchange(agentId, options),
    appendMessageLog: (agentId, options) =>
      sessionStore.appendMessageLog(agentId, options),
    materializeWorkflowMemories: workflowId =>
      sessionStore.materializeWorkflowMemories(workflowId),
    getSoulText: (agentId, fallbackSoulMd) =>
      soulStore.getSoulText(agentId, fallbackSoulMd),
    appendLearnedBehaviors: (agentId, behaviors) =>
      soulStore.appendLearnedBehaviors(agentId, behaviors),
  },
  llmProvider: {
    call: (messages, options) => callLLM(messages, options),
    callJson: (messages, options) => callLLMJson(messages, options),
  },
  eventEmitter: {
    emit: event => emitEvent(event),
  },
};

export class Agent extends RuntimeAgent {
  constructor(config: AgentConfig) {
    // Create per-agent dependencies with timing instrumentation
    const agentDeps: RuntimeAgentDependencies = {
      ...sharedAgentDependencies,
      llmProvider: {
        call: async (messages, options) => {
          const start = Date.now();
          try {
            const result = await callLLM(messages, options);
            return result;
          } finally {
            telemetryStore.recordAgentTiming({
              agentId: config.id,
              agentName: config.name,
              durationMs: Date.now() - start,
              timestamp: start,
            });
          }
        },
        callJson: async (messages, options) => {
          const start = Date.now();
          try {
            const result = await callLLMJson(messages, options);
            return result;
          } finally {
            telemetryStore.recordAgentTiming({
              agentId: config.id,
              agentName: config.name,
              durationMs: Date.now() - start,
              timestamp: start,
            });
          }
        },
      },
    };
    super(config, agentDeps);
  }

  static fromDB(agentId: string): Agent | null {
    const row = db.getAgent(agentId);
    if (!row) return null;

    return new Agent({
      id: row.id,
      name: row.name,
      department: row.department,
      role: row.role,
      managerId: row.manager_id,
      model: row.model,
      soulMd: soulStore.getSoulText(agentId, row.soul_md || ""),
    });
  }

  async sendMessage(
    toAgentId: string,
    content: string,
    workflowId: string,
    stage: string
  ): Promise<void> {
    await messageBus.send(this.config.id, toAgentId, content, workflowId, stage);
  }

  async getHistory(workflowId?: string, limit?: number): Promise<any[]> {
    const messages = await messageBus.getInbox(this.config.id, workflowId);
    return limit ? messages.slice(-limit) : messages;
  }

  ensureWorkspace(): string {
    return ensureAgentWorkspace(this.config.id).rootDir;
  }

  saveToWorkspace(
    filename: string,
    content: string,
    scope: AgentWorkspaceScope = "root"
  ): string {
    this.ensureWorkspace();
    return writeAgentWorkspaceFile(this.config.id, filename, content, scope);
  }

  readFromWorkspace(
    filename: string,
    scope: AgentWorkspaceScope = "root"
  ): string | null {
    this.ensureWorkspace();
    return readAgentWorkspaceFile(this.config.id, filename, scope);
  }

  /**
   * RAG 增强钩子：在 invoke 前注入检索到的上下文。
   * 根据 rag.augmentation.mode 控制行为（auto/on_demand/disabled）。
   */
  async invokeWithRAG(
    prompt: string,
    context?: string[],
    options: AgentInvokeOptions & { projectId?: string; taskId?: string } = {}
  ): Promise<string> {
    const ragConfig = getRAGConfig();
    if (!ragConfig.enabled || ragConfig.augmentation.mode === 'disabled') {
      return this.invoke(prompt, context, options);
    }

    try {
      const { initRAG } = await import("../rag/index.js");
      const deps = initRAG();
      const result = await deps.ragPipeline.augment(
        {
          taskId: options.taskId ?? '',
          projectId: options.projectId ?? '',
          directive: prompt,
        },
        {
          agentId: this.config.id,
          role: this.config.role,
        }
      );

      if (result.injectedChunks.length > 0) {
        const ragContext = result.injectedChunks.map(c =>
          `[${c.sourceType}:${c.sourceId}] ${c.content}`
        ).join('\n---\n');
        const augmentedContext = [...(context ?? []), `\n<RAG Context>\n${ragContext}\n</RAG Context>`];
        return this.invoke(prompt, augmentedContext, options);
      }
    } catch {
      // RAG failure — fall through to normal invoke
    }

    return this.invoke(prompt, context, options);
  }
}

export type { AgentInvokeOptions };
