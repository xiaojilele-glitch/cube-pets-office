import type { Alert } from "@shared/nl-command/contracts";

/**
 * Color-coded alert list panel showing real-time alerts.
 *
 * @see Requirements 10.2
 */
export interface AlertPanelProps {
  alerts: Alert[];
}

const PRIORITY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  critical: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b" },
  warning: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e" },
  info: { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af" },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AlertPanel({ alerts }: AlertPanelProps) {
  if (alerts.length === 0) {
    return <div className="py-4 text-center text-sm text-stone-400">No alerts.</div>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {alerts.map((a) => {
        const style = PRIORITY_STYLES[a.priority] ?? PRIORITY_STYLES.info;
        return (
          <li
            key={a.alertId}
            className="rounded-lg border px-3 py-2"
            style={{ backgroundColor: style.bg, borderColor: style.border }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: style.text }}>
                {a.type.replace(/_/g, " ")}
              </span>
              <span className="text-[10px] text-stone-500">{formatTime(a.triggeredAt)}</span>
            </div>
            <div className="mt-0.5 text-xs" style={{ color: style.text }}>
              {a.message}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
