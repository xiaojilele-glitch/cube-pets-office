import { describe, expect, it, beforeEach } from "vitest";

import type {
  Permission,
  UserRole,
} from "../../../shared/nl-command/contracts.js";
import { PermissionGuard } from "../../core/nl-command/permission-guard.js";
import type { PermissionOverride } from "../../core/nl-command/permission-guard.js";

describe("PermissionGuard", () => {
  let guard: PermissionGuard;

  beforeEach(() => {
    guard = new PermissionGuard();
  });

  // ─── Default role-permission mappings ───

  describe("default role permissions", () => {
    it("admin should have all permissions", () => {
      const perms = guard.getPermissions("admin");
      expect(perms).toEqual(
        expect.arrayContaining([
          "view",
          "create",
          "edit",
          "approve",
          "execute",
          "cancel",
        ])
      );
      expect(perms).toHaveLength(6);
    });

    it("manager should have view, create, edit, approve", () => {
      const perms = guard.getPermissions("manager");
      expect(perms).toEqual(
        expect.arrayContaining(["view", "create", "edit", "approve"])
      );
      expect(perms).toHaveLength(4);
      expect(perms).not.toContain("execute");
      expect(perms).not.toContain("cancel");
    });

    it("operator should have view, create, edit, execute", () => {
      const perms = guard.getPermissions("operator");
      expect(perms).toEqual(
        expect.arrayContaining(["view", "create", "edit", "execute"])
      );
      expect(perms).toHaveLength(4);
      expect(perms).not.toContain("approve");
      expect(perms).not.toContain("cancel");
    });

    it("viewer should have view only", () => {
      const perms = guard.getPermissions("viewer");
      expect(perms).toEqual(["view"]);
    });
  });

  // ─── checkPermission() ───

  describe("checkPermission()", () => {
    it("should return true when role has the permission", () => {
      expect(guard.checkPermission("u1", "admin", "cancel")).toBe(true);
      expect(guard.checkPermission("u1", "manager", "approve")).toBe(true);
      expect(guard.checkPermission("u1", "operator", "execute")).toBe(true);
      expect(guard.checkPermission("u1", "viewer", "view")).toBe(true);
    });

    it("should return false when role lacks the permission", () => {
      expect(guard.checkPermission("u1", "viewer", "create")).toBe(false);
      expect(guard.checkPermission("u1", "manager", "execute")).toBe(false);
      expect(guard.checkPermission("u1", "operator", "approve")).toBe(false);
    });
  });

  // ─── Entity-level overrides ───

  describe("entity-level overrides", () => {
    it("should grant additional permissions via override", () => {
      guard.setOverride("u1", { grant: ["execute"], deny: [] });
      expect(guard.checkPermission("u1", "viewer", "execute")).toBe(true);
      // Original permissions still intact
      expect(guard.checkPermission("u1", "viewer", "view")).toBe(true);
    });

    it("should deny permissions via override", () => {
      guard.setOverride("u1", { grant: [], deny: ["edit"] });
      expect(guard.checkPermission("u1", "admin", "edit")).toBe(false);
      // Other permissions unaffected
      expect(guard.checkPermission("u1", "admin", "view")).toBe(true);
    });

    it("should scope overrides to entityType", () => {
      guard.setOverride("u1", { grant: ["cancel"], deny: [] }, "mission");

      // With matching entityType → granted
      expect(guard.checkPermission("u1", "viewer", "cancel", "mission")).toBe(
        true
      );
      // Without entityType → not granted (override doesn't apply)
      expect(guard.checkPermission("u1", "viewer", "cancel")).toBe(false);
    });

    it("should scope overrides to entityType + entityId", () => {
      guard.setOverride(
        "u1",
        { grant: ["approve"], deny: [] },
        "task",
        "task-42"
      );

      // Exact match → granted
      expect(
        guard.checkPermission("u1", "viewer", "approve", "task", "task-42")
      ).toBe(true);
      // Same entityType, different entityId → not granted
      expect(
        guard.checkPermission("u1", "viewer", "approve", "task", "task-99")
      ).toBe(false);
      // No entity context → not granted
      expect(guard.checkPermission("u1", "viewer", "approve")).toBe(false);
    });

    it("should apply overrides in priority order (global < entityType < entityType+entityId)", () => {
      // Global: grant execute
      guard.setOverride("u1", { grant: ["execute"], deny: [] });
      // entityType mission: deny execute
      guard.setOverride("u1", { grant: [], deny: ["execute"] }, "mission");
      // Specific mission-1: grant execute back
      guard.setOverride(
        "u1",
        { grant: ["execute"], deny: [] },
        "mission",
        "mission-1"
      );

      // viewer + global grant → true
      expect(guard.checkPermission("u1", "viewer", "execute")).toBe(true);
      // viewer + global grant + mission deny → false
      expect(guard.checkPermission("u1", "viewer", "execute", "mission")).toBe(
        false
      );
      // viewer + global grant + mission deny + mission-1 grant → true
      expect(
        guard.checkPermission("u1", "viewer", "execute", "mission", "mission-1")
      ).toBe(true);
    });

    it("should not affect other users", () => {
      guard.setOverride("u1", { grant: ["cancel"], deny: [] });
      expect(guard.checkPermission("u1", "viewer", "cancel")).toBe(true);
      expect(guard.checkPermission("u2", "viewer", "cancel")).toBe(false);
    });
  });

  // ─── Override management ───

  describe("override management", () => {
    it("removeOverride should remove the override", () => {
      guard.setOverride("u1", { grant: ["cancel"], deny: [] });
      expect(guard.checkPermission("u1", "viewer", "cancel")).toBe(true);

      guard.removeOverride("u1");
      expect(guard.checkPermission("u1", "viewer", "cancel")).toBe(false);
    });

    it("listOverrides should return all overrides", () => {
      guard.setOverride("u1", { grant: ["cancel"], deny: [] });
      guard.setOverride("u2", { grant: [], deny: ["view"] }, "mission");

      const overrides = guard.listOverrides();
      expect(overrides.size).toBe(2);
    });
  });

  // ─── getPermissions with userId ───

  describe("getPermissions() with userId and overrides", () => {
    it("should return effective permissions including overrides", () => {
      guard.setOverride("u1", { grant: ["execute", "cancel"], deny: [] });
      const perms = guard.getPermissions("viewer", undefined, undefined, "u1");
      expect(perms).toEqual(
        expect.arrayContaining(["view", "execute", "cancel"])
      );
    });

    it("should return base role permissions when no userId provided", () => {
      guard.setOverride("u1", { grant: ["execute"], deny: [] });
      const perms = guard.getPermissions("viewer");
      expect(perms).toEqual(["view"]);
    });
  });
});
