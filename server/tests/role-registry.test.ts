/**
 * RoleRegistry 单元测试
 *
 * 覆盖范围：
 * - 重复 roleId 注册（应覆盖并记录 modified 日志）
 * - 不存在的 roleId 查询（get 返回 undefined，resolve 抛出错误）
 * - 循环继承检测（resolve 应抛出错误）
 *
 * _Requirements: 1.2, 1.3_
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { RoleTemplate } from "../../shared/role-schema.js";
import { RoleRegistry } from "../core/role-registry.js";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(
  __test_dirname,
  "../../data/__test_role_registry_unit__"
);
const TEST_STORE_PATH = resolve(TEST_STORE_DIR, "role-templates.json");

// ── Helper ───────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<RoleTemplate> = {}): RoleTemplate {
  return {
    roleId: "test-role",
    roleName: "Test Role",
    responsibilityPrompt: "You are a test role.",
    requiredSkillIds: ["skill-a"],
    mcpIds: ["mcp-a"],
    defaultModelConfig: { model: "gpt-4", temperature: 0.7, maxTokens: 4096 },
    authorityLevel: "medium",
    source: "predefined",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Cleanup ──────────────────────────────────────────────────────

afterEach(() => {
  if (existsSync(TEST_STORE_DIR)) {
    rmSync(TEST_STORE_DIR, { recursive: true, force: true });
  }
});

// ── 1. 重复 roleId 注册 ─────────────────────────────────────────

describe("重复 roleId 注册", () => {
  it("should overwrite the existing template when registering with the same roleId", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);
    const original = makeTemplate({ roleName: "Original" });
    const updated = makeTemplate({
      roleName: "Updated",
      responsibilityPrompt: "Updated prompt.",
    });

    registry.register(original);
    registry.register(updated);

    const retrieved = registry.get("test-role");
    expect(retrieved).toBeDefined();
    expect(retrieved!.roleName).toBe("Updated");
    expect(retrieved!.responsibilityPrompt).toBe("Updated prompt.");
  });

  it("should not create a duplicate entry in list() after re-registration", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);
    const original = makeTemplate();
    const updated = makeTemplate({ roleName: "V2" });

    registry.register(original);
    registry.register(updated);

    const all = registry.list();
    const matching = all.filter(t => t.roleId === "test-role");
    expect(matching).toHaveLength(1);
    expect(matching[0].roleName).toBe("V2");
  });

  it('should record a "modified" change log entry on re-registration', () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);
    const original = makeTemplate();
    const updated = makeTemplate({ roleName: "V2" });

    registry.register(original);
    registry.register(updated);

    const log = registry.getChangeLog("test-role");
    expect(log).toHaveLength(2);
    expect(log[0].action).toBe("created");
    expect(log[1].action).toBe("modified");
    expect(log[1].diff).toHaveProperty("roleName");
    expect(log[1].diff["roleName"]).toEqual({ old: "Test Role", new: "V2" });
  });
});

// ── 2. 不存在的 roleId 查询 ─────────────────────────────────────

describe("不存在的 roleId 查询", () => {
  it("get() should return undefined for a non-existent roleId", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);

    expect(registry.get("non-existent")).toBeUndefined();
  });

  it("get() should return undefined after unregistering a roleId", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);
    registry.register(makeTemplate());
    registry.unregister("test-role");

    expect(registry.get("test-role")).toBeUndefined();
  });

  it("resolve() should throw an error for a non-existent roleId", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);

    expect(() => registry.resolve("non-existent")).toThrowError(
      "[RoleRegistry] Role not found: non-existent"
    );
  });

  it("resolve() should throw when a child extends a non-existent parent", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);
    const child = makeTemplate({ roleId: "child", extends: "missing-parent" });
    registry.register(child);

    expect(() => registry.resolve("child")).toThrowError(
      "[RoleRegistry] Role not found: missing-parent"
    );
  });
});

// ── 3. 循环继承检测 ─────────────────────────────────────────────

describe("循环继承检测", () => {
  it("should throw on direct self-reference (A extends A)", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);
    const selfRef = makeTemplate({ roleId: "role-a", extends: "role-a" });
    registry.register(selfRef);

    expect(() => registry.resolve("role-a")).toThrowError(
      /Circular inheritance detected/
    );
  });

  it("should throw on two-node cycle (A extends B, B extends A)", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);
    const a = makeTemplate({ roleId: "role-a", extends: "role-b" });
    const b = makeTemplate({ roleId: "role-b", extends: "role-a" });
    registry.register(a);
    registry.register(b);

    expect(() => registry.resolve("role-a")).toThrowError(
      /Circular inheritance detected/
    );
  });

  it("should throw on three-node cycle (A → B → C → A)", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);
    const a = makeTemplate({ roleId: "role-a", extends: "role-b" });
    const b = makeTemplate({ roleId: "role-b", extends: "role-c" });
    const c = makeTemplate({ roleId: "role-c", extends: "role-a" });
    registry.register(a);
    registry.register(b);
    registry.register(c);

    expect(() => registry.resolve("role-a")).toThrowError(
      /Circular inheritance detected/
    );
  });

  it("should NOT throw for a valid linear inheritance chain (A → B → C, no cycle)", () => {
    const registry = new RoleRegistry(TEST_STORE_PATH);
    const grandparent = makeTemplate({
      roleId: "gp",
      extends: undefined,
      responsibilityPrompt: "GP prompt",
      requiredSkillIds: ["gp-skill"],
    });
    const parent = makeTemplate({
      roleId: "parent",
      extends: "gp",
      responsibilityPrompt: "Parent prompt",
      requiredSkillIds: ["parent-skill"],
    });
    const child = makeTemplate({
      roleId: "child",
      extends: "parent",
      responsibilityPrompt: "Child prompt",
      requiredSkillIds: ["child-skill"],
    });
    registry.register(grandparent);
    registry.register(parent);
    registry.register(child);

    const resolved = registry.resolve("child");
    expect(resolved.responsibilityPrompt).toBe(
      "GP prompt\n\nParent prompt\n\nChild prompt"
    );
    expect(new Set(resolved.requiredSkillIds)).toEqual(
      new Set(["gp-skill", "parent-skill", "child-skill"])
    );
  });
});
