/**
 * NL Command Socket Emitter
 *
 * Wraps all nl_command_* Socket.IO event emissions with typed methods.
 * Uses a callback-based approach for loose coupling — the emitter does not
 * depend on Socket.IO directly; instead it accepts an `EmitFn` that the
 * caller wires to the real Socket.IO server instance.
 *
 * @see Requirements 9.4
 */

import { NL_COMMAND_SOCKET_EVENTS } from '../../../shared/nl-command/socket.js';
import type {
  NLCommandCreatedEvent,
  NLCommandAnalysisEvent,
  NLClarificationQuestionEvent,
  NLDecompositionCompleteEvent,
  NLPlanGeneratedEvent,
  NLPlanApprovedEvent,
  NLPlanAdjustedEvent,
  NLAlertEvent,
  NLProgressUpdateEvent,
  NLSuggestionEvent,
} from '../../../shared/nl-command/socket.js';
import type {
  StrategicCommand,
  CommandAnalysis,
  ClarificationQuestion,
  MissionDecomposition,
  NLExecutionPlan,
  PlanAdjustment,
  Alert,
} from '../../../shared/nl-command/contracts.js';

/** Generic emit function signature — maps to `io.emit(event, payload)`. */
export type EmitFn = (event: string, payload: unknown) => void;

export class NLCommandSocketEmitter {
  constructor(private readonly emit: EmitFn) {}

  /** Emit when a new strategic command is created. */
  emitCommandCreated(command: StrategicCommand): void {
    const payload: NLCommandCreatedEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.commandCreated,
      issuedAt: Date.now(),
      command,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.commandCreated, payload);
  }

  /** Emit when command analysis completes. */
  emitCommandAnalysis(commandId: string, analysis: CommandAnalysis): void {
    const payload: NLCommandAnalysisEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.commandAnalysis,
      issuedAt: Date.now(),
      commandId,
      analysis,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.commandAnalysis, payload);
  }

  /** Emit when clarification questions are generated. */
  emitClarificationQuestion(commandId: string, questions: ClarificationQuestion[]): void {
    const payload: NLClarificationQuestionEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.clarificationQuestion,
      issuedAt: Date.now(),
      commandId,
      questions,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.clarificationQuestion, payload);
  }

  /** Emit when mission decomposition completes. */
  emitDecompositionComplete(commandId: string, decomposition: MissionDecomposition): void {
    const payload: NLDecompositionCompleteEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.decompositionComplete,
      issuedAt: Date.now(),
      commandId,
      decomposition,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.decompositionComplete, payload);
  }

  /** Emit when an execution plan is generated. */
  emitPlanGenerated(commandId: string, plan: NLExecutionPlan): void {
    const payload: NLPlanGeneratedEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.planGenerated,
      issuedAt: Date.now(),
      commandId,
      plan,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.planGenerated, payload);
  }

  /** Emit when a plan is approved. */
  emitPlanApproved(planId: string, approvedBy: string[]): void {
    const payload: NLPlanApprovedEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.planApproved,
      issuedAt: Date.now(),
      planId,
      approvedBy,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.planApproved, payload);
  }

  /** Emit when a plan is adjusted. */
  emitPlanAdjusted(planId: string, adjustment: PlanAdjustment): void {
    const payload: NLPlanAdjustedEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.planAdjusted,
      issuedAt: Date.now(),
      planId,
      adjustment,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.planAdjusted, payload);
  }

  /** Emit an alert notification. */
  emitAlert(alert: Alert): void {
    const payload: NLAlertEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.alert,
      issuedAt: Date.now(),
      alert,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.alert, payload);
  }

  /** Emit a progress update. */
  emitProgressUpdate(data: Omit<NLProgressUpdateEvent, 'type' | 'issuedAt'>): void {
    const payload: NLProgressUpdateEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.progressUpdate,
      issuedAt: Date.now(),
      ...data,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.progressUpdate, payload);
  }

  /** Emit a decision suggestion. */
  emitSuggestion(data: Omit<NLSuggestionEvent, 'type' | 'issuedAt'>): void {
    const payload: NLSuggestionEvent = {
      type: NL_COMMAND_SOCKET_EVENTS.suggestion,
      issuedAt: Date.now(),
      ...data,
    };
    this.emit(NL_COMMAND_SOCKET_EVENTS.suggestion, payload);
  }
}
