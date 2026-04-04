/**
 * Unit tests + Property tests for NetworkChecker
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.6
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  NetworkChecker,
  parseIPv4,
  ipInCidr,
  isPrivateIP,
  matchDomain,
  portInRanges,
} from "../permission/checkers/network-checker.js";
import type { PermissionConstraints, PortRange } from "../../shared/permission/contracts.js";

const checker = new NetworkChecker();

// ─── Unit Tests ─────────────────────────────────────────────────────────────

describe("NetworkChecker", () => {
  describe("parseIPv4", () => {
    it("parses valid IPs", () => {
      expect(parseIPv4("192.168.1.1")).toBe((192 << 24 | 168 << 16 | 1 << 8 | 1) >>> 0);
      expect(parseIPv4("10.0.0.1")).toBe((10 << 24 | 0 << 16 | 0 << 8 | 1) >>> 0);
      expect(parseIPv4("0.0.0.0")).toBe(0);
    });

    it("returns null for invalid IPs", () => {
      expect(parseIPv4("256.0.0.1")).toBeNull();
      expect(parseIPv4("abc")).toBeNull();
      expect(parseIPv4("1.2.3")).toBeNull();
      expect(parseIPv4("1.2.3.4.5")).toBeNull();
    });
  });

  describe("ipInCidr", () => {
    it("matches IP within CIDR range", () => {
      const ip = parseIPv4("10.0.0.5")!;
      expect(ipInCidr(ip, "10.0.0.0/8")).toBe(true);
    });

    it("rejects IP outside CIDR range", () => {
      const ip = parseIPv4("11.0.0.1")!;
      expect(ipInCidr(ip, "10.0.0.0/8")).toBe(false);
    });

    it("handles /32 (exact match)", () => {
      const ip = parseIPv4("1.2.3.4")!;
      expect(ipInCidr(ip, "1.2.3.4/32")).toBe(true);
      expect(ipInCidr(ip, "1.2.3.5/32")).toBe(false);
    });
  });

  describe("isPrivateIP", () => {
    it("detects 10.x.x.x as private", () => {
      expect(isPrivateIP("10.0.0.1")).toBe(true);
      expect(isPrivateIP("10.255.255.255")).toBe(true);
    });

    it("detects 172.16-31.x.x as private", () => {
      expect(isPrivateIP("172.16.0.1")).toBe(true);
      expect(isPrivateIP("172.31.255.255")).toBe(true);
      expect(isPrivateIP("172.15.0.1")).toBe(false);
      expect(isPrivateIP("172.32.0.1")).toBe(false);
    });

    it("detects 192.168.x.x as private", () => {
      expect(isPrivateIP("192.168.0.1")).toBe(true);
      expect(isPrivateIP("192.168.255.255")).toBe(true);
    });

    it("does not flag public IPs", () => {
      expect(isPrivateIP("8.8.8.8")).toBe(false);
      expect(isPrivateIP("1.1.1.1")).toBe(false);
      expect(isPrivateIP("203.0.113.1")).toBe(false);
    });
  });

  describe("matchDomain", () => {
    it("matches exact domain", () => {
      expect(matchDomain("example.com", "example.com")).toBe(true);
      expect(matchDomain("example.com", "other.com")).toBe(false);
    });

    it("matches wildcard subdomain", () => {
      expect(matchDomain("*.example.com", "api.example.com")).toBe(true);
      expect(matchDomain("*.example.com", "sub.api.example.com")).toBe(true);
      expect(matchDomain("*.example.com", "example.com")).toBe(true);
    });

    it("is case insensitive", () => {
      expect(matchDomain("*.Example.COM", "api.example.com")).toBe(true);
    });

    it("matches bare * wildcard for any domain", () => {
      expect(matchDomain("*", "anything.com")).toBe(true);
      expect(matchDomain("*", "sub.domain.org")).toBe(true);
    });
  });

  describe("portInRanges", () => {
    it("matches port within range", () => {
      expect(portInRanges(443, [{ from: 443, to: 443 }])).toBe(true);
      expect(portInRanges(8080, [{ from: 8000, to: 9000 }])).toBe(true);
    });

    it("rejects port outside range", () => {
      expect(portInRanges(80, [{ from: 443, to: 443 }])).toBe(false);
      expect(portInRanges(7999, [{ from: 8000, to: 9000 }])).toBe(false);
    });

    it("matches across multiple ranges", () => {
      const ranges: PortRange[] = [{ from: 80, to: 80 }, { from: 443, to: 443 }, { from: 8000, to: 9000 }];
      expect(portInRanges(80, ranges)).toBe(true);
      expect(portInRanges(443, ranges)).toBe(true);
      expect(portInRanges(8500, ranges)).toBe(true);
      expect(portInRanges(3000, ranges)).toBe(false);
    });
  });

  describe("checkConstraints", () => {
    it("denies private IPs regardless of constraints", () => {
      const constraints: PermissionConstraints = {
        domainPatterns: ["*"],
        cidrRanges: ["0.0.0.0/0"],
      };
      expect(checker.checkConstraints("connect", "10.0.0.1:80", constraints)).toBe(false);
      expect(checker.checkConstraints("connect", "192.168.1.1:443", constraints)).toBe(false);
      expect(checker.checkConstraints("connect", "172.16.0.1:8080", constraints)).toBe(false);
    });

    it("allows public IP with matching CIDR", () => {
      const constraints: PermissionConstraints = {
        cidrRanges: ["8.8.0.0/16"],
      };
      expect(checker.checkConstraints("connect", "8.8.8.8", constraints)).toBe(true);
    });

    it("allows domain matching whitelist", () => {
      const constraints: PermissionConstraints = {
        domainPatterns: ["*.company.com"],
      };
      expect(checker.checkConstraints("connect", "api.company.com:443", constraints)).toBe(true);
    });

    it("denies domain not in whitelist", () => {
      const constraints: PermissionConstraints = {
        domainPatterns: ["*.company.com"],
      };
      expect(checker.checkConstraints("connect", "evil.com:443", constraints)).toBe(false);
    });

    it("checks port ranges", () => {
      const constraints: PermissionConstraints = {
        domainPatterns: ["*"],
        ports: [{ from: 443, to: 443 }],
      };
      expect(checker.checkConstraints("connect", "example.com:443", constraints)).toBe(true);
      expect(checker.checkConstraints("connect", "example.com:80", constraints)).toBe(false);
    });
  });
});

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("NetworkChecker Property Tests", () => {
  /**
   * **Validates: Requirements 6.6**
   *
   * Property 7: Private IP always denied —
   * For any config, 10.x.x.x, 172.16-31.x.x, 192.168.x.x are denied.
   */
  describe("Property 7: Private IP always denied", () => {
    // Generator for private IPs in 10.0.0.0/8
    const ip10 = fc.tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ).map(([b, c, d]) => `10.${b}.${c}.${d}`);

    // Generator for private IPs in 172.16.0.0/12
    const ip172 = fc.tuple(
      fc.integer({ min: 16, max: 31 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ).map(([b, c, d]) => `172.${b}.${c}.${d}`);

    // Generator for private IPs in 192.168.0.0/16
    const ip192 = fc.tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ).map(([c, d]) => `192.168.${c}.${d}`);

    const privateIpArb = fc.oneof(ip10, ip172, ip192);

    const portArb = fc.integer({ min: 1, max: 65535 });

    // Most permissive constraints possible
    const permissiveConstraints: PermissionConstraints = {
      domainPatterns: ["*"],
      cidrRanges: ["0.0.0.0/0"],
      ports: [{ from: 0, to: 65535 }],
    };

    const actionArb = fc.constantFrom("connect" as const, "call" as const);

    it("private IPs are always denied regardless of constraints", () => {
      fc.assert(
        fc.property(privateIpArb, portArb, actionArb, (ip, port, action) => {
          const resource = `${ip}:${port}`;
          expect(checker.checkConstraints(action, resource, permissiveConstraints)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * Property 8: Port range matching correctness —
   * For any port 0-65535 and port range list, matching is correct.
   */
  describe("Property 8: Port range matching correctness", () => {
    const portArb = fc.integer({ min: 0, max: 65535 });
    const portRangeArb = fc.tuple(
      fc.integer({ min: 0, max: 65535 }),
      fc.integer({ min: 0, max: 65535 }),
    ).map(([a, b]): PortRange => ({ from: Math.min(a, b), to: Math.max(a, b) }));
    const portRangesArb = fc.array(portRangeArb, { minLength: 1, maxLength: 5 });

    it("port in range returns true, port outside returns false", () => {
      fc.assert(
        fc.property(portArb, portRangesArb, (port, ranges) => {
          const result = portInRanges(port, ranges);
          const expected = ranges.some((r) => port >= r.from && port <= r.to);
          expect(result).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });
  });
});
