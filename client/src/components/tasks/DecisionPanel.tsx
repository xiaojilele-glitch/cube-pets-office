import { useCallback, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  LoaderCircle,
  MessageSquare,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import type {
  DecisionType,
  MissionDecision,
  MissionDecisionOption,
} from "@shared/mission/contracts";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  workspaceCalloutClass,
  workspaceToneClass,
  type WorkspaceTone,
} from "@/components/workspace/workspace-tone";
import { submitMissionDecision } from "@/lib/mission-client";
import { cn } from "@/lib/utils";

interface DecisionPanelProps {
  missionId: string;
  decision: MissionDecision;
  onDecisionSubmitted?: () => void;
}

function resolveDecisionType(decision: MissionDecision): DecisionType {
  return decision.type ?? "custom-action";
}

function severityClasses(severity?: "info" | "warn" | "danger"): string {
  switch (severity) {
    case "info":
      return `${workspaceToneClass("info")} hover:bg-[rgba(91,137,165,0.22)]`;
    case "warn":
      return `${workspaceToneClass("warning")} hover:bg-[rgba(201,130,87,0.22)]`;
    case "danger":
      return `${workspaceToneClass("danger")} hover:bg-[rgba(180,93,77,0.2)]`;
    default:
      return `${workspaceToneClass("neutral")} hover:bg-[rgba(255,255,255,0.82)]`;
  }
}

function surfaceTextareaClass(size: "md" | "lg" | "xl" = "md"): string {
  return cn(
    "border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.68)] text-sm text-stone-700",
    size === "md"
      ? "min-h-16 rounded-[14px]"
      : size === "lg"
        ? "min-h-20 rounded-[18px] leading-6"
        : "min-h-24 rounded-[18px] leading-6"
  );
}

function decisionTone(type: DecisionType): WorkspaceTone {
  if (type === "approve") return "success";
  if (type === "reject" || type === "escalate") return "danger";
  if (type === "request-info" || type === "multi-choice") return "info";
  return "neutral";
}

function typeIcon(type: DecisionType) {
  switch (type) {
    case "approve":
      return <CheckCircle2 className="size-4 text-emerald-600" />;
    case "reject":
      return <XCircle className="size-4 text-red-600" />;
    case "request-info":
      return <MessageSquare className="size-4 text-blue-600" />;
    case "escalate":
      return <ShieldAlert className="size-4 text-red-600" />;
    case "multi-choice":
      return <HelpCircle className="size-4 text-violet-600" />;
    default:
      return <Send className="size-4 text-stone-600" />;
  }
}

function OptionCard({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: MissionDecisionOption;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={option.label}
      disabled={disabled}
      onClick={() => onSelect(option.id)}
      className={cn(
        "w-full rounded-[18px] border px-3.5 py-3 text-left transition-colors",
        selected
          ? "workspace-tone-success ring-2 ring-[rgba(94,139,114,0.22)] ring-offset-2 ring-offset-transparent"
          : severityClasses(option.severity),
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <div className="text-sm font-semibold">{option.label}</div>
      {option.description && (
        <div className="mt-1 text-xs leading-5 opacity-80">
          {option.description}
        </div>
      )}
    </button>
  );
}

function ApproveRejectLayout({
  options,
  submitting,
  onSubmit,
  commentTexts,
  onCommentChange,
}: {
  options: MissionDecisionOption[];
  submitting: boolean;
  onSubmit: (optionId: string, freeText?: string) => void;
  commentTexts: Record<string, string>;
  onCommentChange: (optionId: string, text: string) => void;
}) {
  const approveOpt = options.find(
    option =>
      option.action === "approve" ||
      /approve|\u901a\u8fc7|\u6279\u51c6/i.test(option.label)
  );
  const rejectOpt = options.find(
    option =>
      option.action === "reject" ||
      /reject|\u62d2\u7edd|\u9a73\u56de/i.test(option.label)
  );
  const remaining = options.filter(
    option => option !== approveOpt && option !== rejectOpt
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {approveOpt ? (
          <div className="space-y-2">
            <Button
              type="button"
              disabled={submitting}
              aria-label={approveOpt.label}
              onClick={() =>
                onSubmit(approveOpt.id, commentTexts[approveOpt.id])
              }
              className="w-full rounded-[18px] border border-[rgba(94,139,114,0.28)] bg-[var(--workspace-success)] text-white hover:bg-[#537860]"
            >
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {approveOpt.label}
            </Button>
            {approveOpt.requiresComment ? (
              <Textarea
                value={commentTexts[approveOpt.id] ?? ""}
                onChange={event =>
                  onCommentChange(approveOpt.id, event.target.value)
                }
                placeholder="Required: provide a reason"
                aria-label={`Comment for ${approveOpt.label}`}
                aria-required="true"
                className={surfaceTextareaClass()}
              />
            ) : null}
          </div>
        ) : null}

        {rejectOpt ? (
          <div className="space-y-2">
            <Button
              type="button"
              disabled={submitting}
              aria-label={rejectOpt.label}
              onClick={() => onSubmit(rejectOpt.id, commentTexts[rejectOpt.id])}
              className="w-full rounded-[18px] border border-[rgba(180,93,77,0.28)] bg-[var(--workspace-danger)] text-white hover:bg-[#a85445]"
            >
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              {rejectOpt.label}
            </Button>
            {rejectOpt.requiresComment ? (
              <Textarea
                value={commentTexts[rejectOpt.id] ?? ""}
                onChange={event =>
                  onCommentChange(rejectOpt.id, event.target.value)
                }
                placeholder="Required: provide a reason"
                aria-label={`Comment for ${rejectOpt.label}`}
                aria-required="true"
                className={surfaceTextareaClass()}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {remaining.map(option => (
        <div key={option.id} className="space-y-2">
          <button
            type="button"
            disabled={submitting}
            aria-label={option.label}
            onClick={() => onSubmit(option.id, commentTexts[option.id])}
            className={cn(
              "w-full rounded-[18px] border px-3.5 py-3 text-left text-sm font-semibold transition-colors",
              severityClasses(option.severity),
              submitting && "cursor-not-allowed opacity-50"
            )}
          >
            {option.label}
          </button>
          {option.requiresComment ? (
            <Textarea
              value={commentTexts[option.id] ?? ""}
              onChange={event => onCommentChange(option.id, event.target.value)}
              placeholder="Required: provide a reason"
              aria-label={`Comment for ${option.label}`}
              aria-required="true"
              className={surfaceTextareaClass()}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MultiChoiceLayout({
  options,
  submitting,
  onSubmit,
  commentTexts,
  onCommentChange,
}: {
  options: MissionDecisionOption[];
  submitting: boolean;
  onSubmit: (optionId: string, freeText?: string) => void;
  commentTexts: Record<string, string>;
  onCommentChange: (optionId: string, text: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Decision options"
        className="grid gap-2"
      >
        {options.map(option => (
          <div key={option.id} className="space-y-2">
            <OptionCard
              option={option}
              selected={selectedId === option.id}
              disabled={submitting}
              onSelect={setSelectedId}
            />
            {option.requiresComment && selectedId === option.id ? (
              <Textarea
                value={commentTexts[option.id] ?? ""}
                onChange={event =>
                  onCommentChange(option.id, event.target.value)
                }
                placeholder="Required: provide a reason"
                aria-label={`Comment for ${option.label}`}
                aria-required="true"
                className={surfaceTextareaClass()}
              />
            ) : null}
          </div>
        ))}
      </div>
      <Button
        type="button"
        disabled={submitting || !selectedId}
        onClick={() =>
          selectedId && onSubmit(selectedId, commentTexts[selectedId])
        }
        className="w-full rounded-[18px]"
      >
        {submitting ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
        Submit Selection
      </Button>
    </div>
  );
}

function RequestInfoLayout({
  decision,
  submitting,
  onSubmitFreeText,
}: {
  decision: MissionDecision;
  submitting: boolean;
  onSubmitFreeText: (freeText: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder={
          decision.placeholder ?? "Provide the requested information..."
        }
        aria-label="Information response"
        aria-required="true"
        className={surfaceTextareaClass("xl")}
      />
      <Button
        type="button"
        disabled={submitting || !text.trim()}
        onClick={() => onSubmitFreeText(text)}
        className="w-full rounded-[18px]"
      >
        {submitting ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
        Submit Information
      </Button>
    </div>
  );
}

function EscalateLayout({
  options,
  submitting,
  onSubmit,
  commentTexts,
  onCommentChange,
}: {
  options: MissionDecisionOption[];
  submitting: boolean;
  onSubmit: (optionId: string, freeText?: string) => void;
  commentTexts: Record<string, string>;
  onCommentChange: (optionId: string, text: string) => void;
}) {
  const primary = options[0];

  return (
    <div className="space-y-3">
      <div
        className={workspaceCalloutClass(
          "danger",
          "flex items-center gap-2 px-3.5 py-2.5 text-[var(--workspace-danger)]"
        )}
      >
        <AlertTriangle className="size-4 shrink-0 text-red-600" />
        <span className="text-sm font-medium text-red-800">
          High priority: this decision requires immediate attention
        </span>
      </div>

      {options.map(option => (
        <div key={option.id} className="space-y-2">
          <Button
            type="button"
            disabled={submitting}
            aria-label={option.label}
            onClick={() => onSubmit(option.id, commentTexts[option.id])}
            className={cn(
              "w-full rounded-[18px]",
              option === primary
                ? "border border-[rgba(180,93,77,0.28)] bg-[var(--workspace-danger)] text-white hover:bg-[#a85445]"
                : "workspace-control border-[var(--workspace-panel-border)] bg-white/70 text-stone-800 hover:bg-white/85"
            )}
          >
            {submitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ShieldAlert className="size-4" />
            )}
            {option.label}
          </Button>
          {option.requiresComment ? (
            <Textarea
              value={commentTexts[option.id] ?? ""}
              onChange={event => onCommentChange(option.id, event.target.value)}
              placeholder="Required: provide a reason"
              aria-label={`Comment for ${option.label}`}
              aria-required="true"
              className={surfaceTextareaClass()}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CustomActionLayout({
  options,
  decision,
  submitting,
  onSubmit,
  commentTexts,
  onCommentChange,
}: {
  options: MissionDecisionOption[];
  decision: MissionDecision;
  submitting: boolean;
  onSubmit: (optionId: string, freeText?: string) => void;
  commentTexts: Record<string, string>;
  onCommentChange: (optionId: string, text: string) => void;
}) {
  const [freeText, setFreeText] = useState("");

  return (
    <div className="space-y-3">
      {decision.allowFreeText ? (
        <Textarea
          value={freeText}
          onChange={event => setFreeText(event.target.value)}
          placeholder={decision.placeholder ?? "Optional note..."}
          aria-label="Decision note"
          className={surfaceTextareaClass("lg")}
        />
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(option => (
          <div key={option.id} className="space-y-2">
            <button
              type="button"
              disabled={submitting}
              aria-label={option.label}
              onClick={() =>
                onSubmit(
                  option.id,
                  commentTexts[option.id] ||
                    (decision.allowFreeText ? freeText : undefined)
                )
              }
              className={cn(
                "w-full rounded-[18px] border px-3.5 py-3 text-left transition-colors",
                severityClasses(option.severity),
                submitting && "cursor-not-allowed opacity-50"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{option.label}</div>
                  {option.description ? (
                    <div className="mt-1 line-clamp-2 text-xs leading-5 opacity-80">
                      {option.description}
                    </div>
                  ) : null}
                </div>
                {submitting ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin" />
                ) : (
                  <Send className="size-4 shrink-0 opacity-50" />
                )}
              </div>
            </button>
            {option.requiresComment ? (
              <Textarea
                value={commentTexts[option.id] ?? ""}
                onChange={event =>
                  onCommentChange(option.id, event.target.value)
                }
                placeholder="Required: provide a reason"
                aria-label={`Comment for ${option.label}`}
                aria-required="true"
                className={surfaceTextareaClass()}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DecisionPanel({
  missionId,
  decision,
  onDecisionSubmitted,
}: DecisionPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});

  const type = resolveDecisionType(decision);
  const options = decision.options ?? [];

  const handleCommentChange = useCallback((optionId: string, text: string) => {
    setCommentTexts(previous => ({ ...previous, [optionId]: text }));
  }, []);

  const handleSubmit = useCallback(
    async (optionId: string, freeText?: string) => {
      const option = options.find(current => current.id === optionId);
      if (option?.requiresComment && (!freeText || !freeText.trim())) {
        setError(`A comment is required for "${option.label}".`);
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        await submitMissionDecision(missionId, {
          optionId,
          freeText: freeText?.trim() || undefined,
        });
        onDecisionSubmitted?.();
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to submit decision"
        );
      } finally {
        setSubmitting(false);
      }
    },
    [missionId, onDecisionSubmitted, options]
  );

  const handleSubmitFreeText = useCallback(
    async (freeText: string) => {
      setSubmitting(true);
      setError(null);

      try {
        await submitMissionDecision(missionId, {
          freeText: freeText.trim(),
        });
        onDecisionSubmitted?.();
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to submit decision"
        );
      } finally {
        setSubmitting(false);
      }
    },
    [missionId, onDecisionSubmitted]
  );

  return (
    <Card
      className={cn(
        "workspace-panel rounded-[28px] shadow-[0_24px_60px_rgba(112,84,51,0.08)]",
        type === "escalate"
          ? "border-[rgba(180,93,77,0.24)] bg-[linear-gradient(180deg,rgba(255,251,249,0.96),rgba(248,233,229,0.92))]"
          : "border-[var(--workspace-panel-border)]"
      )}
    >
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          {typeIcon(type)}
          Decision Required
        </CardTitle>
        <CardDescription
          className={cn(
            "text-sm leading-6",
            workspaceToneClass(decisionTone(type))
          )}
        >
          {decision.prompt}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {type === "approve" || type === "reject" ? (
          <ApproveRejectLayout
            options={options}
            submitting={submitting}
            onSubmit={handleSubmit}
            commentTexts={commentTexts}
            onCommentChange={handleCommentChange}
          />
        ) : type === "multi-choice" ? (
          <MultiChoiceLayout
            options={options}
            submitting={submitting}
            onSubmit={handleSubmit}
            commentTexts={commentTexts}
            onCommentChange={handleCommentChange}
          />
        ) : type === "request-info" ? (
          <RequestInfoLayout
            decision={decision}
            submitting={submitting}
            onSubmitFreeText={handleSubmitFreeText}
          />
        ) : type === "escalate" ? (
          <EscalateLayout
            options={options}
            submitting={submitting}
            onSubmit={handleSubmit}
            commentTexts={commentTexts}
            onCommentChange={handleCommentChange}
          />
        ) : (
          <CustomActionLayout
            options={options}
            decision={decision}
            submitting={submitting}
            onSubmit={handleSubmit}
            commentTexts={commentTexts}
            onCommentChange={handleCommentChange}
          />
        )}

        {error ? (
          <div
            role="alert"
            className={workspaceCalloutClass(
              "danger",
              "px-3 py-2 text-sm text-[var(--workspace-danger)]"
            )}
          >
            {error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
