/**
 * Permission Zustand store.
 *
 * Manages Agent permission data (roles, policies, templates, audit trail)
 * and provides REST API integration for the permission management UI.
 *
 * @see Requirements 13.1, 13.2, 13.3, 13.4, 13.5
 */

import { create } from "zustand";
import type {
  AgentRole,
  AgentPermissionPolicy,
  PermissionTemplate,
  PermissionAuditEntry,
  Permission,
} from "@shared/permission/contracts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface PermissionState {
  /** All permission roles */
  roles: AgentRole[];
  /** Agent permission policies keyed by agentId */
  policies: Record<string, AgentPermissionPolicy>;
  /** Permission templates */
  templates: PermissionTemplate[];
  /** Audit trail entries keyed by agentId */
  auditTrail: Record<string, PermissionAuditEntry[]>;
  /** Loading flags */
  loadingRoles: boolean;
  loadingPolicies: boolean;
  loadingTemplates: boolean;
  loadingAudit: boolean;

  /** Fetch all roles */
  fetchRoles: () => Promise<void>;
  /** Fetch policy for a specific agent */
  fetchPolicy: (agentId: string) => Promise<void>;
  /** Fetch all templates */
  fetchTemplates: () => Promise<void>;
  /** Fetch audit trail for a specific agent */
  fetchAuditTrail: (agentId: string) => Promise<void>;
  /** Update an agent's policy (role assignment, custom permissions) */
  updatePolicy: (agentId: string, updates: Partial<AgentPermissionPolicy>) => Promise<void>;
  /** Grant temporary permission */
  grantTemp: (agentId: string, permission: Permission, durationMs: number) => Promise<void>;
  /** Revoke a permission */
  revoke: (agentId: string, permission: Permission) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePermissionStore = create<PermissionState>((set) => ({
  roles: [],
  policies: {},
  templates: [],
  auditTrail: {},
  loadingRoles: false,
  loadingPolicies: false,
  loadingTemplates: false,
  loadingAudit: false,

  async fetchRoles() {
    set({ loadingRoles: true });
    try {
      const res = await fetch("/api/permissions/roles");
      if (!res.ok) return;
      const data = await res.json();
      set({ roles: data.roles ?? data ?? [] });
    } catch {
      // silently ignore
    } finally {
      set({ loadingRoles: false });
    }
  },

  async fetchPolicy(agentId: string) {
    set({ loadingPolicies: true });
    try {
      const res = await fetch(`/api/permissions/policies/${agentId}`);
      if (!res.ok) return;
      const policy: AgentPermissionPolicy = await res.json();
      set((s) => ({
        policies: { ...s.policies, [agentId]: policy },
      }));
    } catch {
      // silently ignore
    } finally {
      set({ loadingPolicies: false });
    }
  },

  async fetchTemplates() {
    set({ loadingTemplates: true });
    try {
      const res = await fetch("/api/permissions/templates");
      if (!res.ok) return;
      const data = await res.json();
      set({ templates: data.templates ?? data ?? [] });
    } catch {
      // silently ignore
    } finally {
      set({ loadingTemplates: false });
    }
  },

  async fetchAuditTrail(agentId: string) {
    set({ loadingAudit: true });
    try {
      const res = await fetch(`/api/permissions/audit/${agentId}`);
      if (!res.ok) return;
      const data = await res.json();
      set((s) => ({
        auditTrail: { ...s.auditTrail, [agentId]: data.entries ?? data ?? [] },
      }));
    } catch {
      // silently ignore
    } finally {
      set({ loadingAudit: false });
    }
  },

  async updatePolicy(agentId: string, updates: Partial<AgentPermissionPolicy>) {
    try {
      const res = await fetch(`/api/permissions/policies/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return;
      const policy: AgentPermissionPolicy = await res.json();
      set((s) => ({
        policies: { ...s.policies, [agentId]: policy },
      }));
    } catch {
      // silently ignore
    }
  },

  async grantTemp(agentId: string, permission: Permission, durationMs: number) {
    try {
      await fetch("/api/permissions/grant-temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, permission, durationMs }),
      });
    } catch {
      // silently ignore
    }
  },

  async revoke(agentId: string, permission: Permission) {
    try {
      await fetch("/api/permissions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, permission }),
      });
    } catch {
      // silently ignore
    }
  },
}));
