import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
} from "lucide-react";

import type { MissionTaskSummary } from "@/lib/tasks-store";
import {
  workspaceCalloutClass,
  workspaceToneClass,
  type WorkspaceTone,
} from "@/components/workspace/workspace-tone";
import { cn } from "@/lib/utils";

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: WorkspaceTone;
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] border px-3 py-3",
        workspaceToneClass(tone)
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function CommandMonitorSummary({
  tasks,
  className,
}: {
  tasks: MissionTaskSummary[];
  className?: string;
}) {
  const running = tasks.filter(task => task.status === "running").length;
  const waiting = tasks.filter(task => task.status === "waiting").length;
  const completed = tasks.filter(task => task.status === "done").length;
  const warnings = tasks.filter(task => task.hasWarnings).length;

  return (
    <section
      className={cn(
        "rounded-[28px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_20px_60px_rgba(112,84,51,0.08)] backdrop-blur",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
            Monitoring
          </div>
          <div className="mt-2 text-lg font-semibold tracking-tight text-stone-900">
            The task loop closes on this page
          </div>
        </div>
        <div className="rounded-2xl bg-stone-100 p-2 text-stone-500">
          <LoaderCircle className="size-4" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <MetricTile label="Running" value={running} tone="warning" />
        <MetricTile label="Waiting" value={waiting} tone="info" />
        <MetricTile label="Completed" value={completed} tone="success" />
        <MetricTile label="Warnings" value={warnings} tone="danger" />
      </div>

      <div
        className={cn(
          workspaceCalloutClass(
            warnings > 0 ? "warning" : completed > 0 ? "success" : "info"
          ),
          "mt-4 px-4 py-3 text-sm leading-6"
        )}
      >
        <div className="flex items-center gap-2 font-semibold text-[var(--workspace-text-strong)]">
          {warnings > 0 ? (
            <AlertTriangle className="size-4 text-[var(--workspace-warning)]" />
          ) : completed > 0 ? (
            <CheckCircle2 className="size-4 text-[var(--workspace-success)]" />
          ) : (
            <Clock3 className="size-4 text-[var(--workspace-info)]" />
          )}
          Current cadence
        </div>
        <div className="mt-2 text-[var(--workspace-text)]">
          After a command is submitted, it lands back into the same task thread
          so you can observe, intervene, and close the loop below.
        </div>
      </div>
    </section>
  );
}
