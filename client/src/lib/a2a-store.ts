import { create } from "zustand";
import type {
  A2ASession,
  A2AFrameworkType,
} from "../../../shared/a2a-protocol";

export interface A2AMessageEvent {
  type: "a2a_outbound" | "a2a_inbound";
  workflowId: string;
  from?: string;
  to?: string;
  frameworkType?: A2AFrameworkType;
  sessionId?: string;
  hasError?: boolean;
  preview: string;
  timestamp: string;
}

export interface A2AState {
  activeSessions: A2ASession[];
  a2aMessages: A2AMessageEvent[];
  addSession: (session: A2ASession) => void;
  updateSession: (sessionId: string, update: Partial<A2ASession>) => void;
  removeSession: (sessionId: string) => void;
  addA2AMessage: (event: A2AMessageEvent) => void;
}

export const useA2AStore = create<A2AState>(set => ({
  activeSessions: [],
  a2aMessages: [],
  addSession: session =>
    set(state => ({ activeSessions: [...state.activeSessions, session] })),
  updateSession: (sessionId, update) =>
    set(state => ({
      activeSessions: state.activeSessions.map(s =>
        s.sessionId === sessionId ? { ...s, ...update } : s
      ),
    })),
  removeSession: sessionId =>
    set(state => ({
      activeSessions: state.activeSessions.filter(
        s => s.sessionId !== sessionId
      ),
    })),
  addA2AMessage: event =>
    set(state => ({ a2aMessages: [...state.a2aMessages, event] })),
}));
