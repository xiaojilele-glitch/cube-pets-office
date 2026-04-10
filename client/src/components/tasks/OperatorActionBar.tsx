import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  LoaderCircle,
  OctagonX,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";

import {
  type MissionOperatorActionLoadingMap,
  type MissionTaskDetail,
} from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  availableMissionOperatorActions,
  compactText,
  formatTaskRelative,
  missionOperatorStateLabel,
  missionOperatorStateTone,
} from "./task-helpers";

export type OperatorActionKind =
  | "pause"
  | "resume"
  | "retry"
  | "mark-blocked"
  | "terminate";

type ActionKind = OperatorActionKind;

export function operatorActionRequiresReason(action: OperatorActionKind): boolean {
  return action === "mark-blocked";
}

export function operatorActionRequiresConfirmation(
  action: OperatorActionKind
): boolean {
  return action === "terminate";
}

function actionLabel(action: ActionKind): string {
  switch (action) {
    case "pause":
      return "Pause";
    case "resume":
      return "Resume";
    case "retry":
      return "Retry";
    case "mark-blocked":
      return "Mark Blocked";
    case "terminate":
      return "Terminate";
  }
}

function actionDescription(action: ActionKind, detail: MissionTaskDetail): string {
  switch (action) {
    case "pause":
      return detail.status === "queued"
        ? "Hold this mission before executor work starts."
        : "Pause the current mission without losing execution context.";
    case "resume":
      return "Return this mission to the active execution path.";
    case "retry":
      return `Queue a fresh attempt while keeping artifacts, timeline, and action history. Current attempt: ${detail.attempt}.`;
    case "mark-blocked":
      return "Flag the mission as blocked without ending it, so the team can see what needs follow-up.";
    case "terminate":
      return "Stop the mission by reusing the cancel flow. This is a terminal action.";
  }
}

function ActionIcon({
  action,
  className,
}: {
  action: ActionKind;
  className?: string;
}) {
  switch (action) {
    case "pause":
      return <Pause className={className} />;
    case "resume":
      return <Play className={className} />;
    case "retry":
      return <RotateCcw className={className} />;
    case "mark-blocked":
      return <AlertTriangle className={className} />;
    case "terminate":
      return <OctagonX className={className} />;
  }
}

export function OperatorActionBar({
  detail,
  loadingByAction,
  onSubmitAction,
}: {
  detail: MissionTaskDetail;
  loadingByAction?: MissionOperatorActionLoadingMap;
  onSubmitAction?: (payload: {
    action: ActionKind;
    reason?: string;
  }) => void | Promise<void>;
}) {
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [terminateDialogOpen, setTerminateDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [terminateReason, setTerminateReason] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);

  useEffect(() => {
    setBlockDialogOpen(false);
    setTerminateDialogOpen(false);
    setBlockReason("");
    setTerminateReason("");
    setInlineError(null);
  }, [detail.id]);

  const availableActions = useMemo(
    () =>
      availableMissionOperatorActions(detail.status, detail.operatorState) as ActionKind[],
    [detail.operatorState, detail.status],
  );

  const latestAction = detail.latestOperatorAction;
  const blockerVisible = detail.operatorState === "blocked" && detail.blocker;

  async function submitAction(action: ActionKind, reason?: string) {
    if (!onSubmitAction) return;
    setInlineError(null);
    await onSubmitAction({
      action,
      reason,
    });
  }

  async function handleBlockedConfirm() {
    if (!blockReason.trim()) {
      setInlineError("Blocker reason is required.");
      return;
    }

    try {
      await submitAction("mark-blocked", blockReason.trim());
      setBlockDialogOpen(false);
      setBlockReason("");
    } catch {
      // Page-level handler already surfaces the error.
    }
  }

  async function handleTerminateConfirm() {
    try {
      await submitAction("terminate", terminateReason.trim() || undefined);
      setTerminateDialogOpen(false);
      setTerminateReason("");
    } catch {
      // Page-level handler already surfaces the error.
    }
  }

  return (
    <div className="rounded-[24px] border border-white/75 bg-white/72 px-4 py-4 text-sm text-stone-700 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
            Operator Actions
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                missionOperatorStateTone(detail.operatorState),
              )}
            >
              {missionOperatorStateLabel(detail.operatorState)}
            </span>
            <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700">
              Attempt {detail.attempt}
            </span>
          </div>
        </div>

        {latestAction ? (
          <div className="max-w-[360px] rounded-[18px] border border-stone-200/80 bg-stone-50/75 px-3 py-3 text-xs text-stone-600">
            <div className="font-semibold text-stone-800">
              Latest action: {actionLabel(latestAction.action as ActionKind)}
            </div>
            <div className="mt-1 leading-5">
              {compactText(
                latestAction.reason || latestAction.detail || "No extra detail recorded.",
                160,
              )}
            </div>
            <div className="mt-1 text-[11px] text-stone-500">
              {formatTaskRelative(latestAction.createdAt)}
            </div>
          </div>
        ) : null}
      </div>

      {blockerVisible ? (
        <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" />
            Current blocker
          </div>
          <div className="mt-2 leading-6">{detail.blocker?.reason}</div>
          <div className="mt-2 text-xs text-amber-700">
            Added {formatTaskRelative(detail.blocker?.createdAt || null)}
          </div>
        </div>
      ) : null}

      {inlineError ? (
        <div className="mt-4 rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {inlineError}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {availableActions.length === 0 ? (
          <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
            No operator actions are currently available for this mission state.
          </div>
        ) : null}

        {availableActions.includes("pause") ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-stone-200 bg-white"
            disabled={loadingByAction?.pause === true}
            onClick={() => void submitAction("pause")}
            title={actionDescription("pause", detail)}
          >
            {loadingByAction?.pause ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ActionIcon action="pause" className="size-4" />
            )}
            Pause
          </Button>
        ) : null}

        {availableActions.includes("resume") ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-stone-200 bg-white"
            disabled={loadingByAction?.resume === true}
            onClick={() => void submitAction("resume")}
            title={actionDescription("resume", detail)}
          >
            {loadingByAction?.resume ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ActionIcon action="resume" className="size-4" />
            )}
            Resume
          </Button>
        ) : null}

        {availableActions.includes("retry") ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-stone-200 bg-white"
            disabled={loadingByAction?.retry === true}
            onClick={() => void submitAction("retry")}
            title={actionDescription("retry", detail)}
          >
            {loadingByAction?.retry ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ActionIcon action="retry" className="size-4" />
            )}
            Retry
          </Button>
        ) : null}

        {availableActions.includes("mark-blocked") ? (
          <Dialog
            open={blockDialogOpen}
            onOpenChange={open => {
              setBlockDialogOpen(open);
              if (!open) {
                setBlockReason("");
                setInlineError(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                disabled={loadingByAction?.["mark-blocked"] === true}
                title={actionDescription("mark-blocked", detail)}
              >
                {loadingByAction?.["mark-blocked"] ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ActionIcon action="mark-blocked" className="size-4" />
                )}
                Mark Blocked
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-[28px] border-stone-200 bg-white/96 shadow-[0_30px_90px_rgba(112,84,51,0.18)]">
              <DialogHeader>
                <DialogTitle>Mark this mission as blocked?</DialogTitle>
                <DialogDescription>
                  This does not end the mission. It marks the current state as
                  blocked so the team can see what follow-up is needed.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={blockReason}
                onChange={event => setBlockReason(event.target.value)}
                placeholder="Required blocker reason"
                className="min-h-28 rounded-[20px] border-stone-200 bg-stone-50/80 text-sm leading-6 text-stone-700"
                disabled={loadingByAction?.["mark-blocked"] === true}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-stone-200 bg-white"
                  onClick={() => setBlockDialogOpen(false)}
                  disabled={loadingByAction?.["mark-blocked"] === true}
                >
                  Keep Active
                </Button>
                <Button
                  type="button"
                  className="rounded-full bg-amber-600 text-white hover:bg-amber-700"
                  onClick={() => void handleBlockedConfirm()}
                  disabled={loadingByAction?.["mark-blocked"] === true}
                >
                  {loadingByAction?.["mark-blocked"] ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ActionIcon action="mark-blocked" className="size-4" />
                  )}
                  Confirm Blocker
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}

        {availableActions.includes("terminate") ? (
          <Dialog
            open={terminateDialogOpen}
            onOpenChange={open => {
              setTerminateDialogOpen(open);
              if (!open) {
                setTerminateReason("");
                setInlineError(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                className="rounded-full"
                disabled={loadingByAction?.terminate === true}
                title={actionDescription("terminate", detail)}
              >
                {loadingByAction?.terminate ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ActionIcon action="terminate" className="size-4" />
                )}
                Terminate
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-[28px] border-stone-200 bg-white/96 shadow-[0_30px_90px_rgba(112,84,51,0.18)]">
              <DialogHeader>
                <DialogTitle>Terminate this mission?</DialogTitle>
                <DialogDescription>
                  This reuses the cancel flow and will move the mission into a
                  terminal cancelled state.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={terminateReason}
                onChange={event => setTerminateReason(event.target.value)}
                placeholder="Optional termination reason"
                className="min-h-28 rounded-[20px] border-stone-200 bg-stone-50/80 text-sm leading-6 text-stone-700"
                disabled={loadingByAction?.terminate === true}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-stone-200 bg-white"
                  onClick={() => setTerminateDialogOpen(false)}
                  disabled={loadingByAction?.terminate === true}
                >
                  Keep Running
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="rounded-full"
                  onClick={() => void handleTerminateConfirm()}
                  disabled={loadingByAction?.terminate === true}
                >
                  {loadingByAction?.terminate ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ActionIcon action="terminate" className="size-4" />
                  )}
                  Confirm Termination
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}
