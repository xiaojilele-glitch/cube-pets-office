/**
 * 审计链 Socket 事件常量与载荷类型
 */

import type {
  AuditEvent,
  AuditLogEntry,
  AnomalyAlert,
  VerificationResult,
} from "./contracts.js";

// ─── Socket 事件名 ─────────────────────────────────────────────────────────

export const AUDIT_SOCKET_EVENTS = {
  auditEvent: "audit_event",
  auditAnomaly: "audit_anomaly",
  auditVerification: "audit_verification",
} as const;

// ─── 载荷接口 ──────────────────────────────────────────────────────────────

export interface AuditEventPayload {
  entry: AuditLogEntry;
  event: AuditEvent;
  issuedAt: number;
}

export interface AuditAnomalyPayload {
  alert: AnomalyAlert;
  issuedAt: number;
}

export interface AuditVerificationPayload {
  result: VerificationResult;
  issuedAt: number;
}

export type AuditSocketPayload =
  | AuditEventPayload
  | AuditAnomalyPayload
  | AuditVerificationPayload;
