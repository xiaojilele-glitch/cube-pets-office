/**
 * Audit Integration Hooks
 *
 * Non-invasive audit event collection for existing modules.
 * Called once during server startup via installAuditHooks().
 *
 * Strategy: monkey-patch key methods on singleton instances to inject
 * audit recording. Original behavior is preserved — audit failures
 * are silently caught and never break the main application.
 */

import { AuditEventType } from "../../shared/audit/contracts.js";
import type { AuditCollector } from "./audit-collector.js";
import { auditCollector } from "./audit-collector.js";

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Install audit collection hooks into existing modules.
 * Called once during server startup.
 */
export function installAuditHooks(deps: {
  collector?: AuditCollector;
} = {}): void {
  const collector = deps.collector ?? auditCollector;

  installWorkflowHooks(collector);
  installMissionHooks(collector);
  installOrganizationHooks(collector);
  installMessageBusHooks(collector);
  installMemoryHooks(collector);
  installFeishuHooks(collector);
}

// ─── 14.1 Workflow Engine Integration ──────────────────────────────────────

/**
 * Hook into WorkflowEngine stage completion events.
 * - direction complete → DECISION_MADE
 * - execution complete → AGENT_EXECUTED (or AGENT_FAILED on error)
 * - meta_audit complete → DATA_ACCESSED
 */
function installWorkflowHooks(collector: AuditCollector): void {
  try {
    // Dynamic import to avoid circular deps — we access the runtime callback
    const { WorkflowEngine } = require("../core/workflow-engine.js") as {
      WorkflowEngine: { prototype: Record<string, unknown> };
    };

    const proto = WorkflowEngine.prototype;
    const originalEmitStageCompleted = proto["emitStageCompleted"] as
      | ((workflowId: string, stage: string) => Promise<void>)
      | undefined;

    if (typeof originalEmitStageCompleted !== "function") return;

    proto["emitStageCompleted"] = async function (
      this: unknown,
      workflowId: string,
      completedStage: string,
    ): Promise<void> {
      // Always call original first
      await originalEmitStageCompleted.call(this, workflowId, completedStage);

      try {
        if (completedStage === "direction") {
          collector.record({
            eventType: AuditEventType.DECISION_MADE,
            actor: { type: "system", id: "workflow-engine" },
            action: `Workflow direction stage completed`,
            resource: { type: "workflow", id: workflowId, name: "direction" },
            result: "success",
            context: { sessionId: workflowId },
            metadata: { stage: completedStage },
          });
        } else if (completedStage === "execution") {
          collector.record({
            eventType: AuditEventType.AGENT_EXECUTED,
            actor: { type: "system", id: "workflow-engine" },
            action: `Workflow execution stage completed`,
            resource: { type: "workflow", id: workflowId, name: "execution" },
            result: "success",
            context: { sessionId: workflowId },
            metadata: { stage: completedStage },
          });
        } else if (completedStage === "meta_audit") {
          collector.record({
            eventType: AuditEventType.DATA_ACCESSED,
            actor: { type: "system", id: "workflow-engine" },
            action: `Workflow meta_audit stage completed`,
            resource: { type: "workflow", id: workflowId, name: "meta_audit" },
            result: "success",
            context: { sessionId: workflowId },
            metadata: { stage: completedStage },
          });
        }
      } catch {
        // Audit hook must never break the workflow
      }
    };
  } catch {
    // Module not available — skip
  }
}

// ─── 14.2 Mission Orchestrator Integration ─────────────────────────────────

/**
 * Hook into MissionOrchestrator key operations.
 * - startMission → DECISION_MADE
 * - applyExecutorEvent → AGENT_EXECUTED / AGENT_FAILED
 */
function installMissionHooks(collector: AuditCollector): void {
  try {
    const { MissionOrchestrator } = require("../core/mission-orchestrator.js") as {
      MissionOrchestrator: { prototype: Record<string, unknown> };
    };

    const proto = MissionOrchestrator.prototype;

    // Hook startMission
    const originalStartMission = proto["startMission"] as
      | ((input: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (typeof originalStartMission === "function") {
      proto["startMission"] = async function (
        this: unknown,
        input: Record<string, unknown>,
      ): Promise<unknown> {
        const result = await originalStartMission.call(this, input);

        try {
          const missionId = (input.missionId as string) || "unknown";
          collector.record({
            eventType: AuditEventType.DECISION_MADE,
            actor: { type: "system", id: "mission-orchestrator" },
            action: `Mission started: ${input.title || missionId}`,
            resource: { type: "mission", id: missionId },
            result: "success",
            context: { sessionId: missionId },
            metadata: { title: input.title, topicId: input.topicId },
          });
        } catch {
          // Audit hook must never break mission start
        }

        return result;
      };
    }

    // Hook applyExecutorEvent
    const originalApplyEvent = proto["applyExecutorEvent"] as
      | ((event: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (typeof originalApplyEvent === "function") {
      proto["applyExecutorEvent"] = async function (
        this: unknown,
        event: Record<string, unknown>,
      ): Promise<unknown> {
        let result: unknown;
        let failed = false;
        try {
          result = await originalApplyEvent.call(this, event);
        } catch (err) {
          failed = true;
          // Record failure then re-throw
          try {
            collector.record({
              eventType: AuditEventType.AGENT_FAILED,
              actor: { type: "system", id: "mission-orchestrator" },
              action: `Executor event processing failed: ${event.type}`,
              resource: { type: "mission", id: String(event.missionId || "unknown") },
              result: "failure",
              context: { sessionId: String(event.missionId || "") },
              metadata: { eventType: event.type, jobId: event.jobId },
            });
          } catch {
            // Swallow audit errors
          }
          throw err;
        }

        if (!failed) {
          try {
            const status = event.status as string | undefined;
            const eventType =
              status === "failed" || status === "cancelled"
                ? AuditEventType.AGENT_FAILED
                : AuditEventType.AGENT_EXECUTED;
            const auditResult =
              status === "failed" || status === "cancelled" ? "failure" : "success";

            collector.record({
              eventType,
              actor: { type: "system", id: "mission-orchestrator" },
              action: `Executor event applied: ${event.type}`,
              resource: { type: "mission", id: String(event.missionId || "unknown") },
              result: auditResult,
              context: { sessionId: String(event.missionId || "") },
              metadata: { eventType: event.type, status, jobId: event.jobId },
            });
          } catch {
            // Swallow audit errors
          }
        }

        return result;
      };
    }
  } catch {
    // Module not available — skip
  }
}

// ─── 14.3 Dynamic Organization Integration ─────────────────────────────────

/**
 * Hook into dynamic organization generation and permission assignment.
 * - generateWorkflowOrganization → CONFIG_CHANGED
 * - assignOrganizationPermissions → PERMISSION_GRANTED
 */
function installOrganizationHooks(collector: AuditCollector): void {
  try {
    const mod = require("../core/dynamic-organization.js") as Record<string, unknown>;

    // Hook generateWorkflowOrganization
    const originalGenerate = mod["generateWorkflowOrganization"] as
      | ((options: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (typeof originalGenerate === "function") {
      mod["generateWorkflowOrganization"] = async function (
        options: Record<string, unknown>,
      ): Promise<unknown> {
        const result = await originalGenerate(options);

        try {
          const workflowId = String(options.workflowId || "unknown");
          collector.record({
            eventType: AuditEventType.CONFIG_CHANGED,
            actor: { type: "system", id: "dynamic-organization" },
            action: `Workflow organization generated`,
            resource: { type: "workflow", id: workflowId, name: "organization" },
            result: "success",
            context: { sessionId: workflowId },
            metadata: { directive: typeof options.directive === "string" ? options.directive.slice(0, 200) : undefined },
          });
        } catch {
          // Swallow audit errors
        }

        return result;
      };
    }

    // Hook assignOrganizationPermissions
    const originalAssign = mod["assignOrganizationPermissions"] as
      | ((org: Record<string, unknown>, ...rest: unknown[]) => void)
      | undefined;

    if (typeof originalAssign === "function") {
      mod["assignOrganizationPermissions"] = function (
        organization: Record<string, unknown>,
        ...rest: unknown[]
      ): void {
        originalAssign(organization, ...rest);

        try {
          const orgId = String(
            (organization as { organizationId?: string }).organizationId ||
            (organization as { rootNodeId?: string }).rootNodeId ||
            "unknown",
          );
          const nodes = Array.isArray((organization as { nodes?: unknown[] }).nodes)
            ? (organization as { nodes: Array<{ agentId?: string }> }).nodes
            : [];

          for (const node of nodes) {
            if (node.agentId) {
              collector.record({
                eventType: AuditEventType.PERMISSION_GRANTED,
                actor: { type: "system", id: "dynamic-organization" },
                action: `Agent role assigned in organization`,
                resource: { type: "agent", id: node.agentId },
                result: "success",
                metadata: { organizationId: orgId },
              });
            }
          }
        } catch {
          // Swallow audit errors
        }
      };
    }
  } catch {
    // Module not available — skip
  }
}

// ─── 14.4 Message Bus Integration ──────────────────────────────────────────

/**
 * Hook into MessageBus to record hierarchy violation rejections.
 * - send() throws hierarchy_violation → PERMISSION_REVOKED
 */
function installMessageBusHooks(collector: AuditCollector): void {
  try {
    const { messageBus } = require("../core/message-bus.js") as {
      messageBus: Record<string, unknown>;
    };

    if (!messageBus) return;

    const originalSend = messageBus["send"] as
      | ((
          fromId: string,
          toId: string,
          content: string,
          workflowId: string,
          stage: string,
          metadata?: unknown,
        ) => Promise<unknown>)
      | undefined;

    if (typeof originalSend !== "function") return;

    messageBus["send"] = async function (
      this: unknown,
      fromId: string,
      toId: string,
      content: string,
      workflowId: string,
      stage: string,
      metadata?: unknown,
    ): Promise<unknown> {
      try {
        return await originalSend.call(this, fromId, toId, content, workflowId, stage, metadata);
      } catch (err: unknown) {
        // Record hierarchy violations as PERMISSION_REVOKED
        const code = (err as { code?: string })?.code;
        if (code === "hierarchy_violation" || code === "stage_route_violation") {
          try {
            collector.record({
              eventType: AuditEventType.PERMISSION_REVOKED,
              actor: { type: "agent", id: fromId },
              action: `Message rejected: ${code}`,
              resource: { type: "agent", id: toId },
              result: "denied",
              context: { sessionId: workflowId },
              metadata: { stage, violationCode: code },
            });
          } catch {
            // Swallow audit errors
          }
        }
        throw err;
      }
    };
  } catch {
    // Module not available — skip
  }
}

// ─── 14.5 Memory System Integration ───────────────────────────────────────

/**
 * Hook into memory system data access.
 * - VectorStore.searchMemorySummaries → DATA_ACCESSED
 * - SoulStore.updateSoul → CONFIG_CHANGED
 */
function installMemoryHooks(collector: AuditCollector): void {
  try {
    // Hook VectorStore search
    try {
      const { VectorStore } = require("../memory/vector-store.js") as {
        VectorStore: { prototype: Record<string, unknown> };
      };

      const vProto = VectorStore.prototype;
      const originalSearch = vProto["searchMemorySummaries"] as
        | ((agentId: string, query: string, topK?: number) => unknown[])
        | undefined;

      if (typeof originalSearch === "function") {
        vProto["searchMemorySummaries"] = function (
          this: unknown,
          agentId: string,
          query: string,
          topK?: number,
        ): unknown[] {
          const results = originalSearch.call(this, agentId, query, topK);

          try {
            collector.record({
              eventType: AuditEventType.DATA_ACCESSED,
              actor: { type: "agent", id: agentId },
              action: `Vector memory search`,
              resource: { type: "data", id: `vector-store:${agentId}` },
              result: "success",
              metadata: { query: query.slice(0, 200), topK, resultCount: results.length },
            });
          } catch {
            // Swallow audit errors
          }

          return results;
        };
      }
    } catch {
      // VectorStore not available
    }

    // Hook SoulStore update
    try {
      const { SoulStore } = require("../memory/soul-store.js") as {
        SoulStore: { prototype: Record<string, unknown> };
      };

      const sProto = SoulStore.prototype;
      const originalUpdateSoul = sProto["updateSoul"] as
        | ((agentId: string, soulMd: string) => string)
        | undefined;

      if (typeof originalUpdateSoul === "function") {
        sProto["updateSoul"] = function (
          this: unknown,
          agentId: string,
          soulMd: string,
        ): string {
          const result = originalUpdateSoul.call(this, agentId, soulMd);

          try {
            collector.record({
              eventType: AuditEventType.CONFIG_CHANGED,
              actor: { type: "agent", id: agentId },
              action: `SOUL.md updated`,
              resource: { type: "config", id: `soul:${agentId}`, name: "SOUL.md" },
              result: "success",
              metadata: { contentLength: soulMd.length },
            });
          } catch {
            // Swallow audit errors
          }

          return result;
        };
      }
    } catch {
      // SoulStore not available
    }
  } catch {
    // Memory module not available — skip
  }
}

// ─── 14.6 Feishu Integration ──────────────────────────────────────────────

/**
 * Hook into Feishu integration.
 * - createFeishuRelayAuth → USER_LOGIN (successful auth) / USER_LOGOUT (auth failure)
 * - startComplexFeishuTask → DECISION_MADE
 */
function installFeishuHooks(collector: AuditCollector): void {
  try {
    // Hook relay auth verification
    try {
      const relayAuthMod = require("../feishu/relay-auth.js") as Record<string, unknown>;
      const originalCreateAuth = relayAuthMod["createFeishuRelayAuth"] as
        | ((config: Record<string, unknown>) => Record<string, unknown>)
        | undefined;

      if (typeof originalCreateAuth === "function") {
        relayAuthMod["createFeishuRelayAuth"] = function (
          config: Record<string, unknown>,
        ): Record<string, unknown> {
          const auth = originalCreateAuth(config);
          const originalVerify = auth["verifyRequest"] as
            | ((req: unknown, res: unknown, path: string) => boolean)
            | undefined;

          if (typeof originalVerify === "function") {
            auth["verifyRequest"] = function (
              this: unknown,
              req: unknown,
              res: unknown,
              path: string,
            ): boolean {
              const ok = originalVerify.call(this, req, res, path);

              try {
                if (ok) {
                  collector.record({
                    eventType: AuditEventType.USER_LOGIN,
                    actor: { type: "system", id: "feishu-relay" },
                    action: `Relay auth verified`,
                    resource: { type: "config", id: "feishu-relay", name: path },
                    result: "success",
                    metadata: { path },
                  });
                } else {
                  collector.record({
                    eventType: AuditEventType.USER_LOGOUT,
                    actor: { type: "system", id: "feishu-relay" },
                    action: `Relay auth rejected`,
                    resource: { type: "config", id: "feishu-relay", name: path },
                    result: "denied",
                    metadata: { path },
                  });
                }
              } catch {
                // Swallow audit errors
              }

              return ok;
            };
          }

          return auth;
        };
      }
    } catch {
      // Relay auth module not available
    }

    // Hook task start
    try {
      const taskStartMod = require("../feishu/task-start.js") as Record<string, unknown>;
      const originalStart = taskStartMod["startComplexFeishuTask"] as
        | ((...args: unknown[]) => Promise<Record<string, unknown>>)
        | undefined;

      if (typeof originalStart === "function") {
        taskStartMod["startComplexFeishuTask"] = async function (
          ...args: unknown[]
        ): Promise<Record<string, unknown>> {
          const result = await originalStart(...args);

          try {
            const taskId = (result as { result?: { taskId?: string } })?.result?.taskId || "unknown";
            collector.record({
              eventType: AuditEventType.DECISION_MADE,
              actor: { type: "system", id: "feishu-bridge" },
              action: `Feishu complex task started`,
              resource: { type: "mission", id: taskId, name: "feishu-task" },
              result: result.ok ? "success" : "failure",
              metadata: { taskId },
            });
          } catch {
            // Swallow audit errors
          }

          return result;
        };
      }
    } catch {
      // Task start module not available
    }
  } catch {
    // Feishu module not available — skip
  }
}
