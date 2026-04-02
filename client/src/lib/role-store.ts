/**
 * Zustand store for dynamic role system.
 * Tracks agent role state and subscribes to WebSocket role change events.
 */
import { create } from 'zustand';
import type { Socket } from 'socket.io-client';

export interface AgentCurrentRole {
  roleId: string;
  roleName: string;
  loadedAt: string;
}

export interface RoleHistoryEntry {
  fromRole: string | null;
  toRole: string | null;
  missionName: string;
  timestamp: string;
}

export interface AgentRoleInfo {
  currentRole: AgentCurrentRole | null;
  roleHistory: RoleHistoryEntry[];
}

export interface RolePerformanceEntry {
  roleId: string;
  roleName: string;
  avgQualityScore: number;
}

export interface RoleChangedEvent {
  agentId: string;
  fromRoleId: string | null;
  toRoleId: string | null;
  toRoleName?: string;
  missionName?: string;
  timestamp: string;
}

interface RoleState {
  agentRoles: Map<string, AgentRoleInfo>;

  /** Handle an incoming agent.roleChanged WebSocket event */
  handleRoleChanged: (event: RoleChangedEvent) => void;

  /** Fetch role info for a specific agent from the API */
  fetchAgentRole: (agentId: string) => Promise<void>;

  /** Subscribe to Socket.IO agent.roleChanged events */
  initWebSocket: (socket: Socket) => void;
}

const MAX_HISTORY = 20;

export const useRoleStore = create<RoleState>((set, get) => ({
  agentRoles: new Map(),

  handleRoleChanged: (event: RoleChangedEvent) => {
    set(state => {
      const next = new Map(state.agentRoles);
      const existing = next.get(event.agentId) || { currentRole: null, roleHistory: [] };

      const currentRole: AgentCurrentRole | null = event.toRoleId
        ? { roleId: event.toRoleId, roleName: event.toRoleName || event.toRoleId, loadedAt: event.timestamp }
        : null;

      const historyEntry: RoleHistoryEntry = {
        fromRole: event.fromRoleId,
        toRole: event.toRoleId,
        missionName: event.missionName || '',
        timestamp: event.timestamp,
      };

      const roleHistory = [historyEntry, ...existing.roleHistory].slice(0, MAX_HISTORY);

      next.set(event.agentId, { currentRole, roleHistory });
      return { agentRoles: next };
    });
  },

  fetchAgentRole: async (agentId: string) => {
    try {
      const response = await fetch(`/api/agents/${agentId}`);
      if (!response.ok) return;
      const data = await response.json();

      set(state => {
        const next = new Map(state.agentRoles);
        next.set(agentId, {
          currentRole: data.currentRole || null,
          roleHistory: (data.roleHistory || []).slice(0, MAX_HISTORY),
        });
        return { agentRoles: next };
      });
    } catch (err) {
      console.error('[RoleStore] Failed to fetch agent role:', err);
    }
  },

  initWebSocket: (socket: Socket) => {
    socket.on('agent.roleChanged', (event: RoleChangedEvent) => {
      get().handleRoleChanged(event);
    });
  },
}));
