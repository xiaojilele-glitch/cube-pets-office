/**
 * Collaboration Replay System — Event Interceptors
 *
 * Three interceptors that hook into existing systems to collect replay events
 * without modifying core business logic. All interceptors are defensive and
 * never throw errors that could affect the main business flow.
 *
 * Requirements: 1.3, 2.1, 2.3, 2.6, 3.2, 3.3, 4.2, 4.3, 5.1
 */

import type { Request, Response, NextFunction } from 'express';
import type { EventCollector } from './event-collector.js';

/* ─── installMissionInterceptor ─── */

/**
 * Hooks into MissionOrchestrator lifecycle via the `hooks` pattern.
 *
 * Wraps the existing `onMissionUpdated` hook so that every persist() call
 * emits the appropriate replay event (AGENT_STARTED, MILESTONE_REACHED,
 * AGENT_STOPPED, ERROR_OCCURRED) based on the mission record's status.
 *
 * The orchestrator parameter is typed loosely (`any`) to avoid tight coupling
 * with MissionOrchestrator internals. We only read from the `hooks` property.
 */
export function installMissionInterceptor(
  orchestrator: any,
  collector: EventCollector,
): void {
  try {
    // Preserve any existing hook so we don't break other consumers
    const previousHook: ((mission: any) => void | Promise<void>) | undefined =
      orchestrator.hooks?.onMissionUpdated;

    if (!orchestrator.hooks) {
      orchestrator.hooks = {};
    }

    orchestrator.hooks.onMissionUpdated = async (mission: any): Promise<void> => {
      // Always call the previous hook first
      try {
        await previousHook?.(mission);
      } catch {
        // Never let hook chain failures propagate
      }

      try {
        const missionId: string = mission?.id ?? 'unknown';
        const status: string = mission?.status ?? '';
        const stageKey: string = mission?.currentStageKey ?? '';
        const events: any[] = mission?.events ?? [];
        const latestEvent = events.length > 0 ? events[events.length - 1] : undefined;
        const source: string = latestEvent?.source ?? 'mission-core';

        if (status === 'queued' || (latestEvent?.kind === 'created')) {
          // Mission created
          collector.emit({
            missionId,
            eventType: 'AGENT_STARTED',
            sourceAgent: source,
            eventData: {
              action: 'mission_created',
              title: mission?.title ?? '',
              kind: mission?.kind ?? '',
              stageKey,
            },
            metadata: {
              phase: 'create',
              stageKey,
            },
          });
        } else if (status === 'done') {
          // Mission completed
          collector.emit({
            missionId,
            eventType: 'MILESTONE_REACHED',
            sourceAgent: source,
            eventData: {
              action: 'mission_completed',
              summary: mission?.summary ?? '',
              stageKey,
              progress: mission?.progress ?? 100,
            },
            metadata: {
              phase: 'complete',
              stageKey,
            },
          });
          collector.emit({
            missionId,
            eventType: 'AGENT_STOPPED',
            sourceAgent: source,
            eventData: {
              action: 'mission_completed',
              summary: mission?.summary ?? '',
            },
            metadata: {
              phase: 'complete',
              stageKey,
            },
          });
        } else if (status === 'failed') {
          // Mission failed
          collector.emit({
            missionId,
            eventType: 'ERROR_OCCURRED',
            sourceAgent: source,
            eventData: {
              action: 'mission_failed',
              summary: mission?.summary ?? '',
              stageKey,
            },
            metadata: {
              phase: 'fail',
              stageKey,
            },
          });
          collector.emit({
            missionId,
            eventType: 'AGENT_STOPPED',
            sourceAgent: source,
            eventData: {
              action: 'mission_failed',
              summary: mission?.summary ?? '',
            },
            metadata: {
              phase: 'fail',
              stageKey,
            },
          });
        } else if (status === 'running') {
          // Stage transition
          collector.emit({
            missionId,
            eventType: 'MILESTONE_REACHED',
            sourceAgent: source,
            eventData: {
              action: 'stage_transition',
              stageKey,
              detail: latestEvent?.detail ?? '',
              progress: mission?.progress ?? 0,
            },
            metadata: {
              phase: 'stageTransition',
              stageKey,
            },
          });
        }
      } catch {
        // Defensive: never let replay collection break the mission flow
      }
    };
  } catch {
    // Installation failure is non-fatal — replay degrades gracefully
  }
}

/* ─── installMessageBusInterceptor ─── */

/**
 * Wraps MessageBus.send() to collect MESSAGE_SENT and MESSAGE_RECEIVED events.
 *
 * The original send() is preserved and called first. Replay events are emitted
 * after the original call succeeds, so we capture the actual message row data.
 */
export function installMessageBusInterceptor(
  messageBus: any,
  collector: EventCollector,
): void {
  try {
    const originalSend = messageBus.send.bind(messageBus);

    messageBus.send = async function interceptedSend(
      fromId: string,
      toId: string,
      content: string,
      workflowId: string,
      stage: string,
      metadata?: any,
    ): Promise<any> {
      // Always call the original first — business logic must not be affected
      const result = await originalSend(fromId, toId, content, workflowId, stage, metadata);

      try {
        const messageId: string = result?.id?.toString() ?? `msg_${Date.now()}`;
        const missionId: string = workflowId ?? 'unknown';

        // MESSAGE_SENT from sender's perspective
        collector.emit({
          missionId,
          eventType: 'MESSAGE_SENT',
          sourceAgent: fromId,
          targetAgent: toId,
          eventData: {
            senderId: fromId,
            receiverId: toId,
            messageId,
            messageContent: content,
            messageType: 'INSTRUCTION' as const,
            status: 'SENT' as const,
          },
          metadata: {
            phase: stage,
            stageKey: stage,
          },
        });

        // MESSAGE_RECEIVED from receiver's perspective
        collector.emit({
          missionId,
          eventType: 'MESSAGE_RECEIVED',
          sourceAgent: toId,
          targetAgent: fromId,
          eventData: {
            senderId: fromId,
            receiverId: toId,
            messageId,
            messageContent: content,
            messageType: 'INSTRUCTION' as const,
            status: 'RECEIVED' as const,
          },
          metadata: {
            phase: stage,
            stageKey: stage,
          },
        });
      } catch {
        // Defensive: never let replay collection break message sending
      }

      return result;
    };
  } catch {
    // Installation failure is non-fatal
  }
}

/* ─── installExecutorInterceptor ─── */

/**
 * Returns Express middleware that intercepts executor callback events
 * and emits CODE_EXECUTED / RESOURCE_ACCESSED replay events.
 *
 * This middleware should be mounted BEFORE the main executor callback handler
 * so it can inspect the request body without consuming it.
 */
export function installExecutorInterceptor(
  collector: EventCollector,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const event = (req.body as any)?.event;
      if (!event?.missionId || !event?.eventId) {
        return next();
      }

      const missionId: string = event.missionId.trim();
      const executorName: string = event.executor?.trim() ?? 'executor';
      const stageKey: string = event.stageKey?.trim() ?? 'execute';
      const eventType: string = event.type?.trim() ?? '';
      const status: string = event.status?.trim() ?? '';

      // Emit CODE_EXECUTED for execution-related events
      if (
        eventType === 'job.progress' ||
        eventType === 'job.completed' ||
        stageKey === 'execute' ||
        stageKey === 'codegen'
      ) {
        collector.emit({
          missionId,
          eventType: 'CODE_EXECUTED',
          sourceAgent: executorName,
          eventData: {
            agentId: executorName,
            codeSnippet: event.detail ?? event.message ?? '',
            codeLanguage: 'unknown',
            executionInput: {
              jobId: event.jobId ?? '',
              stageKey,
            },
            executionOutput: {
              stdout: event.message ?? '',
              stderr: '',
              returnValue: event.summary ?? undefined,
            },
            executionStatus: mapExecutorStatus(status),
            executionTime: 0,
          },
          metadata: {
            phase: stageKey,
            stageKey,
          },
        });
      }

      // Emit RESOURCE_ACCESSED for artifact/payload events
      const artifacts = event.artifacts;
      if (Array.isArray(artifacts) && artifacts.length > 0) {
        for (const artifact of artifacts) {
          if (!artifact?.name) continue;
          collector.emit({
            missionId,
            eventType: 'RESOURCE_ACCESSED',
            sourceAgent: executorName,
            eventData: {
              agentId: executorName,
              resourceType: mapArtifactKindToResourceType(artifact.kind),
              resourceId: artifact.path ?? artifact.url ?? artifact.name,
              accessType: 'WRITE' as const,
              accessResult: {
                success: status !== 'failed' && status !== 'cancelled',
                dataSummary: artifact.description ?? artifact.name,
                duration: 0,
              },
            },
            metadata: {
              phase: stageKey,
              stageKey,
            },
          });
        }
      }

      // Emit RESOURCE_ACCESSED for instance/payload events (container provisioning)
      const instance = event.payload?.instance;
      if (instance?.id) {
        collector.emit({
          missionId,
          eventType: 'RESOURCE_ACCESSED',
          sourceAgent: executorName,
          eventData: {
            agentId: executorName,
            resourceType: 'API' as const,
            resourceId: instance.id,
            accessType: 'EXECUTE' as const,
            accessResult: {
              success: status !== 'failed' && status !== 'cancelled',
              dataSummary: `Container ${instance.image ?? 'unknown'}`,
              duration: 0,
            },
          },
          metadata: {
            phase: stageKey,
            stageKey,
          },
        });
      }
    } catch {
      // Defensive: never let replay collection break executor callbacks
    }

    next();
  };
}

/* ─── Helpers ─── */

function mapExecutorStatus(status: string): string {
  switch (status) {
    case 'completed':
      return 'SUCCESS';
    case 'failed':
    case 'cancelled':
      return 'FAILURE';
    default:
      return 'SUCCESS';
  }
}

function mapArtifactKindToResourceType(kind: string | undefined): string {
  switch (kind) {
    case 'file':
      return 'FILE';
    case 'url':
      return 'API';
    case 'report':
    case 'log':
      return 'FILE';
    default:
      return 'FILE';
  }
}
