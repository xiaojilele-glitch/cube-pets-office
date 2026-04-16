/**
 * PermissionCheckEngine — 运行时权限检查引擎
 *
 * 检查流程：
 * 1. 验证 JWT 令牌签名和有效期
 * 2. 从令牌 payload 提取权限矩阵
 * 3. 查找 LRU 缓存
 * 4. 匹配 deny 规则（优先级最高）
 * 5. 匹配 allow 规则
 * 6. 应用约束条件（委托给对应的 ResourceChecker）
 * 7. 记录审计日志
 * 8. 缓存并返回结果
 */

import type {
  Action,
  PermissionCheckResult,
  PermissionMatrixEntry,
  ResourceType,
} from "../../shared/permission/contracts.js";
import type { ResourceChecker } from "./checkers/filesystem-checker.js";
import type { TokenService } from "./token-service.js";
import { InvalidTokenError, TokenExpiredError } from "./token-service.js";

// ─── AuditLogger interface (optional dependency) ────────────────────────────

export interface AuditLogger {
  log(entry: {
    agentId: string;
    operation: string;
    resourceType: ResourceType;
    action: Action;
    resource: string;
    result: "allowed" | "denied" | "error";
    reason?: string;
    metadata?: Record<string, unknown>;
  }): void;
}

// ─── LRU Cache ──────────────────────────────────────────────────────────────

interface CacheEntry {
  result: PermissionCheckResult;
  createdAt: number;
}

const DEFAULT_CACHE_SIZE = 10_000;
const DEFAULT_CACHE_TTL_MS = 60_000; // 60 seconds

function getCacheSize(): number {
  const envVal =
    typeof process !== "undefined"
      ? process.env.PERMISSION_CACHE_SIZE
      : undefined;
  if (envVal) {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CACHE_SIZE;
}

function getCacheTtlMs(): number {
  const envVal =
    typeof process !== "undefined"
      ? process.env.PERMISSION_CACHE_TTL_MS
      : undefined;
  if (envVal) {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CACHE_TTL_MS;
}

/**
 * Simple LRU cache backed by a Map (insertion-order iteration).
 * Supports TTL-based expiration and capacity eviction.
 */
export class LRUCache {
  private cache = new Map<string, CacheEntry>();
  readonly capacity: number;
  readonly ttlMs: number;

  constructor(capacity?: number, ttlMs?: number) {
    this.capacity = capacity ?? getCacheSize();
    this.ttlMs = ttlMs ?? getCacheTtlMs();
  }

  get(key: string): PermissionCheckResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // TTL check
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  set(key: string, result: PermissionCheckResult): void {
    // If key exists, delete first to refresh position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.capacity) {
      let oldest: string | undefined;
      this.cache.forEach((_, k) => {
        if (oldest === undefined) oldest = k;
      });
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, { result, createdAt: Date.now() });
  }

  /** Remove all entries whose key starts with the given prefix */
  invalidateByPrefix(prefix: string): void {
    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ─── PermissionCheckEngine ──────────────────────────────────────────────────

export class PermissionCheckEngine {
  private cache: LRUCache;

  constructor(
    private tokenService: TokenService,
    private auditLogger?: AuditLogger,
    private checkers: Map<ResourceType, ResourceChecker> = new Map()
  ) {
    this.cache = new LRUCache();
  }

  /**
   * Core permission check.
   *
   * Flow: JWT verify → extract matrix → cache lookup → deny-first match →
   *       allow match → constraint check → audit log → cache & return
   */
  checkPermission(
    agentId: string,
    resourceType: ResourceType,
    action: Action,
    resource: string,
    token: string
  ): PermissionCheckResult {
    // 1. Verify JWT token
    let matrix: PermissionMatrixEntry[];
    try {
      const payload = this.tokenService.verifyToken(token);
      // Ensure token belongs to the requesting agent
      if (payload.agentId !== agentId) {
        const result: PermissionCheckResult = {
          allowed: false,
          reason: "Token agentId mismatch",
          suggestion: "Use a token issued for this agent",
        };
        this.audit(
          agentId,
          resourceType,
          action,
          resource,
          "denied",
          result.reason
        );
        return result;
      }
      matrix = payload.permissionMatrix;
    } catch (err) {
      const reason =
        err instanceof TokenExpiredError
          ? "Token expired"
          : err instanceof InvalidTokenError
            ? "Invalid token"
            : "Token verification failed";
      const suggestion =
        err instanceof TokenExpiredError
          ? "Refresh the token using tokenService.refreshToken()"
          : "Provide a valid capability token";
      const result: PermissionCheckResult = {
        allowed: false,
        reason,
        suggestion,
      };
      this.audit(agentId, resourceType, action, resource, "denied", reason);
      return result;
    }

    // 2. Cache lookup
    const cacheKey = `${agentId}:${resourceType}:${action}:${resource}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // 3. Deny-first matching — highest priority
    const denyEntries = matrix.filter(
      e => e.effect === "deny" && e.resourceType === resourceType
    );
    for (const deny of denyEntries) {
      if (deny.actions.includes(action)) {
        const result: PermissionCheckResult = {
          allowed: false,
          reason: `Denied by explicit deny rule for ${resourceType}:${action}`,
          matchedRule: {
            resourceType: deny.resourceType,
            action,
            constraints: deny.constraints,
            effect: "deny",
          },
        };
        this.cache.set(cacheKey, result);
        this.audit(
          agentId,
          resourceType,
          action,
          resource,
          "denied",
          result.reason
        );
        return result;
      }
    }

    // 4. Allow matching
    const allowEntries = matrix.filter(
      e => e.effect === "allow" && e.resourceType === resourceType
    );
    const matchedAllow = allowEntries.find(e => e.actions.includes(action));

    if (!matchedAllow) {
      const result: PermissionCheckResult = {
        allowed: false,
        reason: `No allow rule found for ${resourceType}:${action}`,
        suggestion: `Request permission for ${resourceType}:${action}`,
      };
      this.cache.set(cacheKey, result);
      this.audit(
        agentId,
        resourceType,
        action,
        resource,
        "denied",
        result.reason
      );
      return result;
    }

    // 5. Constraint checking via ResourceChecker
    const checker = this.checkers.get(resourceType);
    if (checker) {
      const constraintsPassed = checker.checkConstraints(
        action,
        resource,
        matchedAllow.constraints
      );
      if (!constraintsPassed) {
        const result: PermissionCheckResult = {
          allowed: false,
          reason: `Constraint check failed for ${resourceType}:${action} on "${resource}"`,
          suggestion: "Verify the resource matches the allowed constraints",
          matchedRule: {
            resourceType: matchedAllow.resourceType,
            action,
            constraints: matchedAllow.constraints,
            effect: "allow",
          },
        };
        this.cache.set(cacheKey, result);
        this.audit(
          agentId,
          resourceType,
          action,
          resource,
          "denied",
          result.reason
        );
        return result;
      }
    }

    // 6. Allowed
    const result: PermissionCheckResult = {
      allowed: true,
      matchedRule: {
        resourceType: matchedAllow.resourceType,
        action,
        constraints: matchedAllow.constraints,
        effect: "allow",
      },
    };
    this.cache.set(cacheKey, result);
    this.audit(agentId, resourceType, action, resource, "allowed");
    return result;
  }

  /**
   * Batch permission check. Calls checkPermission for each request.
   */
  checkPermissions(
    checks: Array<{
      agentId: string;
      resourceType: ResourceType;
      action: Action;
      resource: string;
    }>,
    token: string
  ): PermissionCheckResult[] {
    return checks.map(c =>
      this.checkPermission(
        c.agentId,
        c.resourceType,
        c.action,
        c.resource,
        token
      )
    );
  }

  /**
   * Invalidate all cache entries for a given agent.
   */
  invalidateCache(agentId: string): void {
    this.cache.invalidateByPrefix(`${agentId}:`);
  }

  /** Expose cache for testing */
  getCacheSize(): number {
    return this.cache.size;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private audit(
    agentId: string,
    resourceType: ResourceType,
    action: Action,
    resource: string,
    result: "allowed" | "denied" | "error",
    reason?: string
  ): void {
    if (!this.auditLogger) return;
    try {
      this.auditLogger.log({
        agentId,
        operation: "check",
        resourceType,
        action,
        resource,
        result,
        reason,
      });
    } catch {
      // Audit failures must not block permission checks
    }
  }
}
