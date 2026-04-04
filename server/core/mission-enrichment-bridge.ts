/**
 * Bridge between WorkflowEngine stage-completion events and MissionRecord enrichment.
 *
 * Maintains a workflowId → missionId mapping and calls the extraction helpers
 * from MissionOrchestrator to enrich the MissionRecord after each workflow stage.
 * Updates are applied through MissionRuntime.patchEnrichment() so the Socket
 * broadcast (mission_event) includes the enriched fields automatically.
 */
import type {
  MissionOrganizationSnapshot,
  MissionWorkPackage,
  MissionMessageLogEntry,
  MissionAgentCrewMember,
  MissionRecord,
} from "../../shared/mission/contracts.js";
import type {
  WorkflowRepository,
  TaskRecord,
  MessageRecord,
} from "../../shared/workflow-runtime.js";
import type { WorkflowOrganizationSnapshot } from "../../shared/organization-schema.js";
import type { MissionRuntime } from "../tasks/mission-runtime.js";
import { mapTaskStatus } from "./mission-orchestrator.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Maps workflowId → missionId. */
const workflowMissionMap = new Map<string, string>();

let _missionRuntime: MissionRuntime | null = null;
let _workflowRepo: WorkflowRepository | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the enrichment bridge.
 * Call once during server startup after both systems are ready.
 */
export function initEnrichmentBridge(
  missionRuntime: MissionRuntime,
  workflowRepo: WorkflowRepository,
): void {
  _missionRuntime = missionRuntime;
  _workflowRepo = workflowRepo;
}

/**
 * Register a link between a workflowId and a missionId.
 * Call this when a workflow is started on behalf of a mission.
 */
export function linkWorkflowToMission(workflowId: string, missionId: string): void {
  workflowMissionMap.set(workflowId, missionId);
}

/**
 * Resolve the missionId linked to a given workflowId.
 * Returns undefined if no mapping exists.
 */
export function resolveWorkflowMission(workflowId: string): string | undefined {
  return workflowMissionMap.get(workflowId);
}

/**
 * Handle a workflow stage completion — the callback wired into
 * WorkflowRuntime.onStageCompleted by server-runtime.ts.
 */
export async function onWorkflowStageCompleted(
  workflowId: string,
  completedStage: string,
): Promise<void> {
  const missionId = workflowMissionMap.get(workflowId);
  if (!missionId || !_missionRuntime || !_workflowRepo) return;

  try {
    const workflow = _workflowRepo.getWorkflow(workflowId);
    if (!workflow) return;

    const enrichment: Partial<Pick<
      MissionRecord,
      "organization" | "workPackages" | "messageLog" | "agentCrew"
    >> = {};

    // planning/direction 阶段完成后：填充 organization 和 agentCrew
    if (completedStage === "planning" || completedStage === "direction") {
      enrichment.organization = extractOrganization(_workflowRepo, workflowId);
      enrichment.agentCrew = extractAgentCrew(_workflowRepo, workflowId);
    }

    // execution/review/revision/verify 阶段完成后：填充 workPackages
    if (["execution", "review", "revision", "verify"].includes(completedStage)) {
      try {
        enrichment.workPackages = extractWorkPackages(_workflowRepo, workflowId);
      } catch (err) {
        console.warn(
          `[EnrichmentBridge] extractWorkPackages failed for workflow ${workflowId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // 每个阶段完成后：更新 messageLog（最近 50 条）
    enrichment.messageLog = extractMessageLog(_workflowRepo, workflowId, 50);

    _missionRuntime.patchEnrichment(missionId, enrichment);
  } catch (err) {
    console.warn(
      `[EnrichmentBridge] Failed to enrich mission after stage "${completedStage}":`,
      err instanceof Error ? err.message : err,
    );
  }
}

// ---------------------------------------------------------------------------
// Extraction helpers — mirror the logic in MissionOrchestrator (Task 4.1)
// but accept WorkflowRepository as a parameter instead of using `this`.
// ---------------------------------------------------------------------------

function extractOrganization(
  repo: WorkflowRepository,
  workflowId: string,
): MissionOrganizationSnapshot | undefined {
  const workflow = repo.getWorkflow(workflowId);
  const orgSnapshot = workflow?.results?.organization as
    | WorkflowOrganizationSnapshot
    | undefined;

  if (!orgSnapshot?.departments?.length) return undefined;

  return {
    departments: orgSnapshot.departments.map((dept) => {
      const managerNode = orgSnapshot.nodes?.find(
        (n) => n.id === dept.managerNodeId,
      );
      return {
        key: dept.id,
        label: dept.label,
        managerName: managerNode?.name,
      };
    }),
    agentCount: orgSnapshot.nodes?.length ?? 0,
  };
}

function extractAgentCrew(
  repo: WorkflowRepository,
  workflowId: string,
): MissionAgentCrewMember[] {
  const workflow = repo.getWorkflow(workflowId);
  const orgSnapshot = workflow?.results?.organization as
    | WorkflowOrganizationSnapshot
    | undefined;

  if (!orgSnapshot?.nodes?.length) return [];

  return orgSnapshot.nodes.map((node): MissionAgentCrewMember => ({
    id: node.agentId,
    name: node.name,
    role: node.role,
    department: node.departmentLabel,
    status: "idle",
  }));
}

function extractWorkPackages(
  repo: WorkflowRepository,
  workflowId: string,
): MissionWorkPackage[] {
  const tasks: TaskRecord[] = repo.getTasksByWorkflow(workflowId);

  return tasks.map((task): MissionWorkPackage => ({
    id: String(task.id),
    workerId: task.worker_id,
    description: task.description,
    deliverable: task.deliverable_v3 ?? task.deliverable_v2 ?? task.deliverable ?? undefined,
    status: mapTaskStatus(task.status),
    score: task.total_score ?? undefined,
    feedback: task.manager_feedback ?? task.meta_audit_feedback ?? undefined,
    stageKey: undefined as string | undefined,
  }));
}

function extractMessageLog(
  repo: WorkflowRepository,
  workflowId: string,
  limit: number,
): MissionMessageLogEntry[] {
  const messages: MessageRecord[] = repo.getMessagesByWorkflow(workflowId);

  if (!messages.length) return [];

  const sorted = [...messages].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const recent = sorted.slice(0, limit).reverse();

  return recent.map((msg): MissionMessageLogEntry => ({
    sender: msg.from_agent,
    content:
      msg.content.length > 500
        ? msg.content.slice(0, 497) + "..."
        : msg.content,
    time: new Date(msg.created_at).getTime(),
    stageKey: msg.stage || undefined,
  }));
}
