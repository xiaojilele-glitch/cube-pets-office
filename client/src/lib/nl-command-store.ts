/**
 * NL Command Center Zustand store.
 *
 * Manages command list, current command, execution plan, alerts, comments,
 * and dashboard state. Wraps REST API calls via nl-command-client and
 * subscribes to Socket.IO nl_command_* events for real-time updates.
 *
 * @see Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  StrategicCommand,
  CommandAnalysis,
  NLExecutionPlan,
  Alert,
  Comment,
  ClarificationDialog,
  MissionDecomposition,
  FinalizedCommand,
  PlanApprovalRequest,
  PlanAdjustment,
} from "@shared/nl-command/contracts";

import type {
  DashboardResponse,
  SubmitCommandRequest,
  ApprovePlanRequest,
  AdjustPlanRequest,
  SubmitClarificationRequest,
  AddCommentRequest,
  ListCommandsRequest,
  ListAlertsRequest,
  ListCommentsRequest,
  GenerateReportRequest,
  CreateAlertRuleRequest,
  SaveTemplateRequest,
} from "@shared/nl-command/api";

import { NL_COMMAND_SOCKET_EVENTS } from "@shared/nl-command/socket";
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
} from "@shared/nl-command/socket";

import * as api from "./nl-command-client";

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

interface NLCommandState {
  // Data
  commands: StrategicCommand[];
  currentCommand: StrategicCommand | null;
  currentAnalysis: CommandAnalysis | null;
  currentDialog: ClarificationDialog | null;
  currentFinalized: FinalizedCommand | null;
  currentDecomposition: MissionDecomposition | null;
  currentPlan: NLExecutionPlan | null;
  currentApproval: PlanApprovalRequest | null;
  currentAdjustments: PlanAdjustment[];
  alerts: Alert[];
  comments: Comment[];
  dashboard: DashboardResponse | null;

  // UI state
  loading: boolean;
  error: string | null;

  // Actions — commands
  submitCommand: (req: SubmitCommandRequest) => Promise<void>;
  loadCommands: (params?: ListCommandsRequest) => Promise<void>;
  loadCommand: (id: string) => Promise<void>;

  // Actions — clarification
  submitClarification: (commandId: string, req: SubmitClarificationRequest) => Promise<void>;
  loadDialog: (commandId: string) => Promise<void>;

  // Actions — plans
  loadPlan: (planId: string) => Promise<void>;
  approvePlan: (planId: string, req: ApprovePlanRequest) => Promise<void>;
  adjustPlan: (planId: string, req: AdjustPlanRequest) => Promise<void>;

  // Actions — monitoring
  loadDashboard: () => Promise<void>;
  loadAlerts: (params?: ListAlertsRequest) => Promise<void>;
  createAlertRule: (req: CreateAlertRuleRequest) => Promise<void>;

  // Actions — collaboration
  addComment: (req: AddCommentRequest) => Promise<void>;
  loadComments: (params: ListCommentsRequest) => Promise<void>;

  // Actions — reports & templates
  generateReport: (req: GenerateReportRequest) => Promise<void>;
  saveTemplate: (req: SaveTemplateRequest) => Promise<void>;

  // Socket.IO
  initSocket: (socket: Socket) => void;

  // Utility
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useNLCommandStore = create<NLCommandState>((set, get) => ({
  // Initial state
  commands: [],
  currentCommand: null,
  currentAnalysis: null,
  currentDialog: null,
  currentFinalized: null,
  currentDecomposition: null,
  currentPlan: null,
  currentApproval: null,
  currentAdjustments: [],
  alerts: [],
  comments: [],
  dashboard: null,
  loading: false,
  error: null,

  // ── Commands ──────────────────────────────────────────────────────────

  submitCommand: async (req) => {
    set({ loading: true, error: null });
    try {
      const res = await api.submitCommand(req);
      set((s) => ({
        commands: [res.command, ...s.commands],
        currentCommand: res.command,
        currentAnalysis: res.analysis,
        loading: false,
      }));
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadCommands: async (params) => {
    set({ loading: true, error: null });
    try {
      const res = await api.listCommands(params);
      set({ commands: res.commands, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadCommand: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getCommand(id);
      set({
        currentCommand: res.command,
        currentAnalysis: res.analysis ?? null,
        currentFinalized: res.finalized ?? null,
        currentDecomposition: res.decomposition ?? null,
        currentPlan: res.plan ?? null,
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Clarification ────────────────────────────────────────────────────

  submitClarification: async (commandId, req) => {
    set({ loading: true, error: null });
    try {
      const res = await api.submitClarification(commandId, req);
      set({
        currentDialog: res.dialog,
        currentAnalysis: res.updatedAnalysis,
        currentFinalized: res.finalized ?? get().currentFinalized,
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadDialog: async (commandId) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getDialog(commandId);
      set({ currentDialog: res.dialog, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Plans ────────────────────────────────────────────────────────────

  loadPlan: async (planId) => {
    set({ loading: true, error: null });
    try {
      const res = await api.getPlan(planId);
      set({
        currentPlan: res.plan,
        currentApproval: res.approval ?? null,
        currentAdjustments: res.adjustments ?? [],
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  approvePlan: async (planId, req) => {
    set({ loading: true, error: null });
    try {
      const res = await api.approvePlan(planId, req);
      set({
        currentPlan: res.plan,
        currentApproval: res.approval,
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  adjustPlan: async (planId, req) => {
    set({ loading: true, error: null });
    try {
      const res = await api.adjustPlan(planId, req);
      set((s) => ({
        currentPlan: res.updatedPlan,
        currentAdjustments: [...s.currentAdjustments, res.adjustment],
        loading: false,
      }));
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Monitoring ───────────────────────────────────────────────────────

  loadDashboard: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.getDashboard();
      set({ dashboard: res, alerts: res.recentAlerts, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadAlerts: async (params) => {
    set({ loading: true, error: null });
    try {
      const res = await api.listAlerts(params);
      set({ alerts: res.alerts, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createAlertRule: async (req) => {
    set({ loading: true, error: null });
    try {
      await api.createAlertRule(req);
      set({ loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Collaboration ───────────────────────────────────────────────────

  addComment: async (req) => {
    set({ loading: true, error: null });
    try {
      const res = await api.addComment(req);
      set((s) => ({
        comments: [...s.comments, res.comment],
        loading: false,
      }));
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  loadComments: async (params) => {
    set({ loading: true, error: null });
    try {
      const res = await api.listComments(params);
      set({ comments: res.comments, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Reports & Templates ─────────────────────────────────────────────

  generateReport: async (req) => {
    set({ loading: true, error: null });
    try {
      await api.generateReport(req);
      set({ loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  saveTemplate: async (req) => {
    set({ loading: true, error: null });
    try {
      await api.saveTemplate(req);
      set({ loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  // ── Socket.IO ───────────────────────────────────────────────────────

  initSocket: (socket: Socket) => {
    socket.on(
      NL_COMMAND_SOCKET_EVENTS.commandCreated,
      (event: NLCommandCreatedEvent) => {
        set((s) => ({
          commands: [event.command, ...s.commands.filter((c) => c.commandId !== event.command.commandId)],
        }));
      },
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.commandAnalysis,
      (event: NLCommandAnalysisEvent) => {
        const cur = get().currentCommand;
        if (cur && cur.commandId === event.commandId) {
          set({ currentAnalysis: event.analysis });
        }
      },
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.clarificationQuestion,
      (event: NLClarificationQuestionEvent) => {
        const cur = get().currentCommand;
        if (cur && cur.commandId === event.commandId) {
          set((s) => {
            const dialog = s.currentDialog ?? {
              dialogId: `dialog-${event.commandId}`,
              commandId: event.commandId,
              questions: [],
              answers: [],
              clarificationRounds: 0,
              status: "active" as const,
            };
            return {
              currentDialog: {
                ...dialog,
                questions: [...dialog.questions, ...event.questions],
              },
            };
          });
        }
      },
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.decompositionComplete,
      (event: NLDecompositionCompleteEvent) => {
        const cur = get().currentCommand;
        if (cur && cur.commandId === event.commandId) {
          set({ currentDecomposition: event.decomposition });
        }
      },
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.planGenerated,
      (event: NLPlanGeneratedEvent) => {
        const cur = get().currentCommand;
        if (cur && cur.commandId === event.commandId) {
          set({ currentPlan: event.plan });
        }
      },
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.planApproved,
      (event: NLPlanApprovedEvent) => {
        const plan = get().currentPlan;
        if (plan && plan.planId === event.planId) {
          set({ currentPlan: { ...plan, status: "approved" } });
        }
      },
    );

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.planAdjusted,
      (event: NLPlanAdjustedEvent) => {
        const plan = get().currentPlan;
        if (plan && plan.planId === event.planId) {
          set((s) => ({
            currentAdjustments: [...s.currentAdjustments, event.adjustment],
          }));
        }
      },
    );

    socket.on(NL_COMMAND_SOCKET_EVENTS.alert, (event: NLAlertEvent) => {
      set((s) => ({
        alerts: [event.alert, ...s.alerts.filter((a) => a.alertId !== event.alert.alertId)],
      }));
    });

    socket.on(
      NL_COMMAND_SOCKET_EVENTS.progressUpdate,
      (event: NLProgressUpdateEvent) => {
        // Update the command status in the commands list
        set((s) => ({
          commands: s.commands.map((c) =>
            c.commandId === event.commandId
              ? { ...c, status: event.status as StrategicCommand["status"] }
              : c,
          ),
        }));
      },
    );
  },

  // ── Utility ─────────────────────────────────────────────────────────

  clearError: () => set({ error: null }),
}));
