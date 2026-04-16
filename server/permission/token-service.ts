/**
 * TokenService — CapabilityToken 生成与验证
 *
 * 使用轻量级 HMAC-SHA256 实现 JWT 签名和验证（无外部依赖）。
 * 依赖 PolicyStore 解析有效权限，依赖 RoleStore 查询角色信息。
 */
import { createHmac } from "node:crypto";
import { randomBytes } from "node:crypto";
import type {
  CapabilityToken,
  CapabilityTokenPayload,
  Permission,
  PermissionMatrixEntry,
} from "../../shared/permission/contracts.js";
import type { PolicyStore } from "./policy-store.js";
import type { RoleStore } from "./role-store.js";

// ─── Error Types ────────────────────────────────────────────────────────────

export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export class TokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenExpiredError";
  }
}

// ─── JWT Helpers (lightweight, no external deps) ────────────────────────────

function base64urlEncode(data: string): string {
  return Buffer.from(data, "utf-8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(str: string): string {
  // Restore padding
  let padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const mod = padded.length % 4;
  if (mod === 2) padded += "==";
  else if (mod === 3) padded += "=";
  return Buffer.from(padded, "base64").toString("utf-8");
}

function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const JWT_HEADER = base64urlEncode(
  JSON.stringify({ alg: "HS256", typ: "JWT" })
);

function signJwt(payload: CapabilityTokenPayload, secret: string): string {
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${JWT_HEADER}.${encodedPayload}`;
  const signature = hmacSign(signingInput, secret);
  return `${signingInput}.${signature}`;
}

function verifyJwt(token: string, secret: string): CapabilityTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new InvalidTokenError("Malformed JWT: expected 3 parts");
  }

  const [header, payload, signature] = parts;
  const signingInput = `${header}.${payload}`;
  const expectedSig = hmacSign(signingInput, secret);

  if (signature !== expectedSig) {
    throw new InvalidTokenError("Invalid JWT signature");
  }

  let decoded: CapabilityTokenPayload;
  try {
    decoded = JSON.parse(base64urlDecode(payload));
  } catch {
    throw new InvalidTokenError("Invalid JWT payload");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (decoded.exp <= nowSec) {
    throw new TokenExpiredError(
      `Token expired at ${new Date(decoded.exp * 1000).toISOString()}`
    );
  }

  return decoded;
}

// ─── Default Configuration ──────────────────────────────────────────────────

const DEFAULT_TTL_MS = 7_200_000; // 2 hours

function getDefaultTtlMs(): number {
  const envVal =
    typeof process !== "undefined"
      ? process.env.PERMISSION_TOKEN_DEFAULT_TTL_MS
      : undefined;
  if (envVal) {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TTL_MS;
}

function getSecret(provided?: string): string {
  if (provided) return provided;
  const envVal =
    typeof process !== "undefined"
      ? process.env.PERMISSION_TOKEN_SECRET
      : undefined;
  if (envVal) return envVal;
  // Dev fallback: random secret (not suitable for production)
  return randomBytes(32).toString("hex");
}

// ─── TokenService ───────────────────────────────────────────────────────────

export class TokenService {
  private readonly secret: string;

  constructor(
    private policyStore: PolicyStore,
    private roleStore: RoleStore,
    secret?: string
  ) {
    this.secret = getSecret(secret);
  }

  /**
   * Issue a CapabilityToken for the given agent.
   * Resolves effective permissions → builds permission matrix → signs JWT.
   */
  issueToken(agentId: string, customExpiresInMs?: number): CapabilityToken {
    const permissions = this.policyStore.resolveEffectivePermissions(agentId);
    const matrix = this.buildPermissionMatrix(permissions);

    const nowMs = Date.now();
    const ttlMs = customExpiresInMs ?? getDefaultTtlMs();
    const iatSec = Math.floor(nowMs / 1000);
    const expSec = iatSec + Math.floor(ttlMs / 1000);

    const payload: CapabilityTokenPayload = {
      agentId,
      permissionMatrix: matrix,
      iat: iatSec,
      exp: expSec,
    };

    const token = signJwt(payload, this.secret);

    return {
      token,
      agentId,
      issuedAt: new Date(iatSec * 1000).toISOString(),
      expiresAt: new Date(expSec * 1000).toISOString(),
    };
  }

  /**
   * Verify a JWT token string. Returns the decoded payload.
   * Throws InvalidTokenError or TokenExpiredError on failure.
   */
  verifyToken(token: string): CapabilityTokenPayload {
    return verifyJwt(token, this.secret);
  }

  /**
   * Re-issue a token for the agent with fresh permissions.
   * Equivalent to issueToken but semantically indicates a refresh.
   */
  refreshToken(agentId: string): CapabilityToken {
    return this.issueToken(agentId);
  }

  /**
   * Convert a flat list of Permission[] into a grouped PermissionMatrixEntry[].
   * Groups by (resourceType + effect), merging actions and constraints.
   */
  buildPermissionMatrix(permissions: Permission[]): PermissionMatrixEntry[] {
    const groupMap = new Map<string, PermissionMatrixEntry>();

    for (const perm of permissions) {
      const key = `${perm.resourceType}:${perm.effect}`;
      const existing = groupMap.get(key);

      if (existing) {
        // Merge action if not already present
        if (!existing.actions.includes(perm.action)) {
          existing.actions.push(perm.action);
        }
        // Merge constraints (shallow merge — arrays are concatenated, scalars overwritten)
        mergeConstraints(
          existing.constraints as Record<string, any>,
          perm.constraints as Record<string, any>
        );
      } else {
        groupMap.set(key, {
          resourceType: perm.resourceType,
          actions: [perm.action],
          constraints: { ...perm.constraints },
          effect: perm.effect,
        });
      }
    }

    return Array.from(groupMap.values());
  }
}

// ─── Constraint Merging Helper ──────────────────────────────────────────────

function mergeConstraints(
  target: Record<string, any>,
  source: Record<string, any>
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const existing = target[key];

    if (Array.isArray(existing) && Array.isArray(value)) {
      // Deduplicate merged arrays
      const merged = [...existing];
      for (const item of value) {
        if (!merged.includes(item)) {
          merged.push(item);
        }
      }
      target[key] = merged;
    } else if (existing === undefined) {
      // Deep-copy arrays to avoid shared references
      target[key] = Array.isArray(value) ? [...value] : value;
    }
    // For scalar conflicts, keep the existing value (first-wins)
  }
}

// ─── Exported helpers for testing ───────────────────────────────────────────

export { base64urlEncode, base64urlDecode, hmacSign, signJwt, verifyJwt };
