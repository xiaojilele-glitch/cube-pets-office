/**
 * Unit tests + Property tests for FilesystemChecker
 *
 * Validates: Requirements 5.1, 5.2, 5.4, 5.5
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FilesystemChecker,
  matchGlob,
  isSensitivePath,
  SENSITIVE_DIRS,
} from "../permission/checkers/filesystem-checker.js";
import type { PermissionConstraints } from "../../shared/permission/contracts.js";

const checker = new FilesystemChecker();

// ─── Unit Tests ─────────────────────────────────────────────────────────────

describe("FilesystemChecker", () => {
  describe("matchGlob", () => {
    it("matches exact paths", () => {
      expect(matchGlob("/data/file.txt", "/data/file.txt")).toBe(true);
      expect(matchGlob("/data/file.txt", "/data/other.txt")).toBe(false);
    });

    it("matches * wildcard (single segment)", () => {
      expect(matchGlob("/data/*/file.txt", "/data/user1/file.txt")).toBe(true);
      expect(matchGlob("/data/*/file.txt", "/data/user1/sub/file.txt")).toBe(
        false
      );
    });

    it("matches ** wildcard (any depth)", () => {
      expect(matchGlob("/data/**", "/data/a/b/c")).toBe(true);
      expect(matchGlob("/data/**/file.txt", "/data/a/b/file.txt")).toBe(true);
      expect(matchGlob("/data/**/file.txt", "/data/file.txt")).toBe(true);
    });

    it("matches sandbox agent paths", () => {
      expect(
        matchGlob("/sandbox/agent_*/**", "/sandbox/agent_123/workspace/file.ts")
      ).toBe(true);
      expect(
        matchGlob("/sandbox/agent_*/**", "/sandbox/agent_456/output")
      ).toBe(true);
      expect(
        matchGlob("/sandbox/agent_123/**", "/sandbox/agent_456/file")
      ).toBe(false);
    });
  });

  describe("isSensitivePath", () => {
    it("detects /etc as sensitive", () => {
      expect(isSensitivePath("/etc")).toBe(true);
      expect(isSensitivePath("/etc/passwd")).toBe(true);
    });

    it("detects /sys as sensitive", () => {
      expect(isSensitivePath("/sys")).toBe(true);
      expect(isSensitivePath("/sys/kernel")).toBe(true);
    });

    it("detects /proc as sensitive", () => {
      expect(isSensitivePath("/proc")).toBe(true);
      expect(isSensitivePath("/proc/1/status")).toBe(true);
    });

    it("detects ~/.ssh as sensitive", () => {
      expect(isSensitivePath("~/.ssh")).toBe(true);
      expect(isSensitivePath("~/.ssh/id_rsa")).toBe(true);
    });

    it("does not flag normal paths", () => {
      expect(isSensitivePath("/data/file.txt")).toBe(false);
      expect(isSensitivePath("/sandbox/agent_1/work")).toBe(false);
      expect(isSensitivePath("/tmp/output")).toBe(false);
    });
  });

  describe("checkConstraints", () => {
    it("allows access when path matches pattern", () => {
      const constraints: PermissionConstraints = {
        pathPatterns: ["/sandbox/agent_1/**"],
      };
      expect(
        checker.checkConstraints(
          "read",
          "/sandbox/agent_1/file.txt",
          constraints
        )
      ).toBe(true);
    });

    it("denies access when path does not match any pattern", () => {
      const constraints: PermissionConstraints = {
        pathPatterns: ["/sandbox/agent_1/**"],
      };
      expect(
        checker.checkConstraints(
          "read",
          "/sandbox/agent_2/file.txt",
          constraints
        )
      ).toBe(false);
    });

    it("denies access to sensitive directories even with matching patterns", () => {
      const constraints: PermissionConstraints = {
        pathPatterns: ["/**"],
      };
      expect(checker.checkConstraints("read", "/etc/passwd", constraints)).toBe(
        false
      );
      expect(
        checker.checkConstraints("write", "/sys/kernel", constraints)
      ).toBe(false);
      expect(
        checker.checkConstraints("read", "/proc/1/status", constraints)
      ).toBe(false);
      expect(
        checker.checkConstraints("read", "~/.ssh/id_rsa", constraints)
      ).toBe(false);
    });

    it("denies access when no path patterns are defined", () => {
      expect(checker.checkConstraints("read", "/data/file.txt", {})).toBe(
        false
      );
      expect(
        checker.checkConstraints("read", "/data/file.txt", { pathPatterns: [] })
      ).toBe(false);
    });

    it("allows access when any pattern matches", () => {
      const constraints: PermissionConstraints = {
        pathPatterns: ["/data/**", "/tmp/**"],
      };
      expect(
        checker.checkConstraints("read", "/tmp/output.log", constraints)
      ).toBe(true);
      expect(
        checker.checkConstraints("read", "/data/input.csv", constraints)
      ).toBe(true);
    });
  });
});

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("FilesystemChecker Property Tests", () => {
  /**
   * **Validates: Requirements 5.2**
   *
   * Property 5: Path pattern matching correctness —
   * For any glob pattern and path, FilesystemChecker matches correctly.
   * We verify that exact paths always match themselves and that
   * wildcard patterns behave consistently.
   */
  describe("Property 5: Path pattern matching correctness", () => {
    // Generator for safe path segments (no special glob chars)
    const safeSegment = fc
      .array(
        fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_-".split("")),
        { minLength: 1, maxLength: 8 }
      )
      .map(chars => chars.join(""));

    const safePath = fc
      .array(safeSegment, { minLength: 1, maxLength: 4 })
      .map(segments => "/" + segments.join("/"));

    it("exact path always matches itself", () => {
      fc.assert(
        fc.property(safePath, path => {
          expect(matchGlob(path, path)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it("/** pattern matches any subpath", () => {
      fc.assert(
        fc.property(safePath, safePath, (base, suffix) => {
          const pattern = base + "/**";
          const target = base + suffix;
          expect(matchGlob(pattern, target)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it("/* pattern matches single segment children only", () => {
      fc.assert(
        fc.property(safePath, safeSegment, (base, child) => {
          const pattern = base + "/*";
          const singleChild = base + "/" + child;
          expect(matchGlob(pattern, singleChild)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Property 6: Sensitive directories always denied —
   * For any permission config, /etc, /sys, /proc, ~/.ssh access is always denied.
   */
  describe("Property 6: Sensitive directories always denied", () => {
    const sensitiveDirArb = fc.constantFrom(...SENSITIVE_DIRS);
    const subPathArb = fc
      .array(
        fc
          .array(
            fc.constantFrom(
              ..."abcdefghijklmnopqrstuvwxyz0123456789".split("")
            ),
            { minLength: 1, maxLength: 6 }
          )
          .map(chars => chars.join("")),
        { minLength: 0, maxLength: 3 }
      )
      .map(parts => (parts.length > 0 ? "/" + parts.join("/") : ""));

    // Even the most permissive constraints should not allow sensitive dirs
    const permissiveConstraints: PermissionConstraints = {
      pathPatterns: [
        "/**",
        "~/**",
        "/etc/**",
        "/sys/**",
        "/proc/**",
        "~/.ssh/**",
      ],
    };

    const actionArb = fc.constantFrom(
      "read" as const,
      "write" as const,
      "execute" as const,
      "delete" as const
    );

    it("sensitive paths are always denied regardless of constraints", () => {
      fc.assert(
        fc.property(
          sensitiveDirArb,
          subPathArb,
          actionArb,
          (dir, sub, action) => {
            const path = dir + sub;
            expect(
              checker.checkConstraints(action, path, permissiveConstraints)
            ).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
