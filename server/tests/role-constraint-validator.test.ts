/**
 * RoleConstraintValidator 单元测试
 *
 * 覆盖范围：
 * - AGENT_BUSY — Agent 有未完成任务
 * - COOLDOWN_ACTIVE — 在冷却期内，冷却期边界（恰好到期）
 * - ROLE_SWITCH_DENIED — incompatibleRoles 黑名单、compatibleRoles 白名单不匹配
 * - AUTHORITY_APPROVAL_REQUIRED — 低→高权限切换
 * - 边界情况：无 currentRoleId（首次加载）、同权限等级、冷却期恰好到期
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { RoleTemplate } from "../../shared/role-schema.js";
import { RoleRegistry } from "../core/role-registry.js";
import {
  RoleConstraintValidator,
  type ValidatableAgent,
  type RoleConstraintContext,
} from "../core/role-constraint-validator.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(
  __test_dirname,
  "../../data/__test_constraint_unit__"
);
const TEST_STORE_PATH = resolve(TEST_STORE_DIR, "role-templates.json");

// ── Helpers ──────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<RoleTemplate> = {}): RoleTemplate {
  const now = new Date().toISOString();
  return {
    roleId: "default-role",
    roleName: "Default",
    responsibilityPrompt: "Default prompt",
    requiredSkillIds: [],
    mcpIds: [],
    defaultModelConfig: { model: "gpt-4o", temperature: 0.7, maxTokens: 4096 },
    authorityLevel: "medium",
    source: "predefined",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAgent(id = "agent-1"): ValidatableAgent {
  return { config: { id } };
}

function makeContext(
  overrides: Partial<RoleConstraintContext> = {}
): RoleConstraintContext {
  return {
    currentRoleId: null,
    hasIncompleteTasks: false,
    triggerSource: "test-mission",
    lastRoleSwitchAt: null,
    roleSwitchCooldownMs: 60_000,
    ...overrides,
  };
}

// ── Cleanup ──────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEST_STORE_DIR)) {
    rmSync(TEST_STORE_DIR, { recursive: true, force: true });
  }
});

// ── 1. AGENT_BUSY ────────────────────────────────────────────────

describe("AGENT_BUSY", () => {
  it("should return AGENT_BUSY when agent has incomplete tasks", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    const result = validator.validate(
      makeAgent("busy-agent"),
      "any-role",
      makeContext({ hasIncompleteTasks: true })
    );

    expect(result).not.toBeNull();
    expect(result!.code).toBe("AGENT_BUSY");
    expect(result!.agentId).toBe("busy-agent");
    expect(result!.requestedRoleId).toBe("any-role");
    expect(result!.denialReason).toContain("incomplete tasks");
  });

  it("should return AGENT_BUSY even when all other constraints also apply (priority)", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(
      makeTemplate({
        roleId: "current",
        authorityLevel: "low",
        incompatibleRoles: ["target"],
      })
    );
    reg.register(makeTemplate({ roleId: "target", authorityLevel: "high" }));

    const result = validator.validate(
      makeAgent(),
      "target",
      makeContext({
        currentRoleId: "current",
        hasIncompleteTasks: true,
        lastRoleSwitchAt: new Date().toISOString(), // within cooldown
      })
    );

    expect(result!.code).toBe("AGENT_BUSY");
  });

  it("should pass when agent has no incomplete tasks", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    const result = validator.validate(
      makeAgent(),
      "target-role",
      makeContext({ hasIncompleteTasks: false })
    );

    expect(result).toBeNull();
  });
});

// ── 2. COOLDOWN_ACTIVE ──────────────────────────────────────────

describe("COOLDOWN_ACTIVE", () => {
  it("should return COOLDOWN_ACTIVE when within cooldown period", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    const lastSwitch = new Date(Date.now() - 10_000).toISOString();
    const result = validator.validate(
      makeAgent("cool-agent"),
      "target-role",
      makeContext({
        lastRoleSwitchAt: lastSwitch,
        roleSwitchCooldownMs: 60_000,
      })
    );

    expect(result).not.toBeNull();
    expect(result!.code).toBe("COOLDOWN_ACTIVE");
    expect(result!.agentId).toBe("cool-agent");
    expect(result!.denialReason).toContain("cooldown");
  });

  it("should pass when cooldown has fully expired", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    const lastSwitch = new Date(Date.now() - 120_000).toISOString();
    const result = validator.validate(
      makeAgent(),
      "target-role",
      makeContext({
        lastRoleSwitchAt: lastSwitch,
        roleSwitchCooldownMs: 60_000,
      })
    );

    expect(result).toBeNull();
  });

  it("should pass when cooldown is exactly expired (boundary: elapsed === cooldownMs)", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    const now = 1700000000000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const cooldownMs = 60_000;
    const lastSwitch = new Date(now - cooldownMs).toISOString();

    const result = validator.validate(
      makeAgent(),
      "target-role",
      makeContext({
        lastRoleSwitchAt: lastSwitch,
        roleSwitchCooldownMs: cooldownMs,
      })
    );

    // elapsed === cooldownMs → NOT < cooldownMs → should pass
    expect(result).toBeNull();
  });

  it("should return COOLDOWN_ACTIVE when 1ms before cooldown expires", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    const now = 1700000000000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const cooldownMs = 60_000;
    const lastSwitch = new Date(now - cooldownMs + 1).toISOString();

    const result = validator.validate(
      makeAgent(),
      "target-role",
      makeContext({
        lastRoleSwitchAt: lastSwitch,
        roleSwitchCooldownMs: cooldownMs,
      })
    );

    // elapsed = cooldownMs - 1 → still < cooldownMs → COOLDOWN_ACTIVE
    expect(result).not.toBeNull();
    expect(result!.code).toBe("COOLDOWN_ACTIVE");
  });

  it("should pass when lastRoleSwitchAt is null (no previous switch)", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    const result = validator.validate(
      makeAgent(),
      "target-role",
      makeContext({ lastRoleSwitchAt: null })
    );

    expect(result).toBeNull();
  });

  it("COOLDOWN_ACTIVE takes priority over ROLE_SWITCH_DENIED", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(
      makeTemplate({
        roleId: "current",
        incompatibleRoles: ["target"],
      })
    );
    reg.register(makeTemplate({ roleId: "target" }));

    const result = validator.validate(
      makeAgent(),
      "target",
      makeContext({
        currentRoleId: "current",
        lastRoleSwitchAt: new Date().toISOString(),
      })
    );

    expect(result!.code).toBe("COOLDOWN_ACTIVE");
  });
});

// ── 3. ROLE_SWITCH_DENIED ───────────────────────────────────────

describe("ROLE_SWITCH_DENIED", () => {
  it("should return ROLE_SWITCH_DENIED when target is in incompatibleRoles blacklist", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(
      makeTemplate({
        roleId: "coder",
        authorityLevel: "medium",
        incompatibleRoles: ["qa"],
      })
    );
    reg.register(makeTemplate({ roleId: "qa", authorityLevel: "medium" }));

    const result = validator.validate(
      makeAgent(),
      "qa",
      makeContext({ currentRoleId: "coder" })
    );

    expect(result).not.toBeNull();
    expect(result!.code).toBe("ROLE_SWITCH_DENIED");
    expect(result!.denialReason).toContain("incompatibleRoles");
  });

  it("should return ROLE_SWITCH_DENIED when target is NOT in compatibleRoles whitelist", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(
      makeTemplate({
        roleId: "coder",
        authorityLevel: "medium",
        compatibleRoles: ["reviewer"], // only reviewer allowed
      })
    );
    reg.register(makeTemplate({ roleId: "pm", authorityLevel: "medium" }));

    const result = validator.validate(
      makeAgent(),
      "pm",
      makeContext({ currentRoleId: "coder" })
    );

    expect(result).not.toBeNull();
    expect(result!.code).toBe("ROLE_SWITCH_DENIED");
    expect(result!.denialReason).toContain("compatibleRoles");
  });

  it("should pass when target IS in compatibleRoles whitelist", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(
      makeTemplate({
        roleId: "coder",
        authorityLevel: "medium",
        compatibleRoles: ["reviewer", "qa"],
      })
    );
    reg.register(
      makeTemplate({ roleId: "reviewer", authorityLevel: "medium" })
    );

    const result = validator.validate(
      makeAgent(),
      "reviewer",
      makeContext({ currentRoleId: "coder" })
    );

    expect(result).toBeNull();
  });

  it("should pass when no compatibleRoles or incompatibleRoles defined", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "coder", authorityLevel: "medium" }));
    reg.register(
      makeTemplate({ roleId: "reviewer", authorityLevel: "medium" })
    );

    const result = validator.validate(
      makeAgent(),
      "reviewer",
      makeContext({ currentRoleId: "coder" })
    );

    expect(result).toBeNull();
  });

  it("should skip compatibility check when currentRoleId is null (first role load)", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "target" }));

    const result = validator.validate(
      makeAgent(),
      "target",
      makeContext({ currentRoleId: null })
    );

    expect(result).toBeNull();
  });

  it("should skip compatibility check when current role template not found in registry", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "target", authorityLevel: "medium" }));

    const result = validator.validate(
      makeAgent(),
      "target",
      makeContext({ currentRoleId: "nonexistent" })
    );

    expect(result).toBeNull();
  });
});

// ── 4. AUTHORITY_APPROVAL_REQUIRED ──────────────────────────────

describe("AUTHORITY_APPROVAL_REQUIRED", () => {
  it("should return AUTHORITY_APPROVAL_REQUIRED when switching low → high", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "worker", authorityLevel: "low" }));
    reg.register(makeTemplate({ roleId: "architect", authorityLevel: "high" }));

    const result = validator.validate(
      makeAgent(),
      "architect",
      makeContext({ currentRoleId: "worker" })
    );

    expect(result).not.toBeNull();
    expect(result!.code).toBe("AUTHORITY_APPROVAL_REQUIRED");
    expect(result!.denialReason).toContain("approval");
  });

  it("should return AUTHORITY_APPROVAL_REQUIRED when switching low → medium", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "worker", authorityLevel: "low" }));
    reg.register(makeTemplate({ roleId: "coder", authorityLevel: "medium" }));

    const result = validator.validate(
      makeAgent(),
      "coder",
      makeContext({ currentRoleId: "worker" })
    );

    expect(result).not.toBeNull();
    expect(result!.code).toBe("AUTHORITY_APPROVAL_REQUIRED");
  });

  it("should return AUTHORITY_APPROVAL_REQUIRED when switching medium → high", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "coder", authorityLevel: "medium" }));
    reg.register(makeTemplate({ roleId: "architect", authorityLevel: "high" }));

    const result = validator.validate(
      makeAgent(),
      "architect",
      makeContext({ currentRoleId: "coder" })
    );

    expect(result).not.toBeNull();
    expect(result!.code).toBe("AUTHORITY_APPROVAL_REQUIRED");
  });

  it("should pass when switching same authority level", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "coder", authorityLevel: "medium" }));
    reg.register(
      makeTemplate({ roleId: "reviewer", authorityLevel: "medium" })
    );

    const result = validator.validate(
      makeAgent(),
      "reviewer",
      makeContext({ currentRoleId: "coder" })
    );

    expect(result).toBeNull();
  });

  it("should pass when switching high → low (downgrade)", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "architect", authorityLevel: "high" }));
    reg.register(makeTemplate({ roleId: "worker", authorityLevel: "low" }));

    const result = validator.validate(
      makeAgent(),
      "worker",
      makeContext({ currentRoleId: "architect" })
    );

    expect(result).toBeNull();
  });

  it("should skip authority check when currentRoleId is null (first role load)", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "architect", authorityLevel: "high" }));

    const result = validator.validate(
      makeAgent(),
      "architect",
      makeContext({ currentRoleId: null })
    );

    expect(result).toBeNull();
  });

  it("should skip authority check when target template not found", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "worker", authorityLevel: "low" }));

    const result = validator.validate(
      makeAgent(),
      "nonexistent-role",
      makeContext({ currentRoleId: "worker" })
    );

    expect(result).toBeNull();
  });
});

// ── 5. Priority ordering ────────────────────────────────────────

describe("priority ordering", () => {
  it("ROLE_SWITCH_DENIED takes priority over AUTHORITY_APPROVAL_REQUIRED", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(
      makeTemplate({
        roleId: "worker",
        authorityLevel: "low",
        incompatibleRoles: ["architect"],
      })
    );
    reg.register(makeTemplate({ roleId: "architect", authorityLevel: "high" }));

    const result = validator.validate(
      makeAgent(),
      "architect",
      makeContext({ currentRoleId: "worker" })
    );

    expect(result!.code).toBe("ROLE_SWITCH_DENIED");
  });
});

// ── 6. Error shape ──────────────────────────────────────────────

describe("error shape", () => {
  it("includes all required fields in the error", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    const result = validator.validate(
      makeAgent("test-agent"),
      "target-role",
      makeContext({ hasIncompleteTasks: true })
    );

    expect(result).toMatchObject({
      code: "AGENT_BUSY",
      agentId: "test-agent",
      requestedRoleId: "target-role",
    });
    expect(result!.denialReason).toBeTruthy();
    expect(result!.timestamp).toBeTruthy();
    expect(new Date(result!.timestamp).toISOString()).toBe(result!.timestamp);
  });
});

// ── 7. All constraints pass ─────────────────────────────────────

describe("all checks pass", () => {
  it("returns null when no constraints are violated", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "coder", authorityLevel: "medium" }));
    reg.register(
      makeTemplate({ roleId: "reviewer", authorityLevel: "medium" })
    );

    const pastTime = new Date(Date.now() - 200_000).toISOString();
    const result = validator.validate(
      makeAgent(),
      "reviewer",
      makeContext({
        currentRoleId: "coder",
        hasIncompleteTasks: false,
        lastRoleSwitchAt: pastTime,
        roleSwitchCooldownMs: 60_000,
      })
    );

    expect(result).toBeNull();
  });

  it("returns null when agent has no current role (first load)", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "coder" }));

    const result = validator.validate(
      makeAgent(),
      "coder",
      makeContext({ currentRoleId: null })
    );

    expect(result).toBeNull();
  });

  it("returns null when switching from high to low authority", () => {
    const reg = new RoleRegistry(TEST_STORE_PATH);
    const validator = new RoleConstraintValidator(reg);

    reg.register(makeTemplate({ roleId: "architect", authorityLevel: "high" }));
    reg.register(makeTemplate({ roleId: "worker", authorityLevel: "low" }));

    const result = validator.validate(
      makeAgent(),
      "worker",
      makeContext({ currentRoleId: "architect" })
    );

    expect(result).toBeNull();
  });
});
