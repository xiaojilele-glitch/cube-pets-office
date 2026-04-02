/**
 * Reputation Zustand store.
 *
 * Manages Agent reputation data, listens to WebSocket events,
 * and provides fetch methods for reputation and leaderboard.
 *
 * @see Requirements 9.1, 9.2, 9.3, 9.6
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";
import type {
  ReputationProfile,
  ReputationChangeEvent,
  ReputationGrade,
  TrustTier,
  DimensionScores,
} from "@shared/reputation";

// ---------------------------------------------------------------------------
// Leaderboard entry (mirrors server)
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  agentId: string;
  overallScore: number;
  dimensions: DimensionScores;
  grade: ReputationGrade;
  trustTier: TrustTier;
  totalTasks: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ReputationState {
  /** Cached profiles keyed by agentId */
  profiles: Record<string, ReputationProfile>;
  /** Recent change events per agent */
  events: Record<string, ReputationChangeEvent[]>;
  /** Leaderboard entries */
  leaderboard: LeaderboardEntry[];

  /** Fetch a single agent's reputation from the API */
  fetchReputation: (agentId: string) => Promise<void>;
  /** Fetch the leaderboard from the API */
  fetchLeaderboard: () => Promise<void>;
  /** Initialize WebSocket listeners */
  initSocket: (socket: Socket) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useReputationStore = create<ReputationState>((set, get) => ({
  profiles: {},
  events: {},
  leaderboard: [],

  async fetchReputation(agentId: string) {
    try {
      const res = await fetch(`/api/agents/${agentId}/reputation`);
      if (!res.ok) return;
      const profile: ReputationProfile = await res.json();
      set((s) => ({
        profiles: { ...s.profiles, [agentId]: profile },
      }));

      // Also fetch recent events
      const eventsRes = await fetch(
        `/api/admin/reputation/trends?agentId=${agentId}&limit=50`
      );
      if (eventsRes.ok) {
        const data = await eventsRes.json();
        set((s) => ({
          events: { ...s.events, [agentId]: data.events ?? [] },
        }));
      }
    } catch {
      // silently ignore fetch errors
    }
  },

  async fetchLeaderboard() {
    try {
      const res = await fetch("/api/admin/reputation/leaderboard?limit=100");
      if (!res.ok) return;
      const data = await res.json();
      set({ leaderboard: data.leaderboard ?? [] });
    } catch {
      // silently ignore
    }
  },

  initSocket(socket: Socket) {
    socket.on(
      "agent.reputationChanged",
      (payload: {
        agentId: string;
        oldScore: number;
        newScore: number;
        grade: string;
        dimensionDeltas: Record<string, number>;
      }) => {
        // Refresh the profile for this agent
        get().fetchReputation(payload.agentId);
      }
    );

    socket.on(
      "agent.trustTierChanged",
      (payload: {
        agentId: string;
        oldTier: string;
        newTier: string;
        reason: string;
      }) => {
        // Refresh the profile for this agent
        get().fetchReputation(payload.agentId);
      }
    );
  },
}));
