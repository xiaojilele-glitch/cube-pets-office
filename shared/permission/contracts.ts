/**
 * Agent 细粒度权限模型契约
 *
 * 定义 Agent-Resource-Action 三维权限矩阵的核心类型。
 * 在 secure-sandbox 的 Docker 容器物理隔离之上，提供治理层权限控制。
 */

// ─── 资源类型与操作 ─────────────────────────────────────────────────────────

export const RESOURCE_TYPES = ["filesystem", "network", "api", "database", "mcp_tool"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const ACTIONS = ["read", "write", "execute", "delete", "connect", "call", "select", "insert", "update"] as const;
export type Action = (typeof ACTIONS)[number];

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// ─── 约束条件 ───────────────────────────────────────────────────────────────

export interface PermissionConstraints {
  pathPatterns?: string[];
  domainPatterns?: string[];
  cidrRanges?: string[];
  ports?: PortRange[];
  rateLimit?: RateLimitConfig;
  endpoints?: string[];
  methods?: string[];
  parameterConstraints?: Record<string, string>;
  tables?: string[];
  rowLevelFilter?: string;
  forbiddenOperations?: string[];
  maxResultRows?: number;
  queryTimeoutMs?: number;
}

export interface PortRange {
  from: number;
  to: number;
}

export interface RateLimitConfig {
  maxPerMinute: number;
  maxBandwidthBytesPerMinute?: number;
}

// ─── 权限定义 ───────────────────────────────────────────────────────────────

export interface Permission {
  resourceType: ResourceType;
  action: Action;
  constraints: PermissionConstraints;
  effect: "allow" | "deny";
}

// ─── 角色 ───────────────────────────────────────────────────────────────────

export interface AgentRole {
  roleId: string;
  roleName: string;
  description: string;
  permissions: Permission[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Agent 权限策略 ─────────────────────────────────────────────────────────

export interface AgentPermissionPolicy {
  agentId: string;
  assignedRoles: string[];
  customPermissions: Permission[];
  deniedPermissions: Permission[];
  effectiveAt: string;
  expiresAt: string | null;
  templateId?: string;
  organizationId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── CapabilityToken ────────────────────────────────────────────────────────

export interface CapabilityTokenPayload {
  agentId: string;
  permissionMatrix: PermissionMatrixEntry[];
  iat: number;
  exp: number;
}

export interface PermissionMatrixEntry {
  resourceType: ResourceType;
  actions: Action[];
  constraints: PermissionConstraints;
  effect: "allow" | "deny";
}

export interface CapabilityToken {
  token: string;
  agentId: string;
  issuedAt: string;
  expiresAt: string;
}

// ─── 权限检查结果 ───────────────────────────────────────────────────────────

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
  matchedRule?: Permission;
}

// ─── 审计日志 ───────────────────────────────────────────────────────────────

export interface PermissionAuditEntry {
  id: string;
  timestamp: string;
  agentId: string;
  operation: string;
  resourceType: ResourceType;
  action: Action;
  resource: string;
  result: "allowed" | "denied" | "error";
  reason?: string;
  operator?: string;
  metadata?: Record<string, unknown>;
}

// ─── 权限模板 ───────────────────────────────────────────────────────────────

export interface PermissionTemplate {
  templateId: string;
  templateName: string;
  description: string;
  targetRole: string;
  permissions: Permission[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── 风险评估 ───────────────────────────────────────────────────────────────

export interface RiskAssessment {
  agentId: string;
  riskLevel: RiskLevel;
  factors: RiskFactor[];
  timestamp: string;
}

export interface RiskFactor {
  category: string;
  description: string;
  severity: RiskLevel;
}

// ─── 权限冲突 ───────────────────────────────────────────────────────────────

export interface PermissionConflict {
  agentId: string;
  conflictType: "allow_deny_overlap" | "excessive_scope" | "dangerous_combination";
  permissions: Permission[];
  description: string;
  suggestion: string;
}

// ─── 权限提升请求 ─────────────────────────────────────────────────────────

export interface PermissionEscalation {
  id: string;
  agentId: string;
  reason: string;
  requestedPermissions: Permission[];
  approverList: string[];
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
  createdAt: string;
  resolvedAt?: string;
}

// ─── 权限使用报告 ───────────────────────────────────────────────────────────

export interface PermissionUsageReport {
  agentId: string;
  timeRange: { from: string; to: string };
  totalChecks: number;
  allowedCount: number;
  deniedCount: number;
  resourceBreakdown: Record<ResourceType, { allowed: number; denied: number }>;
}
