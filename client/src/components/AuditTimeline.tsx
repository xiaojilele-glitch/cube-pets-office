/**
 * AuditTimeline — vertical timeline showing audit events chronologically.
 *
 * Color-coded by severity: INFO=green, WARNING=amber, CRITICAL=red.
 *
 * @see Requirements AC-12.1
 */

import { Clock, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import type { AuditLogEntry, AuditSeverity } from "@shared/audit/contracts.js";
import { useAuditStore } from "@/lib/audit-store";

const SEVERITY_STYLES: Record<
  AuditSeverity,
  { bg: string; text: string; border: string }
> = {
  INFO: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-300",
  },
  WARNING: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-300",
  },
  CRITICAL: { bg: "bg-red-50", text: "text-red-700", border: "border-red-300" },
};

const SEVERITY_DOT: Record<AuditSeverity, string> = {
  INFO: "bg-emerald-500",
  WARNING: "bg-amber-500",
  CRITICAL: "bg-red-500",
};

function SeverityIcon({ severity }: { severity: AuditSeverity }) {
  const cls = "size-3.5";
  switch (severity) {
    case "CRITICAL":
      return <ShieldAlert className={`${cls} text-red-600`} />;
    case "WARNING":
      return <AlertTriangle className={`${cls} text-amber-600`} />;
    default:
      return <Info className={`${cls} text-emerald-600`} />;
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function getSeverity(entry: AuditLogEntry): AuditSeverity {
  // Derive severity from the event type registry or fall back to INFO
  const type = entry.event.eventType;
  if (
    type === "DECISION_MADE" ||
    type === "PERMISSION_GRANTED" ||
    type === "PERMISSION_REVOKED" ||
    type === "DATA_ACCESSED" ||
    type === "ESCALATION_APPROVED" ||
    type === "AUDIT_DELETE"
  ) {
    return "CRITICAL";
  }
  if (
    type === "AGENT_FAILED" ||
    type === "CONFIG_CHANGED" ||
    type === "ESCALATION_REQUESTED" ||
    type === "ANOMALY_DETECTED"
  ) {
    return "WARNING";
  }
  return "INFO";
}

export function AuditTimeline() {
  const entries = useAuditStore(s => s.entries);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-stone-400">
        <Clock className="mb-2 size-8" />
        <span>No audit events yet</span>
      </div>
    );
  }

  return (
    <div className="relative max-h-[460px] overflow-y-auto px-2 py-3">
      {/* Vertical line */}
      <div className="absolute left-5 top-0 bottom-0 w-px bg-stone-200" />

      <div className="space-y-4">
        {entries.map(entry => {
          const severity = getSeverity(entry);
          const styles = SEVERITY_STYLES[severity];
          const dot = SEVERITY_DOT[severity];

          return (
            <div key={entry.entryId} className="relative flex gap-4 pl-4">
              {/* Dot */}
              <div
                className={`relative z-10 mt-1.5 size-3 shrink-0 rounded-full ring-2 ring-white ${dot}`}
              />

              {/* Card */}
              <div
                className={`flex-1 rounded-xl border p-3 ${styles.bg} ${styles.border}`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <SeverityIcon severity={severity} />
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${styles.text} bg-white/60`}
                  >
                    {entry.event.eventType.replace(/_/g, " ")}
                  </span>
                  <span className="ml-auto text-stone-400">
                    {formatTime(entry.timestamp.system)}
                  </span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-stone-600">
                  <span>
                    <span className="font-medium">Actor:</span>{" "}
                    {entry.event.actor.name ?? entry.event.actor.id}
                  </span>
                  <span>
                    <span className="font-medium">Action:</span>{" "}
                    {entry.event.action}
                  </span>
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] font-semibold ${
                      entry.event.result === "success"
                        ? "bg-emerald-100 text-emerald-700"
                        : entry.event.result === "failure"
                          ? "bg-red-100 text-red-700"
                          : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {entry.event.result}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
