/**
 * Swarm collaboration Zustand store.
 *
 * Manages activeSessions (CollaborationSession[]) and crossPodMessages
 * (CrossPodMessageEvent[]) for the cross-Pod autonomous collaboration feature.
 * Integrates with Socket.IO for real-time swarm events.
 *
 * @see Requirements 7.1, 7.2, 7.5
 */

import { create } from "zustand";
import type { Socket } from "socket.io-client";

import type { CollaborationSession } from "@shared/swarm";

// ---------------------------------------------------------------------------
// Cross-Pod message event (client-side representation)
// ---------------------------------------------------------------------------

export interface CrossPodMessageEvent {
  sourcePodId: string;
  targetPodId: string;
  contentPreview: string;
  messageId: number;
  receivedAt: number;
}

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

const MAX_CROSS_POD_MESSAGES = 50;
const MAX_ACTIVE_SESSIONS = 20;

export interface SwarmState {
  activeSessions: CollaborationSession[];
  crossPodMessages: CrossPodMessageEvent[];

  addSession: (session: CollaborationSession) => void;
  updateSession: (
    sessionId: string,
    update: Partial<CollaborationSession>
  ) => void;
  removeSession: (sessionId: string) => void;
  addCrossPodMessage: (event: CrossPodMessageEvent) => void;
  initSocket: (socket: Socket) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSwarmStore = create<SwarmState>((set, get) => ({
  activeSessions: [],
  crossPodMessages: [],

  addSession: (session: CollaborationSession) => {
    set(s => {
      const sessions = [...s.activeSessions, session];
      // Keep max 20 active sessions, trim oldest first
      return {
        activeSessions:
          sessions.length > MAX_ACTIVE_SESSIONS
            ? sessions.slice(sessions.length - MAX_ACTIVE_SESSIONS)
            : sessions,
      };
    });
  },

  updateSession: (sessionId: string, update: Partial<CollaborationSession>) => {
    set(s => ({
      activeSessions: s.activeSessions.map(session =>
        session.id === sessionId ? { ...session, ...update } : session
      ),
    }));
  },

  removeSession: (sessionId: string) => {
    set(s => ({
      activeSessions: s.activeSessions.filter(sess => sess.id !== sessionId),
    }));
  },

  addCrossPodMessage: (event: CrossPodMessageEvent) => {
    set(s => {
      const messages = [...s.crossPodMessages, event];
      // Keep max 50 messages, trim oldest first
      return {
        crossPodMessages:
          messages.length > MAX_CROSS_POD_MESSAGES
            ? messages.slice(messages.length - MAX_CROSS_POD_MESSAGES)
            : messages,
      };
    });
  },

  initSocket: (socket: Socket) => {
    socket.on("cross_pod_message", (event: CrossPodMessageEvent) => {
      get().addCrossPodMessage(event);
    });

    socket.on(
      "collaboration_session_update",
      (session: CollaborationSession) => {
        const existing = get().activeSessions.find(s => s.id === session.id);
        if (existing) {
          get().updateSession(session.id, session);
        } else {
          get().addSession(session);
        }
      }
    );
  },
}));
