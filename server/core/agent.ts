/**
 * Server-side agent wrapper built on top of the shared runtime agent core.
 *
 * Extended with dynamic role loading/unloading capabilities.
 * @see Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RuntimeAgentDependencies } from "../../shared/runtime-agent.js";
import {
  RuntimeAgent,
  type AgentInvokeOptions,
  setLineageCollector as setSharedLineageCollector,
} from "../../shared/runtime-agent.js";
import type { LineageCollector } from "../lineage/lineage-collector.js";
import type { RoleLoadPolicy, RoleOperationLog } from "../../shared/role-schema.js";
import type { WorkflowNodeModelConfig } from "../../shared/organization-schema.js";
import db from "../db/index.js";
import { sessionStore } from "../memory/session-store.js";
import { soulStore } from "../memory/soul-store.js";
import {
  ensureAgentWorkspace,
  type AgentWorkspaceScope,
} from "../memory/workspace.js";
import { readAgentWorkspaceFile, writeAgentWorkspaceFile, resolveAgentWorkspacePath } from "./access-guard.js";
import { callLLM, callLLMJson } from "./llm-client.js";
import { messageBus } from "./message-bus.js";
import { emitEvent } from "./socket.js";
import { telemetryStore } from "./telemetry-store.js";
import { roleRegistry } from "./role-registry.js";
import { roleConstraintValidator } from "./role-constraint-validator.js";
import { getRAGConfig } from "../rag/config.js";
import type { PermissionCheckEngine } from "../permission/check-engine.js";

// ─── Permission Error ───────────────────────────────────────────────────────

export class PermissionDeniedError extends Error {
  public readonly suggestion?: string;

  constructor(reason?: string, suggestion?: string) {
    super(reason ?? "Permission denied");
    this.name = "PermissionDeniedError";
    this.suggestion = suggestion;
  }
}

// ─── Singleton lineage collector (lazy, opt-in) ─────────────────────────────

export function setAgentLineageCollector(collector: LineageCollector): void {
  setSharedLineageCollector(collector);
}

// ─── Singleton permission check engine (lazy, opt-in) ───────────────────────

let _permissionCheckEngine: PermissionCheckEngine | undefined;

export function setPermissionCheckEngine(engine: PermissionCheckEngine): void {
  _permissionCheckEngine = engine;
}

export function getPermissionCheckEngine(): PermissionCheckEngine | undefined {
  return _permissionCheckEngine;
}

const __agent_filename = fileURLToPath(import.meta.url);
const __agent_dirname = dirname(__agent_filename);
const DATA_ROOT = resolve(__agent_dirname, '../../data/agents');

const MAX_OPERATION_LOG = 200;

export interface AgentConfig {
  id: string;
  name: string;
  department: string;
  role: "ceo" | "manager" | "worker";
  managerId: string | null;
  model: string;
  soulMd: string;
}

export interface AgentRoleState {
  currentRoleId: string | null;
  currentRoleLoadedAt: string | null;
  baseSystemPrompt: string;
  baseModelConfig: string;
  roleLoadPolicy: RoleLoadPolicy;
  lastRoleSwitchAt: string | null;
  roleSwitchCooldownMs: number;
  operationLog: RoleOperationLog[];
  /** Conceptual: skill IDs loaded by the current role */
  loadedSkillIds: string[];
  /** Conceptual: MCP IDs loaded by the current role */
  loadedMcpIds: string[];
  /** Effective model config after applying roleLoadPolicy merge */
  effectiveModelConfig: WorkflowNodeModelConfig | null;
  /** Agent's own base model config (full) for merge calculations */
  baseFullModelConfig: WorkflowNodeModelConfig | null;
}

/** Persistence file schema */
interface AgentRoleStateStore {
  currentRoleId: string | null;
  currentRoleLoadedAt: string | null;
  roleLoadPolicy: RoleLoadPolicy;
  lastRoleSwitchAt: string | null;
  roleSwitchCooldownMs: number;
  operationLog: RoleOperationLog[];
}

function defaultRoleState(soulMd: string, model: string): AgentRoleState {
  return {
    currentRoleId: null,
    currentRoleLoadedAt: null,
    baseSystemPrompt: soulMd,
    baseModelConfig: model,
    roleLoadPolicy: 'merge',
    lastRoleSwitchAt: null,
    roleSwitchCooldownMs: 60_000,
    operationLog: [],
    loadedSkillIds: [],
    loadedMcpIds: [],
    effectiveModelConfig: null,
    baseFullModelConfig: null,
  };
}

function getRoleStatePath(agentId: string): string {
  return resolve(DATA_ROOT, agentId, 'role-state.json');
}

function loadRoleStateFromDisk(agentId: string, soulMd: string, model: string): AgentRoleState {
  const filePath = getRoleStatePath(agentId);
  if (!existsSync(filePath)) {
    return defaultRoleState(soulMd, model);
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AgentRoleStateStore;
    return {
      currentRoleId: parsed.currentRoleId ?? null,
      currentRoleLoadedAt: parsed.currentRoleLoadedAt ?? null,
      baseSystemPrompt: soulMd,
      baseModelConfig: model,
      roleLoadPolicy: parsed.roleLoadPolicy ?? 'merge',
      lastRoleSwitchAt: parsed.lastRoleSwitchAt ?? null,
      roleSwitchCooldownMs: parsed.roleSwitchCooldownMs ?? 60_000,
      operationLog: Array.isArray(parsed.operationLog) ? parsed.operationLog : [],
      loadedSkillIds: [],
      loadedMcpIds: [],
      effectiveModelConfig: null,
      baseFullModelConfig: null,
    };
  } catch {
    console.warn(`[Agent] Role state file corrupted for ${agentId}, using defaults`);
    return defaultRoleState(soulMd, model);
  }
}

function persistRoleState(agentId: string, state: AgentRoleState): void {
  const filePath = getRoleStatePath(agentId);
  const data: AgentRoleStateStore = {
    currentRoleId: state.currentRoleId,
    currentRoleLoadedAt: state.currentRoleLoadedAt,
    roleLoadPolicy: state.roleLoadPolicy,
    lastRoleSwitchAt: state.lastRoleSwitchAt,
    roleSwitchCooldownMs: state.roleSwitchCooldownMs,
    operationLog: state.operationLog,
  };
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[Agent] Failed to persist role state for ${agentId}:`, err);
  }
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
  private roleState: AgentRoleState;
  private permissionToken?: string;

  /**
   * Set the permission token for this agent.
   * When set, file operations (saveToWorkspace, readFromWorkspace) will be
   * checked against the permission system before execution.
   */
  setPermissionToken(token: string): void {
    this.permissionToken = token;
  }

  /**
   * Get the current permission token (for testing / inspection).
   */
  getPermissionToken(): string | undefined {
    return this.permissionToken;
  }

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

    // Initialize role state from disk or defaults
    this.roleState = loadRoleStateFromDisk(config.id, config.soulMd, config.model);
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

  // ── Role Management Methods ──────────────────────────────────────

  /**
   * Load a role onto this agent.
   *
   * Flow: constraint validation → resolve template → inject prompt →
   * load skills/MCP → merge model config → update state → log → emit event
   *
   * @see Requirements 2.1, 2.4, 2.5
   */
  async loadRole(roleId: string, triggerSource: string): Promise<void> {
    // 1. Constraint validation
    const constraintError = roleConstraintValidator.validate(
      this,
      roleId,
      {
        currentRoleId: this.roleState.currentRoleId,
        hasIncompleteTasks: false, // caller should check this externally
        triggerSource,
        lastRoleSwitchAt: this.roleState.lastRoleSwitchAt,
        roleSwitchCooldownMs: this.roleState.roleSwitchCooldownMs,
      }
    );
    if (constraintError) {
      throw new Error(
        `[Agent] Role load denied (${constraintError.code}): ${constraintError.denialReason}`
      );
    }

    // 2. Resolve template with inheritance
    const template = roleRegistry.resolve(roleId);

    // 3. Save base prompt on first load (if not already saved)
    if (this.roleState.currentRoleId === null) {
      this.roleState.baseSystemPrompt = this.config.soulMd;
      this.roleState.baseModelConfig = this.config.model;
    }

    // 4. Inject responsibilityPrompt after base SOUL.md
    this.config.soulMd = this.roleState.baseSystemPrompt + '\n\n' + template.responsibilityPrompt;

    // 5. Load role-associated skills (conceptual — store on state)
    this.roleState.loadedSkillIds = [...template.requiredSkillIds];

    // 6. Load role-associated MCP tools (conceptual — store on state)
    this.roleState.loadedMcpIds = [...template.mcpIds];

    // 7. Merge model config based on roleLoadPolicy
    this.applyModelConfig(template.defaultModelConfig);

    // 8. Update state
    const previousRoleId = this.roleState.currentRoleId;
    this.roleState.currentRoleId = roleId;
    this.roleState.currentRoleLoadedAt = new Date().toISOString();
    this.roleState.lastRoleSwitchAt = new Date().toISOString();

    // 9. Record operation log
    this.appendOperationLog({
      agentId: this.config.id,
      roleId,
      action: 'load',
      timestamp: new Date().toISOString(),
      triggerSource,
    });

    // 10. Persist and emit event
    persistRoleState(this.config.id, this.roleState);
    emitEvent({
      type: "agent.roleChanged",
      agentId: this.config.id,
      fromRoleId: previousRoleId,
      toRoleId: roleId,
      timestamp: new Date().toISOString(),
    });

    console.log(`[Agent] ${this.config.id} loaded role ${roleId} (trigger: ${triggerSource})`);
  }

  /**
   * Unload the current role, restoring the agent to its base state.
   *
   * @see Requirements 2.2, 2.5
   */
  async unloadRole(triggerSource: string): Promise<void> {
    const previousRoleId = this.roleState.currentRoleId;
    if (previousRoleId === null) {
      console.warn(`[Agent] ${this.config.id} has no role loaded, skipping unload`);
      return;
    }

    // 1. Restore base system prompt
    this.config.soulMd = this.roleState.baseSystemPrompt;

    // 2. Unload role skills/MCP (clear from state)
    this.roleState.loadedSkillIds = [];
    this.roleState.loadedMcpIds = [];

    // 3. Restore original model config
    this.config.model = this.roleState.baseModelConfig;

    // 4. Clear role state
    this.roleState.currentRoleId = null;
    this.roleState.currentRoleLoadedAt = null;
    this.roleState.effectiveModelConfig = null;

    // 5. Record operation log
    this.appendOperationLog({
      agentId: this.config.id,
      roleId: previousRoleId,
      action: 'unload',
      timestamp: new Date().toISOString(),
      triggerSource,
    });

    // 6. Persist and emit event
    persistRoleState(this.config.id, this.roleState);
    emitEvent({
      type: "agent.roleChanged",
      agentId: this.config.id,
      fromRoleId: previousRoleId,
      toRoleId: null,
      timestamp: new Date().toISOString(),
    });

    console.log(`[Agent] ${this.config.id} unloaded role ${previousRoleId} (trigger: ${triggerSource})`);
  }

  /**
   * Transactional role switch: unload current → load new.
   * Rolls back to previous state on failure.
   *
   * @see Requirements 2.3
   */
  async switchRole(newRoleId: string, triggerSource: string): Promise<void> {
    // 1. Save current state snapshot for rollback
    const snapshot = {
      soulMd: this.config.soulMd,
      model: this.config.model,
      roleState: { ...this.roleState, operationLog: [...this.roleState.operationLog] },
    };

    try {
      // 2. Unload current role (if any)
      if (this.roleState.currentRoleId !== null) {
        await this.unloadRole(triggerSource);
      }

      // 3. Load new role
      await this.loadRole(newRoleId, triggerSource);
    } catch (err) {
      // 4. Rollback on failure
      console.error(`[Agent] ${this.config.id} switchRole failed, rolling back:`, err);
      this.config.soulMd = snapshot.soulMd;
      this.config.model = snapshot.model;
      this.roleState = snapshot.roleState;
      persistRoleState(this.config.id, this.roleState);
      throw err;
    }
  }

  /**
   * Get the currently loaded role ID, or null if no role is loaded.
   */
  getCurrentRoleId(): string | null {
    return this.roleState.currentRoleId;
  }

  /**
   * Get the role operation log entries.
   */
  getRoleOperationLog(): RoleOperationLog[] {
    return [...this.roleState.operationLog];
  }

  /**
   * Get the full role state (for testing / inspection).
   */
  getRoleState(): Readonly<AgentRoleState> {
    return this.roleState;
  }

  // ── Private Role Helpers ─────────────────────────────────────────

  /**
   * Apply model config based on roleLoadPolicy.
   *
   * - "override": replace agent model config entirely with role's defaultModelConfig
   * - "prefer_agent": keep agent's own model config
   * - "merge": use lower temperature and higher maxTokens from both configs
   */
  private applyModelConfig(roleModelConfig: WorkflowNodeModelConfig): void {
    const agentBaseConfig = this.roleState.baseFullModelConfig;

    switch (this.roleState.roleLoadPolicy) {
      case 'override':
        this.config.model = roleModelConfig.model;
        this.roleState.effectiveModelConfig = { ...roleModelConfig };
        break;
      case 'prefer_agent':
        // Keep agent's own config — no change to config.model
        if (agentBaseConfig) {
          this.roleState.effectiveModelConfig = { ...agentBaseConfig };
        } else {
          this.roleState.effectiveModelConfig = null;
        }
        break;
      case 'merge':
        this.config.model = roleModelConfig.model;
        if (agentBaseConfig) {
          this.roleState.effectiveModelConfig = {
            model: roleModelConfig.model,
            temperature: Math.min(agentBaseConfig.temperature, roleModelConfig.temperature),
            maxTokens: Math.max(agentBaseConfig.maxTokens, roleModelConfig.maxTokens),
          };
        } else {
          this.roleState.effectiveModelConfig = { ...roleModelConfig };
        }
        break;
    }
  }

  /**
   * Append an operation log entry, capping at MAX_OPERATION_LOG entries.
   */
  private appendOperationLog(entry: RoleOperationLog): void {
    this.roleState.operationLog.push(entry);
    if (this.roleState.operationLog.length > MAX_OPERATION_LOG) {
      this.roleState.operationLog = this.roleState.operationLog.slice(
        this.roleState.operationLog.length - MAX_OPERATION_LOG
      );
    }
  }

  // ── Existing Methods ─────────────────────────────────────────────

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
    // Permission check: if token is set, verify write permission before proceeding
    if (this.permissionToken) {
      const engine = getPermissionCheckEngine();
      if (engine) {
        const resolvedPath = resolveAgentWorkspacePath(this.config.id, filename, scope);
        const result = engine.checkPermission(
          this.config.id, "filesystem", "write", resolvedPath, this.permissionToken
        );
        if (!result.allowed) {
          throw new PermissionDeniedError(result.reason, result.suggestion);
        }
      }
    }
    return writeAgentWorkspaceFile(this.config.id, filename, content, scope);
  }

  readFromWorkspace(
    filename: string,
    scope: AgentWorkspaceScope = "root"
  ): string | null {
    this.ensureWorkspace();
    // Permission check: if token is set, verify read permission before proceeding
    if (this.permissionToken) {
      const engine = getPermissionCheckEngine();
      if (engine) {
        const resolvedPath = resolveAgentWorkspacePath(this.config.id, filename, scope);
        const result = engine.checkPermission(
          this.config.id, "filesystem", "read", resolvedPath, this.permissionToken
        );
        if (!result.allowed) {
          throw new PermissionDeniedError(result.reason, result.suggestion);
        }
      }
    }
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
