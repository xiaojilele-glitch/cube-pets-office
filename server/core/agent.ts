/**
 * Core agent abstraction.
 * Each agent carries identity, prompt context, workspace helpers,
 * and a consistent LLM invocation interface.
 */
import db from '../db/index.js';
import { sessionStore } from '../memory/session-store.js';
import {
  ensureAgentWorkspace,
  type AgentWorkspaceScope,
} from '../memory/workspace.js';
import { readAgentWorkspaceFile, writeAgentWorkspaceFile } from './access-guard.js';
import { callLLM, callLLMJson } from './llm-client.js';
import { messageBus } from './message-bus.js';
import { emitEvent } from './socket.js';

export interface AgentConfig {
  id: string;
  name: string;
  department: string;
  role: 'ceo' | 'manager' | 'worker';
  managerId: string | null;
  model: string;
  soulMd: string;
}

export interface AgentInvokeOptions {
  workflowId?: string;
  stage?: string;
}

export class Agent {
  config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Load an agent from the database.
   */
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
      soulMd: row.soul_md || '',
    });
  }

  /**
   * Invoke the LLM with the agent identity and optional context.
   */
  async invoke(prompt: string, context?: string[], options: AgentInvokeOptions = {}): Promise<string> {
    emitEvent({
      type: 'agent_active',
      agentId: this.config.id,
      action: 'thinking',
    });

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: this.buildSystemPrompt() },
    ];

    const memoryContext = sessionStore.buildPromptContext(this.config.id, prompt, options.workflowId);
    for (const ctx of memoryContext) {
      messages.push({ role: 'user', content: ctx });
    }

    if (context && context.length > 0) {
      for (const ctx of context) {
        messages.push({ role: 'user', content: ctx });
      }
    }

    messages.push({ role: 'user', content: prompt });

    const response = await callLLM(messages, {
      model: this.config.model,
      temperature: 0.7,
      maxTokens: 3000,
    });

    emitEvent({
      type: 'agent_active',
      agentId: this.config.id,
      action: 'idle',
    });
    sessionStore.appendLLMExchange(this.config.id, {
      workflowId: options.workflowId,
      stage: options.stage,
      prompt,
      response: response.content,
    });

    return response.content;
  }

  /**
   * Invoke the LLM and require a JSON response.
   */
  async invokeJson<T = any>(
    prompt: string,
    context?: string[],
    options: AgentInvokeOptions = {}
  ): Promise<T> {
    emitEvent({
      type: 'agent_active',
      agentId: this.config.id,
      action: 'thinking',
    });

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: `${this.buildSystemPrompt()}

Important JSON requirements:
- Return valid JSON only
- Do not wrap the JSON in Markdown code fences
- Do not include any explanation outside the JSON payload`,
      },
    ];

    const memoryContext = sessionStore.buildPromptContext(this.config.id, prompt, options.workflowId);
    for (const ctx of memoryContext) {
      messages.push({ role: 'user', content: ctx });
    }

    if (context && context.length > 0) {
      for (const ctx of context) {
        messages.push({ role: 'user', content: ctx });
      }
    }

    messages.push({ role: 'user', content: prompt });

    const result = await callLLMJson<T>(messages, {
      model: this.config.model,
      temperature: 0.5,
      maxTokens: 3000,
    });

    emitEvent({
      type: 'agent_active',
      agentId: this.config.id,
      action: 'idle',
    });
    sessionStore.appendLLMExchange(this.config.id, {
      workflowId: options.workflowId,
      stage: options.stage,
      prompt,
      response: JSON.stringify(result, null, 2),
    });

    return result;
  }

  /**
   * Send a message to another agent.
   */
  async sendMessage(
    toAgentId: string,
    content: string,
    workflowId: string,
    stage: string
  ): Promise<void> {
    await messageBus.send(this.config.id, toAgentId, content, workflowId, stage);
  }

  /**
   * Read inbox history for the current agent.
   */
  async getHistory(workflowId?: string, limit?: number): Promise<any[]> {
    const messages = await messageBus.getInbox(this.config.id, workflowId);
    return limit ? messages.slice(-limit) : messages;
  }

  /**
   * Build the system prompt from SOUL.md plus runtime identity info.
   */
  private buildSystemPrompt(): string {
    return `${this.config.soulMd}

---
Current identity: ${this.config.name}
Role: ${this.config.role}
Department: ${this.config.department}`;
  }

  /**
   * Ensure the agent workspace directory exists.
   */
  ensureWorkspace(): string {
    return ensureAgentWorkspace(this.config.id).rootDir;
  }

  /**
   * Save a file to the agent workspace.
   */
  saveToWorkspace(
    filename: string,
    content: string,
    scope: AgentWorkspaceScope = 'root'
  ): string {
    this.ensureWorkspace();
    return writeAgentWorkspaceFile(this.config.id, filename, content, scope);
  }

  /**
   * Read a file from the agent workspace.
   */
  readFromWorkspace(filename: string, scope: AgentWorkspaceScope = 'root'): string | null {
    this.ensureWorkspace();
    return readAgentWorkspaceFile(this.config.id, filename, scope);
  }
}
