/**
 * UI state for both browser runtime mode and advanced server mode.
 */
import { create } from "zustand";
import { io, Socket } from "socket.io-client";
import {
  buildWorkflowInputSignature,
  normalizeWorkflowAttachments,
} from "@shared/workflow-input";

import { useAppStore } from "@/lib/store";
import { fetchJsonSafe, type ApiRequestError } from "./api-client";
import {
  getAgentsSnapshot,
  getHeartbeatReportsSnapshot,
  getHeartbeatStatusesSnapshot,
  getMemorySearchSnapshot,
  getRecentMemorySnapshot,
  getWorkflowDetailSnapshot,
  getWorkflowsSnapshot,
  persistAgents,
  persistHeartbeatReports,
  persistHeartbeatStatuses,
  persistMemorySearch,
  persistRecentMemory,
  persistWorkflowDetail,
  persistWorkflows,
} from "./browser-runtime-storage";
import { runtimeEventBus } from "./runtime/local-event-bus";
import { localRuntime } from "./runtime/local-runtime-client";
import type {
  AgentInfo,
  AgentMemoryEntry,
  AgentMemorySummary,
  HeartbeatReportInfo,
  HeartbeatStatusInfo,
  MessageInfo,
  RuntimeEvent,
  StageInfo,
  TaskInfo,
  WorkflowInputAttachment,
  WorkflowInfo,
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
} from "./runtime/types";

export type {
  AgentInfo,
  AgentMemoryEntry,
  AgentMemorySummary,
  HeartbeatReportInfo,
  HeartbeatStatusInfo,
  MessageInfo,
  StageInfo,
  TaskInfo,
  WorkflowInputAttachment,
  WorkflowInfo,
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
};

export interface DirectiveSubmissionInput {
  directive: string;
  attachments?: WorkflowInputAttachment[];
}

interface WorkflowAgentsResponse {
  agents?: AgentInfo[];
}

interface WorkflowStagesResponse {
  stages?: StageInfo[];
}

interface WorkflowListResponse {
  workflows?: WorkflowInfo[];
}

interface WorkflowDetailResponse {
  workflow?: WorkflowInfo | null;
  tasks?: TaskInfo[];
  messages?: MessageInfo[];
  report?: unknown | null;
}

interface WorkflowRecentMemoryResponse {
  entries?: AgentMemoryEntry[];
}

interface WorkflowSearchMemoryResponse {
  memories?: AgentMemorySummary[];
}

interface WorkflowHeartbeatStatusesResponse {
  statuses?: HeartbeatStatusInfo[];
}

interface WorkflowHeartbeatReportsResponse {
  reports?: HeartbeatReportInfo[];
}

interface WorkflowHeartbeatRunResponse {
  ok?: boolean;
  error?: string;
}

interface WorkflowCreateResponse {
  workflowId?: string;
  missionId?: string | null;
  status?: WorkflowInfo["status"];
  deduped?: boolean;
  error?: string;
}

export interface WorkflowLaunchResult {
  workflowId: string;
  missionId: string | null;
  deduped: boolean;
}

export type PanelView =
  | "directive"
  | "org"
  | "workflow"
  | "review"
  | "history"
  | "memory"
  | "reports"
  | "sessions";

const FALLBACK_STAGES: StageInfo[] = [
  { id: "direction", order: 1, label: "方向下发" },
  { id: "planning", order: 2, label: "任务规划" },
  { id: "execution", order: 3, label: "执行" },
  { id: "review", order: 4, label: "评审" },
  { id: "meta_audit", order: 5, label: "元审计" },
  { id: "revision", order: 6, label: "修订" },
  { id: "verify", order: 7, label: "验证" },
  { id: "summary", order: 8, label: "汇总" },
  { id: "feedback", order: 9, label: "反馈" },
  { id: "evolution", order: 10, label: "进化" },
];

function isAdvancedMode() {
  return useAppStore.getState().runtimeMode === "advanced";
}

function mergeHeartbeatStatus(
  items: HeartbeatStatusInfo[],
  next: HeartbeatStatusInfo
): HeartbeatStatusInfo[] {
  const found = items.some(item => item.agentId === next.agentId);
  const merged = found
    ? items.map(item => (item.agentId === next.agentId ? next : item))
    : [...items, next];

  return merged.sort((a, b) => a.agentId.localeCompare(b.agentId));
}

function normalizeDirective(directive: string): string {
  return directive.trim().replace(/\s+/g, " ");
}

function getWorkflowInputSignature(workflow: WorkflowInfo) {
  const signature = workflow.results?.input?.signature;
  if (typeof signature === "string" && signature) {
    return signature;
  }

  return buildWorkflowInputSignature(
    workflow.directive,
    normalizeWorkflowAttachments(workflow.results?.input?.attachments)
  );
}

function isTerminalWorkflowStatus(status: WorkflowInfo["status"]): boolean {
  return (
    status === "completed" ||
    status === "completed_with_errors" ||
    status === "failed"
  );
}

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveDownload(filename: string, mimeType: string, content: string) {
  saveBlob(filename, new Blob([content], { type: mimeType }));
}

function getDownloadFilename(
  response: Response,
  fallbackFilename: string
): string {
  const disposition = response.headers.get("content-disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallbackFilename;
}

async function downloadFromUrl(url: string, fallbackFilename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `API ${response.status}`);
  }

  const blob = await response.blob();
  saveBlob(getDownloadFilename(response, fallbackFilename), blob);
}

function isApiRequestError(error: unknown): error is ApiRequestError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<ApiRequestError>;
  return (
    typeof candidate.endpoint === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.detail === "string"
  );
}

async function fetchAdvancedJsonOrThrow<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const result = await fetchJsonSafe<T>(input, init);
  if (!result.ok) {
    throw result.error;
  }

  return result.data;
}

let runtimeUnsubscribe: (() => void) | null = null;
let runtimeInitPromise: Promise<void> | null = null;

interface WorkflowState {
  socket: Socket | null;
  connected: boolean;
  agents: AgentInfo[];
  agentsError: ApiRequestError | null;
  agentStatuses: Record<string, string>;
  currentWorkflowId: string | null;
  workflows: WorkflowInfo[];
  workflowsError: ApiRequestError | null;
  currentWorkflow: WorkflowInfo | null;
  workflowDetailError: ApiRequestError | null;
  tasks: TaskInfo[];
  messages: MessageInfo[];
  agentMemoryRecent: AgentMemoryEntry[];
  agentMemorySearchResults: AgentMemorySummary[];
  memoryError: ApiRequestError | null;
  heartbeatStatuses: HeartbeatStatusInfo[];
  heartbeatReports: HeartbeatReportInfo[];
  heartbeatError: ApiRequestError | null;
  stages: StageInfo[];
  isWorkflowPanelOpen: boolean;
  activeView: PanelView;
  isSubmitting: boolean;
  submitError: ApiRequestError | null;
  lastSubmittedInputSignature: string | null;
  lastSubmittedAt: number | null;
  isMemoryLoading: boolean;
  isHeartbeatLoading: boolean;
  runningHeartbeatAgentId: string | null;
  selectedMemoryAgentId: string | null;
  memoryQuery: string;
  eventLog: Array<{ type: string; data: any; timestamp: string }>;
  initSocket: () => Promise<void>;
  disconnectSocket: () => void;
  fetchAgents: () => Promise<void>;
  fetchStages: () => Promise<void>;
  fetchWorkflows: () => Promise<void>;
  fetchWorkflowDetail: (id: string) => Promise<void>;
  fetchAgentRecentMemory: (
    agentId: string,
    workflowId?: string | null,
    limit?: number
  ) => Promise<void>;
  searchAgentMemory: (
    agentId: string,
    query: string,
    topK?: number
  ) => Promise<void>;
  fetchHeartbeatStatuses: () => Promise<void>;
  fetchHeartbeatReports: (
    agentId?: string | null,
    limit?: number
  ) => Promise<void>;
  runHeartbeat: (agentId: string) => Promise<boolean>;
  submitDirective: (
    input: DirectiveSubmissionInput
  ) => Promise<WorkflowLaunchResult | null>;
  downloadWorkflowReport: (
    workflowId: string,
    format: "json" | "md"
  ) => Promise<void>;
  downloadDepartmentReport: (
    workflowId: string,
    managerId: string,
    format: "json" | "md"
  ) => Promise<void>;
  downloadHeartbeatReport: (
    agentId: string,
    reportId: string,
    format: "json" | "md"
  ) => Promise<void>;
  setSelectedMemoryAgent: (id: string | null) => void;
  setMemoryQuery: (query: string) => void;
  setActiveView: (view: PanelView) => void;
  toggleWorkflowPanel: () => void;
  openWorkflowPanel: () => void;
  setCurrentWorkflow: (id: string | null) => void;
}

type WorkflowStoreSet = (
  partial:
    | Partial<WorkflowState>
    | ((state: WorkflowState) => Partial<WorkflowState>)
) => void;

function applyAgentStatusUpdate(
  agents: AgentInfo[],
  agentId: string,
  action: string
) {
  return agents.map(agent =>
    agent.id === agentId
      ? { ...agent, status: (action || "idle") as AgentInfo["status"] }
      : agent
  );
}

function handleRuntimeEvent(
  event: RuntimeEvent,
  set: WorkflowStoreSet,
  get: () => WorkflowState
) {
  const state = get();

  set({
    eventLog: [
      ...state.eventLog.slice(-100),
      {
        type: event.type,
        data: event,
        timestamp: new Date().toISOString(),
      },
    ],
  });

  switch (event.type) {
    case "stage_change": {
      set(store => ({
        workflows: store.workflows.map(workflow =>
          workflow.id === event.workflowId
            ? { ...workflow, current_stage: event.stage, status: "running" }
            : workflow
        ),
        currentWorkflow:
          store.currentWorkflow && store.currentWorkflow.id === event.workflowId
            ? {
                ...store.currentWorkflow,
                current_stage: event.stage,
                status: "running",
              }
            : store.currentWorkflow,
      }));
      if (state.currentWorkflowId === event.workflowId) {
        void get().fetchWorkflowDetail(event.workflowId);
      }
      break;
    }
    case "agent_active": {
      set(store => ({
        agentStatuses: {
          ...store.agentStatuses,
          [event.agentId]: event.action,
        },
        agents: applyAgentStatusUpdate(
          store.agents,
          event.agentId,
          event.action
        ),
      }));
      break;
    }
    case "heartbeat_status": {
      set(store => ({
        heartbeatStatuses: mergeHeartbeatStatus(
          store.heartbeatStatuses,
          event.status
        ),
        agentStatuses:
          store.agentStatuses[event.status.agentId] === "heartbeat" &&
          event.status.state !== "running"
            ? { ...store.agentStatuses, [event.status.agentId]: "idle" }
            : store.agentStatuses,
        agents:
          store.agentStatuses[event.status.agentId] === "heartbeat" &&
          event.status.state !== "running"
            ? applyAgentStatusUpdate(store.agents, event.status.agentId, "idle")
            : store.agents,
      }));
      break;
    }
    case "heartbeat_report_saved": {
      void get().fetchHeartbeatStatuses();
      void get().fetchHeartbeatReports(undefined, 12);
      break;
    }
    case "message_sent":
    case "score_assigned":
    case "task_update": {
      if (state.currentWorkflowId === event.workflowId) {
        void get().fetchWorkflowDetail(event.workflowId);
      }
      break;
    }
    case "workflow_complete": {
      set(store => ({
        workflows: store.workflows.map(workflow =>
          workflow.id === event.workflowId
            ? { ...workflow, status: event.status }
            : workflow
        ),
        currentWorkflow:
          store.currentWorkflow && store.currentWorkflow.id === event.workflowId
            ? { ...store.currentWorkflow, status: event.status }
            : store.currentWorkflow,
      }));
      if (state.currentWorkflowId === event.workflowId) {
        void get().fetchWorkflowDetail(event.workflowId);
      }
      void get().fetchWorkflows();
      break;
    }
    case "workflow_error": {
      set(store => ({
        workflows: store.workflows.map(workflow =>
          workflow.id === event.workflowId
            ? {
                ...workflow,
                status: "failed",
                results: {
                  ...(workflow.results || {}),
                  last_error: event.error,
                },
              }
            : workflow
        ),
        currentWorkflow:
          store.currentWorkflow && store.currentWorkflow.id === event.workflowId
            ? {
                ...store.currentWorkflow,
                status: "failed",
                results: {
                  ...(store.currentWorkflow.results || {}),
                  last_error: event.error,
                },
              }
            : store.currentWorkflow,
      }));
      if (state.currentWorkflowId === event.workflowId) {
        void get().fetchWorkflowDetail(event.workflowId);
      }
      break;
    }
  }
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  socket: null,
  connected: false,
  agents: [],
  agentsError: null,
  agentStatuses: {},
  currentWorkflowId: null,
  workflows: [],
  workflowsError: null,
  currentWorkflow: null,
  workflowDetailError: null,
  tasks: [],
  messages: [],
  agentMemoryRecent: [],
  agentMemorySearchResults: [],
  memoryError: null,
  heartbeatStatuses: [],
  heartbeatReports: [],
  heartbeatError: null,
  stages: FALLBACK_STAGES,
  isWorkflowPanelOpen: false,
  activeView: "directive",
  isSubmitting: false,
  submitError: null,
  lastSubmittedInputSignature: null,
  lastSubmittedAt: null,
  isMemoryLoading: false,
  isHeartbeatLoading: false,
  runningHeartbeatAgentId: null,
  selectedMemoryAgentId: null,
  memoryQuery: "",
  eventLog: [],

  initSocket: async () => {
    if (isAdvancedMode()) {
      if (runtimeUnsubscribe) {
        runtimeUnsubscribe();
        runtimeUnsubscribe = null;
      }
      runtimeInitPromise = null;

      const existingSocket = get().socket;
      if (existingSocket?.connected) return;
      if (existingSocket) {
        existingSocket.disconnect();
      }

      const socket = io(window.location.origin, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      socket.on("connect", () => {
        set({ connected: true });
      });

      socket.on("disconnect", () => {
        set({ connected: false });
      });

      socket.on("agent_event", (event: RuntimeEvent) => {
        handleRuntimeEvent(event, set, get);
      });

      set({ socket, connected: socket.connected });
      return;
    }

    const existingSocket = get().socket;
    if (existingSocket) {
      existingSocket.disconnect();
      set({ socket: null, connected: false });
    }

    if (runtimeInitPromise) {
      await runtimeInitPromise;
      return;
    }

    runtimeInitPromise = (async () => {
      await localRuntime.ensureStarted();

      if (!runtimeUnsubscribe) {
        runtimeUnsubscribe = runtimeEventBus.subscribe(event =>
          handleRuntimeEvent(event, set, get)
        );
      }

      const snapshot = await localRuntime.getSnapshot();
      set({
        socket: null,
        connected: true,
        agents: snapshot.agents,
        agentStatuses: snapshot.agentStatuses,
        workflows: snapshot.workflows,
        heartbeatStatuses: snapshot.heartbeatStatuses,
        heartbeatReports: snapshot.heartbeatReports,
        stages: snapshot.stages?.length ? snapshot.stages : FALLBACK_STAGES,
      });
    })();

    try {
      await runtimeInitPromise;
    } catch (error) {
      set({ connected: false });
      runtimeInitPromise = null;
      throw error;
    }
  },

  disconnectSocket: () => {
    const socket = get().socket;
    if (socket) {
      socket.disconnect();
    }
    if (runtimeUnsubscribe) {
      runtimeUnsubscribe();
      runtimeUnsubscribe = null;
    }
    runtimeInitPromise = null;
    set({ socket: null, connected: false });
  },

  fetchAgents: async () => {
    try {
      if (isAdvancedMode()) {
        const data =
          await fetchAdvancedJsonOrThrow<WorkflowAgentsResponse>("/api/agents");
        const agents = (data.agents || []).map((agent: any) => ({
          ...agent,
          isActive: agent.isActive ?? true,
          status: (get().agentStatuses[agent.id] ||
            "idle") as AgentInfo["status"],
        }));
        void persistAgents(agents).catch(storageError => {
          console.warn(
            "[Store] Failed to persist agents snapshot:",
            storageError
          );
        });
        set({ agents, agentsError: null });
        return;
      }

      const data = await localRuntime.getAgents();
      const agents = data.agents.map(agent => ({
        ...agent,
        status: (get().agentStatuses[agent.id] ||
          agent.status) as AgentInfo["status"],
      }));
      void persistAgents(agents).catch(storageError => {
        console.warn(
          "[Store] Failed to persist agents snapshot:",
          storageError
        );
      });
      set({ agents, agentsError: null });
    } catch (err) {
      console.error("[Store] Failed to fetch agents:", err);
      const agentsError = isApiRequestError(err) ? err : null;
      if (agentsError) {
        set({ agentsError });
      }
      try {
        const agents = await getAgentsSnapshot();
        if (agents.length > 0) {
          set({
            agents: agents.map((agent: any) => ({
              ...agent,
              isActive: agent.isActive ?? true,
              status: get().agentStatuses[agent.id] || agent.status || "idle",
            })),
            agentsError,
          });
        }
      } catch (storageError) {
        console.warn("[Store] Failed to load agent snapshot:", storageError);
      }
    }
  },

  fetchStages: async () => {
    try {
      if (isAdvancedMode()) {
        const data =
          await fetchAdvancedJsonOrThrow<WorkflowStagesResponse>(
            "/api/config/stages"
          );
        set({ stages: data.stages || FALLBACK_STAGES });
        return;
      }

      const data = await localRuntime.getStages();
      set({ stages: data.stages || FALLBACK_STAGES });
    } catch (err) {
      console.error("[Store] Failed to fetch stages:", err);
      set({ stages: FALLBACK_STAGES });
    }
  },

  fetchWorkflows: async () => {
    try {
      const data = isAdvancedMode()
        ? await fetchAdvancedJsonOrThrow<WorkflowListResponse>("/api/workflows")
        : await localRuntime.listWorkflows();
      void persistWorkflows(data.workflows || []).catch(storageError => {
        console.warn(
          "[Store] Failed to persist workflow list snapshot:",
          storageError
        );
      });
      set({ workflows: data.workflows || [], workflowsError: null });
    } catch (err) {
      console.error("[Store] Failed to fetch workflows:", err);
      const workflowsError = isApiRequestError(err) ? err : null;
      if (workflowsError) {
        set({ workflowsError });
      }
      try {
        const workflows = await getWorkflowsSnapshot();
        if (workflows.length > 0) {
          set({ workflows, workflowsError });
        }
      } catch (storageError) {
        console.warn(
          "[Store] Failed to load workflow snapshots:",
          storageError
        );
      }
    }
  },

  fetchWorkflowDetail: async (id: string) => {
    try {
      const data = isAdvancedMode()
        ? await fetchAdvancedJsonOrThrow<WorkflowDetailResponse>(
            `/api/workflows/${id}`
          )
        : await localRuntime.getWorkflowDetail(id);
      void persistWorkflowDetail({
        id,
        workflow: data.workflow,
        tasks: data.tasks || [],
        messages: data.messages || [],
        report: data.report || null,
      }).catch(storageError => {
        console.warn(
          "[Store] Failed to persist workflow detail snapshot:",
          storageError
        );
      });
      set({
        currentWorkflow: data.workflow,
        tasks: data.tasks || [],
        messages: data.messages || [],
        currentWorkflowId: id,
        workflowDetailError: null,
      });
    } catch (err) {
      console.error("[Store] Failed to fetch workflow detail:", err);
      const workflowDetailError = isApiRequestError(err) ? err : null;
      if (workflowDetailError) {
        set({ workflowDetailError });
      }
      try {
        const snapshot = await getWorkflowDetailSnapshot(id);
        if (snapshot) {
          set({
            currentWorkflow: snapshot.workflow,
            tasks: snapshot.tasks || [],
            messages: snapshot.messages || [],
            currentWorkflowId: id,
            workflowDetailError,
          });
        }
      } catch (storageError) {
        console.warn(
          "[Store] Failed to load workflow detail snapshot:",
          storageError
        );
      }
    }
  },

  fetchAgentRecentMemory: async (
    agentId: string,
    workflowId?: string | null,
    limit: number = 10
  ) => {
    if (!agentId) return;
    set({ isMemoryLoading: true, memoryError: null });

    try {
      const data = isAdvancedMode()
        ? await (async () => {
            const params = new URLSearchParams();
            params.set("limit", String(limit));
            if (workflowId) {
              params.set("workflowId", workflowId);
            }
            return fetchAdvancedJsonOrThrow<WorkflowRecentMemoryResponse>(
              `/api/agents/${agentId}/memory/recent?${params.toString()}`
            );
          })()
        : await localRuntime.getAgentRecentMemory(agentId, workflowId, limit);
      void persistRecentMemory(
        agentId,
        workflowId || null,
        data.entries || []
      ).catch(storageError => {
        console.warn(
          "[Store] Failed to persist recent memory snapshot:",
          storageError
        );
      });
      set({
        agentMemoryRecent: data.entries || [],
        isMemoryLoading: false,
        memoryError: null,
      });
    } catch (err) {
      console.error("[Store] Failed to fetch recent memory:", err);
      const memoryError = isApiRequestError(err) ? err : null;
      if (memoryError) {
        set({ memoryError });
      }
      try {
        const snapshot = await getRecentMemorySnapshot(
          agentId,
          workflowId || null
        );
        set({
          agentMemoryRecent: snapshot?.entries || [],
          isMemoryLoading: false,
          memoryError,
        });
      } catch (storageError) {
        console.warn(
          "[Store] Failed to load recent memory snapshot:",
          storageError
        );
        set({ agentMemoryRecent: [], isMemoryLoading: false, memoryError });
      }
    }
  },

  searchAgentMemory: async (
    agentId: string,
    query: string,
    topK: number = 5
  ) => {
    if (!agentId) return;
    set({ isMemoryLoading: true, memoryQuery: query, memoryError: null });

    try {
      const data = isAdvancedMode()
        ? await (async () => {
            const params = new URLSearchParams();
            params.set("query", query);
            params.set("topK", String(topK));
            return fetchAdvancedJsonOrThrow<WorkflowSearchMemoryResponse>(
              `/api/agents/${agentId}/memory/search?${params.toString()}`
            );
          })()
        : await localRuntime.searchAgentMemory(agentId, query, topK);
      void persistMemorySearch(agentId, query, data.memories || []).catch(
        storageError => {
          console.warn(
            "[Store] Failed to persist memory search snapshot:",
            storageError
          );
        }
      );
      set({
        agentMemorySearchResults: data.memories || [],
        isMemoryLoading: false,
        memoryError: null,
      });
    } catch (err) {
      console.error("[Store] Failed to search memory:", err);
      const memoryError = isApiRequestError(err) ? err : null;
      if (memoryError) {
        set({ memoryError });
      }
      try {
        const snapshot = await getMemorySearchSnapshot(agentId, query);
        set({
          agentMemorySearchResults: snapshot?.results || [],
          isMemoryLoading: false,
          memoryError,
        });
      } catch (storageError) {
        console.warn(
          "[Store] Failed to load memory search snapshot:",
          storageError
        );
        set({
          agentMemorySearchResults: [],
          isMemoryLoading: false,
          memoryError,
        });
      }
    }
  },

  fetchHeartbeatStatuses: async () => {
    try {
      const data = isAdvancedMode()
        ? await fetchAdvancedJsonOrThrow<WorkflowHeartbeatStatusesResponse>(
            "/api/reports/heartbeat/status"
          )
        : await localRuntime.getHeartbeatStatuses();
      void persistHeartbeatStatuses(data.statuses || []).catch(storageError => {
        console.warn(
          "[Store] Failed to persist heartbeat status snapshot:",
          storageError
        );
      });
      set({ heartbeatStatuses: data.statuses || [], heartbeatError: null });
    } catch (err) {
      console.error("[Store] Failed to fetch heartbeat statuses:", err);
      const heartbeatError = isApiRequestError(err) ? err : null;
      if (heartbeatError) {
        set({ heartbeatError });
      }
      try {
        const statuses = await getHeartbeatStatusesSnapshot();
        set({ heartbeatStatuses: statuses || [], heartbeatError });
      } catch (storageError) {
        console.warn(
          "[Store] Failed to load heartbeat status snapshots:",
          storageError
        );
      }
    }
  },

  fetchHeartbeatReports: async (
    agentId?: string | null,
    limit: number = 12
  ) => {
    set({ isHeartbeatLoading: true, heartbeatError: null });

    try {
      const data = isAdvancedMode()
        ? await (async () => {
            const params = new URLSearchParams();
            params.set("limit", String(limit));
            if (agentId) {
              params.set("agentId", agentId);
            }
            return fetchAdvancedJsonOrThrow<WorkflowHeartbeatReportsResponse>(
              `/api/reports/heartbeat?${params.toString()}`
            );
          })()
        : await localRuntime.getHeartbeatReports(agentId, limit);
      void persistHeartbeatReports(
        (data.reports || []).map((report: any) => ({
          agentId: report.agentId,
          reportId: report.reportId,
          summary: report,
          detail: null,
        }))
      ).catch(storageError => {
        console.warn(
          "[Store] Failed to persist heartbeat report snapshots:",
          storageError
        );
      });
      set({
        heartbeatReports: data.reports || [],
        isHeartbeatLoading: false,
        heartbeatError: null,
      });
    } catch (err) {
      console.error("[Store] Failed to fetch heartbeat reports:", err);
      const heartbeatError = isApiRequestError(err) ? err : null;
      if (heartbeatError) {
        set({ heartbeatError });
      }
      try {
        const reports = await getHeartbeatReportsSnapshot(agentId || null);
        set({
          heartbeatReports: reports.map(item => item.summary),
          isHeartbeatLoading: false,
          heartbeatError,
        });
      } catch (storageError) {
        console.warn(
          "[Store] Failed to load heartbeat report snapshots:",
          storageError
        );
        set({
          heartbeatReports: [],
          isHeartbeatLoading: false,
          heartbeatError,
        });
      }
    }
  },

  runHeartbeat: async (agentId: string) => {
    if (!agentId) return false;
    set({ runningHeartbeatAgentId: agentId, heartbeatError: null });

    try {
      if (isAdvancedMode()) {
        await fetchAdvancedJsonOrThrow<WorkflowHeartbeatRunResponse>(
          `/api/reports/heartbeat/${agentId}/run`,
          {
            method: "POST",
          }
        );
      } else {
        await localRuntime.runHeartbeat(agentId);
      }

      await get().fetchHeartbeatStatuses();
      await get().fetchHeartbeatReports(undefined, 12);
      set({ runningHeartbeatAgentId: null });
      return true;
    } catch (err) {
      console.error("[Store] Failed to run heartbeat:", err);
      set({
        runningHeartbeatAgentId: null,
        heartbeatError: isApiRequestError(err) ? err : get().heartbeatError,
      });
      return false;
    }
  },

  submitDirective: async (input: DirectiveSubmissionInput) => {
    const normalizedDirective = normalizeDirective(input.directive);
    const attachments = normalizeWorkflowAttachments(input.attachments);
    if (!normalizedDirective) return null;
    const inputSignature = buildWorkflowInputSignature(
      normalizedDirective,
      attachments
    );

    const state = get();
    const now = Date.now();
    const currentWorkflow = state.currentWorkflow;
    const existingRunningWorkflow =
      currentWorkflow &&
      !isTerminalWorkflowStatus(currentWorkflow.status) &&
      getWorkflowInputSignature(currentWorkflow) === inputSignature
        ? currentWorkflow
        : state.workflows.find(
            workflow =>
              !isTerminalWorkflowStatus(workflow.status) &&
              getWorkflowInputSignature(workflow) === inputSignature
          );

    if (existingRunningWorkflow) {
      set({
        currentWorkflowId: existingRunningWorkflow.id,
        currentWorkflow: existingRunningWorkflow,
        activeView: "workflow",
      });
      await get().fetchWorkflowDetail(existingRunningWorkflow.id);
      return {
        workflowId: existingRunningWorkflow.id,
        missionId: existingRunningWorkflow.missionId ?? null,
        deduped: true,
      };
    }

    if (
      state.lastSubmittedInputSignature === inputSignature &&
      state.lastSubmittedAt !== null &&
      now - state.lastSubmittedAt < 5000
    ) {
      return state.currentWorkflowId
        ? {
            workflowId: state.currentWorkflowId,
            missionId:
              state.currentWorkflow?.id === state.currentWorkflowId
                ? (state.currentWorkflow.missionId ?? null)
                : null,
            deduped: true,
          }
        : null;
    }

    set({
      isSubmitting: true,
      submitError: null,
      lastSubmittedInputSignature: inputSignature,
      lastSubmittedAt: now,
    });

    try {
      const data = isAdvancedMode()
        ? await (async () => {
            return fetchAdvancedJsonOrThrow<WorkflowCreateResponse>(
              "/api/workflows",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  directive: normalizedDirective,
                  attachments,
                }),
              }
            );
          })()
        : await localRuntime.submitDirective(normalizedDirective, attachments);

      if (data.workflowId) {
        set({
          currentWorkflowId: data.workflowId,
          activeView: "workflow",
          isSubmitting: false,
          submitError: null,
          lastSubmittedInputSignature: inputSignature,
          lastSubmittedAt: Date.now(),
        });
        await get().fetchWorkflowDetail(data.workflowId);
        await get().fetchWorkflows();
        return {
          workflowId: data.workflowId,
          missionId: data.missionId ?? null,
          deduped: Boolean(data.deduped),
        };
      }

      set({ isSubmitting: false, submitError: null });
      return null;
    } catch (err) {
      console.error("[Store] Failed to submit directive:", err);
      set({
        isSubmitting: false,
        submitError: isApiRequestError(err) ? err : null,
      });
      return null;
    }
  },

  downloadWorkflowReport: async (workflowId, format) => {
    if (isAdvancedMode()) {
      await downloadFromUrl(
        `/api/workflows/${workflowId}/report/download?format=${format}`,
        `workflow-report.${format}`
      );
      return;
    }

    const payload = await localRuntime.downloadWorkflowReport(
      workflowId,
      format
    );
    saveDownload(payload.filename, payload.mimeType, payload.content);
  },

  downloadDepartmentReport: async (workflowId, managerId, format) => {
    if (isAdvancedMode()) {
      await downloadFromUrl(
        `/api/workflows/${workflowId}/report/department/${managerId}/download?format=${format}`,
        `department-report.${format}`
      );
      return;
    }

    const payload = await localRuntime.downloadWorkflowReport(
      workflowId,
      format,
      managerId
    );
    saveDownload(payload.filename, payload.mimeType, payload.content);
  },

  downloadHeartbeatReport: async (agentId, reportId, format) => {
    if (isAdvancedMode()) {
      await downloadFromUrl(
        `/api/reports/heartbeat/${agentId}/${reportId}/download?format=${format}`,
        `heartbeat-report.${format}`
      );
      return;
    }

    const payload = await localRuntime.downloadHeartbeatReport(
      agentId,
      reportId,
      format
    );
    saveDownload(payload.filename, payload.mimeType, payload.content);
  },

  setSelectedMemoryAgent: id =>
    set({
      selectedMemoryAgentId: id,
      agentMemoryRecent: [],
      agentMemorySearchResults: [],
    }),

  setMemoryQuery: query => set({ memoryQuery: query }),
  setActiveView: view => set({ activeView: view }),
  toggleWorkflowPanel: () =>
    set(state => ({ isWorkflowPanelOpen: !state.isWorkflowPanelOpen })),
  openWorkflowPanel: () => set({ isWorkflowPanelOpen: true }),
  setCurrentWorkflow: id => {
    if (id) {
      void get().fetchWorkflowDetail(id);
    } else {
      set({
        currentWorkflowId: null,
        currentWorkflow: null,
        tasks: [],
        messages: [],
      });
    }
  },
}));
