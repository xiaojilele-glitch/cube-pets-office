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
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  workspaceCalloutClass,
  workspaceStatusClass,
} from "@/components/workspace/workspace-tone";
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
import { ActionFeedbackInline } from "./ActionFeedbackInline";
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

export function resolvePrimaryOperatorAction(
  detail: MissionTaskDetail,
  locale: AppLocale = "en-US"
): ActionKind | null {
  const primaryActions = derivePrimaryActions(detail, locale);
  const availableActions = primaryActions.normalActions as ActionKind[];
  const recommendedAction = primaryActions.recommended.find(action =>
    availableActions.includes(action.key as ActionKind)
  );

  return (
    (recommendedAction?.key as ActionKind | undefined) ??
    availableActions[0] ??
    null
  );
}

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
  variant = "default",
}: {
  detail: MissionTaskDetail;
  loadingByAction?: MissionOperatorActionLoadingMap;
  onSubmitAction?: (payload: {
    action: ActionKind;
    reason?: string;
  }) => void | Promise<void>;
  showContextSummary?: boolean;
  variant?: "default" | "compact";
}) {
  const { locale, copy } = useI18n();
  const isCompact = variant === "compact";
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [terminateDialogOpen, setTerminateDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [terminateReason, setTerminateReason] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    title: string;
    description: string;
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
  const blockerVisible =
    showContextSummary && detail.operatorState === "blocked" && detail.blocker;

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
      await onSubmitAction({
        action,
        reason,
      });
      setFeedback({
        tone: "success",
        title: actionTitle(action),
        description: copy.tasks.operatorBar.successHint,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : copy.tasks.listPage.actionError;
      setFeedback({
        tone: "error",
        title: message,
        description: copy.tasks.operatorBar.errorHint,
        retryPayload: {
          action,
          reason,
        },
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

  function buttonClassName(
    action: ActionKind,
    emphasis: "primary" | "secondary"
  ) {
    if (emphasis === "primary") {
      if (action === "mark-blocked") {
        return "rounded-full bg-amber-600 text-white hover:bg-amber-700";
      }
      return "rounded-full bg-[#d07a4f] text-white hover:bg-[#c26d42]";
    }

    if (action === "mark-blocked") {
      return "rounded-full border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100";
    }

    return "rounded-full border-stone-200 bg-white";
  }

  function renderSafeAction(
    action: ActionKind,
    emphasis: "primary" | "secondary"
  ) {
    const isLoading = loadingByAction?.[action] === true;
    const label = missionOperatorActionLabel(action, locale);
    const title = missionOperatorActionDescription(action, detail, locale);
    const button = (
      <Button
        type="button"
        variant={emphasis === "primary" ? undefined : "outline"}
        className={buttonClassName(action, emphasis)}
        disabled={isLoading}
        title={title}
        onClick={
          action === "pause" || action === "resume" || action === "retry"
            ? () => void submitAction(action)
            : undefined
        }
      >
        {isLoading ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ActionIcon action={action} className="size-4" />
        )}
        {label}
      </Button>
    );

    if (action === "mark-blocked") {
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
      );
    }

    return <div key={action}>{button}</div>;
  }

  return (
    <div
      className={cn(
        "border text-sm text-stone-700 shadow-sm backdrop-blur",
        isCompact
          ? "rounded-[22px] border-stone-200/80 bg-white/82 px-3.5 py-3"
          : "rounded-[24px] border-white/75 bg-white/72 px-4 py-4"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
            {copy.tasks.operatorBar.title}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span
              className={cn(
                "workspace-status px-3 py-1 text-xs",
                missionOperatorStateTone(detail.operatorState)
              )}
            >
              {missionOperatorStateLabel(detail.operatorState, locale)}
            </span>
            <span
              className={workspaceStatusClass(
                "neutral",
                "px-3 py-1 text-xs font-medium"
              )}
            >
              {copy.tasks.listPage.attemptCount(detail.attempt)}
            </span>
          </div>
        </div>

        {latestAction && !isCompact ? (
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

      {latestAction && isCompact ? (
        <div className="mt-2 text-xs leading-5 text-stone-500">
          <span className="font-semibold text-stone-700">
            {copy.tasks.operatorBar.latestAction}:{" "}
          </span>
          {missionOperatorActionLabel(
            latestAction.action as ActionKind,
            locale
          )}
          {latestAction.reason || latestAction.detail
            ? ` / ${compactText(
                latestAction.reason ||
                  latestAction.detail ||
                  copy.tasks.detailView.noDetail,
                80
              )}`
            : ""}
        </div>
      ) : null}

      {blockerVisible ? (
        <div
          className={cn(
            workspaceCalloutClass("warning"),
            "mt-4 px-4 py-3 text-sm"
          )}
        >
          <div className="flex items-center gap-2 font-semibold text-[var(--workspace-text-strong)]">
            <AlertTriangle className="size-4" />
            {copy.tasks.operatorBar.currentBlocker}
          </div>
          <div className="mt-2 leading-6 text-[var(--workspace-text)]">
            {detail.blocker?.reason}
          </div>
          <div className="mt-2 text-xs text-[var(--workspace-text-muted)]">
            {formatTaskRelative(detail.blocker?.createdAt || null, locale)}
          </div>
        </div>
      ) : null}

      {inlineError ? (
        <ActionFeedbackInline
          tone="error"
          title={inlineError}
          description={copy.tasks.operatorBar.errorHint}
          className="mt-4"
        />
      ) : null}

      {feedback ? (
        <ActionFeedbackInline
          tone={feedback.tone}
          title={feedback.title}
          description={feedback.description}
          actionLabel={
            feedback.retryPayload ? copy.tasks.operatorBar.retryLast : undefined
          }
          onAction={
            feedback.retryPayload
              ? () => {
                  const retryPayload = feedback.retryPayload;
                  if (!retryPayload) return;
                  void submitAction(retryPayload.action, retryPayload.reason);
                }
              : undefined
          }
          className="mt-4"
        />
      ) : null}

      {primaryActions.passiveMessage ? (
        <div
          className={cn(
            workspaceCalloutClass("neutral"),
            "mt-4 border-dashed px-3 py-2 text-sm text-[var(--workspace-text-muted)]"
          )}
        >
          {primaryActions.passiveMessage}
        </div>
      ) : null}

      {primaryAction || secondaryActions.length > 0 ? (
        <div className={cn("space-y-3", isCompact ? "mt-3" : "mt-4")}>
          {primaryAction ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                {copy.tasks.operatorBar.primaryAction}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {renderSafeAction(primaryAction, "primary")}
              </div>
            </div>
          ) : null}

          {secondaryActions.length > 0 ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                {copy.tasks.operatorBar.secondaryActions}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {secondaryActions.map(action =>
                  renderSafeAction(action, "secondary")
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {dangerousActions.length > 0 ? (
        <div className="mt-3 border-t border-stone-200/80 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
            {copy.tasks.operatorBar.dangerZone}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
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
                    <DialogTitle>
                      {copy.tasks.operatorBar.terminateTitle}
                    </DialogTitle>
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
        </div>
      ) : null}
    </div>
  );
}
