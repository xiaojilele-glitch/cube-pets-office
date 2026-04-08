/**
 * Message bus for inter-agent communication with strict validation.
 * Enforces direct-report routing, workflow existence, and stage-specific flows.
 */
import type { WorkflowStage } from "../../shared/workflow-runtime.js";
import {
  WORKFLOW_STAGE_SET,
  validateHierarchy as validateHierarchyRule,
  validateStageRoute,
} from "../../shared/message-bus-rules.js";
import db, { type AgentRow, type MessageRow } from '../db/index.js';
import { sessionStore } from '../memory/session-store.js';
import { getSocketIO } from './socket.js';
import type { A2AFrameworkType, A2AResponse } from "../../shared/a2a-protocol.js";

export class MessageBusValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MessageBusValidationError';
    this.code = code;
  }
}

class MessageBus {
  /**
   * Send a message between agents with strict routing validation.
   */
  async send(
    fromId: string,
    toId: string,
    content: string,
    workflowId: string,
    stage: string,
    metadata?: any
  ): Promise<MessageRow> {
    this.assertSendableMessage(fromId, toId, content, workflowId, stage);

    const msg = db.createMessage({
      workflow_id: workflowId,
      from_agent: fromId,
      to_agent: toId,
      stage,
      content,
      metadata: metadata || null,
    });

    sessionStore.appendMessageLog(fromId, {
      workflowId,
      stage,
      direction: 'outbound',
      otherAgentId: toId,
      content,
      metadata,
    });
    sessionStore.appendMessageLog(toId, {
      workflowId,
      stage,
      direction: 'inbound',
      otherAgentId: fromId,
      content,
      metadata,
    });

    const io = getSocketIO();
    if (io) {
      io.emit('agent_event', {
        type: 'message_sent',
        workflowId,
        from: fromId,
        to: toId,
        stage,
        preview: content.substring(0, 100),
        timestamp: msg.created_at,
      });
    }

    return msg;
  }

  /**
   * Get inbox for an agent.
   */
  async getInbox(agentId: string, workflowId?: string): Promise<MessageRow[]> {
    this.assertAgentExists(agentId, 'receiver');
    if (workflowId) {
      this.assertWorkflowExists(workflowId);
    }
    return db.getInbox(agentId, workflowId);
  }

  /**
   * Get all messages for a workflow.
   */
  async getWorkflowMessages(workflowId: string): Promise<MessageRow[]> {
    this.assertWorkflowExists(workflowId);
    return db.getMessagesByWorkflow(workflowId);
  }

  /**
   * Send an A2A message to an external agent.
   * Bypasses hierarchy/stage validation since external agents are outside the org.
   */
  async sendA2A(
    fromId: string,
    toExternalId: string,
    content: string,
    workflowId: string,
    metadata?: { frameworkType: A2AFrameworkType; sessionId: string; [key: string]: unknown }
  ): Promise<MessageRow> {
    if (!fromId.trim() || !toExternalId.trim()) {
      throw new MessageBusValidationError('missing_agent_id', 'Sender and receiver IDs are required');
    }
    if (!content.trim()) {
      throw new MessageBusValidationError('empty_content', 'Message content must not be empty');
    }
    if (!workflowId.trim()) {
      throw new MessageBusValidationError('missing_workflow_id', 'workflowId is required');
    }

    const a2aMetadata = {
      ...metadata,
      a2a: true as const,
      frameworkType: metadata?.frameworkType ?? ("custom" as A2AFrameworkType),
      sessionId: metadata?.sessionId ?? "",
      direction: "outbound" as const,
    };

    const msg = db.createMessage({
      workflow_id: workflowId,
      from_agent: fromId,
      to_agent: toExternalId,
      stage: "execute",
      content,
      metadata: a2aMetadata,
    });

    const io = getSocketIO();
    if (io) {
      io.emit("a2a_message", {
        type: "a2a_outbound",
        workflowId,
        from: fromId,
        to: toExternalId,
        frameworkType: a2aMetadata.frameworkType,
        sessionId: a2aMetadata.sessionId,
        preview: content.substring(0, 100),
        timestamp: msg.created_at,
      });
    }

    return msg;
  }

  /**
   * Deliver an A2A response back to the originating internal agent.
   */
  async deliverA2AResponse(
    sessionId: string,
    response: A2AResponse,
    workflowId: string
  ): Promise<void> {
    const io = getSocketIO();
    if (io) {
      io.emit("a2a_message", {
        type: "a2a_inbound",
        workflowId,
        sessionId,
        hasError: !!response.error,
        preview: response.result?.output?.substring(0, 100) ?? response.error?.message ?? "",
        timestamp: new Date().toISOString(),
      });
    }
  }

  private assertSendableMessage(
    fromId: string,
    toId: string,
    content: string,
    workflowId: string,
    stage: string
  ): void {
    if (!fromId.trim() || !toId.trim()) {
      throw new MessageBusValidationError('missing_agent_id', 'Sender and receiver IDs are required');
    }

    if (!content.trim()) {
      throw new MessageBusValidationError('empty_content', 'Message content must not be empty');
    }

    if (!workflowId.trim()) {
      throw new MessageBusValidationError('missing_workflow_id', 'workflowId is required');
    }

    if (!WORKFLOW_STAGE_SET.has(stage)) {
      throw new MessageBusValidationError('invalid_stage', `Unsupported message stage: ${stage}`);
    }

    const fromAgent = this.assertAgentExists(fromId, 'sender');
    const toAgent = this.assertAgentExists(toId, 'receiver');
    this.assertWorkflowExists(workflowId);

    if (!this.validateHierarchy(fromAgent, toAgent)) {
      throw new MessageBusValidationError(
        'hierarchy_violation',
        `Hierarchy violation: ${fromId} (${fromAgent.role}) -> ${toId} (${toAgent.role})`
      );
    }

    if (!validateStageRoute(fromAgent, toAgent, stage as WorkflowStage)) {
      throw new MessageBusValidationError(
        'stage_route_violation',
        `Stage route violation at ${stage}: ${fromId} -> ${toId}`
      );
    }
  }

  private assertAgentExists(agentId: string, label: 'sender' | 'receiver'): AgentRow {
    const agent = db.getAgent(agentId);
    if (!agent) {
      throw new MessageBusValidationError('unknown_agent', `${label} agent not found: ${agentId}`);
    }
    return agent;
  }

  private assertWorkflowExists(workflowId: string): void {
    const workflow = db.getWorkflow(workflowId);
    if (!workflow) {
      throw new MessageBusValidationError(
        'unknown_workflow',
        `Workflow not found for message bus operation: ${workflowId}`
      );
    }
  }

  private validateHierarchy(from: AgentRow, to: AgentRow): boolean {
    return validateHierarchyRule(from, to);
  }
}

export const messageBus = new MessageBus();
