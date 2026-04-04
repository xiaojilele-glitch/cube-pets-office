/**
 * ApiChecker — API 权限检查
 *
 * - 端点路径模式匹配（glob 风格）
 * - HTTP 方法验证
 * - 参数正则约束检查
 */

import type { Action, PermissionConstraints } from "../../../shared/permission/contracts.js";
import type { ResourceChecker } from "./filesystem-checker.js";
import { matchGlob } from "./filesystem-checker.js";
import { SlidingWindowRateLimiter } from "../rate-limiter.js";

/**
 * Resource format: "METHOD /path" or just "/path"
 * e.g. "GET /api/v1/users/123" or "/api/v1/users/123"
 */
export class ApiChecker implements ResourceChecker {
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

  checkConstraints(action: Action, resource: string, constraints: PermissionConstraints): boolean {
    const { method, path } = parseApiResource(resource);

    // 1. HTTP method check
    if (method && constraints.methods && constraints.methods.length > 0) {
      const allowed = constraints.methods.some((m) => m.toUpperCase() === method.toUpperCase());
      if (!allowed) return false;
    }

    // 2. Endpoint path pattern matching
    if (constraints.endpoints && constraints.endpoints.length > 0) {
      const pathAllowed = constraints.endpoints.some((pattern) => matchGlob(pattern, path));
      if (!pathAllowed) return false;
    }

    // 3. Parameter regex constraints
    if (constraints.parameterConstraints) {
      // Extract query parameters from path if present
      const params = extractQueryParams(path);
      for (const [key, regexStr] of Object.entries(constraints.parameterConstraints)) {
        const value = params.get(key);
        if (value !== undefined) {
          try {
            const regex = new RegExp(regexStr);
            if (!regex.test(value)) return false;
          } catch {
            // Invalid regex in constraint — deny for safety
            return false;
          }
        }
      }
    }

    // 4. Rate limiting
    if (constraints.rateLimit && constraints.rateLimit.maxPerMinute > 0) {
      const endpoint = path.split("?")[0]; // strip query params for key
      const key = this.agentId ? `${this.agentId}:api:${endpoint}` : `unknown:api:${endpoint}`;
      if (!this.rateLimiter.check(key, constraints.rateLimit.maxPerMinute)) {
        return false;
      }
      this.rateLimiter.record(key);
    }

    return true;
  }
}

function parseApiResource(resource: string): { method: string | null; path: string } {
  const match = resource.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(.+)$/i);
  if (match) {
    return { method: match[1], path: match[2] };
  }
  return { method: null, path: resource };
}

function extractQueryParams(path: string): Map<string, string> {
  const params = new Map<string, string>();
  const qIndex = path.indexOf("?");
  if (qIndex === -1) return params;
  const query = path.slice(qIndex + 1);
  for (const pair of query.split("&")) {
    const [key, value] = pair.split("=");
    if (key) params.set(decodeURIComponent(key), decodeURIComponent(value ?? ""));
  }
  return params;
}
