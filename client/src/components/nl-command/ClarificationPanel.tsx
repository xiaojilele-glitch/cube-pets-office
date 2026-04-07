import { useCallback, useState } from "react";
import { MessageCircleQuestion, Send } from "lucide-react";

import { GlowButton } from "@/components/ui/GlowButton";
import { cn } from "@/lib/utils";
import type { ClarificationDialog, ClarificationQuestion } from "@shared/nl-command/contracts";

/**
 * Clarification dialog panel.
 *
 * Displays unanswered clarification questions and supports:
 * - Free-text answers
 * - Selection-based answers (single_choice / multi_choice)
 *
 * @see Requirements 2.3
 */
export interface ClarificationPanelProps {
  dialog: ClarificationDialog;
  onAnswer: (questionId: string, text: string, selectedOptions?: string[]) => void | Promise<void>;
  className?: string;
}

export function ClarificationPanel({ dialog, onAnswer, className }: ClarificationPanelProps) {
  const answeredIds = new Set(dialog.answers.map((a) => a.questionId));
  const unanswered = dialog.questions.filter((q) => !answeredIds.has(q.questionId));

  if (unanswered.length === 0) return null;

  return (
    <div className={cn("rounded-xl border border-amber-200 bg-amber-50/60 p-3", className)}>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800">
        <MessageCircleQuestion className="size-4" />
        Clarification Needed ({unanswered.length} question{unanswered.length > 1 ? "s" : ""})
      </div>
      <div className="space-y-3">
        {unanswered.map((question) => (
          <QuestionCard key={question.questionId} question={question} onAnswer={onAnswer} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: single question card
// ---------------------------------------------------------------------------

function QuestionCard({
  question,
  onAnswer,
}: {
  question: ClarificationQuestion;
  onAnswer: (questionId: string, text: string, selectedOptions?: string[]) => void | Promise<void>;
}) {
  const [freeText, setFreeText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const isFreeText = question.type === "free_text";
  const isSingleChoice = question.type === "single_choice";
  const isMultiChoice = question.type === "multi_choice";
  const hasOptions = (isSingleChoice || isMultiChoice) && question.options && question.options.length > 0;

  const toggleOption = useCallback(
    (option: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (isSingleChoice) {
          // Single choice: replace selection
          return new Set([option]);
        }
        // Multi choice: toggle
        if (next.has(option)) next.delete(option);
        else next.add(option);
        return next;
      });
    },
    [isSingleChoice],
  );

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      if (hasOptions) {
        const opts = Array.from(selected);
        await onAnswer(question.questionId, opts.join(", "), opts);
      } else {
        await onAnswer(question.questionId, freeText.trim());
      }
    } finally {
      setSubmitting(false);
    }
  }, [hasOptions, selected, freeText, onAnswer, question.questionId]);

  const canSubmit = hasOptions ? selected.size > 0 : freeText.trim().length > 0;

  return (
    <div className="rounded-lg border border-amber-100 bg-white/80 p-3">
      <p className="text-sm font-medium text-stone-800">{question.text}</p>
      {question.context && (
        <p className="mt-1 text-xs text-stone-500">{question.context}</p>
      )}

      <div className="mt-2">
        {hasOptions ? (
          <div className="flex flex-wrap gap-2">
            {question.options!.map((option) => (
              <button
                key={option}
                type="button"
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  selected.has(option)
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                    : "border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-300",
                )}
                onClick={() => toggleOption(option)}
              >
                {option}
              </button>
            ))}
          </div>
        ) : (
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="Type your answer..."
            rows={2}
            className="w-full resize-none rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            aria-label={`Answer for: ${question.text}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && canSubmit) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
          />
        )}
      </div>

      <div className="mt-2 flex justify-end">
        <GlowButton
          type="button"
          disabled={!canSubmit || submitting}
          className="rounded-lg"
          onClick={() => void handleSubmit()}
        >
          <Send className="size-3.5" />
          {submitting ? "Submitting..." : "Answer"}
        </GlowButton>
      </div>
    </div>
  );
}
