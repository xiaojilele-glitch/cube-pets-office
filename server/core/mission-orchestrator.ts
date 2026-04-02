import type {
  MissionAgentCrewMember,
  MissionDecision,
  MissionDecisionResolved,
  MissionDecisionSubmission,
  MissionEvent,
  MissionMessageLogEntry,
  MissionOrganizationSnapshot,
  MissionRecord,
  MissionStage,
  MissionWorkPackage,
} from "../../shared/mission/contracts.js";
import { MISSION_CORE_STAGE_BLUEPRINT } from "../../shared/mission/contracts.js";
import type { ExecutorEvent, ExecutionPlan } from "../../shared/executor/contracts.js";
import type {
  WorkflowRuntime,
  TaskRecord,
  MessageRecord,
  AgentRecord,
} from "../../shared/workflow-runtime.js";
import type { WorkflowOrganizationSnapshot } from "../../shared/organization-schema.js";
import {
  ExecutionPlanBuilder,
  type ExecutionPlanBuildInput,
  type ExecutionPlanBuildResult,
} from "./execution-plan-builder.js";
import {
  ExecutorClient,
  type DispatchExecutionPlanOptions,
  type DispatchExecutionPlanResult,
} from "./executor-client.js";

export interface MissionRepository {
  create(record: MissionRecord): Promise<MissionRecord> | MissionRecord;
  get(id: string): Promise<MissionRecord | undefined> | MissionRecord | undefined;
  save(record: MissionRecord): Promise<MissionRecord> | MissionRecord;
}

export interface MissionDecisionSubmissionResult {
  mission: MissionRecord;
  decision: MissionDecisionResolved;
  detail: string;
  resumed: boolean;
}

export interface MissionOrchestratorHooks {
  onMissionUpdated?(mission: MissionRecord): Promise<void> | void;
  onDecisionSubmitted?(
    mission: MissionRecord,
    submission: MissionDecisionSubmission,
    resolved: MissionDecisionResolved,
  ):
    | Promise<{ resumed?: boolean; detail?: string; nextDecision?: MissionDecision } | void>
    | { resumed?: boolean; detail?: string; nextDecision?: MissionDecision }
    | void;
}

export interface StartMissionInput {
  missionId?: string;
  title?: string;
  sourceText: string;
  topicId?: string;
  requestedBy?: ExecutionPlan["requestedBy"];
  mode?: ExecutionPlan["mode"];
  workspaceRoot?: string;
  metadata?: Record<string, unknown>;
  dispatch?: DispatchExecutionPlanOptions;
}

export interface StartMissionResult {
  mission: MissionRecord;
  plan: ExecutionPlan;
  dispatch: DispatchExecutionPlanResult;
}

export interface MissionOrchestratorOptions {
  executorClient: ExecutorClient;
  repository?: MissionRepository;
  planBuilder?: ExecutionPlanBuilder;
  hooks?: MissionOrchestratorHooks;
  workflowRuntime?: WorkflowRuntime;
}

interface MissionRuntimeState {
  plan?: ExecutionPlan;
  dispatch?: DispatchExecutionPlanResult;
  lastExecutorEvent?: ExecutorEvent;
  submittedDecision?: MissionDecisionResolved;
}

const MISSION_STAGE_LABELS = Object.fromEntries(
  MISSION_CORE_STAGE_BLUEPRINT.map(stage => [stage.key, stage.label]),
) as Record<string, string>;

function createMissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `mission_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function eventTimeFromIso(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function clampProgress(progress: number | undefined, fallback: number): number {
  if (typeof progress !== "number" || Number.isNaN(progress)) return fallback;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function cloneStages(stages: MissionStage[]): MissionStage[] {
  return stages.map(stage => ({ ...stage }));
}

function cloneEvents(events: MissionEvent[]): MissionEvent[] {
  return events.map(event => ({ ...event }));
}

function cloneMission(record: MissionRecord): MissionRecord {
  return structuredClone(record);
}

function baseStages(): MissionStage[] {
  return MISSION_CORE_STAGE_BLUEPRINT.map(stage => ({
    ...stage,
    status: "pending",
  }));
}

function ensureStage(
  stages: MissionStage[],
  key: string,
  label = toTitleCase(key),
): MissionStage {
  const existing = stages.find(stage => stage.key === key);
  if (existing) return existing;

  const created: MissionStage = {
    key,
    label,
    status: "pending",
  };
  stages.push(created);
  return created;
}

function touchStage(
  stages: MissionStage[],
  key: string,
  label: string,
  update: Partial<MissionStage>,
  now = Date.now(),
): MissionStage[] {
  const next = cloneStages(stages);
  const stage = ensureStage(next, key, label);
  if (update.status === "running" && !stage.startedAt) {
    stage.startedAt = now;
  }
  if ((update.status === "done" || update.status === "failed") && !stage.completedAt) {
    stage.completedAt = now;
  }
  Object.assign(stage, update);
  return next;
}

function replaceMission(record: MissionRecord, patch: Partial<MissionRecord>): MissionRecord {
  return {
    ...record,
    ...patch,
    updatedAt: Date.now(),
  };
}

function appendEvent(record: MissionRecord, event: MissionEvent): MissionRecord {
  const next = cloneMission(record);
  next.events.push(event);
  next.updatedAt = event.time;
  return next;
}

function missionEvent(
  type: MissionEvent["type"],
  message: string,
  options: Partial<MissionEvent> = {},
): MissionEvent {
  return {
    type,
    message,
    time: options.time || Date.now(),
    progress: options.progress,
    stageKey: options.stageKey,
    level: options.level,
    source: options.source,
  };
}

function missionStageLabel(stageKey: string): string {
  return MISSION_STAGE_LABELS[stageKey] || toTitleCase(stageKey);
}

function resolveMissionStageKey(
  event: ExecutorEvent,
  fallback: string | undefined,
): string {
  const rawStageKey = event.stageKey?.trim();
  if (rawStageKey) {
    if (MISSION_STAGE_LABELS[rawStageKey]) return rawStageKey;
    if (rawStageKey === "scan" || rawStageKey === "analyze") return "understand";
    if (rawStageKey === "build-plan") return "plan";
    if (rawStageKey === "dispatch") return "provision";
    if (rawStageKey === "codegen" || rawStageKey === "execute" || rawStageKey === "custom") {
      return "execute";
    }
    if (rawStageKey === "report") return "finalize";
  }

  if (event.type === "job.accepted") return "provision";
  if (event.type === "job.waiting" || event.status === "waiting") {
    return fallback || "execute";
  }
  if (
    event.type === "job.completed" ||
    event.type === "job.failed" ||
    event.type === "job.cancelled" ||
    event.status === "completed" ||
    event.status === "failed" ||
    event.status === "cancelled"
  ) {
    return "finalize";
  }

  return fallback || "execute";
}

function normalizeExecutorArtifacts(
  artifacts: ExecutorEvent["artifacts"],
): MissionRecord["artifacts"] | undefined {
  if (!Array.isArray(artifacts)) return undefined;

  const normalized = artifacts.flatMap(artifact => {
    if (
      !artifact ||
      (artifact.kind !== "file" &&
        artifact.kind !== "report" &&
        artifact.kind !== "url" &&
        artifact.kind !== "log") ||
      !artifact.name?.trim()
    ) {
      return [];
    }

    return [
      {
        kind: artifact.kind,
        name: artifact.name.trim(),
        path: artifact.path?.trim() || undefined,
        url: artifact.url?.trim() || undefined,
        description: artifact.description?.trim() || undefined,
      },
    ];
  });

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeExecutorInstance(
  payload: ExecutorEvent["payload"],
): MissionRecord["instance"] | undefined {
  const instance = payload?.instance as Record<string, unknown> | undefined;
  if (!instance || typeof instance !== "object") return undefined;

  return {
    id: typeof instance.id === "string" ? instance.id.trim() || undefined : undefined,
    image: typeof instance.image === "string" ? instance.image.trim() || undefined : undefined,
    command: Array.isArray(instance.command)
      ? instance.command.filter((entry: unknown): entry is string => typeof entry === "string")
      : undefined,
    workspaceRoot:
      typeof instance.workspaceRoot === "string"
        ? instance.workspaceRoot.trim() || undefined
        : undefined,
    startedAt: typeof instance.startedAt === "number" ? instance.startedAt : undefined,
    completedAt: typeof instance.completedAt === "number" ? instance.completedAt : undefined,
    exitCode: typeof instance.exitCode === "number" ? instance.exitCode : undefined,
    host: typeof instance.host === "string" ? instance.host.trim() || undefined : undefined,
  };
}

// ---------------------------------------------------------------------------
// Enrichment extraction helpers
// ---------------------------------------------------------------------------

const VALID_WORK_PACKAGE_STATUSES = new Set([
  "pending",
  "running",
  "passed",
  "failed",
  "verified",
]);

function extractOrganization(
  event: ExecutorEvent,
): MissionOrganizationSnapshot | undefined {
  const raw = (event.payload as Record<string, unknown> | undefined)
    ?.organization as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return undefined;

  const departments = Array.isArray(raw.departments)
    ? raw.departments.flatMap((d: unknown) => {
        if (!d || typeof d !== "object") return [];
        const dept = d as Record<string, unknown>;
        const key = typeof dept.key === "string" ? dept.key.trim() : "";
        const label = typeof dept.label === "string" ? dept.label.trim() : "";
        if (!key || !label) return [];
        return [
          {
            key,
            label,
            managerName:
              typeof dept.managerName === "string"
                ? dept.managerName.trim() || undefined
                : undefined,
          },
        ];
      })
    : [];

  if (departments.length === 0) return undefined;

  return {
    departments,
    agentCount:
      typeof raw.agentCount === "number" && raw.agentCount >= 0
        ? raw.agentCount
        : departments.length,
  };
}

function extractWorkPackages(
  event: ExecutorEvent,
): MissionWorkPackage[] | undefined {
  const raw = (event.payload as Record<string, unknown> | undefined)
    ?.workPackages;
  if (!Array.isArray(raw)) return undefined;

  const packages = raw.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const wp = item as Record<string, unknown>;
    const id = typeof wp.id === "string" ? wp.id.trim() : "";
    const title = typeof wp.title === "string" ? wp.title.trim() : "";
    const stageKey = typeof wp.stageKey === "string" ? wp.stageKey.trim() : "";
    const status = typeof wp.status === "string" ? wp.status.trim() : "";
    if (!id || !title || !stageKey || !VALID_WORK_PACKAGE_STATUSES.has(status))
      return [];
    return [
      {
        id,
        title,
        assignee:
          typeof wp.assignee === "string"
            ? wp.assignee.trim() || undefined
            : undefined,
        stageKey,
        status: status as MissionWorkPackage["status"],
        score: typeof wp.score === "number" ? wp.score : undefined,
        deliverable:
          typeof wp.deliverable === "string"
            ? wp.deliverable.trim() || undefined
            : undefined,
        feedback:
          typeof wp.feedback === "string"
            ? wp.feedback.trim() || undefined
            : undefined,
      },
    ];
  });

  return packages.length > 0 ? packages : undefined;
}

function extractMessageLog(
  event: ExecutorEvent,
): MissionMessageLogEntry[] | undefined {
  const raw = (event.payload as Record<string, unknown> | undefined)
    ?.messageLog;
  if (!Array.isArray(raw)) return undefined;

  const entries = raw.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const sender = typeof entry.sender === "string" ? entry.sender.trim() : "";
    const content =
      typeof entry.content === "string" ? entry.content.trim() : "";
    const time = typeof entry.time === "number" ? entry.time : 0;
    if (!sender || !content) return [];
    return [
      {
        sender,
        content,
        time,
        stageKey:
          typeof entry.stageKey === "string"
            ? entry.stageKey.trim() || undefined
            : undefined,
      },
    ];
  });

  return entries.length > 0 ? entries : undefined;
}

class InMemoryMissionRepository implements MissionRepository {
  private readonly records = new Map<string, MissionRecord>();

  create(record: MissionRecord): MissionRecord {
    const created = cloneMission(record);
    this.records.set(created.id, created);
    return cloneMission(created);
  }

  get(id: string): MissionRecord | undefined {
    const record = this.records.get(id);
    return record ? cloneMission(record) : undefined;
  }

  save(record: MissionRecord): MissionRecord {
    const saved = cloneMission(record);
    this.records.set(saved.id, saved);
    return cloneMission(saved);
  }
}

export class MissionOrchestrator {
  private readonly runtime = new Map<string, MissionRuntimeState>();
  private readonly repository: MissionRepository;
  private readonly planBuilder: ExecutionPlanBuilder;
  private readonly executorClient: ExecutorClient;
  private readonly hooks: MissionOrchestratorHooks;
  private readonly workflowRuntime?: WorkflowRuntime;
  /** Maps workflowId → missionId so stage-completion callbacks can find the mission. */
  private readonly workflowMissionMap = new Map<string, string>();

  constructor(options: MissionOrchestratorOptions) {
    this.repository = options.repository || new InMemoryMissionRepository();
    this.planBuilder = options.planBuilder || new ExecutionPlanBuilder();
    this.executorClient = options.executorClient;
    this.hooks = options.hooks || {};
    this.workflowRuntime = options.workflowRuntime;
  }

  /**
   * Register a link between a workflowId and a missionId.
   * This allows the stage-completion callback to look up the mission.
   */
  registerWorkflowMissionLink(workflowId: string, missionId: string): void {
    this.workflowMissionMap.set(workflowId, missionId);
  }

  /**
   * Handle a workflow stage completion event.
   * Looks up the missionId from the workflowMissionMap and calls enrichMissionFromWorkflow.
   */
  async handleStageCompleted(workflowId: string, completedStage: string): Promise<void> {
    const missionId = this.workflowMissionMap.get(workflowId);
    if (!missionId) return;
    await this.enrichMissionFromWorkflow(missionId, workflowId, completedStage);
  }

  async startMission(input: StartMissionInput): Promise<StartMissionResult> {
    const missionId = input.missionId || createMissionId();
    const title = input.title || "Brain dispatch mission";
    const now = Date.now();

    let mission = await Promise.resolve(
      this.repository.create({
        id: missionId,
        kind: "brain-dispatch",
        title,
        sourceText: input.sourceText,
        topicId: input.topicId,
        status: "queued",
        progress: 0,
        currentStageKey: "receive",
        stages: baseStages(),
        createdAt: now,
        updatedAt: now,
        events: [
          missionEvent("created", "Mission created by brain dispatch.", {
            source: "brain",
            stageKey: "receive",
            progress: 0,
            time: now,
          }),
        ],
      }),
    );

    mission = await this.persist(
      appendEvent(
        replaceMission(mission, {
          status: "running",
          progress: 8,
          currentStageKey: "understand",
          stages: touchStage(
            touchStage(mission.stages, "receive", missionStageLabel("receive"), {
              status: "done",
              detail: "Mission intake accepted by brain dispatch.",
            }),
            "understand",
            missionStageLabel("understand"),
            { status: "running", detail: "Reading mission objective and constraints." },
          ),
        }),
        missionEvent("progress", "Understanding mission objective.", {
          source: "brain",
          stageKey: "understand",
          progress: 8,
        }),
      ),
    );

    const planResult = await this.buildPlan({
      missionId,
      title,
      sourceText: input.sourceText,
      requestedBy: input.requestedBy,
      mode: input.mode,
      workspaceRoot: input.workspaceRoot,
      topicId: input.topicId,
      metadata: input.metadata,
    });

    mission = await this.persist(
      appendEvent(
        replaceMission(mission, {
          progress: 32,
          currentStageKey: "plan",
          stages: touchStage(
            touchStage(
              mission.stages,
              "understand",
              missionStageLabel("understand"),
              { status: "done", detail: planResult.understanding.summary },
            ),
            "plan",
            missionStageLabel("plan"),
            { status: "done", detail: planResult.plan.summary },
          ),
        }),
        missionEvent("progress", "Structured ExecutionPlan created.", {
          source: "brain",
          stageKey: "plan",
          progress: 32,
        }),
      ),
    );

    this.runtime.set(missionId, {
      plan: planResult.plan,
    });

    mission = await this.persist(
      appendEvent(
        replaceMission(mission, {
          progress: 45,
          currentStageKey: "provision",
          stages: touchStage(
            mission.stages,
            "provision",
            missionStageLabel("provision"),
            {
              status: "running",
              detail: `Dispatching ${planResult.plan.jobs.length} executor job(s).`,
            },
          ),
        }),
        missionEvent("progress", "Dispatching plan to executor.", {
          source: "brain",
          stageKey: "provision",
          progress: 45,
        }),
      ),
    );

    let dispatched: DispatchExecutionPlanResult;
    try {
      dispatched = await this.executorClient.dispatchPlan(planResult.plan, input.dispatch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mission = await this.persist(
        appendEvent(
          replaceMission(mission, {
            status: "failed",
            progress: 45,
            summary: message,
            currentStageKey: "finalize",
            stages: touchStage(
              touchStage(
                mission.stages,
                "provision",
                missionStageLabel("provision"),
                { status: "failed", detail: message },
              ),
              "finalize",
              missionStageLabel("finalize"),
              { status: "failed", detail: "Mission failed before executor acceptance." },
            ),
          }),
          missionEvent("failed", message, {
            source: "brain",
            stageKey: "finalize",
            progress: 45,
            level: "error",
          }),
        ),
      );
      throw error;
    }

    this.runtime.set(missionId, {
      ...this.runtime.get(missionId),
      dispatch: dispatched,
    });

    mission = await this.persist(
      appendEvent(
        replaceMission(mission, {
          status: "running",
          progress: 60,
          currentStageKey: "execute",
          executor: {
            name: dispatched.request.executor,
            requestId: dispatched.request.requestId,
            jobId: dispatched.response.jobId,
            status: "queued",
            lastEventType: "job.accepted",
            lastEventAt: eventTimeFromIso(dispatched.response.receivedAt),
          },
          instance: planResult.plan.workspaceRoot
            ? {
                workspaceRoot: planResult.plan.workspaceRoot,
              }
            : undefined,
          artifacts: normalizeExecutorArtifacts(planResult.plan.artifacts),
          stages: touchStage(
            touchStage(
              mission.stages,
              "provision",
              missionStageLabel("provision"),
              {
                status: "done",
                detail: `Executor accepted job ${dispatched.response.jobId}.`,
              },
            ),
            "execute",
            missionStageLabel("execute"),
            {
              status: "running",
              detail: "Executor accepted the mission and execution is now in progress.",
            },
          ),
        }),
        missionEvent("progress", "Executor accepted mission dispatch.", {
          source: "brain",
          stageKey: "execute",
          progress: 60,
        }),
      ),
    );

    return {
      mission,
      plan: planResult.plan,
      dispatch: dispatched,
    };
  }

  async applyExecutorEvent(event: ExecutorEvent): Promise<MissionRecord> {
    const mission = await Promise.resolve(this.repository.get(event.missionId));
    if (!mission) {
      throw new Error(`Mission not found for executor event: ${event.missionId}`);
    }

    const runtimeState = this.runtime.get(event.missionId) || {};
    runtimeState.lastExecutorEvent = event;
    this.runtime.set(event.missionId, runtimeState);

    const stageKey = resolveMissionStageKey(event, mission.currentStageKey);
    const stageLabel = this.stageLabelForExecutorEvent(event, runtimeState.plan);
    const progress = clampProgress(event.progress, mission.progress);
    const time = eventTimeFromIso(event.occurredAt);
    const sourceEvent = this.mapExecutorEvent(event, progress, time, stageKey);
    const artifacts = normalizeExecutorArtifacts(event.artifacts);
    const instance = normalizeExecutorInstance(event.payload);

    let next = appendEvent(
      replaceMission(mission, {
        progress,
        currentStageKey: stageKey,
        executor: {
          name: event.executor?.trim() || mission.executor?.name || "executor",
          requestId: mission.executor?.requestId,
          jobId: event.jobId.trim(),
          status: event.status,
          baseUrl: mission.executor?.baseUrl,
          lastEventType: event.type,
          lastEventAt: time,
        },
        instance: instance || mission.instance,
        artifacts: artifacts || mission.artifacts,
        stages: touchStage(
          mission.stages,
          stageKey,
          stageLabel,
          {
            status: this.mapExecutorStatus(event.status),
            detail: event.detail || event.message,
          },
          time,
        ),
      }),
      sourceEvent,
    );

    if (event.status === "waiting" || event.type === "job.waiting") {
      next = replaceMission(next, {
        status: "waiting",
        waitingFor: event.waitingFor || event.message,
        decision: event.decision,
        currentStageKey: stageKey,
      });
    } else if (event.status === "completed" || event.type === "job.completed") {
      next = replaceMission(next, {
        status: "done",
        progress: 100,
        summary: event.summary || event.message,
        waitingFor: undefined,
        decision: undefined,
        completedAt: time,
        currentStageKey: "finalize",
        stages: touchStage(next.stages, "finalize", missionStageLabel("finalize"), {
          status: "done",
          detail: event.summary || event.message,
        }, time),
      });
    } else if (event.status === "failed" || event.status === "cancelled" || event.type === "job.failed") {
      next = replaceMission(next, {
        status: "failed",
        summary: event.summary || event.message,
        waitingFor: undefined,
        decision: undefined,
        currentStageKey: "finalize",
        stages: touchStage(next.stages, "finalize", missionStageLabel("finalize"), {
          status: "failed",
          detail: event.summary || event.message,
        }, time),
      });
    } else {
      next = replaceMission(next, {
        status: "running",
      });
    }

    // Enrich MissionRecord when stage completes or mission completes
    if (event.status === "completed" || this.mapExecutorStatus(event.status) === "done") {
      const organization = extractOrganization(event);
      const workPackages = extractWorkPackages(event);
      const messageLog = extractMessageLog(event);

      if (organization || workPackages || messageLog) {
        next = replaceMission(next, {
          ...(organization ? { organization } : {}),
          ...(workPackages ? { workPackages } : {}),
          ...(messageLog ? { messageLog } : {}),
        });
      }
    }

    return this.persist(next);
  }

  async submitDecision(
    missionId: string,
    submission: MissionDecisionSubmission,
  ): Promise<MissionDecisionSubmissionResult> {
    const mission = await Promise.resolve(this.repository.get(missionId));
    if (!mission) {
      throw new Error(`Mission not found: ${missionId}`);
    }

    if (!mission.decision) {
      throw new Error(`Mission ${missionId} is not waiting for a decision.`);
    }

    const resolved = this.resolveDecision(mission.decision, submission);
    const runtimeState = this.runtime.get(missionId) || {};
    runtimeState.submittedDecision = resolved;
    this.runtime.set(missionId, runtimeState);

    const hookResult = await this.hooks.onDecisionSubmitted?.(mission, submission, resolved);
    const nextDecision = hookResult?.nextDecision;
    const resumed = !!hookResult?.resumed;
    const detail =
      hookResult?.detail ||
      (nextDecision
        ? "Decision accepted. Proceeding to next decision."
        : resumed
          ? "Decision accepted and mission resumed."
          : "Decision captured. Waiting for executor resume integration.");

    let next = appendEvent(
      cloneMission(mission),
      missionEvent("log", detail, {
        source: "user",
        stageKey: mission.currentStageKey,
        level: "info",
        progress: mission.progress,
      }),
    );

    if (nextDecision) {
      // Multi-step decision chain: transition to the next decision node
      next = replaceMission(next, {
        status: "waiting",
        waitingFor: nextDecision.prompt,
        decision: nextDecision,
      });
      next = appendEvent(
        next,
        missionEvent("waiting", `Waiting for next decision: ${nextDecision.prompt}`, {
          source: "mission-core",
          stageKey: mission.currentStageKey,
          progress: mission.progress,
        }),
      );
    } else if (resumed) {
      const resumedStageKey = runtimeState.lastExecutorEvent
        ? resolveMissionStageKey(runtimeState.lastExecutorEvent, mission.currentStageKey)
        : mission.currentStageKey || "execute";
      next = replaceMission(next, {
        status: "running",
        waitingFor: undefined,
        decision: undefined,
        currentStageKey: resumedStageKey,
      });
    }

    next = await this.persist(next);

    return {
      mission: next,
      decision: resolved,
      detail,
      resumed,
    };
  }

  async getMission(missionId: string): Promise<MissionRecord | undefined> {
    return Promise.resolve(this.repository.get(missionId));
  }

  getRuntimeState(missionId: string): MissionRuntimeState | undefined {
    const state = this.runtime.get(missionId);
    return state ? { ...state } : undefined;
  }

  private async buildPlan(input: ExecutionPlanBuildInput): Promise<ExecutionPlanBuildResult> {
    return this.planBuilder.build(input);
  }

  private async persist(record: MissionRecord): Promise<MissionRecord> {
    const saved = await Promise.resolve(this.repository.save(record));
    await this.hooks.onMissionUpdated?.(saved);
    return saved;
  }

  private stageLabelForExecutorEvent(event: ExecutorEvent, plan: ExecutionPlan | undefined): string {
    const missionStageKey = resolveMissionStageKey(event, plan?.steps.at(-1)?.key);
    return missionStageLabel(missionStageKey);
  }

  private mapExecutorStatus(status: ExecutorEvent["status"]): MissionStage["status"] {
    switch (status) {
      case "completed":
        return "done";
      case "failed":
      case "cancelled":
        return "failed";
      default:
        return "running";
    }
  }

  private mapExecutorEvent(
    event: ExecutorEvent,
    progress: number,
    time: number,
    stageKey: string,
  ): MissionEvent {
    if (event.type === "job.waiting" || event.status === "waiting") {
      return missionEvent("waiting", event.message, {
        source: "executor",
        stageKey,
        progress,
        time,
      });
    }

    if (event.type === "job.completed" || event.status === "completed") {
      return missionEvent("done", event.summary || event.message, {
        source: "executor",
        stageKey,
        progress: 100,
        time,
      });
    }

    if (event.type === "job.failed" || event.status === "failed" || event.status === "cancelled") {
      return missionEvent("failed", event.summary || event.message, {
        source: "executor",
        stageKey,
        progress,
        level: "error",
        time,
      });
    }

    if (event.type === "job.log" && event.log) {
      return missionEvent("log", event.log.message || event.message, {
        source: "executor",
        stageKey,
        progress,
        level: event.log.level,
        time,
      });
    }

    return missionEvent("progress", event.message, {
      source: "executor",
      stageKey,
      progress,
      time,
    });
  }

  private resolveDecision(
    decision: MissionDecision,
    submission: MissionDecisionSubmission,
  ): MissionDecisionResolved {
    if (!submission.optionId && !submission.freeText?.trim()) {
      throw new Error("Decision submission must include optionId or freeText.");
    }

    const selected = decision.options.find(option => option.id === submission.optionId);
    if (submission.optionId && !selected) {
      throw new Error(`Unknown decision option: ${submission.optionId}`);
    }

    return {
      optionId: selected?.id,
      optionLabel: selected?.label,
      freeText: submission.freeText?.trim() || undefined,
    };
  }

  /* ─── Workflow → Mission enrichment (workflow-decoupling) ─── */

  /**
   * Enrich a MissionRecord with data extracted from the corresponding workflow
   * after a stage completes. Called by the stage-completion callback (Task 4.2).
   */
  async enrichMissionFromWorkflow(
    missionId: string,
    workflowId: string,
    completedStage: string,
  ): Promise<void> {
    if (!this.workflowRuntime) return;

    const workflow = this.workflowRuntime.workflowRepo.getWorkflow(workflowId);
    if (!workflow) return;

    const updates: Partial<MissionRecord> = {};

    // planning/direction 阶段完成后：填充 organization 和 agentCrew
    if (completedStage === "planning" || completedStage === "direction") {
      updates.organization = this.extractOrganization(workflowId);
      updates.agentCrew = this.extractAgentCrew(workflowId);
    }

    // execution/review/revision/verify 阶段完成后：填充 workPackages
    if (["execution", "review", "revision", "verify"].includes(completedStage)) {
      try {
        updates.workPackages = this.extractWorkPackages(workflowId);
      } catch (err) {
        console.warn(
          `[MissionOrchestrator] extractWorkPackages failed for workflow ${workflowId}:`,
          err instanceof Error ? err.message : err,
        );
        // workPackages 保持上一次值 — 不写入 updates
      }
    }

    // 每个阶段完成后：更新 messageLog（最近 50 条）
    updates.messageLog = this.extractMessageLog(workflowId, 50);

    const mission = await Promise.resolve(this.repository.get(missionId));
    if (!mission) return;

    await this.persist(replaceMission(mission, updates));
  }

  private extractOrganization(
    workflowId: string,
  ): MissionOrganizationSnapshot | undefined {
    const workflow = this.workflowRuntime!.workflowRepo.getWorkflow(workflowId);
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

  private extractAgentCrew(workflowId: string): MissionAgentCrewMember[] {
    const workflow = this.workflowRuntime!.workflowRepo.getWorkflow(workflowId);
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

  private extractWorkPackages(workflowId: string): MissionWorkPackage[] {
    const tasks: TaskRecord[] =
      this.workflowRuntime!.workflowRepo.getTasksByWorkflow(workflowId);

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

  private extractMessageLog(
    workflowId: string,
    limit: number,
  ): MissionMessageLogEntry[] {
    const messages: MessageRecord[] =
      this.workflowRuntime!.workflowRepo.getMessagesByWorkflow(workflowId);

    if (!messages.length) return [];

    // Sort by created_at descending, take the most recent `limit`, then reverse to chronological
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
}

/** Map workflow TaskRecord.status string to MissionWorkPackage status union. */
export function mapTaskStatus(
  status: string,
): MissionWorkPackage["status"] {
  switch (status) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "verified":
      return "verified";
    case "running":
    case "in_progress":
      return "running";
    default:
      return "pending";
  }
}
