/**
 * Message bus for inter-agent communication with strict validation.
 * Enforces direct-report routing, workflow existence, and stage-specific flows.
 */
import type { WorkflowStage } from "../../shared/workflow-runtime.js";
import {
  WORKFLOW_STAGE_SET,
  validateHierarchy as validateHierarchyRule,
  validateStageRoute,
  validateCrossPod,
} from "../../shared/message-bus-rules.js";
import { DEFAULT_SWARM_CONFIG } from "../../shared/swarm.js";
import db, { type AgentRow, type MessageRow } from '../db/index.js';
import { sessionStore } from '../memory/session-store.js';
import { getSocketIO } from './socket.js';

export interface CrossPodMessageMetadata {
  crossPod: true;
  sourcePodId: string;
  targetPodId: string;
  collaborationSessionId?: string;
  contentPreview: string;
}

export class MessageBusValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MessageBusValidationError';
    this.code = code;
  }
}

export class MessageBus {
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
   * Send a cross-pod message between Manager agents of different departments.
   * Only Manager-to-Manager communication across different pods is allowed.
   */
  async sendCrossPod(
    fromId: string,
    toId: string,
    content: string,
    workflowId: string,
    metadata?: CrossPodMessageMetadata
  ): Promise<MessageRow> {
    if (!fromId.trim() || !toId.trim()) {
      throw new MessageBusValidationError('missing_agent_id', 'Sender and receiver IDs are required');
    }
    if (!content.trim()) {
      throw new MessageBusValidationError('empty_content', 'Message content must not be empty');
    }
    if (!workflowId.trim()) {
      throw new MessageBusValidationError('missing_workflow_id', 'workflowId is required');
    }

    const fromAgent = this.assertAgentExists(fromId, 'sender');
    const toAgent = this.assertAgentExists(toId, 'receiver');
    this.assertWorkflowExists(workflowId);

    // Validate same-pod violation first (more specific error)
    if (fromAgent.department === toAgent.department) {
      throw new MessageBusValidationError(
        'same_pod_violation',
        `Cross-pod messages must be between different pods: both agents are in "${fromAgent.department}"`
      );
    }

    // Validate cross-pod permissions (Manager-to-Manager)
    if (!validateCrossPod(fromAgent, toAgent)) {
      throw new MessageBusValidationError(
        'cross_pod_unauthorized',
        `Cross-pod messaging requires both agents to be managers: ${fromId} (${fromAgent.role}) -> ${toId} (${toAgent.role})`
      );
    }

    const contentPreview = content.substring(0, DEFAULT_SWARM_CONFIG.summaryMaxLength);

    const crossPodMeta: CrossPodMessageMetadata = metadata ?? {
      crossPod: true,
      sourcePodId: fromAgent.department,
      targetPodId: toAgent.department,
      contentPreview,
    };
    // Ensure contentPreview is always truncated
    crossPodMeta.contentPreview = content.substring(0, DEFAULT_SWARM_CONFIG.summaryMaxLength);

    const msg = db.createMessage({
      workflow_id: workflowId,
      from_agent: fromId,
      to_agent: toId,
      stage: 'cross_pod',
      content,
      metadata: crossPodMeta,
    });

    sessionStore.appendMessageLog(fromId, {
      workflowId,
      stage: 'cross_pod',
      direction: 'outbound',
      otherAgentId: toId,
      content,
      metadata: crossPodMeta,
    });
    sessionStore.appendMessageLog(toId, {
      workflowId,
      stage: 'cross_pod',
      direction: 'inbound',
      otherAgentId: fromId,
      content,
      metadata: crossPodMeta,
    });

    const io = getSocketIO();
    if (io) {
      io.emit('cross_pod_message', {
        sourcePodId: crossPodMeta.sourcePodId,
        targetPodId: crossPodMeta.targetPodId,
        contentPreview: crossPodMeta.contentPreview,
        messageId: msg.id,
      });
    }

    return msg;
  }

  /**
   * Retrieve the full content of a cross-pod message by its ID.
   * Used to fetch complete message content on demand (since cross-pod events only carry a summary preview).
   */
  async getCrossPodMessageContent(messageId: number): Promise<string> {
    const msg = db.getMessage(messageId);
    if (!msg) {
      throw new MessageBusValidationError(
        'message_not_found',
        `Message not found: ${messageId}`
      );
    }
    return msg.content;
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
