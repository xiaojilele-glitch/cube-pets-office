import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Download,
  FileText,
  FolderKanban,
  LoaderCircle,
  Orbit,
  Sparkles,
  TimerReset,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { MissionTaskDetail, TaskArtifact } from "@/lib/tasks-store";
import { useWorkflowStore } from "@/lib/workflow-store";
import { cn } from "@/lib/utils";

import { TaskPlanetInterior } from "./TaskPlanetInterior";
import {
  artifactActionLabel,
  compactText,
  downloadAttachmentArtifact,
  formatTaskDate,
  formatTaskRelative,
  missionStatusLabel,
  missionStatusTone,
  timelineTone,
} from "./task-helpers";

const WORK_PACKAGE_PROGRESS: Record<string, number> = {
  assigned: 8,
  executing: 34,
  submitted: 58,
  reviewed: 72,
  audited: 80,
  revising: 66,
  verified: 100,
  passed: 100,
  failed: 36,
};

function workPackageProgress(status: string): number {
  return WORK_PACKAGE_PROGRESS[status] || 12;
}

function toneFromDecisionTone(
  tone: "primary" | "secondary" | "warning"
): string {
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100";
  }
  if (tone === "secondary") {
    return "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100";
  }
  return "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100";
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/70 bg-white/70 px-4 py-4 shadow-sm backdrop-blur">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-stone-900">{value}</div>
      <div className="mt-1 text-xs leading-5 text-stone-500">{hint}</div>
    </div>
  );
}

function KeyValueList({
  rows,
}: {
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <div
          key={row.label}
          className="rounded-2xl border border-stone-200/80 bg-stone-50/80 px-3 py-3"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {row.label}
          </div>
          <div className="mt-1 break-words text-sm leading-6 text-stone-800">
            {row.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TaskDetailView({
  detail,
  decisionNote,
  onDecisionNoteChange,
  onLaunchDecision,
  launchingPresetId,
  className,
}: {
  detail: MissionTaskDetail | null;
  decisionNote: string;
  onDecisionNoteChange: (next: string) => void;
  onLaunchDecision: (presetId: string) => void | Promise<void>;
  launchingPresetId?: string | null;
  className?: string;
}) {
  const downloadWorkflowReport = useWorkflowStore(
    state => state.downloadWorkflowReport
  );
  const downloadDepartmentReport = useWorkflowStore(
    state => state.downloadDepartmentReport
  );
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<
    string | null
  >(null);

  const orderedArtifacts = useMemo(() => {
    return [...(detail?.artifacts || [])].sort((left, right) => {
      const leftScore =
        left.kind === "attachment"
          ? 2
          : left.kind === "department_report"
            ? 1
            : 0;
      const rightScore =
        right.kind === "attachment"
          ? 2
          : right.kind === "department_report"
            ? 1
            : 0;
      return leftScore - rightScore;
    });
  }, [detail?.artifacts]);

  if (!detail) {
    return (
      <Empty
        className={cn(
          "rounded-[28px] border-stone-200/80 bg-stone-50/80",
          className
        )}
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderKanban />
          </EmptyMedia>
          <EmptyTitle>Select a mission</EmptyTitle>
          <EmptyDescription>
            Pick a task from the left rail to inspect its detail, interior,
            timeline, artifacts, and decision entry.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  async function handleArtifactDownload(artifact: TaskArtifact) {
    if (artifact.downloadKind === "attachment") {
      downloadAttachmentArtifact(artifact);
      return;
    }

    if (
      !artifact.workflowId ||
      (artifact.format !== "json" && artifact.format !== "md")
    ) {
      return;
    }

    setDownloadingArtifactId(artifact.id);
    try {
      if (artifact.downloadKind === "department" && artifact.managerId) {
        await downloadDepartmentReport(
          artifact.workflowId,
          artifact.managerId,
          artifact.format
        );
        return;
      }

      await downloadWorkflowReport(artifact.workflowId, artifact.format);
    } finally {
      setDownloadingArtifactId(null);
    }
  }

  return (
    <div className={cn("space-y-6", className)}>
      <section className="overflow-hidden rounded-[30px] border border-stone-200/80 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_28%),linear-gradient(180deg,#fffdf8,#f7f0e6)] p-6 shadow-[0_30px_80px_rgba(113,83,49,0.12)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <div className="flex flex-wrap gap-2">
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  missionStatusTone(detail.status)
                )}
              >
                {missionStatusLabel(detail.status)}
              </span>
              <span className="rounded-full border border-stone-200 bg-white/70 px-3 py-1 text-xs font-medium text-stone-700">
                {detail.kind}
              </span>
              {detail.departmentLabels.map(label => (
                <span
                  key={label}
                  className="rounded-full border border-white/80 bg-white/65 px-3 py-1 text-xs text-stone-600"
                >
                  {label}
                </span>
              ))}
            </div>
            <h1 className="mt-4 max-w-4xl text-3xl font-semibold tracking-tight text-stone-900 md:text-4xl">
              {detail.title}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-700 md:text-base">
              {detail.summary}
            </p>
          </div>

          <div className="rounded-[22px] border border-white/75 bg-white/70 px-4 py-4 text-sm text-stone-700 shadow-sm backdrop-blur">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
              Live signal
            </div>
            <div className="mt-2 max-w-[280px] text-sm leading-6">
              {detail.lastSignal ||
                detail.waitingFor ||
                "No recent signal yet."}
            </div>
            <div className="mt-3 text-xs text-stone-500">
              Updated {formatTaskRelative(detail.updatedAt)}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Progress"
            value={`${detail.progress}%`}
            hint={detail.currentStageLabel || "No active stage yet"}
          />
          <MetricCard
            label="Work Packages"
            value={`${detail.completedTaskCount}/${detail.taskCount}`}
            hint="Completed versus total tasks"
          />
          <MetricCard
            label="Agents"
            value={`${detail.activeAgentCount}`}
            hint="Currently active robots"
          />
          <MetricCard
            label="Messages"
            value={`${detail.messageCount}`}
            hint="Observed coordination messages"
          />
          <MetricCard
            label="Artifacts"
            value={`${detail.artifacts.length}`}
            hint="Reports and linked references"
          />
        </div>

        <div className="mt-6 rounded-[24px] border border-white/75 bg-white/70 p-4 shadow-sm backdrop-blur">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
            Source Directive
          </div>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-700">
            {detail.sourceText}
          </div>
        </div>
      </section>

      <TaskPlanetInterior detail={detail} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="space-y-6">
          <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-stone-900">
                <Workflow className="size-4 text-amber-600" />
                Work Packages
              </CardTitle>
              <CardDescription>
                Delivery snapshots from workers, review loops, revisions, and
                scores.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.tasks.length > 0 ? (
                detail.tasks.map(task => (
                  <div
                    key={task.id}
                    className="rounded-[24px] border border-stone-200/80 bg-stone-50/80 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-stone-200 bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                            #{task.id}
                          </span>
                          <span className="rounded-full border border-stone-200 bg-white/75 px-2.5 py-1 text-[11px] text-stone-600">
                            {task.department}
                          </span>
                          <span className="rounded-full border border-stone-200 bg-white/75 px-2.5 py-1 text-[11px] text-stone-600">
                            v{task.version}
                          </span>
                        </div>
                        <div className="mt-3 text-sm font-medium leading-6 text-stone-900">
                          {task.description}
                        </div>
                      </div>
                      <div className="min-w-[130px]">
                        <div className="flex items-center justify-between text-xs text-stone-500">
                          <span>{task.status}</span>
                          <span>{workPackageProgress(task.status)}%</span>
                        </div>
                        <Progress
                          className="mt-2 h-2 bg-stone-200"
                          value={workPackageProgress(task.status)}
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <div className="rounded-2xl border border-stone-200/80 bg-white/80 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Deliverable Preview
                        </div>
                        <div className="mt-2 text-sm leading-6 text-stone-700">
                          {compactText(
                            task.deliverable_v3 ||
                              task.deliverable_v2 ||
                              task.deliverable ||
                              "No deliverable text captured yet.",
                            260
                          )}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-stone-200/80 bg-white/80 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Review Signals
                        </div>
                        <div className="mt-2 space-y-2 text-sm leading-6 text-stone-700">
                          <div>Total score: {task.total_score ?? "n/a"}</div>
                          {task.manager_feedback ? (
                            <div>Manager: {task.manager_feedback}</div>
                          ) : null}
                          {task.meta_audit_feedback ? (
                            <div>Audit: {task.meta_audit_feedback}</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/70 px-4 py-6 text-sm leading-6 text-stone-500">
                  The workflow has not emitted work packages yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-stone-900">
                <TimerReset className="size-4 text-sky-600" />
                Timeline
              </CardTitle>
              <CardDescription>
                Workflow events, task transitions, and the latest coordination
                messages.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.timeline.length > 0 ? (
                detail.timeline.map(event => (
                  <div key={event.id} className="relative pl-8">
                    <div className="absolute left-[9px] top-0 h-full w-px bg-stone-200" />
                    <div
                      className={cn(
                        "absolute left-0 top-1.5 size-[18px] rounded-full border shadow-sm",
                        timelineTone(event.level)
                      )}
                    />
                    <div className="rounded-[22px] border border-stone-200/80 bg-stone-50/70 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-stone-900">
                            {event.title}
                          </div>
                          <div className="mt-1 text-sm leading-6 text-stone-600">
                            {event.description}
                          </div>
                        </div>
                        <div className="text-right text-xs text-stone-500">
                          <div>{formatTaskDate(event.time)}</div>
                          {event.actor ? (
                            <div className="mt-1">{event.actor}</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/70 px-4 py-6 text-sm leading-6 text-stone-500">
                  No timeline signals have been captured yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-stone-900">
                <Sparkles className="size-4 text-teal-600" />
                Decision Entry
              </CardTitle>
              <CardDescription>
                Launch a follow-up workflow without touching shared contracts or
                refreshing the page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={decisionNote}
                onChange={event => onDecisionNoteChange(event.target.value)}
                className="min-h-28 rounded-[20px] border-stone-200 bg-stone-50/80 text-sm leading-6 text-stone-700"
                placeholder="Optional steering: add emphasis, constraints, or the exact question the next workflow should answer."
              />
              <div className="space-y-2.5">
                {detail.decisionPresets.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn(
                      "w-full rounded-[20px] border px-4 py-3 text-left transition-colors",
                      toneFromDecisionTone(preset.tone)
                    )}
                    onClick={() => void onLaunchDecision(preset.id)}
                    disabled={launchingPresetId === preset.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          {preset.label}
                        </div>
                        <div className="mt-1 text-xs leading-5 opacity-80">
                          {preset.description}
                        </div>
                      </div>
                      {launchingPresetId === preset.id ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <ArrowUpRight className="size-4" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-stone-900">
                <Orbit className="size-4 text-amber-600" />
                Instance Info
              </CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueList rows={detail.instanceInfo} />
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-stone-900">
                <Bot className="size-4 text-sky-600" />
                Log Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueList rows={detail.logSummary} />
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-stone-900">
                <FileText className="size-4 text-teal-600" />
                Artifacts
              </CardTitle>
              <CardDescription>
                Workflow reports, department summaries, and captured input
                attachments.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {orderedArtifacts.length > 0 ? (
                orderedArtifacts.map((artifact, index) => (
                  <div key={artifact.id}>
                    {index > 0 ? (
                      <Separator className="mb-3 bg-stone-200/80" />
                    ) : null}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-stone-900">
                          {artifact.title}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-stone-500">
                          {artifact.description ||
                            artifact.href ||
                            "Downloadable artifact"}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 rounded-full border-stone-200 bg-white/80"
                        onClick={() => void handleArtifactDownload(artifact)}
                        disabled={
                          downloadingArtifactId === artifact.id ||
                          (!artifact.workflowId &&
                            artifact.downloadKind !== "attachment")
                        }
                      >
                        {downloadingArtifactId === artifact.id ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Download className="size-4" />
                        )}
                        {artifactActionLabel(artifact)}
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/70 px-4 py-6 text-sm leading-6 text-stone-500">
                  No artifacts are linked to this workflow yet.
                </div>
              )}
            </CardContent>
          </Card>

          {detail.failureReasons.length > 0 ? (
            <Card className="rounded-[28px] border-rose-200/80 bg-rose-50/70 shadow-[0_24px_60px_rgba(175,69,95,0.08)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-rose-900">
                  <AlertTriangle className="size-4 text-rose-600" />
                  Failure Reasons
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {detail.failureReasons.map(reason => (
                  <div
                    key={reason}
                    className="rounded-2xl border border-rose-200/80 bg-white/75 px-3 py-3 text-sm leading-6 text-rose-900"
                  >
                    {reason}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
