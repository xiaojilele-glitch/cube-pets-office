/**
 * 审计链 Socket 事件广播
 *
 * 提供审计事件、异常告警、验证结果的 Socket.IO 广播功能。
 * - broadcastAuditEvent()：新审计事件写入后广播
 * - broadcastAuditAnomaly()：异常检测告警广播
 * - setupAuditSocketBroadcast()：注册验证完成回调广播
 */

import { getSocketIO } from "../core/socket.js";
import { AUDIT_SOCKET_EVENTS } from "../../shared/audit/socket.js";
import type {
  AuditLogEntry,
  AnomalyAlert,
  VerificationResult,
} from "../../shared/audit/contracts.js";
import type { AuditVerifier } from "./audit-verifier.js";

// ─── 13.3 audit_verification 广播（通过 verifier 回调） ────────────────────

export function setupAuditSocketBroadcast(deps: {
  verifier: AuditVerifier;
}): void {
  deps.verifier.setOnVerificationComplete((result: VerificationResult) => {
    const io = getSocketIO();
    if (io) {
      io.emit(AUDIT_SOCKET_EVENTS.auditVerification, {
        result,
        issuedAt: Date.now(),
      });
    }
  });
}

// ─── 13.1 audit_event 广播（每次 append 后调用） ────────────────────────────

export function broadcastAuditEvent(entry: AuditLogEntry): void {
  const io = getSocketIO();
  if (io) {
    io.emit(AUDIT_SOCKET_EVENTS.auditEvent, {
      entry,
      event: entry.event,
      issuedAt: Date.now(),
    });
  }
}

// ─── 13.2 audit_anomaly 广播 ───────────────────────────────────────────────

export function broadcastAuditAnomaly(alert: AnomalyAlert): void {
  const io = getSocketIO();
  if (io) {
    io.emit(AUDIT_SOCKET_EVENTS.auditAnomaly, { alert, issuedAt: Date.now() });
  }
}
