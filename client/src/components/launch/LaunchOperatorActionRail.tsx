import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  OctagonX,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";

import { useI18n } from "@/i18n";
import type {
  MissionOperatorActionLoadingMap,
  MissionTaskDetail,
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
import { workspaceStatusClass } from "@/components/workspace/workspace-tone";
import {
  compactText,
  derivePrimaryActions,
  formatTaskRelative,
  missionOperatorActionDescription,
  missionOperatorActionLabel,
  missionOperatorStateLabel,
  missionOperatorStateTone,
} from "@/components/tasks/task-helpers";
import {
  operatorActionRequiresConfirmation,
  operatorActionRequiresReason,
  resolvePrimaryOperatorAction,
  type OperatorActionKind,
} from "@/components/tasks/OperatorActionBar";

type ActionKind = OperatorActionKind;

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

export function LaunchOperatorActionRail({
  detail,
  loadingByAction,
  onSubmitAction,
  trailingAction,
  className,
}: {
  detail: MissionTaskDetail;
  loadingByAction?: MissionOperatorActionLoadingMap;
  onSubmitAction?: (payload: {
    action: ActionKind;
    reason?: string;
  }) => void | Promise<void>;
  trailingAction?: ReactNode;
  className?: string;
}) {
  const { locale, copy } = useI18n();
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [terminateDialogOpen, setTerminateDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [terminateReason, setTerminateReason] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    title: string;
    retryPayload?: {
      action: ActionKind;
      reason?: string;
    };
  } | null>(null);

  useEffect(() => {
    setBlockDialogOpen(false);
    setTerminateDialogOpen(false);
    setBlockReason("");
    setTerminateReason("");
    setInlineError(null);
    setFeedback(null);
  }, [detail.id]);

  const primaryActions = useMemo(
    () => derivePrimaryActions(detail, locale),
    [detail, locale]
  );
  const availableActions = primaryActions.normalActions as ActionKind[];
  const dangerousActions = primaryActions.dangerousActions as ActionKind[];
  const primaryAction = useMemo(
    () => resolvePrimaryOperatorAction(detail, locale),
    [detail, locale]
  );
  const secondaryActions = availableActions.filter(
    action => action !== primaryAction
  );
  const latestAction = detail.latestOperatorAction;
  const latestSummary = latestAction
    ? compactText(
        latestAction.reason ||
          latestAction.detail ||
          copy.tasks.detailView.noDetail,
        48
      )
    : null;

  function actionTitle(action: ActionKind) {
    return copy.tasks.listPage.actionSuccess(
      copy.tasks.statuses.action[
        action === "mark-blocked" ? "markBlocked" : action
      ]
    );
  }

  async function submitAction(action: ActionKind, reason?: string) {
    if (!onSubmitAction) return;
    setInlineError(null);
    setFeedback(null);

    try {
      await onSubmitAction({ action, reason });
      setFeedback({
        tone: "success",
        title: actionTitle(action),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : copy.tasks.listPage.actionError;
      setFeedback({
        tone: "error",
        title: message,
        retryPayload: { action, reason },
      });
      throw error;
    }
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
      // Page-level handlers already surface the failure toast.
    }
  }

  async function handleTerminateConfirm() {
    try {
      await submitAction("terminate", terminateReason.trim() || undefined);
      setTerminateDialogOpen(false);
      setTerminateReason("");
    } catch {
      // Page-level handlers already surface the failure toast.
    }
  }

  function renderActionButton(
    action: ActionKind,
    emphasis: "primary" | "secondary" | "danger"
  ) {
    const isLoading = loadingByAction?.[action] === true;
    const label = missionOperatorActionLabel(action, locale);
    const title = missionOperatorActionDescription(action, detail, locale);
    const baseClassName =
      "h-8 rounded-full px-2.5 text-xs whitespace-nowrap shadow-none";
    const className =
      emphasis === "primary"
        ? cn(
            baseClassName,
            action === "mark-blocked"
              ? "border-amber-600 bg-amber-600 text-white hover:bg-amber-700"
              : "border-[#d07a4f] bg-[#d07a4f] text-white hover:bg-[#c26d42]"
          )
        : emphasis === "danger"
          ? cn(
              baseClassName,
              "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            )
          : cn(
              baseClassName,
              "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
            );

    const button = (
      <Button
        type="button"
        variant={emphasis === "primary" ? undefined : "outline"}
        className={className}
        disabled={isLoading || !onSubmitAction}
        title={title}
        onClick={
          !operatorActionRequiresReason(action) &&
          !operatorActionRequiresConfirmation(action)
            ? () => void submitAction(action)
            : undefined
        }
      >
        {isLoading ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <ActionIcon action={action} className="size-3.5" />
        )}
        {label}
      </Button>
    );

    if (operatorActionRequiresReason(action)) {
      return (
        <Dialog
          key={action}
          open={blockDialogOpen}
          onOpenChange={open => {
            setBlockDialogOpen(open);
            if (!open) {
              setBlockReason("");
              setInlineError(null);
            }
          }}
        >
          <DialogTrigger asChild>{button}</DialogTrigger>
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
              disabled={isLoading}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-stone-200 bg-white"
                onClick={() => setBlockDialogOpen(false)}
                disabled={isLoading}
              >
                {copy.tasks.operatorBar.blockCancel}
              </Button>
              <Button
                type="button"
                className="rounded-full bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => void handleBlockedConfirm()}
                disabled={isLoading}
              >
                {isLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ActionIcon action="mark-blocked" className="size-4" />
                )}
                {copy.tasks.operatorBar.blockConfirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }

    if (operatorActionRequiresConfirmation(action)) {
      return (
        <Dialog
          key={action}
          open={terminateDialogOpen}
          onOpenChange={open => {
            setTerminateDialogOpen(open);
            if (!open) {
              setTerminateReason("");
              setInlineError(null);
            }
          }}
        >
          <DialogTrigger asChild>{button}</DialogTrigger>
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
              disabled={isLoading}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-stone-200 bg-white"
                onClick={() => setTerminateDialogOpen(false)}
                disabled={isLoading}
              >
                {copy.tasks.operatorBar.terminateCancel}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="rounded-full"
                onClick={() => void handleTerminateConfirm()}
                disabled={isLoading}
              >
                {isLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ActionIcon action="terminate" className="size-4" />
                )}
                {copy.tasks.operatorBar.terminateConfirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }

    return <div key={action}>{button}</div>;
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-end gap-1.5",
        className
      )}
    >
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <span
          className={cn(
            "workspace-status !gap-1 !px-2 !py-1 !text-xs font-semibold whitespace-nowrap",
            missionOperatorStateTone(detail.operatorState)
          )}
          title={missionOperatorStateLabel(detail.operatorState, locale)}
        >
          {missionOperatorStateLabel(detail.operatorState, locale)}
        </span>

        {latestAction ? (
          <span
            className={workspaceStatusClass(
              "neutral",
              "max-w-[220px] !gap-1 !px-2 !py-1 !text-xs font-medium"
            )}
            title={[
              missionOperatorActionLabel(
                latestAction.action as ActionKind,
                locale
              ),
              latestSummary,
              formatTaskRelative(latestAction.createdAt, locale),
            ]
              .filter(Boolean)
              .join(" / ")}
          >
            <Clock3 className="size-3.5" />
            <span className="truncate">
              {missionOperatorActionLabel(
                latestAction.action as ActionKind,
                locale
              )}
              {latestSummary ? ` / ${latestSummary}` : ""}
            </span>
          </span>
        ) : null}

        {primaryActions.passiveMessage ? (
          <span
            className={workspaceStatusClass(
              "neutral",
              "max-w-[240px] !gap-1 !px-2 !py-1 !text-xs font-medium"
            )}
            title={primaryActions.passiveMessage}
          >
            <AlertTriangle className="size-3.5" />
            <span className="truncate">
              {compactText(primaryActions.passiveMessage, 44)}
            </span>
          </span>
        ) : null}

        {inlineError ? (
          <span
            className={workspaceStatusClass(
              "danger",
              "max-w-[220px] !gap-1 !px-2 !py-1 !text-xs font-medium"
            )}
            title={inlineError}
          >
            <AlertTriangle className="size-3.5" />
            <span className="truncate">{compactText(inlineError, 40)}</span>
          </span>
        ) : null}

        {feedback ? (
          <span
            className={workspaceStatusClass(
              feedback.tone === "success" ? "success" : "danger",
              "max-w-[220px] !gap-1 !px-2 !py-1 !text-xs font-medium"
            )}
            title={feedback.title}
          >
            {feedback.tone === "success" ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <AlertTriangle className="size-3.5" />
            )}
            <span className="truncate">{compactText(feedback.title, 36)}</span>
          </span>
        ) : null}
      </div>

      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        {primaryAction ? renderActionButton(primaryAction, "primary") : null}
        {secondaryActions.map(action =>
          renderActionButton(action, "secondary")
        )}
        {dangerousActions.includes("terminate")
          ? renderActionButton("terminate", "danger")
          : null}
        {feedback?.retryPayload ? (
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-full px-2.5 text-xs"
            onClick={() => {
              const retryPayload = feedback.retryPayload;
              if (!retryPayload) return;
              void submitAction(retryPayload.action, retryPayload.reason);
            }}
          >
            <RotateCcw className="size-3.5" />
            {copy.tasks.operatorBar.retryLast}
          </Button>
        ) : null}
        {trailingAction}
      </div>
    </div>
  );
}
