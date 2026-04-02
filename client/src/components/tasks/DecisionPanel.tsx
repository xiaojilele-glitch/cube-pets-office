import { useState, useCallback } from "react";
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
import { cn } from "@/lib/utils";
import { submitMissionDecision } from "@/lib/mission-client";

/* ─── Props ─── */

interface DecisionPanelProps {
  missionId: string;
  decision: MissionDecision;
  onDecisionSubmitted?: () => void;
}

/* ─── Helpers ─── */

function resolveDecisionType(decision: MissionDecision): DecisionType {
  return decision.type ?? "custom-action";
}

function severityClasses(severity?: "info" | "warn" | "danger"): string {
  switch (severity) {
    case "info":
      return "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100";
    case "warn":
      return "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100";
    case "danger":
      return "border-red-200 bg-red-50 text-red-800 hover:bg-red-100";
    default:
      return "border-stone-200 bg-stone-50 text-stone-800 hover:bg-stone-100";
  }
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

/* ─── Option Card ─── */

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
          ? "ring-2 ring-teal-400 border-teal-300 bg-teal-50"
          : severityClasses(option.severity),
        disabled && "opacity-50 cursor-not-allowed",
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

/* ─── Approve / Reject Layout ─── */

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
    (o) => o.action === "approve" || /approve|通过|批准/i.test(o.label),
  );
  const rejectOpt = options.find(
    (o) => o.action === "reject" || /reject|拒绝|驳回/i.test(o.label),
  );
  const remaining = options.filter(
    (o) => o !== approveOpt && o !== rejectOpt,
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {approveOpt && (
          <div className="space-y-2">
            <Button
              type="button"
              disabled={submitting}
              aria-label={approveOpt.label}
              onClick={() =>
                onSubmit(approveOpt.id, commentTexts[approveOpt.id])
              }
              className="w-full rounded-[18px] border border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600"
            >
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {approveOpt.label}
            </Button>
            {approveOpt.requiresComment && (
              <Textarea
                value={commentTexts[approveOpt.id] ?? ""}
                onChange={(e) =>
                  onCommentChange(approveOpt.id, e.target.value)
                }
                placeholder="Required: provide a reason"
                aria-label={`Comment for ${approveOpt.label}`}
                aria-required="true"
                className="min-h-16 rounded-[14px] border-stone-200 bg-stone-50/80 text-sm"
              />
            )}
          </div>
        )}
        {rejectOpt && (
          <div className="space-y-2">
            <Button
              type="button"
              disabled={submitting}
              aria-label={rejectOpt.label}
              onClick={() =>
                onSubmit(rejectOpt.id, commentTexts[rejectOpt.id])
              }
              className="w-full rounded-[18px] border border-red-300 bg-red-500 text-white hover:bg-red-600"
            >
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              {rejectOpt.label}
            </Button>
            {rejectOpt.requiresComment && (
              <Textarea
                value={commentTexts[rejectOpt.id] ?? ""}
                onChange={(e) =>
                  onCommentChange(rejectOpt.id, e.target.value)
                }
                placeholder="Required: provide a reason"
                aria-label={`Comment for ${rejectOpt.label}`}
                aria-required="true"
                className="min-h-16 rounded-[14px] border-stone-200 bg-stone-50/80 text-sm"
              />
            )}
          </div>
        )}
      </div>
      {remaining.map((opt) => (
        <div key={opt.id} className="space-y-2">
          <button
            type="button"
            disabled={submitting}
            aria-label={opt.label}
            onClick={() => onSubmit(opt.id, commentTexts[opt.id])}
            className={cn(
              "w-full rounded-[18px] border px-3.5 py-3 text-left text-sm font-semibold transition-colors",
              severityClasses(opt.severity),
            )}
          >
            {opt.label}
          </button>
          {opt.requiresComment && (
            <Textarea
              value={commentTexts[opt.id] ?? ""}
              onChange={(e) => onCommentChange(opt.id, e.target.value)}
              placeholder="Required: provide a reason"
              aria-label={`Comment for ${opt.label}`}
              aria-required="true"
              className="min-h-16 rounded-[14px] border-stone-200 bg-stone-50/80 text-sm"
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Multi-Choice Layout ─── */

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
  const selected = options.find((o) => o.id === selectedId);

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Decision options" className="grid gap-2">
        {options.map((opt) => (
          <div key={opt.id} className="space-y-2">
            <OptionCard
              option={opt}
              selected={selectedId === opt.id}
              disabled={submitting}
              onSelect={setSelectedId}
            />
            {opt.requiresComment && selectedId === opt.id && (
              <Textarea
                value={commentTexts[opt.id] ?? ""}
                onChange={(e) => onCommentChange(opt.id, e.target.value)}
                placeholder="Required: provide a reason"
                aria-label={`Comment for ${opt.label}`}
                aria-required="true"
                className="min-h-16 rounded-[14px] border-stone-200 bg-stone-50/80 text-sm"
              />
            )}
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

/* ─── Request-Info Layout ─── */

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
        onChange={(e) => setText(e.target.value)}
        placeholder={decision.placeholder ?? "Provide the requested information…"}
        aria-label="Information response"
        aria-required="true"
        className="min-h-24 rounded-[18px] border-stone-200 bg-stone-50/80 text-sm leading-6"
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

/* ─── Escalate Layout ─── */

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
      <div className="flex items-center gap-2 rounded-[18px] border border-red-200 bg-red-50 px-3.5 py-2.5">
        <AlertTriangle className="size-4 text-red-600 shrink-0" />
        <span className="text-sm font-medium text-red-800">
          High priority — this decision requires immediate attention
        </span>
      </div>
      {options.map((opt) => (
        <div key={opt.id} className="space-y-2">
          <Button
            type="button"
            disabled={submitting}
            aria-label={opt.label}
            onClick={() => onSubmit(opt.id, commentTexts[opt.id])}
            className={cn(
              "w-full rounded-[18px]",
              opt === primary
                ? "border border-red-300 bg-red-500 text-white hover:bg-red-600"
                : "border border-stone-200 bg-white text-stone-800 hover:bg-stone-50",
            )}
          >
            {submitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ShieldAlert className="size-4" />
            )}
            {opt.label}
          </Button>
          {opt.requiresComment && (
            <Textarea
              value={commentTexts[opt.id] ?? ""}
              onChange={(e) => onCommentChange(opt.id, e.target.value)}
              placeholder="Required: provide a reason"
              aria-label={`Comment for ${opt.label}`}
              aria-required="true"
              className="min-h-16 rounded-[14px] border-stone-200 bg-stone-50/80 text-sm"
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Custom-Action (default) Layout ─── */

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
      {decision.allowFreeText && (
        <Textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder={decision.placeholder ?? "Optional note…"}
          aria-label="Decision note"
          className="min-h-20 rounded-[18px] border-stone-200 bg-stone-50/80 text-sm leading-6"
        />
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => (
          <div key={opt.id} className="space-y-2">
            <button
              type="button"
              disabled={submitting}
              aria-label={opt.label}
              onClick={() =>
                onSubmit(
                  opt.id,
                  commentTexts[opt.id] ||
                    (decision.allowFreeText ? freeText : undefined),
                )
              }
              className={cn(
                "w-full rounded-[18px] border px-3.5 py-3 text-left transition-colors",
                severityClasses(opt.severity),
                submitting && "opacity-50 cursor-not-allowed",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{opt.label}</div>
                  {opt.description && (
                    <div className="mt-1 line-clamp-2 text-xs leading-5 opacity-80">
                      {opt.description}
                    </div>
                  )}
                </div>
                {submitting ? (
                  <LoaderCircle className="size-4 animate-spin shrink-0" />
                ) : (
                  <Send className="size-4 shrink-0 opacity-50" />
                )}
              </div>
            </button>
            {opt.requiresComment && (
              <Textarea
                value={commentTexts[opt.id] ?? ""}
                onChange={(e) => onCommentChange(opt.id, e.target.value)}
                placeholder="Required: provide a reason"
                aria-label={`Comment for ${opt.label}`}
                aria-required="true"
                className="min-h-16 rounded-[14px] border-stone-200 bg-stone-50/80 text-sm"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main DecisionPanel ─── */

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

  const handleCommentChange = useCallback(
    (optionId: string, text: string) => {
      setCommentTexts((prev) => ({ ...prev, [optionId]: text }));
    },
    [],
  );

  const handleSubmit = useCallback(
    async (optionId: string, freeText?: string) => {
      // Validate requiresComment
      const option = options.find((o) => o.id === optionId);
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
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to submit decision",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [missionId, options, onDecisionSubmitted],
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
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to submit decision",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [missionId, onDecisionSubmitted],
  );

  return (
    <Card
      className={cn(
        "rounded-[28px] shadow-[0_24px_60px_rgba(112,84,51,0.08)]",
        type === "escalate"
          ? "border-red-200/80 bg-red-50/40"
          : "border-stone-200/80 bg-white/90",
      )}
    >
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          {typeIcon(type)}
          Decision Required
        </CardTitle>
        <CardDescription>{decision.prompt}</CardDescription>
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

        {error && (
          <div
            role="alert"
            className="rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
