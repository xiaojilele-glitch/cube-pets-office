/**
 * ExecutorStatusPanel — displays Docker executor status within Mission detail.
 * Shows executor name, Job ID, current status, last event time,
 * a progress bar when running, and a list of artifacts.
 *
 * @see Requirements 5.1, 5.2, 5.3
 */
import { Box, Clock, FileOutput, Loader2, Server } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type {
  MissionArtifact,
  MissionExecutorContext,
  MissionInstanceContext,
} from "@shared/mission/contracts";
import { cn } from "@/lib/utils";

export interface ExecutorStatusPanelProps {
  executor?: MissionExecutorContext;
  instance?: MissionInstanceContext;
  artifacts?: MissionArtifact[];
}

const STATUS_STYLES: Record<string, { dot: string; badge: string; label: string }> = {
  queued: {
    dot: "bg-stone-400",
    badge: "border-stone-200 bg-stone-50 text-stone-600",
    label: "Queued",
  },
  running: {
    dot: "bg-sky-500 animate-pulse",
    badge: "border-sky-200 bg-sky-50 text-sky-700",
    label: "Running",
  },
  completed: {
    dot: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    label: "Completed",
  },
  failed: {
    dot: "bg-rose-500",
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    label: "Failed",
  },
};

function statusStyle(status: string | undefined) {
  return STATUS_STYLES[status ?? ""] ?? STATUS_STYLES.queued;
}

function formatEventTime(ts: number | undefined): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(ts));
}

const ARTIFACT_KIND_ICON: Record<string, typeof FileOutput> = {
  file: FileOutput,
  report: FileOutput,
  url: FileOutput,
  log: FileOutput,
};

export function ExecutorStatusPanel({
  executor,
  instance,
  artifacts,
}: ExecutorStatusPanelProps) {
  if (!executor) return null;

  const style = statusStyle(executor.status);
  const isRunning = executor.status === "running";

  return (
    <div className="space-y-3" data-testid="executor-status-panel">
      {/* Header row: executor name + status badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-stone-500" />
          <span className="text-sm font-semibold text-stone-900">
            {executor.name}
          </span>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
            style.badge,
          )}
        >
          <span className={cn("size-1.5 rounded-full", style.dot)} />
          {style.label}
        </span>
      </div>

      {/* Info tiles */}
      <div className="grid gap-2 sm:grid-cols-2">
        {executor.jobId && (
          <div className="rounded-[16px] border border-stone-200/80 bg-stone-50/70 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              Job ID
            </div>
            <div className="mt-0.5 truncate text-xs font-medium text-stone-800">
              {executor.jobId}
            </div>
          </div>
        )}
        <div className="rounded-[16px] border border-stone-200/80 bg-stone-50/70 px-3 py-2">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            <Clock className="size-3" />
            Last Event
          </div>
          <div className="mt-0.5 text-xs font-medium text-stone-800">
            {formatEventTime(executor.lastEventAt)}
          </div>
        </div>
      </div>

      {/* Progress bar — visible only when running */}
      {isRunning && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            <Loader2 className="size-3 animate-spin text-sky-500" />
            Executing…
          </div>
          <Progress className="h-1.5 bg-sky-100" value={undefined} />
        </div>
      )}

      {/* Instance info (if available) */}
      {instance?.image && (
        <div className="rounded-[16px] border border-stone-200/80 bg-stone-50/70 px-3 py-2">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            <Box className="size-3" />
            Container
          </div>
          <div className="mt-0.5 truncate text-xs font-medium text-stone-800">
            {instance.image}
          </div>
        </div>
      )}

      {/* Artifacts list */}
      {artifacts && artifacts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            Artifacts ({artifacts.length})
          </div>
          <div className="space-y-1">
            {artifacts.map((artifact, idx) => {
              const Icon = ARTIFACT_KIND_ICON[artifact.kind] ?? FileOutput;
              return (
                <div
                  key={`${artifact.name}-${idx}`}
                  className="flex items-start gap-2 rounded-[14px] border border-stone-200/80 bg-white/80 px-3 py-2"
                >
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-stone-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-stone-900">
                        {artifact.name}
                      </span>
                      <span className="shrink-0 rounded-full border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                        {artifact.kind}
                      </span>
                    </div>
                    {artifact.description && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-stone-500">
                        {artifact.description}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
