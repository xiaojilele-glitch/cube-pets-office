import { useEffect } from "react";
import { AlertTriangle, Ban, CheckCircle2, Eye, XCircle } from "lucide-react";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { useAuditStore } from "@/lib/audit-store";
import type { AnomalyAlert } from "@shared/audit/contracts.js";

const SEVERITY_BADGE: Record<
  AnomalyAlert["severity"],
  { background: string; text: string }
> = {
  low: { background: "bg-stone-100", text: "text-stone-600" },
  medium: { background: "bg-amber-100", text: "text-amber-700" },
  high: { background: "bg-orange-100", text: "text-orange-700" },
  critical: { background: "bg-red-100", text: "text-red-700" },
};

const STATUS_ICON: Record<AnomalyAlert["status"], typeof AlertTriangle> = {
  open: AlertTriangle,
  acknowledged: Eye,
  resolved: CheckCircle2,
  dismissed: Ban,
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function AlertCard({
  alert,
  onStatusChange,
}: {
  alert: AnomalyAlert;
  onStatusChange: (alertId: string, status: string) => void;
}) {
  const severity = SEVERITY_BADGE[alert.severity];
  const StatusIcon = STATUS_ICON[alert.status];

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${severity.background} ${severity.text}`}
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
        Detected: {formatTime(alert.detectedAt)} | Affected events:{" "}
        {alert.affectedEvents.length}
      </div>

      {alert.suggestedActions.length > 0 ? (
        <div className="mt-2 rounded-lg bg-stone-50 p-2">
          <p className="text-[10px] font-semibold text-stone-500">
            Suggested actions:
          </p>
          <ul className="mt-1 space-y-0.5 text-[10px] text-stone-600">
            {alert.suggestedActions.map((action, index) => (
              <li key={index} className="flex items-start gap-1">
                <span className="mt-0.5 text-stone-400">-</span>
                {action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {alert.status === "open" ? (
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => onStatusChange(alert.alertId, "acknowledged")}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-100"
          >
            <Eye className="size-3" />
            Acknowledge
          </button>
          <button
            type="button"
            onClick={() => onStatusChange(alert.alertId, "resolved")}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            <CheckCircle2 className="size-3" />
            Resolve
          </button>
          <button
            type="button"
            onClick={() => onStatusChange(alert.alertId, "dismissed")}
            className="inline-flex items-center gap-1 rounded-lg bg-stone-50 px-2 py-1 text-[10px] font-semibold text-stone-500 transition-colors hover:bg-stone-100"
          >
            <XCircle className="size-3" />
            Dismiss
          </button>
        </div>
      ) : null}

      {alert.status === "acknowledged" ? (
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => onStatusChange(alert.alertId, "resolved")}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            <CheckCircle2 className="size-3" />
            Resolve
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AnomalyAlertPanel() {
  const anomalies = useAuditStore(state => state.anomalies);
  const loadingAnomalies = useAuditStore(state => state.loadingAnomalies);
  const hasLoadedAnomalies = useAuditStore(state => state.hasLoadedAnomalies);
  const anomaliesError = useAuditStore(state => state.anomaliesError);
  const fetchAnomalies = useAuditStore(state => state.fetchAnomalies);
  const updateAnomalyStatus = useAuditStore(state => state.updateAnomalyStatus);

  useEffect(() => {
    void fetchAnomalies();
  }, [fetchAnomalies]);

  if (loadingAnomalies && !hasLoadedAnomalies) {
    return (
      <div className="py-10 text-center text-sm text-stone-400">
        Loading anomaly alerts...
      </div>
    );
  }

  if (anomaliesError && anomalies.length === 0) {
    return (
      <div className="p-2">
        <EmptyHintBlock
          tone={anomaliesError.kind === "error" ? "danger" : "warning"}
          icon={<AlertTriangle className="size-5" />}
          title={
            anomaliesError.kind === "demo"
              ? "Anomaly alerts are unavailable in preview mode"
              : anomaliesError.kind === "offline"
                ? "Anomaly alerts could not be loaded"
                : "Anomaly alert request failed"
          }
          description={
            anomaliesError.kind === "demo"
              ? "The frontend is running without live audit data, so no anomaly alerts can be fetched yet."
              : anomaliesError.kind === "offline"
                ? "The backend audit service is unreachable, so the anomaly feed could not load."
                : "The anomaly API returned an unexpected result, and the raw parser error was hidden from the UI."
          }
          hint={anomaliesError.message}
          actionLabel="Retry"
          onAction={() => void fetchAnomalies()}
        />
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div className="p-2">
        <EmptyHintBlock
          tone="info"
          icon={<CheckCircle2 className="size-5" />}
          title="No anomaly alerts yet"
          description="No audit rule has raised a data anomaly during the current window, so this panel is empty for now."
          hint="When the detector flags suspicious activity, the alert list and suggested actions will appear here."
          actionLabel="Refresh"
          onAction={() => void fetchAnomalies()}
        />
      </div>
    );
  }

  return (
    <div className="max-h-[460px] space-y-2 overflow-y-auto p-2">
      {anomalies.map(alert => (
        <AlertCard
          key={alert.alertId}
          alert={alert}
          onStatusChange={(alertId, status) =>
            void updateAnomalyStatus(alertId, status)
          }
        />
      ))}
    </div>
  );
}
