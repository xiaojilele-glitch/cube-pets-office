import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Coins,
  Download,
  FileText,
  FolderKanban,
  History,
  LoaderCircle,
  Shield,
  Sparkles,
  TimerReset,
  Workflow,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { useViewportTier } from "@/hooks/useViewportTier";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  MissionOperatorActionLoadingMap,
  MissionTaskDetail,
  TaskArtifact,
} from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { ExecutorStatusPanel } from "@/components/ExecutorStatusPanel";
import { ExecutorTerminalPanel } from "@/components/ExecutorTerminalPanel";

import { useCostStore } from "@/lib/cost-store";
import { useRAGStore } from "@/lib/rag-store";
import { RAGInfoPanel } from "@/components/rag/RAGInfoPanel";
import { RAGDebugPanel } from "@/components/rag/RAGDebugPanel";

import { ArtifactListBlock } from "./ArtifactListBlock";
import { ArtifactPreviewDialog } from "./ArtifactPreviewDialog";
import { DecisionHistory } from "./DecisionHistory";
import { DecisionPanel } from "./DecisionPanel";
import { OperatorActionBar } from "./OperatorActionBar";
import { TaskPlanetInterior } from "./TaskPlanetInterior";
import {
  compactText,
  downloadAttachmentArtifact,
  formatTaskDate,
  formatTaskRelative,
  isMissionTerminal,
  missionOperatorStateLabel,
  missionOperatorStateTone,
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
    <div className="rounded-[20px] border border-white/70 bg-white/72 px-3.5 py-3.5 shadow-sm backdrop-blur">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500">
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold text-stone-900 md:text-2xl">
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-stone-500">{hint}</div>
    </div>
  );
}

function DetailTextDialog({
  title,
  description,
  text,
  buttonLabel = "More",
}: {
  title: string;
  description?: string;
  text: string;
  buttonLabel?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-stone-200 bg-white/80 text-xs"
        >
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl rounded-[24px] border-stone-200 bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]">
        <DialogHeader className="border-b border-stone-200/80 px-6 py-5">
          <DialogTitle className="text-stone-900">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-sm leading-6 text-stone-500">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] w-full">
          <div className="whitespace-pre-wrap px-6 py-5 text-sm leading-7 text-stone-700">
            {text}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ExcerptBlock({
  title,
  description,
  text,
  maxLength,
  emptyText,
  className,
}: {
  title: string;
  description?: string;
  text: string;
  maxLength: number;
  emptyText?: string;
  className?: string;
}) {
  const normalized = text.trim();
  const fallback = emptyText || "No detail captured yet.";
  const resolved = normalized || fallback;
  const preview = compactText(resolved, maxLength);
  const isTruncated = normalized.length > maxLength;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
        {title}
      </div>
      <div className="text-sm leading-6 text-stone-700">{preview}</div>
      {isTruncated ? (
        <DetailTextDialog
          title={title}
          description={description}
          text={resolved}
        />
      ) : null}
    </div>
  );
}

function SnapshotTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium leading-6 text-stone-800">
        {value}
      </div>
    </div>
  );
}

function DetailTabViewport({
  isDesktop,
  children,
}: {
  isDesktop: boolean;
  children: ReactNode;
}) {
  if (!isDesktop) {
    return <div className="space-y-4">{children}</div>;
  }

  return (
    <div className="h-full min-h-0 overflow-hidden rounded-[28px] border border-stone-200/80 bg-white/55 p-2 shadow-[0_24px_60px_rgba(112,84,51,0.06)]">
      <ScrollArea className="h-full w-full">
        <div className="space-y-4 p-1 pr-3">{children}</div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost tab — Mission cost details, token timeline, cost curve
// @see Requirements 10.1, 10.2, 10.3
// ---------------------------------------------------------------------------

const TOKEN_AREA_COLORS = { in: "#6366f1", out: "#10b981" } as const;
const COST_LINE_COLOR = "#d07a4f";

function formatCostValue(v: number): string {
  return `$${v.toFixed(4)}`;
}

function formatTokenCount(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function MissionCostTab() {
  const snapshot = useCostStore((s) => s.snapshot);
  const history = useCostStore((s) => s.history);

  // Derive per-agent token breakdown for AreaChart
  const agentTokenData = useMemo(() => {
    if (!snapshot?.agentCosts.length) return [];
    return snapshot.agentCosts.map((a) => ({
      name: a.agentName || a.agentId,
      tokensIn: a.tokensIn,
      tokensOut: a.tokensOut,
      cost: a.totalCost,
    }));
  }, [snapshot?.agentCosts]);

  // Derive history cost curve for LineChart
  const historyCurveData = useMemo(() => {
    if (!history.length) return [];
    return history.map((m) => ({
      name: m.title.length > 12 ? `${m.title.slice(0, 12)}…` : m.title,
      cost: m.totalCost,
      tokens: m.totalTokensIn + m.totalTokensOut,
    }));
  }, [history]);

  if (!snapshot) {
    return (
      <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
        <CardContent className="py-10 text-center text-sm text-stone-500">
          No cost data available. Cost metrics will appear once LLM calls are
          recorded.
        </CardContent>
      </Card>
    );
  }

  const budgetPct = Math.min(Math.round(snapshot.budgetUsedPercent * 100), 100);
  const tokenPct = Math.min(Math.round(snapshot.tokenUsedPercent * 100), 100);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Cost"
          value={formatCostValue(snapshot.totalCost)}
          hint={`Budget ${budgetPct}% used`}
        />
        <MetricCard
          label="Tokens In"
          value={formatTokenCount(snapshot.totalTokensIn)}
          hint={`Token budget ${tokenPct}% used`}
        />
        <MetricCard
          label="Tokens Out"
          value={formatTokenCount(snapshot.totalTokensOut)}
          hint={`${snapshot.totalCalls} LLM calls`}
        />
        <MetricCard
          label="Budget Remaining"
          value={`${Math.max(100 - budgetPct, 0)}%`}
          hint={`$${(snapshot.budget.maxCost - snapshot.totalCost).toFixed(4)} left`}
        />
      </div>

      {/* Budget progress */}
      <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-stone-900">
            <Coins className="size-4 text-amber-600" />
            Budget Usage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>Cost</span>
              <span>{budgetPct}%</span>
            </div>
            <Progress className="mt-1 h-2 bg-stone-200" value={budgetPct} />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>Tokens</span>
              <span>{tokenPct}%</span>
            </div>
            <Progress className="mt-1 h-2 bg-stone-200" value={tokenPct} />
          </div>
        </CardContent>
      </Card>

      {/* Token consumption timeline — AreaChart by agent */}
      {agentTokenData.length > 0 && (
        <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-stone-900">
              <Coins className="size-4 text-indigo-600" />
              Token Consumption by Agent
            </CardTitle>
            <CardDescription>
              Input and output token breakdown per agent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={agentTokenData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#a8a29e" />
                <YAxis tick={{ fontSize: 11 }} stroke="#a8a29e" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e7e5e4",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="tokensIn"
                  name="Tokens In"
                  stackId="1"
                  stroke={TOKEN_AREA_COLORS.in}
                  fill={TOKEN_AREA_COLORS.in}
                  fillOpacity={0.35}
                />
                <Area
                  type="monotone"
                  dataKey="tokensOut"
                  name="Tokens Out"
                  stackId="1"
                  stroke={TOKEN_AREA_COLORS.out}
                  fill={TOKEN_AREA_COLORS.out}
                  fillOpacity={0.35}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Cost accumulation curve — LineChart from history */}
      {historyCurveData.length > 0 && (
        <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-stone-900">
              <Coins className="size-4 text-orange-600" />
              Cost Accumulation Curve
            </CardTitle>
            <CardDescription>
              Historical mission cost trend (last {historyCurveData.length}{" "}
              missions).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={historyCurveData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#a8a29e" />
                <YAxis tick={{ fontSize: 11 }} stroke="#a8a29e" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e7e5e4",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [
                    formatCostValue(value),
                    "Cost",
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="cost"
                  name="Cost ($)"
                  stroke={COST_LINE_COLOR}
                  strokeWidth={2}
                  dot={{ r: 3, fill: COST_LINE_COLOR }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Downgrade status */}
      {snapshot.downgradeLevel !== "none" && (
        <Card className="rounded-[28px] border-amber-200/80 bg-amber-50/70 shadow-[0_24px_60px_rgba(175,140,69,0.08)]">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="size-5 text-amber-600" />
            <span className="text-sm font-medium text-amber-900">
              Degradation active:{" "}
              <span className="font-semibold uppercase">
                {snapshot.downgradeLevel}
              </span>
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function TaskDetailView({
  detail,
  decisionNote,
  onDecisionNoteChange,
  onLaunchDecision,
  launchingPresetId,
  onSubmitOperatorAction,
  operatorActionLoading,
  onDecisionSubmitted,
  className,
}: {
  detail: MissionTaskDetail | null;
  decisionNote: string;
  onDecisionNoteChange: (next: string) => void;
  onLaunchDecision: (presetId: string) => void | Promise<void>;
  launchingPresetId?: string | null;
  onSubmitOperatorAction?: (payload: {
    action: "pause" | "resume" | "retry" | "mark-blocked" | "terminate";
    reason?: string;
  }) => void | Promise<void>;
  operatorActionLoading?: MissionOperatorActionLoadingMap;
  onDecisionSubmitted?: () => void;
  className?: string;
}) {
  const { isDesktop } = useViewportTier();
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<
    string | null
  >(null);
  const [previewArtifactIndex, setPreviewArtifactIndex] = useState<number | null>(
    null
  );
  const [previewArtifactName, setPreviewArtifactName] = useState("");
  const [previewArtifactFormat, setPreviewArtifactFormat] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    setPreviewArtifactIndex(null);
    setPreviewArtifactName("");
    setPreviewArtifactFormat(undefined);
  }, [detail?.id]);

  if (!detail) {
    return (
      <Empty
        className={cn(
          "flex h-full items-center justify-center rounded-[28px] border-stone-200/80 bg-stone-50/80",
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
    if (artifact.downloadKind === "external") {
      if (artifact.href && typeof window !== "undefined") {
        window.open(artifact.href, "_blank", "noopener,noreferrer");
      }
      return;
    }

    if (artifact.downloadKind === "attachment") {
      downloadAttachmentArtifact(artifact);
      return;
    }

    const downloadUrl = artifact.downloadUrl || artifact.href;
    if (!downloadUrl) {
      return;
    }

    setDownloadingArtifactId(artifact.id);
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        console.warn(`Failed to download artifact: ${response.status}`);
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition");
      const filenameMatch = disposition?.match(/filename="?([^"]+)"?/i);
      const filename =
        filenameMatch?.[1] ||
        artifact.filename ||
        (artifact.format ? `${artifact.title}.${artifact.format}` : artifact.title);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDownloadingArtifactId(null);
    }
  }

  function handleArtifactPreview(artifact: TaskArtifact, index: number) {
    setPreviewArtifactIndex(index);
    setPreviewArtifactName(artifact.title);
    setPreviewArtifactFormat(artifact.format);
  }

  const summaryText = compactText(detail.summary, isDesktop ? 240 : 420);
  const liveSignalText = compactText(
    detail.lastSignal || detail.waitingFor || "No recent signal yet.",
    160
  );
  const summaryDialogNeeded = detail.summary.trim().length > (isDesktop ? 240 : 420);
  const liveSignalResolved =
    detail.lastSignal || detail.waitingFor || "No recent signal yet.";
  const liveSignalDialogNeeded = liveSignalResolved.trim().length > 160;
  const terminalMission = isMissionTerminal(detail.status);
  const decisionEnabled =
    detail.status === "waiting" && detail.decisionPresets.length > 0;
  const decisionTextareaPlaceholder =
    detail.decisionPlaceholder ||
    (detail.decisionAllowsFreeText
      ? "Optional decision note: add confirmation detail, constraints, or the exact follow-up the mission should respect."
      : "This mission uses structured decision options only.");

  const showStructuredDecisionPanel =
    detail.status === "waiting" && !!detail.decision;
  const decisionHistoryEntries = detail.decisionHistory ?? [];

  const sourceDirectiveText = detail.sourceText.trim();
  const runtimePreviewRows = [
    ...detail.instanceInfo.slice(0, 4),
    ...detail.logSummary.slice(0, 4),
  ];
  const runtimeDetailText = [
    "Instance Info",
    ...detail.instanceInfo.map(row => `${row.label}: ${row.value}`),
    "",
    "Log Summary",
    ...detail.logSummary.map(row => `${row.label}: ${row.value}`),
  ].join("\n");

  const sourceDirectivePanel = (
    <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <FileText className="size-4 text-stone-600" />
          Source Directive
        </CardTitle>
        <CardDescription>
          The original request driving this mission.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="rounded-[20px] border border-stone-200/80 bg-stone-50/80 px-3.5 py-3">
          <ExcerptBlock
            title="Directive Preview"
            description="Full original mission directive."
            text={sourceDirectiveText}
            maxLength={132}
          />
        </div>
      </CardContent>
    </Card>
  );

  const workPackagesPanel = (
    <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <Workflow className="size-4 text-amber-600" />
          Work Packages
        </CardTitle>
        <CardDescription>
          Delivery snapshots from workers, review loops, revisions, and scores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {detail.tasks.length > 0 ? (
          detail.tasks.map(task => {
            const progressValue = workPackageProgress(task.status);
            const scoreValue =
              task.total_score !== null && task.total_score !== undefined
                ? String(task.total_score)
                : "n/a";
            const reviewState = task.meta_audit_feedback
              ? "Audit flagged"
              : task.manager_feedback
                ? "Manager replied"
                : "Pending";
            const deliverableText =
              task.deliverable_v3 ||
              task.deliverable_v2 ||
              task.deliverable ||
              "No deliverable text captured yet.";
            const managerText = task.manager_feedback || "No manager feedback yet.";
            const auditText =
              task.meta_audit_feedback || "No audit signal captured yet.";

            return (
              <div
                key={task.id}
                className="rounded-[20px] border border-stone-200/80 bg-stone-50/80 p-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-stone-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                        #{task.id}
                      </span>
                      <span className="rounded-full border border-stone-200 bg-white/80 px-2.5 py-1 text-[11px] text-stone-600">
                        {task.department}
                      </span>
                      <span className="rounded-full border border-stone-200 bg-white/80 px-2.5 py-1 text-[11px] text-stone-600">
                        v{task.version}
                      </span>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                        {task.status}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-medium leading-6 text-stone-900">
                      {compactText(task.description || "No work brief captured yet.", 118)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                        {progressValue}% progress
                      </span>
                      <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
                        Score {scoreValue}
                      </span>
                      <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
                        {reviewState}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-[184px] max-w-[220px] flex-1 rounded-[16px] border border-stone-200/80 bg-white/80 px-3 py-2.5">
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                      <span>Execution lane</span>
                      <span>{progressValue}%</span>
                    </div>
                    <Progress
                      className="mt-2 h-1.5 bg-stone-200"
                      value={progressValue}
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <SnapshotTile label="Score" value={scoreValue} />
                      <SnapshotTile label="Review" value={reviewState} />
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2.5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <div className="rounded-[18px] border border-stone-200/80 bg-white/84 p-3">
                    <ExcerptBlock
                      title="Work Brief"
                      description={`Full work brief for task #${task.id}.`}
                      text={task.description || "No work brief captured yet."}
                      maxLength={104}
                    />
                  </div>
                  <div className="rounded-[18px] border border-stone-200/80 bg-white/84 p-3">
                    <ExcerptBlock
                      title="Deliverable Preview"
                      description={`Full deliverable payload for task #${task.id}.`}
                      text={deliverableText}
                      maxLength={150}
                    />
                  </div>
                  <div className="grid gap-2.5">
                    <div className="rounded-[18px] border border-stone-200/80 bg-white/84 p-3">
                      <ExcerptBlock
                        title="Manager Signal"
                        description={`Manager review notes for task #${task.id}.`}
                        text={managerText}
                        maxLength={86}
                      />
                    </div>
                    <div className="rounded-[18px] border border-stone-200/80 bg-white/84 p-3">
                      <ExcerptBlock
                        title="Audit Signal"
                        description={`Audit notes for task #${task.id}.`}
                        text={auditText}
                        maxLength={86}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/70 px-4 py-6 text-sm leading-6 text-stone-500">
            The mission has not emitted work packages yet.
          </div>
        )}
      </CardContent>
    </Card>
  );

  const timelinePanel = (
    <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <TimerReset className="size-4 text-sky-600" />
          Timeline
        </CardTitle>
        <CardDescription>
          Mission events, task transitions, and the latest coordination
          messages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {detail.timeline.length > 0 ? (
          detail.timeline.map(event => (
            <div key={event.id} className="relative pl-6">
              <div className="absolute left-[6px] top-0 h-full w-px bg-stone-200" />
              <div
                className={cn(
                  "absolute left-0 top-1.5 size-[13px] rounded-full border shadow-sm",
                  timelineTone(event.level)
                )}
              />
              <div className="rounded-[20px] border border-stone-200/80 bg-stone-50/70 px-3.5 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-stone-900">
                        {event.title}
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                          event.level === "error"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : event.level === "warn"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : event.level === "success"
                                ? "border-teal-200 bg-teal-50 text-teal-700"
                                : "border-sky-200 bg-sky-50 text-sky-700"
                        )}
                      >
                        {event.level}
                      </span>
                    </div>
                    <div className="mt-1.5 text-sm leading-6 text-stone-600">
                      {compactText(event.description, 96)}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-stone-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                        {formatTaskDate(event.time)}
                      </span>
                      {event.actor ? (
                        <span className="rounded-full border border-stone-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                          {event.actor}
                        </span>
                      ) : null}
                      {event.description.trim().length > 96 ? (
                        <DetailTextDialog
                          title={event.title}
                          description="Full timeline event detail."
                          text={event.description}
                          buttonLabel="Detail"
                        />
                      ) : null}
                    </div>
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
  );

  const decisionPanel = (
    <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <Sparkles className="size-4 text-teal-600" />
          Decision Entry
        </CardTitle>
        <CardDescription>
          {detail.decisionPrompt ||
            "Submit the current mission decision and resume execution."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Textarea
          value={decisionNote}
          onChange={event => onDecisionNoteChange(event.target.value)}
          className="min-h-20 rounded-[18px] border-stone-200 bg-stone-50/80 text-sm leading-6 text-stone-700"
          placeholder={decisionTextareaPlaceholder}
          disabled={!detail.decisionAllowsFreeText}
        />
        {decisionEnabled ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {detail.decisionPresets.map(preset => (
              <button
                key={preset.id}
                type="button"
                className={cn(
                  "w-full rounded-[18px] border px-3.5 py-3 text-left transition-colors",
                  toneFromDecisionTone(preset.tone)
                )}
                onClick={() => void onLaunchDecision(preset.id)}
                disabled={launchingPresetId === preset.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{preset.label}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 opacity-80">
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
        ) : (
          <div className="rounded-[20px] border border-dashed border-stone-300 bg-stone-50/70 px-4 py-4 text-sm leading-6 text-stone-500">
            {terminalMission
              ? "This mission is already in a terminal state, so no further execution decisions are available."
              : "This mission is not currently waiting for a decision."}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const runtimeSnapshotPanel = (
    <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <Bot className="size-4 text-sky-600" />
          Runtime Snapshot
        </CardTitle>
        <CardDescription>
          Compact preview of instance facts and runtime metrics.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid gap-2 sm:grid-cols-2">
          {runtimePreviewRows.map(row => (
            <SnapshotTile key={row.label} label={row.label} value={row.value} />
          ))}
        </div>
        <div className="flex justify-end">
          <DetailTextDialog
            title="Runtime Snapshot Details"
            description="Full instance info and log summary."
            text={runtimeDetailText}
            buttonLabel="More details"
          />
        </div>
      </CardContent>
    </Card>
  );

  const artifactsPanel = (
    <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <FileText className="size-4 text-teal-600" />
          Artifacts
        </CardTitle>
        <CardDescription>
          Mission reports, department summaries, and captured input
          attachments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {detail.artifacts.length > 0 ? (
          <ArtifactListBlock
            missionId={detail.id}
            artifacts={detail.artifacts}
            missionStatus={detail.status}
            variant="full"
            downloadingArtifactId={downloadingArtifactId}
            onDownload={handleArtifactDownload}
            onPreview={handleArtifactPreview}
          />
        ) : (
          <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/70 px-4 py-6 text-sm leading-6 text-stone-500">
            No artifacts are linked to this mission yet.
          </div>
        )}
      </CardContent>
    </Card>
  );

  const failurePanel =
    detail.failureReasons.length > 0 ? (
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
            className="rounded-2xl border border-rose-200/80 bg-white/75 px-3 py-3"
          >
            <ExcerptBlock
              title="Failure Signal"
              description="Full captured failure reason."
              text={reason}
              maxLength={160}
              className="text-rose-900"
            />
            </div>
          ))}
        </CardContent>
      </Card>
    ) : null;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-4",
        isDesktop && "h-full",
        className
      )}
    >
      <section className="shrink-0 overflow-hidden rounded-[28px] border border-stone-200/80 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_28%),linear-gradient(180deg,#fffdf8,#f7f0e6)] p-5 shadow-[0_24px_70px_rgba(113,83,49,0.1)]">
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
              {detail.operatorState !== "active" ? (
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    missionOperatorStateTone(detail.operatorState),
                  )}
                >
                  {missionOperatorStateLabel(detail.operatorState)}
                </span>
              ) : null}
              {detail.departmentLabels.map(label => (
                <span
                  key={label}
                  className="rounded-full border border-white/80 bg-white/65 px-3 py-1 text-xs text-stone-600"
                >
                  {label}
                </span>
              ))}
            </div>
            <h1 className="mt-3 max-w-4xl text-2xl font-semibold tracking-tight text-stone-900 md:text-3xl">
              {detail.title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700">
              {summaryText}
            </p>
            {summaryDialogNeeded ? (
              <div className="mt-3">
                <DetailTextDialog
                  title="Mission Summary"
                  description="Full summary for the selected mission."
                  text={detail.summary}
                />
              </div>
            ) : null}
          </div>

          <div className="max-w-[300px] rounded-[22px] border border-white/75 bg-white/72 px-4 py-4 text-sm text-stone-700 shadow-sm backdrop-blur">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
              Live signal
            </div>
            <div className="mt-2 text-sm leading-6">{liveSignalText}</div>
            {liveSignalDialogNeeded ? (
              <div className="mt-3">
                <DetailTextDialog
                  title="Live Signal"
                  description="Full live signal text."
                  text={liveSignalResolved}
                />
              </div>
            ) : null}
            <div className="mt-3 text-xs text-stone-500">
              Updated {formatTaskRelative(detail.updatedAt)}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <OperatorActionBar
            detail={detail}
            loadingByAction={operatorActionLoading}
            onSubmitAction={onSubmitOperatorAction}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
      </section>

      <Tabs
        defaultValue="overview"
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <div className="shrink-0 rounded-[24px] border border-stone-200/80 bg-white/78 p-2 shadow-[0_18px_50px_rgba(112,84,51,0.06)]">
          <TabsList className="grid h-auto w-full grid-cols-5 rounded-[18px] bg-stone-100/80 p-1">
            <TabsTrigger className="rounded-[14px]" value="overview">
              Overview
            </TabsTrigger>
            <TabsTrigger className="rounded-[14px]" value="execution">
              Execution
            </TabsTrigger>
            <TabsTrigger className="rounded-[14px]" value="decisions">
              <History className="mr-1.5 size-3.5" />
              Decisions
            </TabsTrigger>
            <TabsTrigger className="rounded-[14px]" value="artifacts">
              Artifacts
            </TabsTrigger>
            <TabsTrigger className="rounded-[14px]" value="cost">
              <Coins className="mr-1.5 size-3.5" />
              Cost
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="overview"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop}>
            <div className="grid gap-4 xl:items-start xl:grid-cols-[minmax(0,1.12fr)_380px]">
              <TaskPlanetInterior detail={detail} />
              <div className="self-start space-y-3">
                {sourceDirectivePanel}
                {showStructuredDecisionPanel && detail.decision && (
                  <DecisionPanel
                    missionId={detail.id}
                    decision={detail.decision}
                    onDecisionSubmitted={onDecisionSubmitted}
                  />
                )}
                {decisionPanel}
                {runtimeSnapshotPanel}
                {/* RAG Augmentation Info */}
                <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
                  <CardHeader className="space-y-1 pb-3">
                    <CardTitle className="flex items-center gap-2 text-stone-900">
                      <Sparkles className="size-4 text-stone-600" />
                      RAG Context
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <RAGInfoPanel logs={useRAGStore.getState().taskData[detail.id]?.logs ?? []} />
                    <RAGDebugPanel logs={useRAGStore.getState().taskData[detail.id]?.logs ?? []} />
                  </CardContent>
                </Card>
              </div>
            </div>
          </DetailTabViewport>
        </TabsContent>

        <TabsContent
          value="execution"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop}>
            {detail.securitySummary && (
              <Card className="mb-4 rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-stone-900">
                    <Shield className="size-4 text-stone-600" />
                    Security Policy
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    Container sandbox configuration
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                        detail.securitySummary.level === "strict"
                          ? "border border-rose-200 bg-rose-50 text-rose-700"
                          : detail.securitySummary.level === "balanced"
                            ? "border border-amber-200 bg-amber-50 text-amber-700"
                            : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                      )}
                    >
                      {detail.securitySummary.level}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <SnapshotTile label="User" value={detail.securitySummary.user} />
                    <SnapshotTile label="Network" value={detail.securitySummary.networkMode} />
                    <SnapshotTile label="Readonly FS" value={detail.securitySummary.readonlyRootfs ? "Yes" : "No"} />
                    <SnapshotTile label="Memory" value={detail.securitySummary.memoryLimit} />
                    <SnapshotTile label="CPU" value={detail.securitySummary.cpuLimit} />
                    <SnapshotTile label="PIDs Limit" value={String(detail.securitySummary.pidsLimit)} />
                  </div>
                </CardContent>
              </Card>
            )}
            {detail.executor && (
              <Card className="mb-4 rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-stone-900">
                    <Bot className="size-4 text-sky-600" />
                    Executor Status
                  </CardTitle>
                  <CardDescription>
                    Docker execution runtime status and artifacts.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <ExecutorStatusPanel
                    executor={detail.executor}
                    instance={detail.instance}
                    artifacts={detail.missionArtifacts}
                  />
                </CardContent>
              </Card>
            )}
            {detail.executor && (
              <div className="mb-4">
                <ExecutorTerminalPanel missionId={detail.id} />
              </div>
            )}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)]">
              {workPackagesPanel}
              {timelinePanel}
            </div>
          </DetailTabViewport>
        </TabsContent>

        <TabsContent
          value="decisions"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop}>
            <Card className="rounded-[28px] border-stone-200/80 bg-white/90 shadow-[0_24px_60px_rgba(112,84,51,0.08)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-stone-900">
                  <History className="size-4 text-violet-600" />
                  Decision History
                </CardTitle>
                <CardDescription>
                  Past decisions made during this mission's execution.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DecisionHistory history={decisionHistoryEntries} />
              </CardContent>
            </Card>
          </DetailTabViewport>
        </TabsContent>

        <TabsContent
          value="artifacts"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop}>
            <div className="space-y-4">
              {artifactsPanel}
              {failurePanel}
            </div>
          </DetailTabViewport>
        </TabsContent>

        <TabsContent
          value="cost"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop}>
            <MissionCostTab />
          </DetailTabViewport>
        </TabsContent>
      </Tabs>
      <ArtifactPreviewDialog
        missionId={detail.id}
        artifactIndex={previewArtifactIndex}
        artifactName={previewArtifactName}
        format={previewArtifactFormat}
        open={previewArtifactIndex !== null}
        onOpenChange={open => {
          if (!open) {
            setPreviewArtifactIndex(null);
          }
        }}
      />
    </div>
  );
}
