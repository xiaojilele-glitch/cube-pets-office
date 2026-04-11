import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  DimensionScores,
  ReputationChangeEvent,
  ReputationGrade,
  ReputationProfile,
  TrustTier,
} from "@shared/reputation";

import { fetchJsonSafe, type ApiRequestError } from "./api-client";

export interface LeaderboardEntry {
  agentId: string;
  overallScore: number;
  dimensions: DimensionScores;
  grade: ReputationGrade;
  trustTier: TrustTier;
  totalTasks: number;
}

interface ReputationEventsResponse {
  agentId: string;
  events?: ReputationChangeEvent[];
}

interface ReputationLeaderboardResponse {
  leaderboard?: LeaderboardEntry[];
}

interface ReputationState {
  profiles: Record<string, ReputationProfile>;
  events: Record<string, ReputationChangeEvent[]>;
  leaderboard: LeaderboardEntry[];
  loadingByAgent: Record<string, boolean>;
  loadedByAgent: Record<string, boolean>;
  errorsByAgent: Record<string, ApiRequestError | null>;
  loadingLeaderboard: boolean;
  leaderboardError: ApiRequestError | null;

  fetchReputation: (agentId: string) => Promise<void>;
  fetchLeaderboard: () => Promise<void>;
  initSocket: (socket: Socket) => void;
}

export const useReputationStore = create<ReputationState>((set, get) => ({
  profiles: {},
  events: {},
  leaderboard: [],
  loadingByAgent: {},
  loadedByAgent: {},
  errorsByAgent: {},
  loadingLeaderboard: false,
  leaderboardError: null,

  async fetchReputation(agentId: string) {
    set(state => ({
      loadingByAgent: { ...state.loadingByAgent, [agentId]: true },
      errorsByAgent: { ...state.errorsByAgent, [agentId]: null },
    }));

    try {
      const [profileResult, eventsResult] = await Promise.all([
        fetchJsonSafe<ReputationProfile>(
          `/api/agents/${encodeURIComponent(agentId)}/reputation`
        ),
        fetchJsonSafe<ReputationEventsResponse>(
          `/api/admin/reputation/trends?agentId=${encodeURIComponent(agentId)}&limit=50`
        ),
      ]);

      const nextState: Partial<ReputationState> = {
        loadedByAgent: { ...get().loadedByAgent, [agentId]: true },
      };

      if (profileResult.ok) {
        nextState.profiles = {
          ...get().profiles,
          [agentId]: profileResult.data,
        };
      } else if (
        profileResult.error.status &&
        profileResult.error.status !== 404
      ) {
        nextState.errorsByAgent = {
          ...get().errorsByAgent,
          [agentId]: profileResult.error,
        };
      }

      if (eventsResult.ok) {
        nextState.events = {
          ...get().events,
          [agentId]: eventsResult.data.events ?? [],
        };
      } else if (!profileResult.ok && profileResult.error.status !== 404) {
        nextState.errorsByAgent = {
          ...get().errorsByAgent,
          [agentId]: eventsResult.error,
        };
      }

      set(state => ({
        ...nextState,
        errorsByAgent: nextState.errorsByAgent ?? {
          ...state.errorsByAgent,
          [agentId]: null,
        },
      }));
    } finally {
      set(state => ({
        loadingByAgent: { ...state.loadingByAgent, [agentId]: false },
      }));
    }
  },

  async fetchLeaderboard() {
    set({ loadingLeaderboard: true, leaderboardError: null });
    try {
      const result = await fetchJsonSafe<ReputationLeaderboardResponse>(
        "/api/admin/reputation/leaderboard?limit=100"
      );
      if (!result.ok) {
        set({ leaderboardError: result.error });
        return;
      }

      set({
        leaderboard: result.data.leaderboard ?? [],
        leaderboardError: null,
      });
    } finally {
      set({ loadingLeaderboard: false });
    }
  },

  initSocket(socket: Socket) {
    socket.on("agent.reputationChanged", (payload: { agentId: string }) => {
      void get().fetchReputation(payload.agentId);
    });

    socket.on("agent.trustTierChanged", (payload: { agentId: string }) => {
      void get().fetchReputation(payload.agentId);
    });
  },
}));
