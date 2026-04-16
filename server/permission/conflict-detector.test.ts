/**
 * Unit tests + Property-based tests for ConflictDetector
 *
 * Validates: Requirements 10.1, 10.2, 10.3
 */

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type {
  AgentRole,
  AgentPermissionPolicy,
  Permission,
  PermissionTemplate,
  PermissionEscalation,
  ResourceType,
  Action,
} from "../../shared/permission/contracts.js";
import { RESOURCE_TYPES, ACTIONS } from "../../shared/permission/contracts.js";
import { RoleStore } from "./role-store.js";
import { PolicyStore } from "./policy-store.js";
import { ConflictDetector } from "./conflict-detector.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let roles: AgentRole[] = [];
  let policies: AgentPermissionPolicy[] = [];
  let templates: PermissionTemplate[] = [];
  let escalations: PermissionEscalation[] = [];
  return {
    getPermissionRoles: () => roles,
    setPermissionRoles: (r: AgentRole[]) => {
      roles = r;
    },
    getPermissionPolicies: () => policies,
    setPermissionPolicies: (p: AgentPermissionPolicy[]) => {
      policies = p;
    },
    getPermissionTemplates: () => templates,
    setPermissionTemplates: (t: PermissionTemplate[]) => {
      templates = t;
    },
    getPermissionEscalations: () => escalations,
    setPermissionEscalations: (e: PermissionEscalation[]) => {
      escalations = e;
    },
  };
}

/* ─── Helpers ─── */

function makePermission(
  resourceType: ResourceType = "filesystem",
  action: Action = "read",
  effect: "allow" | "deny" = "allow",
  constraints: Permission["constraints"] = {}
): Permission {
  return { resourceType, action, constraints, effect };
}

function setup() {
  const db = createInMemoryDb();
  const roleStore = new RoleStore(db as any);
  const policyStore = new PolicyStore(db as any, roleStore);
  const detector = new ConflictDetector(policyStore, roleStore);
  return { db, roleStore, policyStore, detector };
}

function seedAgent(
  roleStore: RoleStore,
  policyStore: PolicyStore,
  agentId: string,
  opts: {
    rolePermissions?: Permission[];
    customPermissions?: Permission[];
    deniedPermissions?: Permission[];
  } = {}
) {
  const roleId = `role-${agentId}`;
  roleStore.createRole({
    roleId,
    roleName: `Role ${agentId}`,
    description: "",
    permissions: opts.rolePermissions ?? [],
  });
  policyStore.createPolicy({
    agentId,
    assignedRoles: [roleId],
    customPermissions: opts.customPermissions ?? [],
    deniedPermissions: opts.deniedPermissions ?? [],
    effectiveAt: new Date().toISOString(),
    expiresAt: null,
  });
}

// ─── Unit Tests: detectConflicts ─────────────────────────────────────────

describe("ConflictDetector", () => {
  describe("detectConflicts", () => {
    it("returns empty array for agent with no policy", () => {
      const { detector } = setup();
      expect(detector.detectConflicts("nonexistent")).toEqual([]);
    });

    it("returns empty array for agent with no conflicts", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-1", {
        rolePermissions: [makePermission("filesystem", "read", "allow")],
      });
      expect(detector.detectConflicts("agent-1")).toEqual([]);
    });

    // ── allow_deny_overlap ──

    it("detects allow_deny_overlap when same resourceType+action has allow and deny", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-2", {
        rolePermissions: [makePermission("filesystem", "read", "allow")],
        deniedPermissions: [makePermission("filesystem", "read", "deny")],
      });

      const conflicts = detector.detectConflicts("agent-2");
      const overlap = conflicts.filter(
        c => c.conflictType === "allow_deny_overlap"
      );
      expect(overlap.length).toBeGreaterThanOrEqual(1);
      expect(overlap[0].agentId).toBe("agent-2");
      expect(overlap[0].permissions.length).toBe(2);
    });

    it("detects allow_deny_overlap from customPermissions vs deniedPermissions", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-3", {
        customPermissions: [makePermission("network", "connect", "allow")],
        deniedPermissions: [makePermission("network", "connect", "deny")],
      });

      const conflicts = detector.detectConflicts("agent-3");
      const overlap = conflicts.filter(
        c => c.conflictType === "allow_deny_overlap"
      );
      expect(overlap.length).toBeGreaterThanOrEqual(1);
    });

    it("does not report allow_deny_overlap for different actions", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-4", {
        rolePermissions: [makePermission("filesystem", "read", "allow")],
        deniedPermissions: [makePermission("filesystem", "write", "deny")],
      });

      const conflicts = detector.detectConflicts("agent-4");
      const overlap = conflicts.filter(
        c => c.conflictType === "allow_deny_overlap"
      );
      expect(overlap.length).toBe(0);
    });

    it("does not report allow_deny_overlap for different resourceTypes", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-5", {
        rolePermissions: [makePermission("filesystem", "read", "allow")],
        deniedPermissions: [makePermission("network", "read", "deny")],
      });

      const conflicts = detector.detectConflicts("agent-5");
      const overlap = conflicts.filter(
        c => c.conflictType === "allow_deny_overlap"
      );
      expect(overlap.length).toBe(0);
    });

    // ── excessive_scope ──

    it("detects excessive_scope for filesystem wildcard *", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-6", {
        rolePermissions: [
          makePermission("filesystem", "read", "allow", {
            pathPatterns: ["*"],
          }),
        ],
      });

      const conflicts = detector.detectConflicts("agent-6");
      const excessive = conflicts.filter(
        c => c.conflictType === "excessive_scope"
      );
      expect(excessive.length).toBeGreaterThanOrEqual(1);
    });

    it("detects excessive_scope for network wildcard domain", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-7", {
        rolePermissions: [
          makePermission("network", "connect", "allow", {
            domainPatterns: ["*"],
          }),
        ],
      });

      const conflicts = detector.detectConflicts("agent-7");
      const excessive = conflicts.filter(
        c => c.conflictType === "excessive_scope"
      );
      expect(excessive.length).toBeGreaterThanOrEqual(1);
    });

    it("detects excessive_scope for database wildcard table", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-8", {
        rolePermissions: [
          makePermission("database", "select", "allow", { tables: ["*"] }),
        ],
      });

      const conflicts = detector.detectConflicts("agent-8");
      const excessive = conflicts.filter(
        c => c.conflictType === "excessive_scope"
      );
      expect(excessive.length).toBeGreaterThanOrEqual(1);
    });

    it("does not flag excessive_scope for specific paths", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-9", {
        rolePermissions: [
          makePermission("filesystem", "read", "allow", {
            pathPatterns: ["/data/user_1/*"],
          }),
        ],
      });

      const conflicts = detector.detectConflicts("agent-9");
      const excessive = conflicts.filter(
        c => c.conflictType === "excessive_scope"
      );
      expect(excessive.length).toBe(0);
    });

    // ── dangerous_combination ──

    it("detects dangerous_combination: filesystem write + network connect", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-10", {
        rolePermissions: [
          makePermission("filesystem", "write", "allow"),
          makePermission("network", "connect", "allow"),
        ],
      });

      const conflicts = detector.detectConflicts("agent-10");
      const dangerous = conflicts.filter(
        c => c.conflictType === "dangerous_combination"
      );
      expect(dangerous.length).toBeGreaterThanOrEqual(1);
      expect(dangerous[0].description).toContain("exfiltration");
    });

    it("detects dangerous_combination: filesystem execute + network connect", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-11", {
        rolePermissions: [
          makePermission("filesystem", "execute", "allow"),
          makePermission("network", "connect", "allow"),
        ],
      });

      const conflicts = detector.detectConflicts("agent-11");
      const dangerous = conflicts.filter(
        c => c.conflictType === "dangerous_combination"
      );
      expect(
        dangerous.some(c => c.description.includes("remote code execution"))
      ).toBe(true);
    });

    it("detects dangerous_combination: database delete + filesystem write", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-12", {
        rolePermissions: [
          makePermission("database", "delete", "allow"),
          makePermission("filesystem", "write", "allow"),
        ],
      });

      const conflicts = detector.detectConflicts("agent-12");
      const dangerous = conflicts.filter(
        c => c.conflictType === "dangerous_combination"
      );
      expect(
        dangerous.some(c => c.description.includes("data destruction"))
      ).toBe(true);
    });

    it("does not flag dangerous_combination for read-only permissions", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "agent-13", {
        rolePermissions: [
          makePermission("filesystem", "read", "allow"),
          makePermission("network", "connect", "allow"),
        ],
      });

      const conflicts = detector.detectConflicts("agent-13");
      const dangerous = conflicts.filter(
        c => c.conflictType === "dangerous_combination"
      );
      // filesystem read + network connect is NOT flagged (only write + connect is)
      expect(dangerous.some(c => c.description.includes("exfiltration"))).toBe(
        false
      );
    });
  });

  // ─── Unit Tests: assessRisk ──────────────────────────────────────────────

  describe("assessRisk", () => {
    it("returns low risk for agent with no policy", () => {
      const { detector } = setup();
      const risk = detector.assessRisk("nonexistent");
      expect(risk.riskLevel).toBe("low");
      expect(risk.factors).toEqual([]);
    });

    it("returns low risk for read-only filesystem access", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-1", {
        rolePermissions: [
          makePermission("filesystem", "read", "allow", {
            pathPatterns: ["/data/input"],
          }),
        ],
      });

      const risk = detector.assessRisk("risk-1");
      expect(risk.riskLevel).toBe("low");
      expect(risk.factors.some(f => f.category === "filesystem_scope")).toBe(
        true
      );
    });

    it("returns critical risk for system directory access", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-2", {
        rolePermissions: [
          makePermission("filesystem", "read", "allow", {
            pathPatterns: ["/etc/passwd"],
          }),
        ],
      });

      const risk = detector.assessRisk("risk-2");
      expect(risk.riskLevel).toBe("critical");
    });

    it("returns high risk for wildcard filesystem access", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-3", {
        rolePermissions: [
          makePermission("filesystem", "write", "allow", {
            pathPatterns: ["*"],
          }),
        ],
      });

      const risk = detector.assessRisk("risk-3");
      expect(["high", "critical"]).toContain(risk.riskLevel);
    });

    it("returns medium risk for whitelisted network access", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-4", {
        rolePermissions: [
          makePermission("network", "connect", "allow", {
            domainPatterns: ["*.api.company.com"],
          }),
        ],
      });

      const risk = detector.assessRisk("risk-4");
      expect(risk.riskLevel).toBe("medium");
    });

    it("returns critical risk for private IP access", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-5", {
        rolePermissions: [
          makePermission("network", "connect", "allow", {
            cidrRanges: ["10.0.0.0/8"],
          }),
        ],
      });

      const risk = detector.assessRisk("risk-5");
      expect(risk.riskLevel).toBe("critical");
    });

    it("returns high risk for database delete", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-6", {
        rolePermissions: [makePermission("database", "delete", "allow")],
      });

      const risk = detector.assessRisk("risk-6");
      expect(["high", "critical"]).toContain(risk.riskLevel);
    });

    it("returns low risk for database select only", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-7", {
        rolePermissions: [
          makePermission("database", "select", "allow", {
            tables: ["public_data"],
            forbiddenOperations: ["DROP", "TRUNCATE"],
          }),
        ],
      });

      const risk = detector.assessRisk("risk-7");
      expect(risk.riskLevel).toBe("low");
    });

    it("returns critical risk for unrestricted MCP execute", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-8", {
        rolePermissions: [
          makePermission("mcp_tool", "execute", "allow", { endpoints: [] }),
        ],
      });

      const risk = detector.assessRisk("risk-8");
      expect(risk.riskLevel).toBe("critical");
    });

    it("returns low risk for read-only MCP access", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-9", {
        rolePermissions: [
          makePermission("mcp_tool", "read", "allow", {
            endpoints: ["tool-1"],
          }),
        ],
      });

      const risk = detector.assessRisk("risk-9");
      expect(risk.riskLevel).toBe("low");
    });

    it("overall risk is the highest severity among all factors", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-10", {
        rolePermissions: [
          makePermission("filesystem", "read", "allow", {
            pathPatterns: ["/data"],
          }), // low
          makePermission("network", "connect", "allow", {
            cidrRanges: ["10.0.0.0/8"],
          }), // critical
        ],
      });

      const risk = detector.assessRisk("risk-10");
      expect(risk.riskLevel).toBe("critical");
    });

    it("includes agentId and timestamp in assessment", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-11", {
        rolePermissions: [makePermission("filesystem", "read", "allow")],
      });

      const risk = detector.assessRisk("risk-11");
      expect(risk.agentId).toBe("risk-11");
      expect(risk.timestamp).toBeTruthy();
    });

    it("only considers allow permissions for risk (ignores deny)", () => {
      const { roleStore, policyStore, detector } = setup();
      seedAgent(roleStore, policyStore, "risk-12", {
        deniedPermissions: [
          makePermission("filesystem", "write", "deny", {
            pathPatterns: ["*"],
          }),
        ],
      });

      const risk = detector.assessRisk("risk-12");
      // Deny-only should not produce filesystem risk factors
      expect(
        risk.factors.filter(f => f.category === "filesystem_scope").length
      ).toBe(0);
    });
  });
});

// ─── Property-Based Tests ───────────────────────────────────────────────────

describe("Property 13: 冲突检测覆盖性", () => {
  /**
   * **Validates: Requirements 10.1**
   *
   * For any config with allow+deny for the same resourceType+action,
   * detectConflicts returns at least one allow_deny_overlap conflict.
   */
  it("detects allow_deny_overlap for any matching allow+deny pair", () => {
    fc.assert(
      fc.property(
        // Random resource type
        fc.constantFrom(...RESOURCE_TYPES),
        // Random action
        fc.constantFrom(...ACTIONS),
        (resourceType, action) => {
          const db = createInMemoryDb();
          const roleStore = new RoleStore(db as any);
          const policyStore = new PolicyStore(db as any, roleStore);
          const detector = new ConflictDetector(policyStore, roleStore);

          const agentId = "pbt-agent";

          // Create a policy with both allow and deny for the same resourceType+action
          const allowPerm: Permission = {
            resourceType,
            action,
            constraints: {},
            effect: "allow",
          };
          const denyPerm: Permission = {
            resourceType,
            action,
            constraints: {},
            effect: "deny",
          };

          policyStore.createPolicy({
            agentId,
            assignedRoles: [],
            customPermissions: [allowPerm],
            deniedPermissions: [denyPerm],
            effectiveAt: new Date().toISOString(),
            expiresAt: null,
          });

          const conflicts = detector.detectConflicts(agentId);
          const overlaps = conflicts.filter(
            c => c.conflictType === "allow_deny_overlap"
          );

          // Must find at least one allow_deny_overlap conflict
          return overlaps.length >= 1;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("detects allow_deny_overlap when allow comes from role permissions", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RESOURCE_TYPES),
        fc.constantFrom(...ACTIONS),
        (resourceType, action) => {
          const db = createInMemoryDb();
          const roleStore = new RoleStore(db as any);
          const policyStore = new PolicyStore(db as any, roleStore);
          const detector = new ConflictDetector(policyStore, roleStore);

          const agentId = "pbt-agent-role";
          const roleId = "test-role";

          // Allow permission comes from a role
          roleStore.createRole({
            roleId,
            roleName: "Test Role",
            description: "",
            permissions: [
              { resourceType, action, constraints: {}, effect: "allow" },
            ],
          });

          // Deny permission is in deniedPermissions
          policyStore.createPolicy({
            agentId,
            assignedRoles: [roleId],
            customPermissions: [],
            deniedPermissions: [
              { resourceType, action, constraints: {}, effect: "deny" },
            ],
            effectiveAt: new Date().toISOString(),
            expiresAt: null,
          });

          const conflicts = detector.detectConflicts(agentId);
          const overlaps = conflicts.filter(
            c => c.conflictType === "allow_deny_overlap"
          );

          return overlaps.length >= 1;
        }
      ),
      { numRuns: 100 }
    );
  });
});
