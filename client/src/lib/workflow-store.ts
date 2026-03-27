/**
 * UI state for both browser runtime mode and advanced server mode.
 */
import { create } from "zustand";
import { io, Socket } from "socket.io-client";

import { useAppStore } from "@/lib/store";
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
  WorkflowInfo,
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
};

export type PanelView =
  | "directive"
  | "org"
  | "workflow"
  | "review"
  | "history"
  | "memory"
  | "reports";

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

let runtimeUnsubscribe: (() => void) | null = null;
let runtimeInitPromise: Promise<void> | null = null;

interface WorkflowState {
  socket: Socket | null;
  connected: boolean;
  agents: AgentInfo[];
  agentStatuses: Record<string, string>;
  currentWorkflowId: string | null;
  workflows: WorkflowInfo[];
  currentWorkflow: WorkflowInfo | null;
  tasks: TaskInfo[];
  messages: MessageInfo[];
  agentMemoryRecent: AgentMemoryEntry[];
  agentMemorySearchResults: AgentMemorySummary[];
  heartbeatStatuses: HeartbeatStatusInfo[];
  heartbeatReports: HeartbeatReportInfo[];
  stages: StageInfo[];
  isWorkflowPanelOpen: boolean;
  activeView: PanelView;
  isSubmitting: boolean;
  lastSubmittedDirective: string | null;
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
  submitDirective: (directive: string) => Promise<string | null>;
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
        agents: applyAgentStatusUpdate(store.agents, event.agentId, event.action),
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
  agentStatuses: {},
  currentWorkflowId: null,
  workflows: [],
  currentWorkflow: null,
  tasks: [],
  messages: [],
  agentMemoryRecent: [],
  agentMemorySearchResults: [],
  heartbeatStatuses: [],
  heartbeatReports: [],
  stages: FALLBACK_STAGES,
  isWorkflowPanelOpen: false,
  activeView: "directive",
  isSubmitting: false,
  lastSubmittedDirective: null,
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
        const response = await fetch("/api/agents");
        const data = await response.json();
        const agents = (data.agents || []).map((agent: any) => ({
          ...agent,
          isActive: agent.isActive ?? true,
          status: (get().agentStatuses[agent.id] || "idle") as AgentInfo["status"],
        }));
        void persistAgents(agents).catch(storageError => {
          console.warn("[Store] Failed to persist agents snapshot:", storageError);
        });
        set({ agents });
        return;
      }

      const data = await localRuntime.getAgents();
      const agents = data.agents.map(agent => ({
        ...agent,
        status: (get().agentStatuses[agent.id] ||
          agent.status) as AgentInfo["status"],
      }));
      void persistAgents(agents).catch(storageError => {
        console.warn("[Store] Failed to persist agents snapshot:", storageError);
      });
      set({ agents });
    } catch (err) {
      console.error("[Store] Failed to fetch agents:", err);
      try {
        const agents = await getAgentsSnapshot();
        if (agents.length > 0) {
          set({
            agents: agents.map((agent: any) => ({
              ...agent,
              isActive: agent.isActive ?? true,
              status: get().agentStatuses[agent.id] || agent.status || "idle",
            })),
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
        const response = await fetch("/api/config/stages");
        const data = await response.json();
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
        ? await fetch("/api/workflows").then(res => res.json())
        : await localRuntime.listWorkflows();
      void persistWorkflows(data.workflows || []).catch(storageError => {
        console.warn(
          "[Store] Failed to persist workflow list snapshot:",
          storageError
        );
      });
      set({ workflows: data.workflows || [] });
    } catch (err) {
      console.error("[Store] Failed to fetch workflows:", err);
      try {
        const workflows = await getWorkflowsSnapshot();
        if (workflows.length > 0) {
          set({ workflows });
        }
      } catch (storageError) {
        console.warn("[Store] Failed to load workflow snapshots:", storageError);
      }
    }
  },

  fetchWorkflowDetail: async (id: string) => {
    try {
      const data = isAdvancedMode()
        ? await fetch(`/api/workflows/${id}`).then(res => res.json())
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
      });
    } catch (err) {
      console.error("[Store] Failed to fetch workflow detail:", err);
      try {
        const snapshot = await getWorkflowDetailSnapshot(id);
        if (snapshot) {
          set({
            currentWorkflow: snapshot.workflow,
            tasks: snapshot.tasks || [],
            messages: snapshot.messages || [],
            currentWorkflowId: id,
          });
        }
      } catch (storageError) {
        console.warn("[Store] Failed to load workflow detail snapshot:", storageError);
      }
    }
  },

  fetchAgentRecentMemory: async (
    agentId: string,
    workflowId?: string | null,
    limit: number = 10
  ) => {
    if (!agentId) return;
    set({ isMemoryLoading: true });

    try {
      const data = isAdvancedMode()
        ? await (async () => {
            const params = new URLSearchParams();
            params.set("limit", String(limit));
            if (workflowId) {
              params.set("workflowId", workflowId);
            }
            return fetch(
              `/api/agents/${agentId}/memory/recent?${params.toString()}`
            ).then(res => res.json());
          })()
        : await localRuntime.getAgentRecentMemory(agentId, workflowId, limit);
      void persistRecentMemory(agentId, workflowId || null, data.entries || []).catch(
        storageError => {
          console.warn("[Store] Failed to persist recent memory snapshot:", storageError);
        }
      );
      set({
        agentMemoryRecent: data.entries || [],
        isMemoryLoading: false,
      });
    } catch (err) {
      console.error("[Store] Failed to fetch recent memory:", err);
      try {
        const snapshot = await getRecentMemorySnapshot(agentId, workflowId || null);
        set({
          agentMemoryRecent: snapshot?.entries || [],
          isMemoryLoading: false,
        });
      } catch (storageError) {
        console.warn("[Store] Failed to load recent memory snapshot:", storageError);
        set({ agentMemoryRecent: [], isMemoryLoading: false });
      }
    }
  },

  searchAgentMemory: async (
    agentId: string,
    query: string,
    topK: number = 5
  ) => {
    if (!agentId) return;
    set({ isMemoryLoading: true, memoryQuery: query });

    try {
      const data = isAdvancedMode()
        ? await (async () => {
            const params = new URLSearchParams();
            params.set("query", query);
            params.set("topK", String(topK));
            return fetch(
              `/api/agents/${agentId}/memory/search?${params.toString()}`
            ).then(res => res.json());
          })()
        : await localRuntime.searchAgentMemory(agentId, query, topK);
      void persistMemorySearch(agentId, query, data.memories || []).catch(
        storageError => {
          console.warn("[Store] Failed to persist memory search snapshot:", storageError);
        }
      );
      set({
        agentMemorySearchResults: data.memories || [],
        isMemoryLoading: false,
      });
    } catch (err) {
      console.error("[Store] Failed to search memory:", err);
      try {
        const snapshot = await getMemorySearchSnapshot(agentId, query);
        set({
          agentMemorySearchResults: snapshot?.results || [],
          isMemoryLoading: false,
        });
      } catch (storageError) {
        console.warn("[Store] Failed to load memory search snapshot:", storageError);
        set({ agentMemorySearchResults: [], isMemoryLoading: false });
      }
    }
  },

  fetchHeartbeatStatuses: async () => {
    try {
      const data = isAdvancedMode()
        ? await fetch("/api/reports/heartbeat/status").then(res => res.json())
        : await localRuntime.getHeartbeatStatuses();
      void persistHeartbeatStatuses(data.statuses || []).catch(storageError => {
        console.warn(
          "[Store] Failed to persist heartbeat status snapshot:",
          storageError
        );
      });
      set({ heartbeatStatuses: data.statuses || [] });
    } catch (err) {
      console.error("[Store] Failed to fetch heartbeat statuses:", err);
      try {
        const statuses = await getHeartbeatStatusesSnapshot();
        set({ heartbeatStatuses: statuses || [] });
      } catch (storageError) {
        console.warn("[Store] Failed to load heartbeat status snapshots:", storageError);
      }
    }
  },

  fetchHeartbeatReports: async (
    agentId?: string | null,
    limit: number = 12
  ) => {
    set({ isHeartbeatLoading: true });

    try {
      const data = isAdvancedMode()
        ? await (async () => {
            const params = new URLSearchParams();
            params.set("limit", String(limit));
            if (agentId) {
              params.set("agentId", agentId);
            }
            return fetch(`/api/reports/heartbeat?${params.toString()}`).then(res =>
              res.json()
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
      });
    } catch (err) {
      console.error("[Store] Failed to fetch heartbeat reports:", err);
      try {
        const reports = await getHeartbeatReportsSnapshot(agentId || null);
        set({
          heartbeatReports: reports.map(item => item.summary),
          isHeartbeatLoading: false,
        });
      } catch (storageError) {
        console.warn("[Store] Failed to load heartbeat report snapshots:", storageError);
        set({ heartbeatReports: [], isHeartbeatLoading: false });
      }
    }
  },

  runHeartbeat: async (agentId: string) => {
    if (!agentId) return false;
    set({ runningHeartbeatAgentId: agentId });

    try {
      if (isAdvancedMode()) {
        const response = await fetch(`/api/reports/heartbeat/${agentId}/run`, {
          method: "POST",
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Heartbeat run failed");
        }
      } else {
        await localRuntime.runHeartbeat(agentId);
      }

      await get().fetchHeartbeatStatuses();
      await get().fetchHeartbeatReports(undefined, 12);
      set({ runningHeartbeatAgentId: null });
      return true;
    } catch (err) {
      console.error("[Store] Failed to run heartbeat:", err);
      set({ runningHeartbeatAgentId: null });
      return false;
    }
  },

  submitDirective: async (directive: string) => {
    const normalizedDirective = normalizeDirective(directive);
    if (!normalizedDirective) return null;

    const state = get();
    const now = Date.now();
    const currentWorkflow = state.currentWorkflow;
    const existingRunningWorkflow =
      currentWorkflow &&
      !isTerminalWorkflowStatus(currentWorkflow.status) &&
      normalizeDirective(currentWorkflow.directive) === normalizedDirective
        ? currentWorkflow
        : state.workflows.find(
            workflow =>
              !isTerminalWorkflowStatus(workflow.status) &&
              normalizeDirective(workflow.directive) === normalizedDirective
          );

    if (existingRunningWorkflow) {
      set({
        currentWorkflowId: existingRunningWorkflow.id,
        currentWorkflow: existingRunningWorkflow,
        activeView: "workflow",
      });
      await get().fetchWorkflowDetail(existingRunningWorkflow.id);
      return existingRunningWorkflow.id;
    }

    if (
      state.lastSubmittedDirective === normalizedDirective &&
      state.lastSubmittedAt !== null &&
      now - state.lastSubmittedAt < 5000
    ) {
      return state.currentWorkflowId;
    }

    set({
      isSubmitting: true,
      lastSubmittedDirective: normalizedDirective,
      lastSubmittedAt: now,
    });

    try {
      const data = isAdvancedMode()
        ? await (async () => {
            const response = await fetch("/api/workflows", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ directive: normalizedDirective }),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Workflow start failed");
            }
            return payload;
          })()
        : await localRuntime.submitDirective(normalizedDirective);

      if (data.workflowId) {
        set({
          currentWorkflowId: data.workflowId,
          activeView: "workflow",
          isSubmitting: false,
          lastSubmittedDirective: normalizedDirective,
          lastSubmittedAt: Date.now(),
        });
        await get().fetchWorkflowDetail(data.workflowId);
        await get().fetchWorkflows();
        return data.workflowId;
      }

      set({ isSubmitting: false });
      return null;
    } catch (err) {
      console.error("[Store] Failed to submit directive:", err);
      set({ isSubmitting: false });
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

    const payload = await localRuntime.downloadWorkflowReport(workflowId, format);
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
