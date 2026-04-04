/**
 * Integration tests for dynamic organization ↔ permission system
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.5
 */

import { describe, expect, it, beforeEach } from "vitest";
import type {
  AgentPermissionPolicy,
  AgentRole as PermissionRole,
  Permission,
  PermissionTemplate,
} from "../../shared/permission/contracts.js";
import type {
  WorkflowOrganizationSnapshot,
  WorkflowOrganizationNode,
} from "../../shared/organization-schema.js";
import { RoleStore } from "./role-store.js";
import { PolicyStore } from "./policy-store.js";
import {
  assignOrganizationPermissions,
  deleteOrganizationPermissions,
} from "../core/dynamic-organization.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let roles: PermissionRole[] = [];
  let policies: AgentPermissionPolicy[] = [];
  let templates: PermissionTemplate[] = [];

  return {
    getPermissionRoles: () => roles,
    setPermissionRoles: (r: PermissionRole[]) => { roles = r; },
    getPermissionPolicies: () => policies,
    setPermissionPolicies: (p: AgentPermissionPolicy[]) => { policies = p; },
    getPermissionTemplates: () => templates,
    setPermissionTemplates: (t: PermissionTemplate[]) => { templates = t; },
    _reset: () => { roles = []; policies = []; templates = []; },
  };
}

type StubDb = ReturnType<typeof createInMemoryDb>;

/* ─── Helper: build a minimal organization snapshot ─── */

function makeNode(
  overrides: Partial<WorkflowOrganizationNode> & { id: string; agentId: string; role: "ceo" | "manager" | "worker" },
): WorkflowOrganizationNode {
  return {
    parentId: null,
    departmentId: "dept-1",
    departmentLabel: "Engineering",
    name: overrides.role.toUpperCase(),
    title: `${overrides.role} title`,
    responsibility: "do stuff",
    responsibilities: [],
    goals: [],
    summaryFocus: [],
    skills: [],
    mcp: [],
    model: { model: "gpt-4", temperature: 0.7, maxTokens: 4096 },
    execution: { mode: "execute", strategy: "sequential", maxConcurrency: 1 },
    ...overrides,
  };
}

function makeOrganization(
  workflowId: string,
  nodes: WorkflowOrganizationNode[],
): WorkflowOrganizationSnapshot {
  return {
    kind: "workflow_organization",
    version: 1,
    workflowId,
    directive: "test directive",
    generatedAt: new Date().toISOString(),
    source: "generated",
    taskProfile: "general",
    reasoning: "test",
    rootNodeId: nodes[0]?.id ?? "root",
    rootAgentId: nodes[0]?.agentId ?? "agent-root",
    departments: [
      {
        id: "dept-1",
        label: "Engineering",
        managerNodeId: nodes[0]?.id ?? "root",
        direction: "build",
        strategy: "sequential",
        maxConcurrency: 1,
      },
    ],
    nodes,
  };
}

/* ─── Tests ─── */

describe("Organization ↔ Permission Integration", () => {
  let db: StubDb;
  let roleStore: RoleStore;
  let policyStore: PolicyStore;

  beforeEach(() => {
    db = createInMemoryDb();
    roleStore = new RoleStore(db as any);
    policyStore = new PolicyStore(db as any, roleStore);
    // Initialize builtin roles so "admin", "writer", "reader" exist
    roleStore.initBuiltinRoles();
  });

  describe("assignOrganizationPermissions", () => {
    it("creates a policy for each node in the organization", () => {
      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "agent-ceo", role: "ceo", parentId: null }),
        makeNode({ id: "n2", agentId: "agent-mgr", role: "manager", parentId: "n1" }),
        makeNode({ id: "n3", agentId: "agent-wkr", role: "worker", parentId: "n2" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      expect(policyStore.getPolicy("agent-ceo")).toBeDefined();
      expect(policyStore.getPolicy("agent-mgr")).toBeDefined();
      expect(policyStore.getPolicy("agent-wkr")).toBeDefined();
    });

    it("assigns Admin role to CEO nodes", () => {
      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "agent-ceo", role: "ceo" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      const policy = policyStore.getPolicy("agent-ceo")!;
      expect(policy.assignedRoles).toContain("admin");
    });

    it("assigns Writer role to Manager nodes", () => {
      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "agent-mgr", role: "manager" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      const policy = policyStore.getPolicy("agent-mgr")!;
      expect(policy.assignedRoles).toContain("writer");
      expect(policy.assignedRoles).not.toContain("admin");
    });

    it("assigns only base template (reader fallback) to Worker nodes", () => {
      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "agent-wkr", role: "worker" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      const policy = policyStore.getPolicy("agent-wkr")!;
      expect(policy.assignedRoles).not.toContain("admin");
      expect(policy.assignedRoles).not.toContain("writer");
      // Should have at least "reader" as fallback
      expect(policy.assignedRoles.length).toBeGreaterThanOrEqual(1);
    });

    it("sets organizationId on each policy for cleanup", () => {
      const org = makeOrganization("wf-42", [
        makeNode({ id: "n1", agentId: "a1", role: "ceo" }),
        makeNode({ id: "n2", agentId: "a2", role: "worker", parentId: "n1" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      expect(policyStore.getPolicy("a1")!.organizationId).toBe("wf-42");
      expect(policyStore.getPolicy("a2")!.organizationId).toBe("wf-42");
    });

    it("skips agents that already have a policy", () => {
      // Pre-create a policy for agent-ceo
      policyStore.createPolicy({
        agentId: "agent-ceo",
        assignedRoles: ["reader"],
        customPermissions: [],
        deniedPermissions: [],
        effectiveAt: new Date().toISOString(),
        expiresAt: null,
      });

      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "agent-ceo", role: "ceo" }),
        makeNode({ id: "n2", agentId: "agent-wkr", role: "worker", parentId: "n1" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      // CEO policy should remain unchanged (still just "reader")
      const ceoPolicy = policyStore.getPolicy("agent-ceo")!;
      expect(ceoPolicy.assignedRoles).toEqual(["reader"]);
      // Worker should get a new policy
      expect(policyStore.getPolicy("agent-wkr")).toBeDefined();
    });

    it("uses template when matching role template exists", () => {
      // Create a template that matches "ceo" role
      roleStore.createTemplate({
        templateId: "tpl-ceo",
        templateName: "CEO Template",
        description: "Template for CEO",
        targetRole: "ceo",
        permissions: [
          { resourceType: "filesystem", action: "read", constraints: {}, effect: "allow" },
        ],
      });

      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "agent-ceo", role: "ceo" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      const policy = policyStore.getPolicy("agent-ceo")!;
      expect(policy.templateId).toBe("tpl-ceo");
      expect(policy.assignedRoles).toContain("tpl-ceo");
      expect(policy.assignedRoles).toContain("admin");
    });
  });

  describe("Permission inheritance: CEO ⊇ Manager ⊇ Worker", () => {
    it("CEO effective permissions are a superset of Manager's", () => {
      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "agent-ceo", role: "ceo" }),
        makeNode({ id: "n2", agentId: "agent-mgr", role: "manager", parentId: "n1" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      const ceoPerms = policyStore.resolveEffectivePermissions("agent-ceo");
      const mgrPerms = policyStore.resolveEffectivePermissions("agent-mgr");

      const ceoKeys = new Set(ceoPerms.map(p => `${p.resourceType}:${p.action}`));
      for (const perm of mgrPerms) {
        expect(ceoKeys.has(`${perm.resourceType}:${perm.action}`)).toBe(true);
      }
    });

    it("Manager effective permissions are a superset of Worker's", () => {
      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "agent-mgr", role: "manager" }),
        makeNode({ id: "n2", agentId: "agent-wkr", role: "worker", parentId: "n1" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      const mgrPerms = policyStore.resolveEffectivePermissions("agent-mgr");
      const wkrPerms = policyStore.resolveEffectivePermissions("agent-wkr");

      const mgrKeys = new Set(mgrPerms.map(p => `${p.resourceType}:${p.action}`));
      for (const perm of wkrPerms) {
        expect(mgrKeys.has(`${perm.resourceType}:${perm.action}`)).toBe(true);
      }
    });

    it("CEO has strictly more permissions than Worker", () => {
      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "agent-ceo", role: "ceo" }),
        makeNode({ id: "n2", agentId: "agent-wkr", role: "worker", parentId: "n1" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);

      const ceoPerms = policyStore.resolveEffectivePermissions("agent-ceo");
      const wkrPerms = policyStore.resolveEffectivePermissions("agent-wkr");

      expect(ceoPerms.length).toBeGreaterThan(wkrPerms.length);
    });
  });

  describe("deleteOrganizationPermissions", () => {
    it("removes all policies for the given organization", () => {
      const org = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "a1", role: "ceo" }),
        makeNode({ id: "n2", agentId: "a2", role: "worker", parentId: "n1" }),
      ]);

      assignOrganizationPermissions(org, roleStore, policyStore);
      expect(policyStore.getPolicy("a1")).toBeDefined();
      expect(policyStore.getPolicy("a2")).toBeDefined();

      deleteOrganizationPermissions("wf-1", policyStore);

      expect(policyStore.getPolicy("a1")).toBeUndefined();
      expect(policyStore.getPolicy("a2")).toBeUndefined();
    });

    it("does not affect policies from other organizations", () => {
      const org1 = makeOrganization("wf-1", [
        makeNode({ id: "n1", agentId: "a1", role: "ceo" }),
      ]);
      const org2 = makeOrganization("wf-2", [
        makeNode({ id: "n2", agentId: "a2", role: "worker" }),
      ]);

      assignOrganizationPermissions(org1, roleStore, policyStore);
      assignOrganizationPermissions(org2, roleStore, policyStore);

      deleteOrganizationPermissions("wf-1", policyStore);

      expect(policyStore.getPolicy("a1")).toBeUndefined();
      expect(policyStore.getPolicy("a2")).toBeDefined();
    });
  });
});

/* ─── Property-Based Tests ─── */

import * as fc from "fast-check";
import type { AgentRole } from "../../shared/workflow-runtime.js";

/**
 * **Validates: Requirements 14.5**
 *
 * Property 12: 权限继承层级正确性
 *
 * For any organization with CEO, Manager, and Worker nodes,
 * CEO effective permissions ⊇ Manager effective permissions ⊇ Worker effective permissions.
 */
describe("Property 12: 权限继承层级正确性", () => {
  // Generator: random organization with exactly one CEO, 1+ Managers, 1+ Workers
  const arbOrgSize = fc.record({
    managerCount: fc.integer({ min: 1, max: 3 }),
    workerCount: fc.integer({ min: 1, max: 5 }),
    workflowId: fc.uuid(),
  });

  it("CEO effective permissions ⊇ Manager ⊇ Worker for any org structure", () => {
    fc.assert(
      fc.property(arbOrgSize, ({ managerCount, workerCount, workflowId }) => {
        // Fresh stores for each run
        const localDb = createInMemoryDb();
        const localRoleStore = new RoleStore(localDb as any);
        const localPolicyStore = new PolicyStore(localDb as any, localRoleStore);
        localRoleStore.initBuiltinRoles();

        // Build nodes: 1 CEO + N Managers + M Workers
        const nodes: WorkflowOrganizationNode[] = [];
        let nodeIdx = 0;

        // CEO
        const ceoNode = makeNode({
          id: `n${nodeIdx}`,
          agentId: `agent-ceo-${workflowId}`,
          role: "ceo",
          parentId: null,
        });
        nodes.push(ceoNode);
        nodeIdx++;

        // Managers
        const managerAgentIds: string[] = [];
        for (let i = 0; i < managerCount; i++) {
          const mgrNode = makeNode({
            id: `n${nodeIdx}`,
            agentId: `agent-mgr-${i}-${workflowId}`,
            role: "manager",
            parentId: ceoNode.id,
          });
          nodes.push(mgrNode);
          managerAgentIds.push(mgrNode.agentId);
          nodeIdx++;
        }

        // Workers
        const workerAgentIds: string[] = [];
        for (let i = 0; i < workerCount; i++) {
          const parentMgr = managerAgentIds.length > 0
            ? nodes.find(n => n.agentId === managerAgentIds[i % managerAgentIds.length])!
            : ceoNode;
          const wkrNode = makeNode({
            id: `n${nodeIdx}`,
            agentId: `agent-wkr-${i}-${workflowId}`,
            role: "worker",
            parentId: parentMgr.id,
          });
          nodes.push(wkrNode);
          workerAgentIds.push(wkrNode.agentId);
          nodeIdx++;
        }

        const org = makeOrganization(workflowId, nodes);
        assignOrganizationPermissions(org, localRoleStore, localPolicyStore);

        // Resolve effective permissions
        const ceoPerms = localPolicyStore.resolveEffectivePermissions(ceoNode.agentId);
        const ceoKeys = new Set(ceoPerms.map(p => `${p.resourceType}:${p.action}`));

        // Check: CEO ⊇ every Manager
        for (const mgrId of managerAgentIds) {
          const mgrPerms = localPolicyStore.resolveEffectivePermissions(mgrId);
          const mgrKeys = new Set(mgrPerms.map(p => `${p.resourceType}:${p.action}`));

          for (const key of mgrKeys) {
            if (!ceoKeys.has(key)) return false;
          }

          // Check: this Manager ⊇ every Worker under it
          for (const wkrId of workerAgentIds) {
            const wkrPerms = localPolicyStore.resolveEffectivePermissions(wkrId);
            for (const perm of wkrPerms) {
              if (!mgrKeys.has(`${perm.resourceType}:${perm.action}`)) return false;
            }
          }
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
