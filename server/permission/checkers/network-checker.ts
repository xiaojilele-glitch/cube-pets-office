/**
 * NetworkChecker — 网络权限检查
 *
 * - 域名白名单匹配（通配符 *.company.com）
 * - CIDR 范围检查
 * - 端口范围验证
 * - 私有 IP 段默认拒绝（10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16）
 * - 速率限制占位（完整实现在 Task 13）
 */

import type {
  Action,
  PermissionConstraints,
  PortRange,
} from "../../../shared/permission/contracts.js";
import type { ResourceChecker } from "./filesystem-checker.js";
import { SlidingWindowRateLimiter } from "../rate-limiter.js";

// ─── IP Utilities ───────────────────────────────────────────────────────────

/** Parse an IPv4 address string to a 32-bit number. Returns null if invalid. */
export function parseIPv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  // Convert to unsigned 32-bit
  return result >>> 0;
}

/** Check if an IP (as 32-bit number) falls within a CIDR range */
export function ipInCidr(ip: number, cidr: string): boolean {
  const [base, prefixStr] = cidr.split("/");
  const baseIp = parseIPv4(base);
  if (baseIp === null) return false;
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ip & mask) === (baseIp & mask);
}

/** Private IP ranges */
const PRIVATE_CIDRS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

/** Check if an IP address is in a private range */
export function isPrivateIP(ip: string): boolean {
  const parsed = parseIPv4(ip);
  if (parsed === null) return false;
  return PRIVATE_CIDRS.some(cidr => ipInCidr(parsed, cidr));
}

// ─── Domain matching ────────────────────────────────────────────────────────

/** Match a domain against a pattern (supports leading wildcard like *.example.com, or bare * for all) */
export function matchDomain(pattern: string, domain: string): boolean {
  const p = pattern.toLowerCase();
  const d = domain.toLowerCase();
  if (p === "*") return true;
  if (p === d) return true;
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".example.com"
    return d.endsWith(suffix) || d === p.slice(2);
  }
  return false;
}

// ─── Port matching ──────────────────────────────────────────────────────────

/** Check if a port falls within any of the given port ranges */
export function portInRanges(port: number, ranges: PortRange[]): boolean {
  return ranges.some(r => port >= r.from && port <= r.to);
}

// ─── NetworkChecker ─────────────────────────────────────────────────────────

/**
 * Resource format for network checks: "host:port" or just "host"
 * where host can be a domain name or IP address.
 */
export class NetworkChecker implements ResourceChecker {
  private rateLimiter: SlidingWindowRateLimiter;
  private agentId: string | null = null;

  constructor(rateLimiter?: SlidingWindowRateLimiter) {
    this.rateLimiter = rateLimiter ?? new SlidingWindowRateLimiter();
  }

  /** Set the current agent context for rate limiting key construction. */
  setAgentId(agentId: string): void {
    this.agentId = agentId;
  }

  /** Get the underlying rate limiter (for testing / shared access). */
  getRateLimiter(): SlidingWindowRateLimiter {
    return this.rateLimiter;
  }

  checkConstraints(
    action: Action,
    resource: string,
    constraints: PermissionConstraints
  ): boolean {
    const { host, port } = parseNetworkResource(resource);

    // 1. Private IP — always denied by default
    if (isPrivateIP(host)) {
      return false;
    }

    // 2. CIDR range check (if IP address)
    const parsedIp = parseIPv4(host);
    if (
      parsedIp !== null &&
      constraints.cidrRanges &&
      constraints.cidrRanges.length > 0
    ) {
      const inRange = constraints.cidrRanges.some(cidr =>
        ipInCidr(parsedIp, cidr)
      );
      if (!inRange) return false;
    }

    // 3. Domain whitelist check (if domain name)
    if (
      parsedIp === null &&
      constraints.domainPatterns &&
      constraints.domainPatterns.length > 0
    ) {
      const domainAllowed = constraints.domainPatterns.some(pattern =>
        matchDomain(pattern, host)
      );
      if (!domainAllowed) return false;
    }

    // 4. Port range check
    if (port !== null && constraints.ports && constraints.ports.length > 0) {
      if (!portInRanges(port, constraints.ports)) return false;
    }

    // 5. Rate limiting
    if (constraints.rateLimit && constraints.rateLimit.maxPerMinute > 0) {
      const key = this.agentId ? `${this.agentId}:network` : `unknown:network`;
      if (!this.rateLimiter.check(key, constraints.rateLimit.maxPerMinute)) {
        return false;
      }
      this.rateLimiter.record(key);
    }

    return true;
  }
}

function parseNetworkResource(resource: string): {
  host: string;
  port: number | null;
} {
  const lastColon = resource.lastIndexOf(":");
  if (lastColon === -1) return { host: resource, port: null };
  const portStr = resource.slice(lastColon + 1);
  const port = Number(portStr);
  if (Number.isInteger(port) && port >= 0 && port <= 65535) {
    return { host: resource.slice(0, lastColon), port };
  }
  return { host: resource, port: null };
}
