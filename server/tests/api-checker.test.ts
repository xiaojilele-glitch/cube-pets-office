/**
 * Unit tests for ApiChecker
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.5
 */

import { describe, expect, it } from "vitest";
import { ApiChecker } from "../permission/checkers/api-checker.js";
import type { PermissionConstraints } from "../../shared/permission/contracts.js";

const checker = new ApiChecker();

describe("ApiChecker", () => {
  describe("endpoint path matching", () => {
    it("allows matching endpoint pattern", () => {
      const constraints: PermissionConstraints = {
        endpoints: ["/api/v1/users/*"],
      };
      expect(checker.checkConstraints("call", "GET /api/v1/users/123", constraints)).toBe(true);
    });

    it("denies non-matching endpoint", () => {
      const constraints: PermissionConstraints = {
        endpoints: ["/api/v1/users/*"],
      };
      expect(checker.checkConstraints("call", "GET /api/v1/admin/settings", constraints)).toBe(false);
    });

    it("supports ** for deep path matching", () => {
      const constraints: PermissionConstraints = {
        endpoints: ["/api/**"],
      };
      expect(checker.checkConstraints("call", "/api/v1/users/123/posts", constraints)).toBe(true);
    });

    it("allows when no endpoints constraint is set", () => {
      expect(checker.checkConstraints("call", "/anything", {})).toBe(true);
    });
  });

  describe("HTTP method validation", () => {
    it("allows matching method", () => {
      const constraints: PermissionConstraints = {
        methods: ["GET", "POST"],
      };
      expect(checker.checkConstraints("call", "GET /api/data", constraints)).toBe(true);
      expect(checker.checkConstraints("call", "POST /api/data", constraints)).toBe(true);
    });

    it("denies non-matching method", () => {
      const constraints: PermissionConstraints = {
        methods: ["GET"],
      };
      expect(checker.checkConstraints("call", "DELETE /api/data", constraints)).toBe(false);
    });

    it("is case insensitive for methods", () => {
      const constraints: PermissionConstraints = {
        methods: ["get"],
      };
      expect(checker.checkConstraints("call", "GET /api/data", constraints)).toBe(true);
    });

    it("skips method check when resource has no method prefix", () => {
      const constraints: PermissionConstraints = {
        methods: ["GET"],
      };
      expect(checker.checkConstraints("call", "/api/data", constraints)).toBe(true);
    });
  });

  describe("parameter constraints", () => {
    it("validates query parameters against regex", () => {
      const constraints: PermissionConstraints = {
        parameterConstraints: { userId: "^[0-9]+$" },
      };
      expect(checker.checkConstraints("call", "/api/users?userId=123", constraints)).toBe(true);
      expect(checker.checkConstraints("call", "/api/users?userId=abc", constraints)).toBe(false);
    });

    it("passes when constrained param is not present in query", () => {
      const constraints: PermissionConstraints = {
        parameterConstraints: { userId: "^[0-9]+$" },
      };
      expect(checker.checkConstraints("call", "/api/users", constraints)).toBe(true);
    });

    it("denies on invalid regex in constraint", () => {
      const constraints: PermissionConstraints = {
        parameterConstraints: { x: "[invalid" },
      };
      expect(checker.checkConstraints("call", "/api?x=1", constraints)).toBe(false);
    });
  });

  describe("combined constraints", () => {
    it("checks method + endpoint + params together", () => {
      const constraints: PermissionConstraints = {
        methods: ["GET"],
        endpoints: ["/api/v1/users/*"],
        parameterConstraints: { limit: "^[0-9]{1,4}$" },
      };
      expect(checker.checkConstraints("call", "GET /api/v1/users/123?limit=50", constraints)).toBe(true);
      expect(checker.checkConstraints("call", "POST /api/v1/users/123?limit=50", constraints)).toBe(false);
      expect(checker.checkConstraints("call", "GET /api/v2/admin?limit=50", constraints)).toBe(false);
      expect(checker.checkConstraints("call", "GET /api/v1/users/123?limit=99999", constraints)).toBe(false);
    });
  });
});
