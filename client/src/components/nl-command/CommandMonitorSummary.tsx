import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
} from "lucide-react";

import type { MissionTaskSummary } from "@/lib/tasks-store";
import { useI18n } from "@/i18n";
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
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const running = tasks.filter(task => task.status === "running").length;
  const waiting = tasks.filter(task => task.status === "waiting").length;
  const completed = tasks.filter(task => task.status === "done").length;
  const warnings = tasks.filter(task => task.hasWarnings).length;
  const text = {
    eyebrow: isZh ? "任务监控" : "Monitoring",
    title: isZh ? "任务闭环会在这页收口" : "The task loop closes on this page",
    running: isZh ? "执行中" : "Running",
    waiting: isZh ? "待处理" : "Waiting",
    completed: isZh ? "已完成" : "Completed",
    warnings: isZh ? "需关注" : "Warnings",
    cadence: isZh ? "当前节奏" : "Current cadence",
    description:
      warnings > 0
        ? isZh
          ? "指令落地后会回到同一条任务主线里，你可以直接在这里观察、干预并把闭环走完。"
          : "After a command is submitted, it lands back into the same task thread so you can observe, intervene, and close the loop below."
        : completed > 0
          ? isZh
            ? "已有任务在这条主线上完成闭环；后续新增指令也会继续回到这里统一推进。"
            : "Completed missions are already closing the loop on this page, and new commands will continue to land here."
          : isZh
            ? "当前还在蓄积任务上下文；一旦有新指令落地，这里会成为持续观察和操作的主位置。"
            : "This page becomes the main place to observe and intervene once a new command lands.",
  };

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
            {text.eyebrow}
          </div>
          <div className="mt-2 text-lg font-semibold tracking-tight text-stone-900">
            {text.title}
          </div>
        </div>
        <div className="rounded-2xl bg-stone-100 p-2 text-stone-500">
          <LoaderCircle className="size-4" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <MetricTile label={text.running} value={running} tone="warning" />
        <MetricTile label={text.waiting} value={waiting} tone="info" />
        <MetricTile label={text.completed} value={completed} tone="success" />
        <MetricTile label={text.warnings} value={warnings} tone="danger" />
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
          {text.cadence}
        </div>
        <div className="mt-2 text-[var(--workspace-text)]">
          {text.description}
        </div>
      </div>
    </section>
  );
}
