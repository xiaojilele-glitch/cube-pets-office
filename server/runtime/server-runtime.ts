import type {
  LLMProvider,
  MemoryRepository,
  ReportRepository,
  RuntimeEventEmitter,
  WorkflowRepository,
  WorkflowRuntime,
} from "../../shared/workflow-runtime.js";

import db from "../db/index.js";
import { reportStore } from "../memory/report-store.js";
import { sessionStore } from "../memory/session-store.js";
import { soulStore } from "../memory/soul-store.js";
import {
  callLLM,
  callLLMJson,
  isLLMTemporarilyUnavailableError,
} from "../core/llm-client.js";
import { registry } from "../core/registry.js";
import { messageBus } from "../core/message-bus.js";
import { emitEvent } from "../core/socket.js";
import { evolutionService } from "../core/evolution.js";

const workflowRepo: WorkflowRepository = db;

const memoryRepo: MemoryRepository = {
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
};

const reportRepo: ReportRepository = reportStore;

const eventEmitter: RuntimeEventEmitter = {
  emit: event => emitEvent(event),
};

const llmProvider: LLMProvider = {
  call: (messages, options) => callLLM(messages, options),
  callJson: (messages, options) => callLLMJson(messages, options),
  isTemporarilyUnavailable: error => isLLMTemporarilyUnavailableError(error),
};

export const serverRuntime: WorkflowRuntime = {
  workflowRepo,
  memoryRepo,
  reportRepo,
  eventEmitter,
  llmProvider,
  agentDirectory: registry,
  messageBus,
  evolutionService,
};

/**
 * Late-bind the onStageCompleted callback after both the workflow engine
 * and mission system are initialised (avoids circular dependency).
 */
export function setOnStageCompleted(
  cb: (workflowId: string, completedStage: string) => void | Promise<void>,
): void {
  serverRuntime.onStageCompleted = cb;
}
