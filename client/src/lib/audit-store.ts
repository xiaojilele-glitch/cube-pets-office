import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  AnomalyAlert,
  AuditLogEntry,
  AuditQueryFilters,
  PageOptions,
  VerificationResult,
} from "@shared/audit/contracts.js";
import { AUDIT_SOCKET_EVENTS } from "@shared/audit/socket.js";
import type {
  AuditAnomalyPayload,
  AuditEventPayload,
  AuditVerificationPayload,
} from "@shared/audit/socket.js";

import { fetchJsonSafe, type ApiRequestError } from "./api-client";

interface AuditEventsResponse {
  ok?: boolean;
  entries?: AuditLogEntry[];
  total?: number;
  page?: PageOptions;
}

interface AuditVerificationResponse {
  ok?: boolean;
  result?: VerificationResult;
  valid?: null;
}

interface AuditAnomaliesResponse {
  ok?: boolean;
  alerts?: AnomalyAlert[];
  alert?: AnomalyAlert;
}

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
  loadingEvents: boolean;
  loadingVerification: boolean;
  loadingAnomalies: boolean;
  hasLoadedEvents: boolean;
  hasLoadedVerification: boolean;
  hasLoadedAnomalies: boolean;
  eventsError: ApiRequestError | null;
  verificationError: ApiRequestError | null;
  anomaliesError: ApiRequestError | null;

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
  loadingEvents: false,
  loadingVerification: false,
  loadingAnomalies: false,
  hasLoadedEvents: false,
  hasLoadedVerification: false,
  hasLoadedAnomalies: false,
  eventsError: null,
  verificationError: null,
  anomaliesError: null,

  togglePanel: () => set(state => ({ panelOpen: !state.panelOpen })),

  setActiveTab: tab => set({ activeTab: tab }),

  setFilters: filters =>
    set(state => ({
      filters: { ...state.filters, ...filters },
      page: { ...state.page, pageNum: 1 },
    })),

  setPage: page => set(state => ({ page: { ...state.page, ...page } })),

  selectEntry: entry => set({ selectedEntry: entry }),

  fetchEvents: async () => {
    set({ loadingEvents: true, eventsError: null });
    try {
      const { filters, page } = get();
      const params = new URLSearchParams();

      if (filters.eventType) {
        const types = Array.isArray(filters.eventType)
          ? filters.eventType
          : [filters.eventType];
        types.forEach(eventType => params.append("eventType", eventType));
      }

      if (filters.severity) params.set("severity", filters.severity);
      if (filters.keyword) params.set("keyword", filters.keyword);
      params.set("pageSize", String(page.pageSize));
      params.set("pageNum", String(page.pageNum));

      const result = await fetchJsonSafe<AuditEventsResponse>(
        `/api/audit/events?${params.toString()}`
      );
      if (!result.ok) {
        set({ eventsError: result.error, hasLoadedEvents: true });
        return;
      }

      set({
        entries: result.data.entries ?? [],
        total: result.data.total ?? 0,
        page: result.data.page ?? get().page,
        hasLoadedEvents: true,
        eventsError: null,
      });
    } finally {
      set({ loadingEvents: false });
    }
  },

  searchEvents: async (keyword: string) => {
    set({ loadingEvents: true, eventsError: null });
    try {
      const { page } = get();
      const params = new URLSearchParams({
        q: keyword,
        pageSize: String(page.pageSize),
        pageNum: String(page.pageNum),
      });

      const result = await fetchJsonSafe<AuditEventsResponse>(
        `/api/audit/events/search?${params.toString()}`
      );
      if (!result.ok) {
        set({ eventsError: result.error, hasLoadedEvents: true });
        return;
      }

      set({
        entries: result.data.entries ?? [],
        total: result.data.total ?? 0,
        hasLoadedEvents: true,
        eventsError: null,
      });
    } finally {
      set({ loadingEvents: false });
    }
  },

  fetchVerification: async () => {
    set({ loadingVerification: true, verificationError: null });
    try {
      const result = await fetchJsonSafe<AuditVerificationResponse>(
        "/api/audit/verify/status"
      );
      if (!result.ok) {
        set({ verificationError: result.error, hasLoadedVerification: true });
        return;
      }

      set({
        verificationResult: result.data.result ?? null,
        hasLoadedVerification: true,
        verificationError: null,
      });
    } finally {
      set({ loadingVerification: false });
    }
  },

  triggerVerification: async () => {
    set({ loadingVerification: true, verificationError: null });
    try {
      const result = await fetchJsonSafe<AuditVerificationResponse>(
        "/api/audit/verify",
        {
          method: "POST",
        }
      );
      if (!result.ok) {
        set({ verificationError: result.error, hasLoadedVerification: true });
        return;
      }

      set({
        verificationResult: result.data.result ?? null,
        hasLoadedVerification: true,
        verificationError: null,
      });
    } finally {
      set({ loadingVerification: false });
    }
  },

  fetchAnomalies: async () => {
    set({ loadingAnomalies: true, anomaliesError: null });
    try {
      const result = await fetchJsonSafe<AuditAnomaliesResponse>(
        "/api/audit/anomalies"
      );
      if (!result.ok) {
        set({ anomaliesError: result.error, hasLoadedAnomalies: true });
        return;
      }

      set({
        anomalies: result.data.alerts ?? [],
        hasLoadedAnomalies: true,
        anomaliesError: null,
      });
    } finally {
      set({ loadingAnomalies: false });
    }
  },

  updateAnomalyStatus: async (alertId: string, status: string) => {
    set({ anomaliesError: null });

    const result = await fetchJsonSafe<AuditAnomaliesResponse>(
      `/api/audit/anomalies/${alertId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }
    );

    if (!result.ok) {
      set({ anomaliesError: result.error });
      return;
    }

    await get().fetchAnomalies();
  },

  initSocket: (socket: Socket) => {
    socket.on(AUDIT_SOCKET_EVENTS.auditEvent, (payload: AuditEventPayload) => {
      set(state => ({
        entries: [payload.entry, ...state.entries].slice(
          0,
          state.page.pageSize
        ),
        total: state.total + 1,
      }));
    });

    socket.on(
      AUDIT_SOCKET_EVENTS.auditAnomaly,
      (payload: AuditAnomalyPayload) => {
        set(state => ({
          anomalies: [payload.alert, ...state.anomalies],
        }));
      }
    );

    socket.on(
      AUDIT_SOCKET_EVENTS.auditVerification,
      (payload: AuditVerificationPayload) => {
        set({
          verificationResult: payload.result,
          hasLoadedVerification: true,
          verificationError: null,
        });
      }
    );
  },
}));
