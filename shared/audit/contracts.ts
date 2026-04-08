/**
 * 审计链 / 不可篡改日志 契约
 *
 * 定义审计事件类型、日志条目、验证结果、查询过滤、保留策略、
 * 异常检测、合规映射等核心类型和默认常量。
 */

// ─── 1.1 AuditEventType 枚举 & AuditSeverity / AuditCategory 类型 ──────────

export enum AuditEventType {
  DECISION_MADE = "DECISION_MADE",
  PERMISSION_GRANTED = "PERMISSION_GRANTED",
  PERMISSION_REVOKED = "PERMISSION_REVOKED",
  DATA_ACCESSED = "DATA_ACCESSED",
  AGENT_EXECUTED = "AGENT_EXECUTED",
  AGENT_FAILED = "AGENT_FAILED",
  CONFIG_CHANGED = "CONFIG_CHANGED",
  USER_LOGIN = "USER_LOGIN",
  USER_LOGOUT = "USER_LOGOUT",
  ESCALATION_REQUESTED = "ESCALATION_REQUESTED",
  ESCALATION_APPROVED = "ESCALATION_APPROVED",
  AUDIT_QUERY = "AUDIT_QUERY",
  AUDIT_EXPORT = "AUDIT_EXPORT",
  AUDIT_ARCHIVE = "AUDIT_ARCHIVE",
  AUDIT_DELETE = "AUDIT_DELETE",
  ANOMALY_DETECTED = "ANOMALY_DETECTED",
}

export type AuditSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AuditCategory = "security" | "compliance" | "operational";

// ─── 1.2 AuditEventTypeDefinition & 默认事件类型注册表 ─────────────────────

export interface AuditEventTypeDefinition {
  type: AuditEventType;
  severity: AuditSeverity;
  category: AuditCategory;
  description: string;
  version: number;
}

export const DEFAULT_EVENT_TYPE_REGISTRY: Record<AuditEventType, AuditEventTypeDefinition> = {
  [AuditEventType.DECISION_MADE]: {
    type: AuditEventType.DECISION_MADE,
    severity: "CRITICAL",
    category: "operational",
    description: "A decision was made in the workflow",
    version: 1,
  },
  [AuditEventType.PERMISSION_GRANTED]: {
    type: AuditEventType.PERMISSION_GRANTED,
    severity: "CRITICAL",
    category: "security",
    description: "Permission was granted to an agent or user",
    version: 1,
  },
  [AuditEventType.PERMISSION_REVOKED]: {
    type: AuditEventType.PERMISSION_REVOKED,
    severity: "CRITICAL",
    category: "security",
    description: "Permission was revoked from an agent or user",
    version: 1,
  },
  [AuditEventType.DATA_ACCESSED]: {
    type: AuditEventType.DATA_ACCESSED,
    severity: "CRITICAL",
    category: "compliance",
    description: "Sensitive data was accessed",
    version: 1,
  },
  [AuditEventType.AGENT_EXECUTED]: {
    type: AuditEventType.AGENT_EXECUTED,
    severity: "INFO",
    category: "operational",
    description: "An agent executed a task",
    version: 1,
  },
  [AuditEventType.AGENT_FAILED]: {
    type: AuditEventType.AGENT_FAILED,
    severity: "WARNING",
    category: "operational",
    description: "An agent failed to execute a task",
    version: 1,
  },
  [AuditEventType.CONFIG_CHANGED]: {
    type: AuditEventType.CONFIG_CHANGED,
    severity: "WARNING",
    category: "security",
    description: "System configuration was changed",
    version: 1,
  },
  [AuditEventType.USER_LOGIN]: {
    type: AuditEventType.USER_LOGIN,
    severity: "INFO",
    category: "security",
    description: "A user logged in",
    version: 1,
  },
  [AuditEventType.USER_LOGOUT]: {
    type: AuditEventType.USER_LOGOUT,
    severity: "INFO",
    category: "security",
    description: "A user logged out",
    version: 1,
  },
  [AuditEventType.ESCALATION_REQUESTED]: {
    type: AuditEventType.ESCALATION_REQUESTED,
    severity: "WARNING",
    category: "security",
    description: "A permission escalation was requested",
    version: 1,
  },
  [AuditEventType.ESCALATION_APPROVED]: {
    type: AuditEventType.ESCALATION_APPROVED,
    severity: "CRITICAL",
    category: "security",
    description: "A permission escalation was approved",
    version: 1,
  },
  [AuditEventType.AUDIT_QUERY]: {
    type: AuditEventType.AUDIT_QUERY,
    severity: "INFO",
    category: "compliance",
    description: "Audit log was queried",
    version: 1,
  },
  [AuditEventType.AUDIT_EXPORT]: {
    type: AuditEventType.AUDIT_EXPORT,
    severity: "INFO",
    category: "compliance",
    description: "Audit log was exported",
    version: 1,
  },
  [AuditEventType.AUDIT_ARCHIVE]: {
    type: AuditEventType.AUDIT_ARCHIVE,
    severity: "INFO",
    category: "compliance",
    description: "Audit log was archived",
    version: 1,
  },
  [AuditEventType.AUDIT_DELETE]: {
    type: AuditEventType.AUDIT_DELETE,
    severity: "CRITICAL",
    category: "compliance",
    description: "Audit log entries were deleted",
    version: 1,
  },
  [AuditEventType.ANOMALY_DETECTED]: {
    type: AuditEventType.ANOMALY_DETECTED,
    severity: "WARNING",
    category: "security",
    description: "An anomaly was detected in audit events",
    version: 1,
  },
};

// ─── 1.3 AuditEvent 接口 ───────────────────────────────────────────────────

export interface AuditEvent {
  eventId: string;
  eventType: AuditEventType;
  timestamp: number;
  actor: {
    type: "user" | "agent" | "system";
    id: string;
    name?: string;
  };
  action: string;
  resource: {
    type: string;
    id: string;
    name?: string;
  };
  result: "success" | "failure" | "denied" | "error";
  context: {
    sessionId?: string;
    requestId?: string;
    sourceIp?: string;
    userAgent?: string;
    organizationId?: string;
  };
  metadata?: Record<string, unknown>;
  lineageId?: string;
}

// ─── 1.4 AuditLogEntry 接口 ────────────────────────────────────────────────

export interface AuditLogEntry {
  entryId: string;
  sequenceNumber: number;
  eventId: string;
  event: AuditEvent;
  previousHash: string;
  currentHash: string;
  nonce: string;
  timestamp: {
    system: number;
    trusted?: number;
    skew?: number;
  };
  signature: string;
}

// ─── 1.5 VerificationResult & VerificationError ────────────────────────────

export interface VerificationResult {
  valid: boolean;
  checkedRange: { start: number; end: number };
  totalEntries: number;
  errors: VerificationError[];
  verifiedAt: number;
}

export interface VerificationError {
  entryId: string;
  sequenceNumber: number;
  errorType:
    | "hash_mismatch"
    | "chain_break"
    | "signature_invalid"
    | "timestamp_regression"
    | "sequence_gap"
    | "entry_missing";
  expected?: string;
  actual?: string;
  message: string;
}

// ─── 1.6 AuditQueryFilters / PageOptions / AuditQueryResult ────────────────

export interface AuditQueryFilters {
  eventType?: AuditEventType | AuditEventType[];
  actorId?: string;
  actorType?: "user" | "agent" | "system";
  resourceType?: string;
  resourceId?: string;
  result?: "success" | "failure" | "denied" | "error";
  severity?: AuditSeverity;
  category?: AuditCategory;
  timeRange?: { start: number; end: number };
  keyword?: string;
}

export interface PageOptions {
  pageSize: number;
  pageNum: number;
}

export interface AuditQueryResult {
  entries: AuditLogEntry[];
  total: number;
  page: PageOptions;
  chainValid?: boolean;
}

// ─── 1.7 RetentionPolicy & 默认保留策略 ────────────────────────────────────

export interface RetentionPolicy {
  severity: AuditSeverity;
  retentionDays: number;
  archiveAfterDays: number;
  deleteAfterDays: number;
}

export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  { severity: "CRITICAL", retentionDays: 2555, archiveAfterDays: 365, deleteAfterDays: 2555 },
  { severity: "WARNING", retentionDays: 1095, archiveAfterDays: 180, deleteAfterDays: 1095 },
  { severity: "INFO", retentionDays: 365, archiveAfterDays: 90, deleteAfterDays: 365 },
];

// ─── 1.8 AnomalyAlert & AnomalyRule ────────────────────────────────────────

export interface AnomalyAlert {
  alertId: string;
  ruleId: string;
  severity: "low" | "medium" | "high" | "critical";
  anomalyType: string;
  description: string;
  affectedEvents: string[];
  suggestedActions: string[];
  detectedAt: number;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
}

export interface AnomalyRule {
  ruleId: string;
  name: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  threshold: number;
  timeWindowMs: number;
  eventTypes: AuditEventType[];
  enabled: boolean;
}

// ─── 1.9 ComplianceFramework / ComplianceRequirement / ComplianceReport / ComplianceGap ─

export type ComplianceFramework = "SOC2" | "GDPR" | "PCI-DSS" | "HIPAA" | "ISO27001";

export interface ComplianceRequirement {
  requirementId: string;
  description: string;
  requiredEventTypes: AuditEventType[];
  minimumRetentionDays: number;
}

export interface ComplianceReport {
  framework: ComplianceFramework;
  timeRange: { start: number; end: number };
  generatedAt: number;
  coverageScore: number;
  totalRequirements: number;
  coveredRequirements: number;
  gaps: ComplianceGap[];
  eventStatistics: Record<AuditEventType, number>;
  riskEvents: AuditLogEntry[];
  reportHash: string;
}

export interface ComplianceGap {
  requirementId: string;
  description: string;
  missingEventTypes: AuditEventType[];
  recommendation: string;
}
