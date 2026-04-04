/**
 * Unit tests + Property tests for DatabaseChecker
 *
 * Validates: Requirements 8.1, 8.2, 8.4, 8.5
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DatabaseChecker,
  containsDangerousOperation,
  matchTablePattern,
  DANGEROUS_OPERATIONS,
} from "../permission/checkers/database-checker.js";
import type { PermissionConstraints } from "../../shared/permission/contracts.js";

const checker = new DatabaseChecker();

// ─── Unit Tests ─────────────────────────────────────────────────────────────

describe("DatabaseChecker", () => {
  describe("containsDangerousOperation", () => {
    it("detects DROP", () => {
      expect(containsDangerousOperation("DROP TABLE users")).toBe(true);
      expect(containsDangerousOperation("drop table users")).toBe(true);
    });

    it("detects TRUNCATE", () => {
      expect(containsDangerousOperation("TRUNCATE TABLE logs")).toBe(true);
    });

    it("detects ALTER", () => {
      expect(containsDangerousOperation("ALTER TABLE users ADD COLUMN age INT")).toBe(true);
    });

    it("does not flag safe operations", () => {
      expect(containsDangerousOperation("SELECT * FROM users")).toBe(false);
      expect(containsDangerousOperation("INSERT INTO users VALUES (1)")).toBe(false);
      expect(containsDangerousOperation("UPDATE users SET name='test'")).toBe(false);
    });

    it("does not flag substrings (e.g. 'BACKDROP')", () => {
      expect(containsDangerousOperation("SELECT * FROM backdrop")).toBe(false);
      expect(containsDangerousOperation("SELECT * FROM droplet")).toBe(false);
    });
  });

  describe("matchTablePattern", () => {
    it("matches exact table name", () => {
      expect(matchTablePattern("users", "users")).toBe(true);
      expect(matchTablePattern("users", "orders")).toBe(false);
    });

    it("matches wildcard pattern", () => {
      expect(matchTablePattern("public_*", "public_users")).toBe(true);
      expect(matchTablePattern("public_*", "public_orders")).toBe(true);
      expect(matchTablePattern("public_*", "private_data")).toBe(false);
    });

    it("matches * for any table", () => {
      expect(matchTablePattern("*", "anything")).toBe(true);
    });

    it("is case insensitive", () => {
      expect(matchTablePattern("Users", "users")).toBe(true);
    });
  });

  describe("checkConstraints", () => {
    it("denies dangerous SQL operations", () => {
      const constraints: PermissionConstraints = {
        tables: ["*"],
      };
      expect(checker.checkConstraints("select", "DROP TABLE users", constraints)).toBe(false);
      expect(checker.checkConstraints("select", "TRUNCATE TABLE logs", constraints)).toBe(false);
      expect(checker.checkConstraints("select", "ALTER TABLE users ADD col INT", constraints)).toBe(false);
    });

    it("allows safe table access with matching pattern", () => {
      const constraints: PermissionConstraints = {
        tables: ["public_*"],
      };
      expect(checker.checkConstraints("select", "public_users", constraints)).toBe(true);
    });

    it("denies table access not matching pattern", () => {
      const constraints: PermissionConstraints = {
        tables: ["public_*"],
      };
      expect(checker.checkConstraints("select", "private_secrets", constraints)).toBe(false);
    });

    it("allows when no table constraints", () => {
      expect(checker.checkConstraints("select", "any_table", {})).toBe(true);
    });

    it("handles database.table format", () => {
      const constraints: PermissionConstraints = {
        tables: ["users"],
      };
      expect(checker.checkConstraints("select", "mydb.users", constraints)).toBe(true);
      expect(checker.checkConstraints("select", "mydb.orders", constraints)).toBe(false);
    });
  });
});

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("DatabaseChecker Property Tests", () => {
  /**
   * **Validates: Requirements 8.4**
   *
   * Property 9: Dangerous SQL operations always denied —
   * For any string containing DROP/TRUNCATE/ALTER, DatabaseChecker denies.
   */
  describe("Property 9: Dangerous SQL always denied", () => {
    const dangerousOpArb = fc.constantFrom(...DANGEROUS_OPERATIONS);

    // Generate a SQL-like string that contains a dangerous keyword as a whole word
    const safePrefixArb = fc.constantFrom(
      "", "SELECT * FROM t; ", "INSERT INTO x; ", "-- comment\n",
    );
    const safeTableArb = fc.array(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_".split("")),
      { minLength: 1, maxLength: 10 },
    ).map((chars) => chars.join(""));
    const safeSuffixArb = fc.constantFrom(
      "", " TABLE foo", " TABLE bar CASCADE", " INDEX idx",
    );

    // Most permissive constraints
    const permissiveConstraints: PermissionConstraints = {
      tables: ["*"],
      forbiddenOperations: ["DROP", "TRUNCATE", "ALTER"],
    };

    const actionArb = fc.constantFrom(
      "select" as const, "insert" as const, "update" as const, "delete" as const,
    );

    it("any SQL containing dangerous keyword as whole word is denied", () => {
      fc.assert(
        fc.property(
          safePrefixArb,
          dangerousOpArb,
          safeSuffixArb,
          actionArb,
          (prefix, op, suffix, action) => {
            const sql = `${prefix}${op}${suffix}`;
            expect(checker.checkConstraints(action, sql, permissiveConstraints)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
