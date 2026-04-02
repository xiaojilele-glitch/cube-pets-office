/**
 * Autonomy state Zustand store.
 *
 * Manages AssessmentResult[], CompetitionSession[], and TaskforceSession[]
 * for the Agent autonomy upgrade feature. Integrates with Socket.IO for
 * real-time autonomy events.
 *
 * @see Requirements 7.1, 7.2, 7.4, 7.5
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type {
  AssessmentResult,
  CompetitionSession,
  TaskforceSession,
} from "@shared/autonomy-types";

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

interface AutonomyState {
  assessments: AssessmentResult[];
  competitions: CompetitionSession[];
  taskforces: TaskforceSession[];

  addAssessment: (result: AssessmentResult) => void;
  updateCompetition: (session: CompetitionSession) => void;
  updateTaskforce: (session: TaskforceSession) => void;
  clearAll: () => void;
  initSocket: (socket: Socket) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAutonomyStore = create<AutonomyState>((set, get) => ({
  assessments: [],
  competitions: [],
  taskforces: [],

  addAssessment: (result: AssessmentResult) => {
    set((s) => ({ assessments: [...s.assessments, result] }));
  },

  updateCompetition: (session: CompetitionSession) => {
    set((s) => {
      const existing = s.competitions.filter((c) => c.id !== session.id);
      return { competitions: [...existing, session] };
    });
  },

  updateTaskforce: (session: TaskforceSession) => {
    set((s) => {
      const existing = s.taskforces.filter(
        (t) => t.taskforceId !== session.taskforceId
      );
      return { taskforces: [...existing, session] };
    });
  },

  clearAll: () => {
    set({ assessments: [], competitions: [], taskforces: [] });
  },

  initSocket: (socket: Socket) => {
    socket.on("autonomy_assessment", (result: AssessmentResult) => {
      get().addAssessment(result);
    });

    socket.on("autonomy_competition", (session: CompetitionSession) => {
      get().updateCompetition(session);
    });

    socket.on("autonomy_taskforce_update", (session: TaskforceSession) => {
      get().updateTaskforce(session);
    });
  },
}));
