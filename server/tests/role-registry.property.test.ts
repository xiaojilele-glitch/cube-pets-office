// Feature: dynamic-role-system, Property 1: 角色模板注册/查询往返一致性
/**
 * Property 1: 角色模板注册/查询往返一致性
 *
 * 对于任意合法的 RoleTemplate，注册到 RoleRegistry 后：
 * - 通过 RoleRegistry.get(roleId) 查询应返回与注册时等价的模板
 * - 通过 RoleRegistry.list() 查询应包含该模板
 *
 * **Validates: Requirements 1.2**
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(
  __test_dirname,
  "../../data/__test_role_registry_prop__"
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
  model: fc.string({ minLength: 1, maxLength: 30 }),
  temperature: fc.double({ min: 0, max: 2, noNaN: true }),
  maxTokens: fc.integer({ min: 1, max: 128000 }),
});

/** Generate a valid ISO date string from a safe integer timestamp range */
const arbISODate: fc.Arbitrary<string> = fc
  .integer({ min: 1577836800000, max: 1924905600000 }) // 2020-01-01 to 2030-12-31
  .map(ts => new Date(ts).toISOString());

/** Role ID: alphanumeric + hyphens, non-empty, starts with a letter */
const arbRoleId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,39}$/)
  .filter(s => s.length >= 1);

const arbStringList: fc.Arbitrary<string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 20 }),
  { minLength: 0, maxLength: 10 }
);

const arbRoleTemplate: fc.Arbitrary<RoleTemplate> = fc.record({
  roleId: arbRoleId,
  roleName: fc.string({ minLength: 1, maxLength: 30 }),
  responsibilityPrompt: fc.string({ minLength: 1, maxLength: 200 }),
  requiredSkillIds: arbStringList,
  mcpIds: arbStringList,
  defaultModelConfig: arbModelConfig,
  authorityLevel: arbAuthorityLevel,
  source: arbRoleSource,
  createdAt: arbISODate,
  updatedAt: arbISODate,
});

// ── Tests ────────────────────────────────────────────────────────

describe("RoleRegistry Property 1: 角色模板注册/查询往返一致性", () => {
  let registry: RoleRegistry;

  beforeEach(() => {
    registry = new RoleRegistry(TEST_STORE_PATH);
  });

  afterEach(() => {
    if (existsSync(TEST_STORE_DIR)) {
      rmSync(TEST_STORE_DIR, { recursive: true, force: true });
    }
  });

  // **Validates: Requirements 1.2**
  it("get(roleId) returns the registered template with all fields equivalent", () => {
    fc.assert(
      fc.property(arbRoleTemplate, template => {
        const reg = new RoleRegistry(TEST_STORE_PATH);

        reg.register(template);
        const retrieved = reg.get(template.roleId);

        expect(retrieved).toBeDefined();
        expect(retrieved!.roleId).toBe(template.roleId);
        expect(retrieved!.roleName).toBe(template.roleName);
        expect(retrieved!.responsibilityPrompt).toBe(
          template.responsibilityPrompt
        );
        expect(retrieved!.requiredSkillIds).toEqual(template.requiredSkillIds);
        expect(retrieved!.mcpIds).toEqual(template.mcpIds);
        expect(retrieved!.defaultModelConfig).toEqual(
          template.defaultModelConfig
        );
        expect(retrieved!.authorityLevel).toBe(template.authorityLevel);
        expect(retrieved!.source).toBe(template.source);
        expect(retrieved!.createdAt).toBe(template.createdAt);
        expect(retrieved!.updatedAt).toBe(template.updatedAt);

        // Cleanup persistence for next iteration
        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.2**
  it("list() includes the registered template", () => {
    fc.assert(
      fc.property(arbRoleTemplate, template => {
        const reg = new RoleRegistry(TEST_STORE_PATH);

        reg.register(template);
        const all = reg.list();

        const found = all.find(t => t.roleId === template.roleId);
        expect(found).toBeDefined();
        expect(found!.roleName).toBe(template.roleName);
        expect(found!.responsibilityPrompt).toBe(template.responsibilityPrompt);

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.2**
  it("registering multiple templates with unique roleIds preserves all in list()", () => {
    fc.assert(
      fc.property(
        fc
          .array(arbRoleTemplate, { minLength: 1, maxLength: 20 })
          .map(templates => {
            // Deduplicate by roleId
            const seen = new Set<string>();
            return templates.filter(t => {
              if (seen.has(t.roleId)) return false;
              seen.add(t.roleId);
              return true;
            });
          })
          .filter(arr => arr.length > 0),
        templates => {
          const reg = new RoleRegistry(TEST_STORE_PATH);

          for (const t of templates) {
            reg.register(t);
          }

          const all = reg.list();
          expect(all).toHaveLength(templates.length);

          for (const t of templates) {
            const found = reg.get(t.roleId);
            expect(found).toBeDefined();
            expect(found!.roleId).toBe(t.roleId);
            expect(found!.roleName).toBe(t.roleName);
          }

          if (existsSync(TEST_STORE_DIR)) {
            rmSync(TEST_STORE_DIR, { recursive: true, force: true });
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: dynamic-role-system, Property 2: 角色继承解析正确性
/**
 * Property 2: 角色继承解析正确性
 *
 * 对于任意声明了 `extends: parentRoleId` 的子角色模板，
 * `RoleRegistry.resolve(childRoleId)` 返回的模板应满足：
 * - `requiredSkillIds` 是父子技能集的并集
 * - `mcpIds` 是父子 MCP 集的并集
 * - `responsibilityPrompt` 包含父角色的 prompt 内容
 * - 子角色的覆写字段（authorityLevel、defaultModelConfig）以子角色为准
 *
 * **Validates: Requirements 1.3**
 */

describe("RoleRegistry Property 2: 角色继承解析正确性", () => {
  /** Generate a parent-child template pair with distinct roleIds */
  const arbParentChildPair: fc.Arbitrary<{
    parent: RoleTemplate;
    child: RoleTemplate;
  }> = fc
    .tuple(arbRoleId, arbRoleId)
    .filter(([a, b]) => a !== b)
    .chain(([parentId, childId]) =>
      fc
        .tuple(arbRoleTemplate, arbRoleTemplate)
        .map(([parentBase, childBase]) => ({
          parent: {
            ...parentBase,
            roleId: parentId,
            extends: undefined, // parent has no parent
          },
          child: {
            ...childBase,
            roleId: childId,
            extends: parentId,
          },
        }))
    );

  afterEach(() => {
    if (existsSync(TEST_STORE_DIR)) {
      rmSync(TEST_STORE_DIR, { recursive: true, force: true });
    }
  });

  // **Validates: Requirements 1.3**
  it("resolve() merges requiredSkillIds as union of parent and child", () => {
    fc.assert(
      fc.property(arbParentChildPair, ({ parent, child }) => {
        const reg = new RoleRegistry(TEST_STORE_PATH);
        reg.register(parent);
        reg.register(child);

        const resolved = reg.resolve(child.roleId);

        const expectedSkills = new Set([
          ...parent.requiredSkillIds,
          ...child.requiredSkillIds,
        ]);
        expect(new Set(resolved.requiredSkillIds)).toEqual(expectedSkills);

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.3**
  it("resolve() merges mcpIds as union of parent and child", () => {
    fc.assert(
      fc.property(arbParentChildPair, ({ parent, child }) => {
        const reg = new RoleRegistry(TEST_STORE_PATH);
        reg.register(parent);
        reg.register(child);

        const resolved = reg.resolve(child.roleId);

        const expectedMcps = new Set([...parent.mcpIds, ...child.mcpIds]);
        expect(new Set(resolved.mcpIds)).toEqual(expectedMcps);

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.3**
  it("resolve() responsibilityPrompt contains parent prompt content", () => {
    fc.assert(
      fc.property(arbParentChildPair, ({ parent, child }) => {
        const reg = new RoleRegistry(TEST_STORE_PATH);
        reg.register(parent);
        reg.register(child);

        const resolved = reg.resolve(child.roleId);

        // The resolved prompt must contain the parent's prompt
        expect(resolved.responsibilityPrompt).toContain(
          parent.responsibilityPrompt
        );
        // It must also contain the child's prompt
        expect(resolved.responsibilityPrompt).toContain(
          child.responsibilityPrompt
        );
        // Per design: parent prompt + "\n\n" + child prompt
        expect(resolved.responsibilityPrompt).toBe(
          parent.responsibilityPrompt + "\n\n" + child.responsibilityPrompt
        );

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.3**
  it("resolve() uses child authorityLevel and defaultModelConfig (override fields)", () => {
    fc.assert(
      fc.property(arbParentChildPair, ({ parent, child }) => {
        const reg = new RoleRegistry(TEST_STORE_PATH);
        reg.register(parent);
        reg.register(child);

        const resolved = reg.resolve(child.roleId);

        // Override fields must use child's values
        expect(resolved.authorityLevel).toBe(child.authorityLevel);
        expect(resolved.defaultModelConfig).toEqual(child.defaultModelConfig);

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.3**
  it("resolve() on a template without extends returns the template unchanged", () => {
    fc.assert(
      fc.property(arbRoleTemplate, template => {
        // Ensure no extends field
        const noExtends = { ...template, extends: undefined };
        const reg = new RoleRegistry(TEST_STORE_PATH);
        reg.register(noExtends);

        const resolved = reg.resolve(noExtends.roleId);

        expect(resolved.requiredSkillIds).toEqual(noExtends.requiredSkillIds);
        expect(resolved.mcpIds).toEqual(noExtends.mcpIds);
        expect(resolved.responsibilityPrompt).toBe(
          noExtends.responsibilityPrompt
        );
        expect(resolved.authorityLevel).toBe(noExtends.authorityLevel);
        expect(resolved.defaultModelConfig).toEqual(
          noExtends.defaultModelConfig
        );

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.3** — multi-level inheritance (grandparent → parent → child)
  it("resolve() handles multi-level inheritance correctly", () => {
    const arbThreeIds = fc
      .tuple(arbRoleId, arbRoleId, arbRoleId)
      .filter(([a, b, c]) => a !== b && b !== c && a !== c);

    const arbThreeGen = arbThreeIds.chain(([gpId, pId, cId]) =>
      fc
        .tuple(arbRoleTemplate, arbRoleTemplate, arbRoleTemplate)
        .map(([gp, p, c]) => ({
          grandparent: { ...gp, roleId: gpId, extends: undefined },
          parent: { ...p, roleId: pId, extends: gpId },
          child: { ...c, roleId: cId, extends: pId },
        }))
    );

    fc.assert(
      fc.property(arbThreeGen, ({ grandparent, parent, child }) => {
        const reg = new RoleRegistry(TEST_STORE_PATH);
        reg.register(grandparent);
        reg.register(parent);
        reg.register(child);

        const resolved = reg.resolve(child.roleId);

        // Skills: union of all three levels
        const expectedSkills = new Set([
          ...grandparent.requiredSkillIds,
          ...parent.requiredSkillIds,
          ...child.requiredSkillIds,
        ]);
        expect(new Set(resolved.requiredSkillIds)).toEqual(expectedSkills);

        // MCPs: union of all three levels
        const expectedMcps = new Set([
          ...grandparent.mcpIds,
          ...parent.mcpIds,
          ...child.mcpIds,
        ]);
        expect(new Set(resolved.mcpIds)).toEqual(expectedMcps);

        // Prompt: grandparent + "\n\n" + parent + "\n\n" + child
        expect(resolved.responsibilityPrompt).toContain(
          grandparent.responsibilityPrompt
        );
        expect(resolved.responsibilityPrompt).toContain(
          parent.responsibilityPrompt
        );
        expect(resolved.responsibilityPrompt).toContain(
          child.responsibilityPrompt
        );

        // Override fields: child wins
        expect(resolved.authorityLevel).toBe(child.authorityLevel);
        expect(resolved.defaultModelConfig).toEqual(child.defaultModelConfig);

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: dynamic-role-system, Property 3: 角色模板变更日志完整性
/**
 * Property 3: 角色模板变更日志完整性
 *
 * 对于任意角色模板的创建、修改或废弃操作，RoleRegistry 的变更日志应新增一条
 * 包含 changedBy、changedAt 和 diff 的记录；且 LLM 生成的模板 source 为 "generated"，
 * 人工预定义的模板 source 为 "predefined"。
 *
 * **Validates: Requirements 1.4, 1.5**
 */

describe("RoleRegistry Property 3: 角色模板变更日志完整性", () => {
  afterEach(() => {
    if (existsSync(TEST_STORE_DIR)) {
      rmSync(TEST_STORE_DIR, { recursive: true, force: true });
    }
  });

  // **Validates: Requirements 1.5**
  it('register() with source "created" appends a change log entry with changedBy, changedAt, and diff', () => {
    fc.assert(
      fc.property(arbRoleTemplate, template => {
        const reg = new RoleRegistry(TEST_STORE_PATH);

        const logBefore = reg.getChangeLog().length;
        reg.register(template);
        const logAfter = reg.getChangeLog();

        // A new entry should have been appended
        expect(logAfter.length).toBe(logBefore + 1);

        const entry = logAfter[logAfter.length - 1];
        expect(entry.roleId).toBe(template.roleId);
        expect(entry.action).toBe("created");
        // changedBy must be present (non-empty string)
        expect(typeof entry.changedBy).toBe("string");
        expect(entry.changedBy.length).toBeGreaterThan(0);
        // changedAt must be a valid ISO date string
        expect(typeof entry.changedAt).toBe("string");
        expect(Number.isNaN(Date.parse(entry.changedAt))).toBe(false);
        // diff must be an object
        expect(typeof entry.diff).toBe("object");
        expect(entry.diff).not.toBeNull();

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.5**
  it('modifying a template appends a "modified" change log entry with diff of changed fields', () => {
    fc.assert(
      fc.property(
        arbRoleTemplate,
        fc.string({ minLength: 1, maxLength: 200 }),
        (template, newPrompt) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);

          // Register original
          reg.register(template);
          const logAfterCreate = reg.getChangeLog().length;

          // Modify the template
          const modified: RoleTemplate = {
            ...template,
            responsibilityPrompt: newPrompt,
            updatedAt: new Date().toISOString(),
          };
          reg.register(modified);

          const logAfterModify = reg.getChangeLog();
          expect(logAfterModify.length).toBe(logAfterCreate + 1);

          const entry = logAfterModify[logAfterModify.length - 1];
          expect(entry.roleId).toBe(template.roleId);
          expect(entry.action).toBe("modified");
          expect(typeof entry.changedBy).toBe("string");
          expect(entry.changedBy.length).toBeGreaterThan(0);
          expect(typeof entry.changedAt).toBe("string");
          expect(Number.isNaN(Date.parse(entry.changedAt))).toBe(false);
          expect(typeof entry.diff).toBe("object");
          expect(entry.diff).not.toBeNull();

          // If the prompt actually changed, diff should contain the responsibilityPrompt field
          if (newPrompt !== template.responsibilityPrompt) {
            expect(entry.diff).toHaveProperty("responsibilityPrompt");
            expect(entry.diff["responsibilityPrompt"].old).toBe(
              template.responsibilityPrompt
            );
            expect(entry.diff["responsibilityPrompt"].new).toBe(newPrompt);
          }

          if (existsSync(TEST_STORE_DIR)) {
            rmSync(TEST_STORE_DIR, { recursive: true, force: true });
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.5**
  it('unregister() appends a "deprecated" change log entry with changedBy, changedAt, and diff', () => {
    fc.assert(
      fc.property(arbRoleTemplate, template => {
        const reg = new RoleRegistry(TEST_STORE_PATH);

        reg.register(template);
        const logAfterCreate = reg.getChangeLog().length;

        reg.unregister(template.roleId);
        const logAfterDeprecate = reg.getChangeLog();

        expect(logAfterDeprecate.length).toBe(logAfterCreate + 1);

        const entry = logAfterDeprecate[logAfterDeprecate.length - 1];
        expect(entry.roleId).toBe(template.roleId);
        expect(entry.action).toBe("deprecated");
        expect(typeof entry.changedBy).toBe("string");
        expect(entry.changedBy.length).toBeGreaterThan(0);
        expect(typeof entry.changedAt).toBe("string");
        expect(Number.isNaN(Date.parse(entry.changedAt))).toBe(false);
        expect(typeof entry.diff).toBe("object");
        expect(entry.diff).not.toBeNull();

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.4**
  it('LLM-generated templates have source "generated" and predefined templates have source "predefined"', () => {
    fc.assert(
      fc.property(arbRoleTemplate, arbRoleSource, (baseTemplate, source) => {
        const reg = new RoleRegistry(TEST_STORE_PATH);

        const template: RoleTemplate = { ...baseTemplate, source };
        reg.register(template);

        const retrieved = reg.get(template.roleId);
        expect(retrieved).toBeDefined();

        if (source === "generated") {
          expect(retrieved!.source).toBe("generated");
        } else {
          expect(retrieved!.source).toBe("predefined");
        }

        // The change log entry should also correspond to this template
        const log = reg.getChangeLog(template.roleId);
        expect(log.length).toBeGreaterThanOrEqual(1);

        if (existsSync(TEST_STORE_DIR)) {
          rmSync(TEST_STORE_DIR, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.4, 1.5**
  it("a sequence of create → modify → deprecate produces exactly 3 log entries with correct actions", () => {
    fc.assert(
      fc.property(
        arbRoleTemplate,
        fc.string({ minLength: 1, maxLength: 30 }),
        (template, newName) => {
          const reg = new RoleRegistry(TEST_STORE_PATH);

          // Step 1: Create
          reg.register(template);

          // Step 2: Modify
          const modified: RoleTemplate = {
            ...template,
            roleName: newName,
            updatedAt: new Date().toISOString(),
          };
          reg.register(modified);

          // Step 3: Deprecate
          reg.unregister(template.roleId);

          const log = reg.getChangeLog(template.roleId);
          expect(log.length).toBe(3);

          expect(log[0].action).toBe("created");
          expect(log[1].action).toBe("modified");
          expect(log[2].action).toBe("deprecated");

          // All entries must have required fields
          for (const entry of log) {
            expect(entry.roleId).toBe(template.roleId);
            expect(typeof entry.changedBy).toBe("string");
            expect(entry.changedBy.length).toBeGreaterThan(0);
            expect(typeof entry.changedAt).toBe("string");
            expect(Number.isNaN(Date.parse(entry.changedAt))).toBe(false);
            expect(typeof entry.diff).toBe("object");
            expect(entry.diff).not.toBeNull();
          }

          if (existsSync(TEST_STORE_DIR)) {
            rmSync(TEST_STORE_DIR, { recursive: true, force: true });
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
