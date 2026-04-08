/**
 * AnomalyAlertPanel — anomaly alert list with severity, status management,
 * and suggested actions.
 *
 * @see Requirements AC-12.5
 */

import { useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Ban,
} from "lucide-react";
import type { AnomalyAlert } from "@shared/audit/contracts.js";
import { useAuditStore } from "@/lib/audit-store";

const SEVERITY_BADGE: Record<
  AnomalyAlert["severity"],
  { bg: string; text: string }
> = {
  low: { bg: "bg-stone-100", text: "text-stone-600" },
  medium: { bg: "bg-amber-100", text: "text-amber-700" },
  high: { bg: "bg-orange-100", text: "text-orange-700" },
  critical: { bg: "bg-red-100", text: "text-red-700" },
};

const STATUS_ICON: Record<AnomalyAlert["status"], typeof AlertTriangle> = {
  open: AlertTriangle,
  acknowledged: Eye,
  resolved: CheckCircle2,
  dismissed: Ban,
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function AlertCard({
  alert,
  onStatusChange,
}: {
  alert: AnomalyAlert;
  onStatusChange: (alertId: string, status: string) => void;
}) {
  const sev = SEVERITY_BADGE[alert.severity];
  const StatusIcon = STATUS_ICON[alert.status];

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${sev.bg} ${sev.text}`}
          >
            {alert.severity}
          </span>
          <span className="text-xs font-semibold text-stone-700">
            {alert.anomalyType.replace(/_/g, " ")}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-stone-400">
          <StatusIcon className="size-3" />
          {alert.status}
        </div>
      </div>

      <p className="mt-1.5 text-xs text-stone-600">{alert.description}</p>

      <div className="mt-1.5 text-[10px] text-stone-400">
        Detected: {formatTime(alert.detectedAt)} · Affected events:{" "}
        {alert.affectedEvents.length}
      </div>

      {/* Suggested actions */}
      {alert.suggestedActions.length > 0 && (
        <div className="mt-2 rounded-lg bg-stone-50 p-2">
          <p className="text-[10px] font-semibold text-stone-500">
            Suggested actions:
          </p>
          <ul className="mt-1 space-y-0.5 text-[10px] text-stone-600">
            {alert.suggestedActions.map((action, i) => (
              <li key={i} className="flex items-start gap-1">
                <span className="mt-0.5 text-stone-400">•</span>
                {action}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Status actions */}
      {alert.status === "open" && (
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => onStatusChange(alert.alertId, "acknowledged")}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-100"
          >
            <Eye className="size-3" />
            Acknowledge
          </button>
          <button
            onClick={() => onStatusChange(alert.alertId, "resolved")}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            <CheckCircle2 className="size-3" />
            Resolve
          </button>
          <button
            onClick={() => onStatusChange(alert.alertId, "dismissed")}
            className="inline-flex items-center gap-1 rounded-lg bg-stone-50 px-2 py-1 text-[10px] font-semibold text-stone-500 transition-colors hover:bg-stone-100"
          >
            <XCircle className="size-3" />
            Dismiss
          </button>
        </div>
      )}
      {alert.status === "acknowledged" && (
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => onStatusChange(alert.alertId, "resolved")}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            <CheckCircle2 className="size-3" />
            Resolve
          </button>
        </div>
      )}
    </div>
  );
}

export function AnomalyAlertPanel() {
  const anomalies = useAuditStore((s) => s.anomalies);
  const fetchAnomalies = useAuditStore((s) => s.fetchAnomalies);
  const updateAnomalyStatus = useAuditStore((s) => s.updateAnomalyStatus);

  useEffect(() => {
    void fetchAnomalies();
  }, [fetchAnomalies]);

  if (anomalies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-stone-400">
        <CheckCircle2 className="mb-2 size-8" />
        <span>No anomaly alerts</span>
      </div>
    );
  }

  return (
    <div className="max-h-[460px] space-y-2 overflow-y-auto p-2">
      {anomalies.map((alert) => (
        <AlertCard
          key={alert.alertId}
          alert={alert}
          onStatusChange={(id, status) => void updateAnomalyStatus(id, status)}
        />
      ))}
    </div>
  );
}
