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
import { useI18n } from "@/i18n";
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
  compactText,
  derivePrimaryActions,
  formatTaskRelative,
  missionOperatorActionDescription,
  missionOperatorActionLabel,
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

export function operatorActionRequiresReason(
  action: OperatorActionKind
): boolean {
  return action === "mark-blocked";
}

export function operatorActionRequiresConfirmation(
  action: OperatorActionKind
): boolean {
  return action === "terminate";
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
  showContextSummary = true,
}: {
  detail: MissionTaskDetail;
  loadingByAction?: MissionOperatorActionLoadingMap;
  onSubmitAction?: (payload: {
    action: ActionKind;
    reason?: string;
  }) => void | Promise<void>;
  showContextSummary?: boolean;
}) {
  const { locale, copy } = useI18n();
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

  const primaryActions = useMemo(
    () => derivePrimaryActions(detail, locale),
    [detail, locale]
  );
  const availableActions = primaryActions.normalActions as ActionKind[];
  const dangerousActions = primaryActions.dangerousActions as ActionKind[];

  const latestAction = detail.latestOperatorAction;
  const blockerVisible =
    showContextSummary && detail.operatorState === "blocked" && detail.blocker;

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
      setInlineError(copy.tasks.operatorBar.blockerReasonRequired);
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
            {copy.tasks.operatorBar.title}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                missionOperatorStateTone(detail.operatorState)
              )}
            >
              {missionOperatorStateLabel(detail.operatorState, locale)}
            </span>
            <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700">
              {copy.tasks.listPage.attemptCount(detail.attempt)}
            </span>
          </div>
        </div>

        {latestAction ? (
          <div className="max-w-[360px] rounded-[18px] border border-stone-200/80 bg-stone-50/75 px-3 py-3 text-xs text-stone-600">
            <div className="font-semibold text-stone-800">
              {copy.tasks.operatorBar.latestAction}:{" "}
              {missionOperatorActionLabel(
                latestAction.action as ActionKind,
                locale
              )}
            </div>
            <div className="mt-1 leading-5">
              {compactText(
                latestAction.reason ||
                  latestAction.detail ||
                  copy.tasks.detailView.noDetail,
                160
              )}
            </div>
            <div className="mt-1 text-[11px] text-stone-500">
              {formatTaskRelative(latestAction.createdAt, locale)}
            </div>
          </div>
        ) : null}
      </div>

      {blockerVisible ? (
        <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" />
            {copy.tasks.operatorBar.currentBlocker}
          </div>
          <div className="mt-2 leading-6">{detail.blocker?.reason}</div>
          <div className="mt-2 text-xs text-amber-700">
            {formatTaskRelative(detail.blocker?.createdAt || null, locale)}
          </div>
        </div>
      ) : null}

      {inlineError ? (
        <div className="mt-4 rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {inlineError}
        </div>
      ) : null}

      {primaryActions.passiveMessage ? (
        <div className="mt-4 rounded-[18px] border border-dashed border-stone-300 bg-stone-50/80 px-3 py-2 text-sm text-stone-600">
          {primaryActions.passiveMessage}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {availableActions.includes("pause") ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-stone-200 bg-white"
            disabled={loadingByAction?.pause === true}
            onClick={() => void submitAction("pause")}
            title={missionOperatorActionDescription("pause", detail, locale)}
          >
            {loadingByAction?.pause ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ActionIcon action="pause" className="size-4" />
            )}
            {missionOperatorActionLabel("pause", locale)}
          </Button>
        ) : null}

        {availableActions.includes("resume") ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-stone-200 bg-white"
            disabled={loadingByAction?.resume === true}
            onClick={() => void submitAction("resume")}
            title={missionOperatorActionDescription("resume", detail, locale)}
          >
            {loadingByAction?.resume ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ActionIcon action="resume" className="size-4" />
            )}
            {missionOperatorActionLabel("resume", locale)}
          </Button>
        ) : null}

        {availableActions.includes("retry") ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-stone-200 bg-white"
            disabled={loadingByAction?.retry === true}
            onClick={() => void submitAction("retry")}
            title={missionOperatorActionDescription("retry", detail, locale)}
          >
            {loadingByAction?.retry ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ActionIcon action="retry" className="size-4" />
            )}
            {missionOperatorActionLabel("retry", locale)}
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
                title={missionOperatorActionDescription(
                  "mark-blocked",
                  detail,
                  locale
                )}
              >
                {loadingByAction?.["mark-blocked"] ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ActionIcon action="mark-blocked" className="size-4" />
                )}
                {missionOperatorActionLabel("mark-blocked", locale)}
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-[28px] border-stone-200 bg-white/96 shadow-[0_30px_90px_rgba(112,84,51,0.18)]">
              <DialogHeader>
                <DialogTitle>{copy.tasks.operatorBar.blockTitle}</DialogTitle>
                <DialogDescription>
                  {copy.tasks.operatorBar.blockDescription}
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={blockReason}
                onChange={event => setBlockReason(event.target.value)}
                placeholder={copy.tasks.operatorBar.blockPlaceholder}
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
                  {copy.tasks.operatorBar.blockCancel}
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
                  {copy.tasks.operatorBar.blockConfirm}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {dangerousActions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-200/80 pt-3">
          {dangerousActions.includes("terminate") ? (
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
                  title={missionOperatorActionDescription(
                    "terminate",
                    detail,
                    locale
                  )}
                >
                  {loadingByAction?.terminate ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ActionIcon action="terminate" className="size-4" />
                  )}
                  {missionOperatorActionLabel("terminate", locale)}
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-[28px] border-stone-200 bg-white/96 shadow-[0_30px_90px_rgba(112,84,51,0.18)]">
                <DialogHeader>
                  <DialogTitle>{copy.tasks.operatorBar.terminateTitle}</DialogTitle>
                  <DialogDescription>
                    {copy.tasks.operatorBar.terminateDescription}
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={terminateReason}
                  onChange={event => setTerminateReason(event.target.value)}
                  placeholder={copy.tasks.operatorBar.terminatePlaceholder}
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
                    {copy.tasks.operatorBar.terminateCancel}
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
                    {copy.tasks.operatorBar.terminateConfirm}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
