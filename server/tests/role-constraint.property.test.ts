// Feature: dynamic-role-system, Property 15: 角色切换约束校验
/**
 * Property 15: 角色切换约束校验
 *
 * 对于任意角色切换请求：
 * (a) 当 Agent 有未完成任务时，应返回 AGENT_BUSY 错误
 * (b) 当在冷却期内时，应返回 COOLDOWN_ACTIVE 错误
 * (c) 当目标角色在 incompatibleRoles 中或不在 compatibleRoles 中时，应返回 ROLE_SWITCH_DENIED 错误
 * (d) 当从低权限切换到高权限时，应返回 AUTHORITY_APPROVAL_REQUIRED 错误
 *
 * 优先级顺序：AGENT_BUSY → COOLDOWN_ACTIVE → ROLE_SWITCH_DENIED → AUTHORITY_APPROVAL_REQUIRED
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
 */

import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  RoleTemplate,
  AuthorityLevel,
  RoleSource,
} from "../../shared/role-schema.js";
import type { WorkflowNodeModelConfig } from "../../shared/organization-schema.js";
import { RoleRegistry } from "../core/role-registry.js";
import {
  RoleConstraintValidator,
  type ValidatableAgent,
  type RoleConstraintContext,
} from "../core/role-constraint-validator.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(
  __test_dirname,
  "../../data/__test_constraint_prop__"
);
const TEST_STORE_PATH = resolve(TEST_STORE_DIR, "role-templates.json");

// ── Arbitraries ──────────────────────────────────────────────────

const arbAuthorityLevel: fc.Arbitrary<AuthorityLevel> = fc.constantFrom(
  "high",
  "medium",
  "low"
);
const arbRoleSource: fc.Arbitrary<RoleSource> = fc.constantFrom(
  "predefined",
  "generated"
);

const arbModelConfig: fc.Arbitrary<WorkflowNodeModelConfig> = fc.record({
  model: fc.string({ minLength: 1, maxLength: 20 }),
  temperature: fc.double({ min: 0, max: 2, noNaN: true }),
  maxTokens: fc.integer({ min: 1, max: 128000 }),
});

const arbISODate: fc.Arbitrary<string> = fc
  .integer({ min: 1577836800000, max: 1924905600000 })
  .map(ts => new Date(ts).toISOString());

const arbRoleId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,29}$/)
  .filter(s => s.length >= 2);

const arbAgentId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
  .filter(s => s.length >= 2);

const arbStringList: fc.Arbitrary<string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 15 }),
  { minLength: 0, maxLength: 5 }
);

/** Generate a valid RoleTemplate with specific overrides */
function arbRoleTemplate(
  overrides?: Partial<RoleTemplate>
): fc.Arbitrary<RoleTemplate> {
  return fc
    .record({
      roleId: arbRoleId,
      roleName: fc.string({ minLength: 1, maxLength: 20 }),
      responsibilityPrompt: fc.string({ minLength: 1, maxLength: 100 }),
      requiredSkillIds: arbStringList,
      mcpIds: arbStringList,
      defaultModelConfig: arbModelConfig,
      authorityLevel: arbAuthorityLevel,
      source: arbRoleSource,
      createdAt: arbISODate,
      updatedAt: arbISODate,
    })
    .map(t => ({ ...t, ...overrides }));
}

/** Authority rank for comparison */
const AUTHORITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** Helper to clean up test persistence */
function cleanup(): void {
  if (existsSync(TEST_STORE_DIR)) {
    rmSync(TEST_STORE_DIR, { recursive: true, force: true });
  }
}

// ── Property Tests ───────────────────────────────────────────────

describe("RoleConstraintValidator Property 15: 角色切换约束校验", () => {
  afterEach(cleanup);

  // **Validates: Requirements 6.4**
  // (a) AGENT_BUSY: When Agent has incomplete tasks → AGENT_BUSY error
  it("returns AGENT_BUSY when agent has incomplete tasks, regardless of other conditions", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        // Generate random context values for other fields to prove AGENT_BUSY always wins
        fc.boolean(), // whether lastRoleSwitchAt is recent (cooldown active)
        fc.integer({ min: 1000, max: 120_000 }), // cooldownMs
        (agentId, targetRoleId, cooldownActive, cooldownMs) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: agentId } };

          const context: RoleConstraintContext = {
            currentRoleId: null,
            hasIncompleteTasks: true, // key condition
            triggerSource: "test-mission",
            lastRoleSwitchAt: cooldownActive ? new Date().toISOString() : null,
            roleSwitchCooldownMs: cooldownMs,
          };

          const result = validator.validate(agent, targetRoleId, context);

          expect(result).not.toBeNull();
          expect(result!.code).toBe("AGENT_BUSY");
          expect(result!.agentId).toBe(agentId);
          expect(result!.requestedRoleId).toBe(targetRoleId);
          expect(typeof result!.denialReason).toBe("string");
          expect(result!.denialReason.length).toBeGreaterThan(0);
          expect(Number.isNaN(Date.parse(result!.timestamp))).toBe(false);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.2**
  // (b) COOLDOWN_ACTIVE: When within cooldown period → COOLDOWN_ACTIVE error
  it("returns COOLDOWN_ACTIVE when within cooldown period and no incomplete tasks", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        // Generate a cooldown period and a recent switch time that is within it
        fc.integer({ min: 10_000, max: 300_000 }), // cooldownMs
        fc.double({ min: 0.01, max: 0.99, noNaN: true }), // fraction of cooldown elapsed
        (agentId, targetRoleId, cooldownMs, elapsedFraction) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: agentId } };

          // Compute a lastRoleSwitchAt that is within the cooldown window
          const elapsedMs = Math.floor(cooldownMs * elapsedFraction);
          const lastSwitchTime = new Date(Date.now() - elapsedMs).toISOString();

          const context: RoleConstraintContext = {
            currentRoleId: null,
            hasIncompleteTasks: false,
            triggerSource: "test-mission",
            lastRoleSwitchAt: lastSwitchTime,
            roleSwitchCooldownMs: cooldownMs,
          };

          const result = validator.validate(agent, targetRoleId, context);

          expect(result).not.toBeNull();
          expect(result!.code).toBe("COOLDOWN_ACTIVE");
          expect(result!.agentId).toBe(agentId);
          expect(result!.requestedRoleId).toBe(targetRoleId);
          expect(typeof result!.denialReason).toBe("string");
          expect(result!.denialReason.length).toBeGreaterThan(0);
          expect(Number.isNaN(Date.parse(result!.timestamp))).toBe(false);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.1**
  // (c) ROLE_SWITCH_DENIED via incompatibleRoles: target in blacklist
  it("returns ROLE_SWITCH_DENIED when target role is in incompatibleRoles of current role", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          arbAgentId,
          fc.tuple(arbRoleId, arbRoleId).filter(([a, b]) => a !== b),
          arbAuthorityLevel
        ),
        ([_agentId, [currentRoleId, targetRoleId], authorityLevel]) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: "agent-test" } };

          // Register current role with target in incompatibleRoles
          const now = new Date().toISOString();
          reg.register({
            roleId: currentRoleId,
            roleName: "Current",
            responsibilityPrompt: "current prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel,
            source: "predefined",
            incompatibleRoles: [targetRoleId],
            createdAt: now,
            updatedAt: now,
          });

          // Register target role with same authority (to avoid AUTHORITY_APPROVAL_REQUIRED)
          reg.register({
            roleId: targetRoleId,
            roleName: "Target",
            responsibilityPrompt: "target prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel, // same level → no authority issue
            source: "predefined",
            createdAt: now,
            updatedAt: now,
          });

          const context: RoleConstraintContext = {
            currentRoleId,
            hasIncompleteTasks: false,
            triggerSource: "test-mission",
            lastRoleSwitchAt: null, // no cooldown
            roleSwitchCooldownMs: 60_000,
          };

          const result = validator.validate(agent, targetRoleId, context);

          expect(result).not.toBeNull();
          expect(result!.code).toBe("ROLE_SWITCH_DENIED");
          expect(result!.requestedRoleId).toBe(targetRoleId);
          expect(result!.denialReason).toContain("incompatibleRoles");

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.1**
  // (c) ROLE_SWITCH_DENIED via compatibleRoles: target not in whitelist
  it("returns ROLE_SWITCH_DENIED when target role is not in compatibleRoles whitelist", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        // Generate three distinct role IDs: current, target, and one allowed role
        fc
          .tuple(arbRoleId, arbRoleId, arbRoleId)
          .filter(([a, b, c]) => a !== b && b !== c && a !== c),
        arbAuthorityLevel,
        (
          agentId,
          [currentRoleId, targetRoleId, allowedRoleId],
          authorityLevel
        ) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: agentId } };

          const now = new Date().toISOString();
          // Current role has a compatibleRoles whitelist that does NOT include target
          reg.register({
            roleId: currentRoleId,
            roleName: "Current",
            responsibilityPrompt: "current prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel,
            source: "predefined",
            compatibleRoles: [allowedRoleId], // only allowedRoleId is permitted
            createdAt: now,
            updatedAt: now,
          });

          reg.register({
            roleId: targetRoleId,
            roleName: "Target",
            responsibilityPrompt: "target prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel,
            source: "predefined",
            createdAt: now,
            updatedAt: now,
          });

          const context: RoleConstraintContext = {
            currentRoleId,
            hasIncompleteTasks: false,
            triggerSource: "test-mission",
            lastRoleSwitchAt: null,
            roleSwitchCooldownMs: 60_000,
          };

          const result = validator.validate(agent, targetRoleId, context);

          expect(result).not.toBeNull();
          expect(result!.code).toBe("ROLE_SWITCH_DENIED");
          expect(result!.requestedRoleId).toBe(targetRoleId);
          expect(result!.denialReason).toContain("compatibleRoles");

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.3**
  // (d) AUTHORITY_APPROVAL_REQUIRED: low → high authority switch
  it("returns AUTHORITY_APPROVAL_REQUIRED when switching from lower to higher authority", () => {
    // Generate pairs where target authority is strictly higher than current
    const arbAuthorityPair: fc.Arbitrary<{
      current: AuthorityLevel;
      target: AuthorityLevel;
    }> = fc.constantFrom(
      { current: "low" as AuthorityLevel, target: "medium" as AuthorityLevel },
      { current: "low" as AuthorityLevel, target: "high" as AuthorityLevel },
      { current: "medium" as AuthorityLevel, target: "high" as AuthorityLevel }
    );

    fc.assert(
      fc.property(
        arbAgentId,
        fc.tuple(arbRoleId, arbRoleId).filter(([a, b]) => a !== b),
        arbAuthorityPair,
        (agentId, [currentRoleId, targetRoleId], { current, target }) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: agentId } };

          const now = new Date().toISOString();
          // No compatibility constraints → only authority check applies
          reg.register({
            roleId: currentRoleId,
            roleName: "Current",
            responsibilityPrompt: "current prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel: current,
            source: "predefined",
            createdAt: now,
            updatedAt: now,
          });

          reg.register({
            roleId: targetRoleId,
            roleName: "Target",
            responsibilityPrompt: "target prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel: target,
            source: "predefined",
            createdAt: now,
            updatedAt: now,
          });

          const context: RoleConstraintContext = {
            currentRoleId,
            hasIncompleteTasks: false,
            triggerSource: "test-mission",
            lastRoleSwitchAt: null,
            roleSwitchCooldownMs: 60_000,
          };

          const result = validator.validate(agent, targetRoleId, context);

          expect(result).not.toBeNull();
          expect(result!.code).toBe("AUTHORITY_APPROVAL_REQUIRED");
          expect(result!.agentId).toBe(agentId);
          expect(result!.requestedRoleId).toBe(targetRoleId);
          expect(result!.denialReason).toContain("approval");

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
  // Priority: AGENT_BUSY > COOLDOWN_ACTIVE > ROLE_SWITCH_DENIED > AUTHORITY_APPROVAL_REQUIRED
  it("respects priority order: AGENT_BUSY beats COOLDOWN_ACTIVE when both apply", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        fc.integer({ min: 10_000, max: 120_000 }),
        (agentId, targetRoleId, cooldownMs) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: agentId } };

          // Both AGENT_BUSY and COOLDOWN_ACTIVE conditions are true
          const context: RoleConstraintContext = {
            currentRoleId: null,
            hasIncompleteTasks: true,
            triggerSource: "test-mission",
            lastRoleSwitchAt: new Date().toISOString(), // within cooldown
            roleSwitchCooldownMs: cooldownMs,
          };

          const result = validator.validate(agent, targetRoleId, context);

          expect(result).not.toBeNull();
          expect(result!.code).toBe("AGENT_BUSY");

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("respects priority order: COOLDOWN_ACTIVE beats ROLE_SWITCH_DENIED when both apply", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        fc.tuple(arbRoleId, arbRoleId).filter(([a, b]) => a !== b),
        fc.integer({ min: 10_000, max: 120_000 }),
        (agentId, [currentRoleId, targetRoleId], cooldownMs) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: agentId } };

          const now = new Date().toISOString();
          // Register current role with target in incompatibleRoles
          reg.register({
            roleId: currentRoleId,
            roleName: "Current",
            responsibilityPrompt: "prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel: "medium",
            source: "predefined",
            incompatibleRoles: [targetRoleId],
            createdAt: now,
            updatedAt: now,
          });

          // COOLDOWN_ACTIVE + ROLE_SWITCH_DENIED both true
          const context: RoleConstraintContext = {
            currentRoleId,
            hasIncompleteTasks: false,
            triggerSource: "test-mission",
            lastRoleSwitchAt: new Date().toISOString(),
            roleSwitchCooldownMs: cooldownMs,
          };

          const result = validator.validate(agent, targetRoleId, context);

          expect(result).not.toBeNull();
          expect(result!.code).toBe("COOLDOWN_ACTIVE");

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("respects priority order: ROLE_SWITCH_DENIED beats AUTHORITY_APPROVAL_REQUIRED when both apply", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        fc.tuple(arbRoleId, arbRoleId).filter(([a, b]) => a !== b),
        (agentId, [currentRoleId, targetRoleId]) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: agentId } };

          const now = new Date().toISOString();
          // Current role: low authority + target in incompatibleRoles
          reg.register({
            roleId: currentRoleId,
            roleName: "Current",
            responsibilityPrompt: "prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel: "low",
            source: "predefined",
            incompatibleRoles: [targetRoleId],
            createdAt: now,
            updatedAt: now,
          });

          // Target role: high authority → would trigger AUTHORITY_APPROVAL_REQUIRED
          reg.register({
            roleId: targetRoleId,
            roleName: "Target",
            responsibilityPrompt: "prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel: "high",
            source: "predefined",
            createdAt: now,
            updatedAt: now,
          });

          const context: RoleConstraintContext = {
            currentRoleId,
            hasIncompleteTasks: false,
            triggerSource: "test-mission",
            lastRoleSwitchAt: null,
            roleSwitchCooldownMs: 60_000,
          };

          const result = validator.validate(agent, targetRoleId, context);

          expect(result).not.toBeNull();
          expect(result!.code).toBe("ROLE_SWITCH_DENIED");

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
  // When no constraints are violated, validate returns null
  it("returns null when no constraints are violated", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        fc.tuple(arbRoleId, arbRoleId).filter(([a, b]) => a !== b),
        arbAuthorityLevel,
        (agentId, [currentRoleId, targetRoleId], authorityLevel) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: agentId } };

          const now = new Date().toISOString();
          // Both roles at same authority, no compatibility constraints
          reg.register({
            roleId: currentRoleId,
            roleName: "Current",
            responsibilityPrompt: "prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel,
            source: "predefined",
            createdAt: now,
            updatedAt: now,
          });

          reg.register({
            roleId: targetRoleId,
            roleName: "Target",
            responsibilityPrompt: "prompt",
            requiredSkillIds: [],
            mcpIds: [],
            defaultModelConfig: {
              model: "gpt-4o",
              temperature: 0.7,
              maxTokens: 4096,
            },
            authorityLevel, // same level
            source: "predefined",
            createdAt: now,
            updatedAt: now,
          });

          // No incomplete tasks, no cooldown, no compatibility issues, same authority
          const pastTime = new Date(Date.now() - 200_000).toISOString();
          const context: RoleConstraintContext = {
            currentRoleId,
            hasIncompleteTasks: false,
            triggerSource: "test-mission",
            lastRoleSwitchAt: pastTime, // well past cooldown
            roleSwitchCooldownMs: 60_000,
          };

          const result = validator.validate(agent, targetRoleId, context);
          expect(result).toBeNull();

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
  // Error shape: all returned errors have required fields
  it("all constraint errors contain agentId, requestedRoleId, denialReason, and valid timestamp", () => {
    const arbErrorScenario = fc.constantFrom(
      "AGENT_BUSY" as const,
      "COOLDOWN_ACTIVE" as const
    );

    fc.assert(
      fc.property(
        arbAgentId,
        arbRoleId,
        arbErrorScenario,
        (agentId, targetRoleId, scenario) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);
          const validator = new RoleConstraintValidator(reg);
          const agent: ValidatableAgent = { config: { id: agentId } };

          let context: RoleConstraintContext;
          if (scenario === "AGENT_BUSY") {
            context = {
              currentRoleId: null,
              hasIncompleteTasks: true,
              triggerSource: "test",
              lastRoleSwitchAt: null,
              roleSwitchCooldownMs: 60_000,
            };
          } else {
            context = {
              currentRoleId: null,
              hasIncompleteTasks: false,
              triggerSource: "test",
              lastRoleSwitchAt: new Date().toISOString(),
              roleSwitchCooldownMs: 120_000,
            };
          }

          const result = validator.validate(agent, targetRoleId, context);

          expect(result).not.toBeNull();
          expect(result!.code).toBe(scenario);
          expect(result!.agentId).toBe(agentId);
          expect(result!.requestedRoleId).toBe(targetRoleId);
          expect(typeof result!.denialReason).toBe("string");
          expect(result!.denialReason.length).toBeGreaterThan(0);
          expect(typeof result!.timestamp).toBe("string");
          // Verify timestamp is a valid ISO date
          const parsed = new Date(result!.timestamp);
          expect(Number.isNaN(parsed.getTime())).toBe(false);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });
});
