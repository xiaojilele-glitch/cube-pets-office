import {
  CheckCircle2,
  HelpCircle,
  MessageSquare,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import type {
  DecisionHistoryEntry,
  DecisionType,
} from "@shared/mission/contracts";

import { cn } from "@/lib/utils";

import { formatTaskRelative } from "./task-helpers";

/* ─── Props ─── */

interface DecisionHistoryProps {
  history: DecisionHistoryEntry[];
}

/* ─── Helpers ─── */

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

/* ─── Main Component ─── */

export function DecisionHistory({ history }: DecisionHistoryProps) {
  const sorted = [...history].sort(
    (a, b) => a.submittedAt - b.submittedAt,
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50/70 px-4 py-6 text-center text-sm leading-6 text-stone-500">
        No decisions have been recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {sorted.map((entry, index) => {
        const reasonText =
          entry.resolved.freeText || entry.reason || undefined;

        return (
          <div key={entry.decisionId} className="relative pl-6">
            {/* Vertical connector line */}
            {index < sorted.length - 1 && (
              <div className="absolute left-[7px] top-5 bottom-0 w-px bg-stone-200" />
            )}

            {/* Dot / icon */}
            <div className="absolute left-0 top-1.5 flex items-center justify-center">
              {typeIcon(entry.type)}
            </div>

            <div className="pb-4">
              <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/70 px-3.5 py-2.5">
                {/* Header row: timestamp + stage */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-stone-500">
                    {formatTaskRelative(entry.submittedAt)}
                  </span>
                  {entry.stageKey && (
                    <span className="rounded-full border border-stone-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                      {entry.stageKey}
                    </span>
                  )}
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                      entry.type === "approve"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : entry.type === "reject"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : entry.type === "escalate"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-sky-200 bg-sky-50 text-sky-700",
                    )}
                  >
                    {entry.type}
                  </span>
                </div>

                {/* Prompt */}
                <div className="mt-1.5 text-sm font-medium text-stone-900">
                  {entry.prompt}
                </div>

                {/* Selected option */}
                {entry.resolved.optionLabel && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-xs text-stone-500">Selected:</span>
                    <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                      {entry.resolved.optionLabel}
                    </span>
                  </div>
                )}

                {/* Reason / free text */}
                {reasonText && (
                  <div className="mt-1.5 text-xs leading-5 text-stone-600">
                    {reasonText}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
