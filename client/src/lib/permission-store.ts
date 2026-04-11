import { create } from "zustand";

import type {
  AgentPermissionPolicy,
  AgentRole,
  Permission,
  PermissionAuditEntry,
  PermissionTemplate,
} from "@shared/permission/contracts";

import { fetchJsonSafe, type ApiRequestError } from "./api-client";

interface PermissionRolesResponse {
  ok?: boolean;
  roles?: AgentRole[];
}

interface PermissionPolicyResponse {
  ok?: boolean;
  policy?: AgentPermissionPolicy;
}

interface PermissionTemplatesResponse {
  ok?: boolean;
  templates?: PermissionTemplate[];
}

interface PermissionAuditResponse {
  ok?: boolean;
  trail?: PermissionAuditEntry[];
}

interface PermissionMutationResponse {
  ok?: boolean;
}

interface PermissionState {
  roles: AgentRole[];
  policies: Record<string, AgentPermissionPolicy>;
  templates: PermissionTemplate[];
  auditTrail: Record<string, PermissionAuditEntry[]>;
  loadingRoles: boolean;
  loadingPolicies: boolean;
  loadingTemplates: boolean;
  loadingAudit: boolean;
  rolesError: ApiRequestError | null;
  templatesError: ApiRequestError | null;
  policyErrors: Record<string, ApiRequestError | null>;
  auditErrors: Record<string, ApiRequestError | null>;

  fetchRoles: () => Promise<void>;
  fetchPolicy: (agentId: string) => Promise<void>;
  fetchTemplates: () => Promise<void>;
  fetchAuditTrail: (agentId: string) => Promise<void>;
  updatePolicy: (
    agentId: string,
    updates: Partial<AgentPermissionPolicy>
  ) => Promise<void>;
  grantTemp: (
    agentId: string,
    permission: Permission,
    durationMs: number
  ) => Promise<void>;
  revoke: (agentId: string, permission: Permission) => Promise<void>;
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  roles: [],
  policies: {},
  templates: [],
  auditTrail: {},
  loadingRoles: false,
  loadingPolicies: false,
  loadingTemplates: false,
  loadingAudit: false,
  rolesError: null,
  templatesError: null,
  policyErrors: {},
  auditErrors: {},

  async fetchRoles() {
    set({ loadingRoles: true, rolesError: null });
    try {
      const result = await fetchJsonSafe<PermissionRolesResponse>(
        "/api/permissions/roles"
      );
      if (!result.ok) {
        set({ rolesError: result.error });
        return;
      }

      set({ roles: result.data.roles ?? [], rolesError: null });
    } finally {
      set({ loadingRoles: false });
    }
  },

  async fetchPolicy(agentId: string) {
    set({
      loadingPolicies: true,
      policyErrors: { ...get().policyErrors, [agentId]: null },
    });

    try {
      const result = await fetchJsonSafe<PermissionPolicyResponse>(
        `/api/permissions/policies/${encodeURIComponent(agentId)}`
      );
      if (!result.ok) {
        set(state => ({
          policyErrors: { ...state.policyErrors, [agentId]: result.error },
        }));
        return;
      }

      const policy = result.data.policy;
      if (!policy) return;

      set(state => ({
        policies: { ...state.policies, [agentId]: policy },
        policyErrors: { ...state.policyErrors, [agentId]: null },
      }));
    } finally {
      set({ loadingPolicies: false });
    }
  },

  async fetchTemplates() {
    set({ loadingTemplates: true, templatesError: null });
    try {
      const result = await fetchJsonSafe<PermissionTemplatesResponse>(
        "/api/permissions/templates"
      );
      if (!result.ok) {
        set({ templatesError: result.error });
        return;
      }

      set({ templates: result.data.templates ?? [], templatesError: null });
    } finally {
      set({ loadingTemplates: false });
    }
  },

  async fetchAuditTrail(agentId: string) {
    set({
      loadingAudit: true,
      auditErrors: { ...get().auditErrors, [agentId]: null },
    });

    try {
      const result = await fetchJsonSafe<PermissionAuditResponse>(
        `/api/permissions/audit/${encodeURIComponent(agentId)}`
      );
      if (!result.ok) {
        set(state => ({
          auditErrors: { ...state.auditErrors, [agentId]: result.error },
        }));
        return;
      }

      set(state => ({
        auditTrail: { ...state.auditTrail, [agentId]: result.data.trail ?? [] },
        auditErrors: { ...state.auditErrors, [agentId]: null },
      }));
    } finally {
      set({ loadingAudit: false });
    }
  },

  async updatePolicy(agentId: string, updates: Partial<AgentPermissionPolicy>) {
    const result = await fetchJsonSafe<PermissionPolicyResponse>(
      `/api/permissions/policies/${encodeURIComponent(agentId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }
    );

    if (!result.ok) {
      set(state => ({
        policyErrors: { ...state.policyErrors, [agentId]: result.error },
      }));
      return;
    }

    const policy = result.data.policy;
    if (!policy) return;

    set(state => ({
      policies: { ...state.policies, [agentId]: policy },
      policyErrors: { ...state.policyErrors, [agentId]: null },
    }));
    await get().fetchAuditTrail(agentId);
  },

  async grantTemp(agentId: string, permission: Permission, durationMs: number) {
    const result = await fetchJsonSafe<PermissionMutationResponse>(
      "/api/permissions/grant-temp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, permission, durationMs }),
      }
    );

    if (!result.ok) {
      set(state => ({
        policyErrors: { ...state.policyErrors, [agentId]: result.error },
      }));
      return;
    }

    await Promise.all([
      get().fetchPolicy(agentId),
      get().fetchAuditTrail(agentId),
    ]);
  },

  async revoke(agentId: string, permission: Permission) {
    const result = await fetchJsonSafe<PermissionMutationResponse>(
      "/api/permissions/revoke",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, permission }),
      }
    );

    if (!result.ok) {
      set(state => ({
        policyErrors: { ...state.policyErrors, [agentId]: result.error },
      }));
      return;
    }

    await Promise.all([
      get().fetchPolicy(agentId),
      get().fetchAuditTrail(agentId),
    ]);
  },
}));
