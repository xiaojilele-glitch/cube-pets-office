/**
 * Audit chain Zustand store.
 *
 * Manages audit log entries, verification results, anomaly alerts,
 * and integrates with Socket.IO for real-time audit events.
 *
 * @see Requirements AC-12.1, AC-12.2, AC-12.3, AC-12.4, AC-12.5
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  AuditLogEntry,
  AuditQueryFilters,
  PageOptions,
  VerificationResult,
  AnomalyAlert,
} from "@shared/audit/contracts.js";
import { AUDIT_SOCKET_EVENTS } from "@shared/audit/socket.js";
import type {
  AuditEventPayload,
  AuditAnomalyPayload,
  AuditVerificationPayload,
} from "@shared/audit/socket.js";

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface AuditState {
  entries: AuditLogEntry[];
  total: number;
  page: PageOptions;
  filters: AuditQueryFilters;
  selectedEntry: AuditLogEntry | null;
  verificationResult: VerificationResult | null;
  anomalies: AnomalyAlert[];
  panelOpen: boolean;
  activeTab: "events" | "timeline" | "verify" | "anomalies";

  togglePanel: () => void;
  setActiveTab: (tab: AuditState["activeTab"]) => void;
  setFilters: (filters: Partial<AuditQueryFilters>) => void;
  setPage: (page: Partial<PageOptions>) => void;
  selectEntry: (entry: AuditLogEntry | null) => void;

  fetchEvents: () => Promise<void>;
  searchEvents: (keyword: string) => Promise<void>;
  fetchVerification: () => Promise<void>;
  triggerVerification: () => Promise<void>;
  fetchAnomalies: () => Promise<void>;
  updateAnomalyStatus: (alertId: string, status: string) => Promise<void>;

  initSocket: (socket: Socket) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAuditStore = create<AuditState>((set, get) => ({
  entries: [],
  total: 0,
  page: { pageSize: 50, pageNum: 1 },
  filters: {},
  selectedEntry: null,
  verificationResult: null,
  anomalies: [],
  panelOpen: false,
  activeTab: "events",

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setFilters: (filters) =>
    set((s) => ({ filters: { ...s.filters, ...filters } })),

  setPage: (page) =>
    set((s) => ({ page: { ...s.page, ...page } })),

  selectEntry: (entry) => set({ selectedEntry: entry }),

  fetchEvents: async () => {
    try {
      const { filters, page } = get();
      const params = new URLSearchParams();
      if (filters.eventType) {
        const types = Array.isArray(filters.eventType)
          ? filters.eventType
          : [filters.eventType];
        types.forEach((t) => params.append("eventType", t));
      }
      if (filters.severity) params.set("severity", filters.severity);
      if (filters.keyword) params.set("keyword", filters.keyword);
      params.set("pageSize", String(page.pageSize));
      params.set("pageNum", String(page.pageNum));

      const res = await fetch(`/api/audit/events?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      set({
        entries: data.entries ?? [],
        total: data.total ?? 0,
        page: data.page ?? get().page,
      });
    } catch {
      // network error — keep current state
    }
  },

  searchEvents: async (keyword: string) => {
    try {
      const { page } = get();
      const params = new URLSearchParams({
        keyword,
        pageSize: String(page.pageSize),
        pageNum: String(page.pageNum),
      });
      const res = await fetch(`/api/audit/events/search?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      set({
        entries: data.entries ?? [],
        total: data.total ?? 0,
      });
    } catch {
      // silently ignore
    }
  },

  fetchVerification: async () => {
    try {
      const res = await fetch("/api/audit/verify/status");
      if (!res.ok) return;
      const result: VerificationResult = await res.json();
      set({ verificationResult: result });
    } catch {
      // silently ignore
    }
  },

  triggerVerification: async () => {
    try {
      const res = await fetch("/api/audit/verify", { method: "POST" });
      if (!res.ok) return;
      const result: VerificationResult = await res.json();
      set({ verificationResult: result });
    } catch {
      // silently ignore
    }
  },

  fetchAnomalies: async () => {
    try {
      const res = await fetch("/api/audit/anomalies");
      if (!res.ok) return;
      const data = await res.json();
      set({ anomalies: data.alerts ?? data ?? [] });
    } catch {
      // silently ignore
    }
  },

  updateAnomalyStatus: async (alertId: string, status: string) => {
    try {
      const res = await fetch(`/api/audit/anomalies/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      // Refresh anomalies list
      await get().fetchAnomalies();
    } catch {
      // silently ignore
    }
  },

  initSocket: (socket: Socket) => {
    socket.on(
      AUDIT_SOCKET_EVENTS.auditEvent,
      (payload: AuditEventPayload) => {
        set((s) => ({
          entries: [payload.entry, ...s.entries].slice(0, s.page.pageSize),
          total: s.total + 1,
        }));
      }
    );

    socket.on(
      AUDIT_SOCKET_EVENTS.auditAnomaly,
      (payload: AuditAnomalyPayload) => {
        set((s) => ({
          anomalies: [payload.alert, ...s.anomalies],
        }));
      }
    );

    socket.on(
      AUDIT_SOCKET_EVENTS.auditVerification,
      (payload: AuditVerificationPayload) => {
        set({ verificationResult: payload.result });
      }
    );
  },
}));
