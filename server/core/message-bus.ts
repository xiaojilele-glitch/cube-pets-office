/**
 * Message bus for inter-agent communication with strict validation.
 * Enforces direct-report routing, workflow existence, and stage-specific flows.
 */
import db, { type AgentRow, type MessageRow } from '../db/index.js';
import { sessionStore } from '../memory/session-store.js';
import { getSocketIO } from './socket.js';

const WORKFLOW_STAGES = new Set([
  'direction',
  'planning',
  'execution',
  'review',
  'meta_audit',
  'revision',
  'verify',
  'summary',
  'feedback',
  'evolution',
]);

export class MessageBusValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MessageBusValidationError';
    this.code = code;
  }
}

function isDirectReport(manager: AgentRow, worker: AgentRow): boolean {
  return manager.role === 'manager' && worker.role === 'worker' && worker.manager_id === manager.id;
}

function validateStageRoute(from: AgentRow, to: AgentRow, stage: string): boolean {
  switch (stage) {
    case 'direction':
      return from.role === 'ceo' && to.role === 'manager';
    case 'planning':
      return isDirectReport(from, to);
    case 'execution':
    case 'revision':
      return isDirectReport(to, from);
    case 'review':
      return isDirectReport(from, to);
    case 'meta_audit':
      return from.department === 'meta';
    case 'verify':
      return isDirectReport(from, to) || isDirectReport(to, from);
    case 'summary':
      return from.role === 'manager' && to.role === 'ceo';
    case 'feedback':
      return from.role === 'ceo' && to.role === 'manager';
    case 'evolution':
      return from.id === to.id || from.department === 'meta';
    default:
      return false;
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

    if (!WORKFLOW_STAGES.has(stage)) {
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

    if (!validateStageRoute(fromAgent, toAgent, stage)) {
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

  /**
   * Validate general hierarchy: CEO <-> manager, manager <-> direct worker.
   * Meta agents are only exempt during explicit meta stages.
   */
  private validateHierarchy(from: AgentRow, to: AgentRow): boolean {
    if (from.role === 'ceo' && to.role === 'manager') return true;
    if (from.role === 'manager' && to.role === 'ceo') return true;
    if (isDirectReport(from, to)) return true;
    if (isDirectReport(to, from)) return true;

    if (from.department === 'meta' && from.role !== 'ceo') {
      return true;
    }

    return false;
  }
}

export const messageBus = new MessageBus();
