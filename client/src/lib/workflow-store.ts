/**
 * State management for the multi-agent workflow UI.
 */
import { create } from "zustand";
import { io, Socket } from "socket.io-client";

import { AGENT_VISUAL_CONFIGS } from "@/lib/agent-config";
import { useAppStore } from "@/lib/store";

export interface AgentInfo {
  id: string;
  name: string;
  department: string;
  role: "ceo" | "manager" | "worker";
  managerId: string | null;
  model: string;
  isActive: boolean;
  status:
    | "idle"
    | "thinking"
    | "heartbeat"
    | "executing"
    | "reviewing"
    | "planning"
    | "analyzing"
    | "auditing"
    | "revising"
    | "verifying"
    | "summarizing"
    | "evaluating";
}

export interface WorkflowInfo {
  id: string;
  directive: string;
  status:
    | "pending"
    | "running"
    | "completed"
    | "completed_with_errors"
    | "failed";
  current_stage: string | null;
  departments_involved: string[];
  started_at: string | null;
  completed_at: string | null;
  results: any;
  created_at: string;
}

export interface TaskInfo {
  id: number;
  workflow_id: string;
  worker_id: string;
  manager_id: string;
  department: string;
  description: string;
  deliverable: string | null;
  deliverable_v2: string | null;
  deliverable_v3: string | null;
  score_accuracy: number | null;
  score_completeness: number | null;
  score_actionability: number | null;
  score_format: number | null;
  total_score: number | null;
  manager_feedback: string | null;
  meta_audit_feedback: string | null;
  version: number;
  status: string;
}

export interface MessageInfo {
  id: number;
  workflow_id: string;
  from_agent: string;
  to_agent: string;
  stage: string;
  content: string;
  metadata: any;
  created_at: string;
}

export interface StageInfo {
  id: string;
  order: number;
  label: string;
}

export interface AgentMemoryEntry {
  timestamp: string;
  workflowId: string | null;
  stage: string | null;
  type: "message" | "llm_prompt" | "llm_response" | "workflow_summary";
  direction?: "inbound" | "outbound";
  agentId?: string;
  otherAgentId?: string;
  preview: string;
  content: string;
  metadata?: any;
}

export interface AgentMemorySummary {
  workflowId: string;
  createdAt: string;
  directive: string;
  status: string;
  role: string;
  stage: string | null;
  summary: string;
  keywords: string[];
}

export interface HeartbeatStatusInfo {
  agentId: string;
  agentName: string;
  department: string;
  enabled: boolean;
  state: "idle" | "scheduled" | "running" | "error";
  intervalMinutes: number;
  keywords: string[];
  focus: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastReportId: string | null;
  lastReportTitle: string | null;
  lastReportAt: string | null;
  reportCount: number;
}

export interface HeartbeatReportInfo {
  reportId: string;
  generatedAt: string;
  trigger: "scheduled" | "manual" | "startup";
  agentId: string;
  agentName: string;
  department: string;
  title: string;
  summaryPreview: string;
  keywords: string[];
  searchResultCount: number;
  jsonPath: string;
  markdownPath: string;
}

export type PanelView =
  | "directive"
  | "org"
  | "workflow"
  | "review"
  | "history"
  | "memory"
  | "reports";

const DEMO_STAGE_LABELS: Record<string, string> = {
  direction: "方向下发",
  planning: "任务规划",
  execution: "执行",
  review: "评审",
  meta_audit: "元审计",
  revision: "修订",
  verify: "验证",
  summary: "汇总",
  feedback: "反馈",
  evolution: "进化",
};

const DEMO_STAGES: StageInfo[] = [
  "direction",
  "planning",
  "execution",
  "review",
  "meta_audit",
  "revision",
  "verify",
  "summary",
  "feedback",
  "evolution",
].map((id, index) => ({
  id,
  order: index + 1,
  label: DEMO_STAGE_LABELS[id] || id,
}));

const DEMO_AGENTS: AgentInfo[] = AGENT_VISUAL_CONFIGS.map((config) => ({
  id: config.id,
  name: config.name,
  department: config.department,
  role: config.role,
  managerId:
    config.role === "worker"
      ? AGENT_VISUAL_CONFIGS.find(
          candidate =>
            candidate.role === "manager" &&
            candidate.department === config.department
        )?.id || null
      : null,
  model: "browser-preview",
  isActive: true,
  status: "idle",
}));

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

  initSocket: () => void;
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
  setSelectedMemoryAgent: (id: string | null) => void;
  setMemoryQuery: (query: string) => void;
  setActiveView: (view: PanelView) => void;
  toggleWorkflowPanel: () => void;
  openWorkflowPanel: () => void;
  setCurrentWorkflow: (id: string | null) => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  socket: null,
  connected: false,
  agents: DEMO_AGENTS,
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
  stages: DEMO_STAGES,
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

  initSocket: () => {
    if (!isAdvancedMode()) {
      const existingSocket = get().socket;
      if (existingSocket) {
        existingSocket.disconnect();
      }

      set({ socket: null, connected: false, eventLog: [] });
      return;
    }

    const existing = get().socket;
    if (existing?.connected) return;

    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      console.log("[WS] Connected");
      set({ connected: true });
    });

    socket.on("disconnect", () => {
      console.log("[WS] Disconnected");
      set({ connected: false });
    });

    socket.on("agent_event", (event: any) => {
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
          if (state.currentWorkflowId === event.workflowId) {
            set(store => ({
              currentWorkflow: store.currentWorkflow
                ? {
                    ...store.currentWorkflow,
                    current_stage: event.stage,
                    status: "running",
                  }
                : null,
            }));
          }

          set(store => ({
            workflows: store.workflows.map(workflow =>
              workflow.id === event.workflowId
                ? { ...workflow, current_stage: event.stage, status: "running" }
                : workflow
            ),
          }));
          break;
        }

        case "agent_active": {
          set(store => ({
            agentStatuses: {
              ...store.agentStatuses,
              [event.agentId]: event.action,
            },
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
          }));
          break;
        }

        case "heartbeat_report_saved": {
          void get().fetchHeartbeatStatuses();
          void get().fetchHeartbeatReports(undefined, 12);
          break;
        }

        case "message_sent":
        case "score_assigned": {
          if (state.currentWorkflowId === event.workflowId) {
            get().fetchWorkflowDetail(event.workflowId);
          }
          break;
        }

        case "task_update": {
          if (state.currentWorkflowId === event.workflowId) {
            set(store => ({
              tasks: store.tasks.map(task =>
                task.id === event.taskId
                  ? { ...task, status: event.status }
                  : task
              ),
            }));
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
              store.currentWorkflow &&
              store.currentWorkflow.id === event.workflowId
                ? { ...store.currentWorkflow, status: event.status }
                : store.currentWorkflow,
          }));

          if (state.currentWorkflowId === event.workflowId) {
            get().fetchWorkflowDetail(event.workflowId);
          }
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
              store.currentWorkflow &&
              store.currentWorkflow.id === event.workflowId
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
            get().fetchWorkflowDetail(event.workflowId);
          }
          break;
        }
      }
    });

    set({ socket });
  },

  disconnectSocket: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null, connected: false });
    }
  },

  fetchAgents: async () => {
    if (!isAdvancedMode()) {
      set({
        agents: DEMO_AGENTS.map(agent => ({
          ...agent,
          status:
            (get().agentStatuses[agent.id] as AgentInfo["status"] | undefined) ||
            "idle",
        })),
      });
      return;
    }

    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      const agents = (data.agents || []).map((agent: any) => ({
        ...agent,
        isActive: agent.isActive ?? true,
        status: get().agentStatuses[agent.id] || "idle",
      }));
      set({ agents });
    } catch (err) {
      console.error("[Store] Failed to fetch agents:", err);
    }
  },

  fetchStages: async () => {
    if (!isAdvancedMode()) {
      set({ stages: DEMO_STAGES });
      return;
    }

    try {
      const res = await fetch("/api/config/stages");
      const data = await res.json();
      set({ stages: data.stages || [] });
    } catch (err) {
      console.error("[Store] Failed to fetch stages:", err);
    }
  },

  fetchWorkflows: async () => {
    if (!isAdvancedMode()) {
      set({ workflows: [] });
      return;
    }

    try {
      const res = await fetch("/api/workflows");
      const data = await res.json();
      set({ workflows: data.workflows || [] });
    } catch (err) {
      console.error("[Store] Failed to fetch workflows:", err);
    }
  },

  fetchWorkflowDetail: async (id: string) => {
    if (!isAdvancedMode()) {
      set({
        currentWorkflow: null,
        tasks: [],
        messages: [],
        currentWorkflowId: id,
      });
      return;
    }

    try {
      const res = await fetch(`/api/workflows/${id}`);
      const data = await res.json();
      set({
        currentWorkflow: data.workflow,
        tasks: data.tasks || [],
        messages: data.messages || [],
        currentWorkflowId: id,
      });
    } catch (err) {
      console.error("[Store] Failed to fetch workflow detail:", err);
    }
  },

  fetchAgentRecentMemory: async (
    agentId: string,
    workflowId?: string | null,
    limit: number = 10
  ) => {
    if (!agentId) return;
    set({ isMemoryLoading: true });

    if (!isAdvancedMode()) {
      set({
        agentMemoryRecent: [],
        isMemoryLoading: false,
      });
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (workflowId) {
        params.set("workflowId", workflowId);
      }

      const res = await fetch(
        `/api/agents/${agentId}/memory/recent?${params.toString()}`
      );
      const data = await res.json();
      set({
        agentMemoryRecent: data.entries || [],
        isMemoryLoading: false,
      });
    } catch (err) {
      console.error("[Store] Failed to fetch recent memory:", err);
      set({ agentMemoryRecent: [], isMemoryLoading: false });
    }
  },

  searchAgentMemory: async (
    agentId: string,
    query: string,
    topK: number = 5
  ) => {
    if (!agentId) return;
    set({ isMemoryLoading: true, memoryQuery: query });

    if (!isAdvancedMode()) {
      set({
        agentMemorySearchResults: [],
        isMemoryLoading: false,
      });
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set("query", query);
      params.set("topK", String(topK));

      const res = await fetch(
        `/api/agents/${agentId}/memory/search?${params.toString()}`
      );
      const data = await res.json();
      set({
        agentMemorySearchResults: data.memories || [],
        isMemoryLoading: false,
      });
    } catch (err) {
      console.error("[Store] Failed to search memory:", err);
      set({ agentMemorySearchResults: [], isMemoryLoading: false });
    }
  },

  fetchHeartbeatStatuses: async () => {
    if (!isAdvancedMode()) {
      set({ heartbeatStatuses: [] });
      return;
    }

    try {
      const res = await fetch("/api/reports/heartbeat/status");
      const data = await res.json();
      set({ heartbeatStatuses: data.statuses || [] });
    } catch (err) {
      console.error("[Store] Failed to fetch heartbeat statuses:", err);
    }
  },

  fetchHeartbeatReports: async (
    agentId?: string | null,
    limit: number = 12
  ) => {
    set({ isHeartbeatLoading: true });

    if (!isAdvancedMode()) {
      set({
        heartbeatReports: [],
        isHeartbeatLoading: false,
      });
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (agentId) {
        params.set("agentId", agentId);
      }

      const res = await fetch(`/api/reports/heartbeat?${params.toString()}`);
      const data = await res.json();
      set({
        heartbeatReports: data.reports || [],
        isHeartbeatLoading: false,
      });
    } catch (err) {
      console.error("[Store] Failed to fetch heartbeat reports:", err);
      set({ heartbeatReports: [], isHeartbeatLoading: false });
    }
  },

  runHeartbeat: async (agentId: string) => {
    if (!agentId) return false;
    set({ runningHeartbeatAgentId: agentId });

    if (!isAdvancedMode()) {
      set({ runningHeartbeatAgentId: null });
      return false;
    }

    try {
      const res = await fetch(`/api/reports/heartbeat/${agentId}/run`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Heartbeat run failed");
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

    if (!isAdvancedMode()) {
      set({
        isSubmitting: false,
        lastSubmittedDirective: normalizedDirective,
        lastSubmittedAt: Date.now(),
      });
      return null;
    }

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
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directive: normalizedDirective }),
      });
      const data = await res.json();

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
      get().fetchWorkflowDetail(id);
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
