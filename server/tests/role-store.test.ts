/**
 * Unit tests for RoleStore — 角色与模板存储
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 12.1, 12.2, 12.3
 */

import { describe, expect, it, beforeEach } from "vitest";
import type {
  AgentRole,
  PermissionTemplate,
} from "../../shared/permission/contracts.js";
import { RoleStore, BUILTIN_ROLES, BUILTIN_TEMPLATES } from "../permission/role-store.js";

/* ─── In-memory Database stub ─── */

function createInMemoryDb() {
  let roles: AgentRole[] = [];
  let templates: PermissionTemplate[] = [];

  return {
    getPermissionRoles: () => roles,
    setPermissionRoles: (r: AgentRole[]) => { roles = r; },
    getPermissionTemplates: () => templates,
    setPermissionTemplates: (t: PermissionTemplate[]) => { templates = t; },
    _reset: () => { roles = []; templates = []; },
  };
}

type StubDb = ReturnType<typeof createInMemoryDb>;

describe("RoleStore", () => {
  let db: StubDb;
  let store: RoleStore;

  beforeEach(() => {
    db = createInMemoryDb();
    store = new RoleStore(db as any);
  });

  // ── Role CRUD ──────────────────────────────────────────────────────────

  describe("createRole", () => {
    it("creates a role with version 1 and timestamps", () => {
      const role = store.createRole({
        roleId: "test-role",
        roleName: "TestRole",
        description: "A test role",
        permissions: [],
      });

      expect(role.roleId).toBe("test-role");
      expect(role.version).toBe(1);
      expect(role.createdAt).toBeTruthy();
      expect(role.updatedAt).toBe(role.createdAt);
      expect(db.getPermissionRoles()).toHaveLength(1);
    });

    it("throws when creating a duplicate roleId", () => {
      store.createRole({
        roleId: "dup",
        roleName: "Dup",
        description: "",
        permissions: [],
      });

      expect(() =>
        store.createRole({
          roleId: "dup",
          roleName: "Dup2",
          description: "",
          permissions: [],
        }),
      ).toThrow('Role "dup" already exists');
    });
  });

  describe("getRole", () => {
    it("returns undefined for non-existent role", () => {
      expect(store.getRole("nope")).toBeUndefined();
    });

    it("returns the role by id", () => {
      store.createRole({
        roleId: "r1",
        roleName: "R1",
        description: "",
        permissions: [],
      });
      const found = store.getRole("r1");
      expect(found).toBeDefined();
      expect(found!.roleName).toBe("R1");
    });
  });

  describe("listRoles", () => {
    it("returns empty array initially", () => {
      expect(store.listRoles()).toEqual([]);
    });

    it("returns all created roles", () => {
      store.createRole({ roleId: "a", roleName: "A", description: "", permissions: [] });
      store.createRole({ roleId: "b", roleName: "B", description: "", permissions: [] });
      expect(store.listRoles()).toHaveLength(2);
    });
  });

  describe("updateRole", () => {
    it("increments version and updates timestamp", () => {
      store.createRole({
        roleId: "r1",
        roleName: "R1",
        description: "old",
        permissions: [],
      });

      const updated = store.updateRole("r1", { description: "new" });
      expect(updated.version).toBe(2);
      expect(updated.description).toBe("new");
      expect(updated.roleName).toBe("R1"); // unchanged field preserved
    });

    it("throws for non-existent role", () => {
      expect(() => store.updateRole("nope", { description: "x" })).toThrow(
        'Role "nope" not found',
      );
    });

    it("persists updates to the database", () => {
      store.createRole({ roleId: "r1", roleName: "R1", description: "", permissions: [] });
      store.updateRole("r1", { roleName: "Updated" });
      expect(db.getPermissionRoles()[0].roleName).toBe("Updated");
    });
  });

  // ── Builtin Roles ─────────────────────────────────────────────────────

  describe("initBuiltinRoles", () => {
    it("initializes all 5 predefined roles", () => {
      store.initBuiltinRoles();
      const roles = store.listRoles();
      expect(roles).toHaveLength(5);

      const names = roles.map((r) => r.roleName).sort();
      expect(names).toEqual(["Admin", "Executor", "NetworkCaller", "Reader", "Writer"]);
    });

    it("does not duplicate roles on repeated calls", () => {
      store.initBuiltinRoles();
      store.initBuiltinRoles();
      expect(store.listRoles()).toHaveLength(5);
    });

    it("preserves existing custom roles", () => {
      store.createRole({ roleId: "custom", roleName: "Custom", description: "", permissions: [] });
      store.initBuiltinRoles();
      expect(store.listRoles()).toHaveLength(6);
      expect(store.getRole("custom")).toBeDefined();
    });

    it("Reader role has only filesystem read permission", () => {
      store.initBuiltinRoles();
      const reader = store.getRole("reader")!;
      expect(reader.permissions).toHaveLength(1);
      expect(reader.permissions[0].resourceType).toBe("filesystem");
      expect(reader.permissions[0].action).toBe("read");
      expect(reader.permissions[0].effect).toBe("allow");
    });

    it("Writer role has filesystem read and write permissions", () => {
      store.initBuiltinRoles();
      const writer = store.getRole("writer")!;
      expect(writer.permissions).toHaveLength(2);
      const actions = writer.permissions.map((p) => p.action).sort();
      expect(actions).toEqual(["read", "write"]);
    });

    it("Admin role has permissions for all resource types", () => {
      store.initBuiltinRoles();
      const admin = store.getRole("admin")!;
      const resourceTypes = new Set(admin.permissions.map((p) => p.resourceType));
      expect(resourceTypes).toContain("filesystem");
      expect(resourceTypes).toContain("network");
      expect(resourceTypes).toContain("api");
      expect(resourceTypes).toContain("database");
      expect(resourceTypes).toContain("mcp_tool");
    });

    it("Executor role includes /tmp path pattern", () => {
      store.initBuiltinRoles();
      const executor = store.getRole("executor")!;
      const allPaths = executor.permissions.flatMap((p) => p.constraints.pathPatterns ?? []);
      expect(allPaths).toContain("/tmp/**");
    });

    it("NetworkCaller role has domain whitelist constraints", () => {
      store.initBuiltinRoles();
      const nc = store.getRole("network-caller")!;
      for (const perm of nc.permissions) {
        expect(perm.constraints.domainPatterns).toBeDefined();
        expect(perm.constraints.domainPatterns!.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Template CRUD ─────────────────────────────────────────────────────

  describe("createTemplate", () => {
    it("creates a template with version 1", () => {
      const tpl = store.createTemplate({
        templateId: "tpl-test",
        templateName: "Test",
        description: "test template",
        targetRole: "TestRole",
        permissions: [],
      });

      expect(tpl.version).toBe(1);
      expect(tpl.createdAt).toBeTruthy();
      expect(db.getPermissionTemplates()).toHaveLength(1);
    });

    it("throws on duplicate templateId", () => {
      store.createTemplate({
        templateId: "tpl-dup",
        templateName: "Dup",
        description: "",
        targetRole: "X",
        permissions: [],
      });

      expect(() =>
        store.createTemplate({
          templateId: "tpl-dup",
          templateName: "Dup2",
          description: "",
          targetRole: "Y",
          permissions: [],
        }),
      ).toThrow('Template "tpl-dup" already exists');
    });
  });

  describe("getTemplate", () => {
    it("returns undefined for non-existent template", () => {
      expect(store.getTemplate("nope")).toBeUndefined();
    });

    it("returns the template by id", () => {
      store.createTemplate({
        templateId: "tpl-a",
        templateName: "A",
        description: "",
        targetRole: "RoleA",
        permissions: [],
      });
      expect(store.getTemplate("tpl-a")!.templateName).toBe("A");
    });
  });

  describe("listTemplates", () => {
    it("returns all templates", () => {
      store.createTemplate({ templateId: "t1", templateName: "T1", description: "", targetRole: "R1", permissions: [] });
      store.createTemplate({ templateId: "t2", templateName: "T2", description: "", targetRole: "R2", permissions: [] });
      expect(store.listTemplates()).toHaveLength(2);
    });
  });

  describe("getTemplateByRole", () => {
    it("returns undefined when no template matches", () => {
      expect(store.getTemplateByRole("Unknown")).toBeUndefined();
    });

    it("returns the template matching the target role", () => {
      store.createTemplate({
        templateId: "tpl-x",
        templateName: "X",
        description: "",
        targetRole: "MyRole",
        permissions: [],
      });
      const found = store.getTemplateByRole("MyRole");
      expect(found).toBeDefined();
      expect(found!.templateId).toBe("tpl-x");
    });
  });

  // ── Builtin Templates ─────────────────────────────────────────────────

  describe("initBuiltinTemplates", () => {
    it("initializes all 5 predefined templates", () => {
      store.initBuiltinTemplates();
      const templates = store.listTemplates();
      expect(templates).toHaveLength(5);

      const names = templates.map((t) => t.templateName).sort();
      expect(names).toEqual(["ApiCaller", "CodeExecutor", "DataAnalyzer", "DatabaseReader", "FileProcessor"]);
    });

    it("does not duplicate templates on repeated calls", () => {
      store.initBuiltinTemplates();
      store.initBuiltinTemplates();
      expect(store.listTemplates()).toHaveLength(5);
    });

    it("CodeExecutor template denies network access", () => {
      store.initBuiltinTemplates();
      const tpl = store.getTemplateByRole("CodeExecutor")!;
      const networkDenies = tpl.permissions.filter(
        (p) => p.resourceType === "network" && p.effect === "deny",
      );
      expect(networkDenies.length).toBeGreaterThanOrEqual(1);
    });

    it("DataAnalyzer template allows database select", () => {
      store.initBuiltinTemplates();
      const tpl = store.getTemplateByRole("DataAnalyzer")!;
      const dbSelect = tpl.permissions.find(
        (p) => p.resourceType === "database" && p.action === "select" && p.effect === "allow",
      );
      expect(dbSelect).toBeDefined();
    });

    it("FileProcessor template denies network access", () => {
      store.initBuiltinTemplates();
      const tpl = store.getTemplateByRole("FileProcessor")!;
      const networkDenies = tpl.permissions.filter(
        (p) => p.resourceType === "network" && p.effect === "deny",
      );
      expect(networkDenies.length).toBeGreaterThanOrEqual(1);
    });

    it("ApiCaller template allows API call", () => {
      store.initBuiltinTemplates();
      const tpl = store.getTemplateByRole("ApiCaller")!;
      const apiCall = tpl.permissions.find(
        (p) => p.resourceType === "api" && p.action === "call" && p.effect === "allow",
      );
      expect(apiCall).toBeDefined();
    });

    it("DatabaseReader template denies database write operations", () => {
      store.initBuiltinTemplates();
      const tpl = store.getTemplateByRole("DatabaseReader")!;
      const dbDenies = tpl.permissions.filter(
        (p) => p.resourceType === "database" && p.effect === "deny",
      );
      expect(dbDenies.length).toBeGreaterThanOrEqual(1);
      const deniedActions = dbDenies.map((p) => p.action).sort();
      expect(deniedActions).toContain("insert");
      expect(deniedActions).toContain("update");
      expect(deniedActions).toContain("delete");
    });
  });

  // ── Builtin constants exported ────────────────────────────────────────

  describe("exported constants", () => {
    it("BUILTIN_ROLES has 5 entries", () => {
      expect(BUILTIN_ROLES).toHaveLength(5);
    });

    it("BUILTIN_TEMPLATES has 5 entries", () => {
      expect(BUILTIN_TEMPLATES).toHaveLength(5);
    });
  });
});
