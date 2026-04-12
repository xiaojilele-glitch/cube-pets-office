import { useCallback, useState } from "react";
import { MessageCircleQuestion, Send } from "lucide-react";

import { GlowButton } from "@/components/ui/GlowButton";
import { useI18n } from "@/i18n";
import { localizeTaskHubQuestion } from "@/lib/task-hub-copy";
import { cn } from "@/lib/utils";
import type {
  ClarificationDialog,
  ClarificationQuestion,
} from "@shared/nl-command/contracts";

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
  onAnswer: (
    questionId: string,
    text: string,
    selectedOptions?: string[]
  ) => void | Promise<void>;
  title?: string;
  answerPlaceholder?: string;
  answerLabel?: string;
  answeringLabel?: string;
  className?: string;
}

export function ClarificationPanel({
  dialog,
  onAnswer,
  title,
  answerPlaceholder,
  answerLabel,
  answeringLabel,
  className,
}: ClarificationPanelProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const answeredIds = new Set(dialog.answers.map(a => a.questionId));
  const unanswered = dialog.questions.filter(
    q => !answeredIds.has(q.questionId)
  );
  const resolvedTitle =
    title ?? (isZh ? "需要补充信息" : "Clarification Needed");
  const resolvedAnswerPlaceholder =
    answerPlaceholder ?? (isZh ? "请填写你的回答..." : "Type your answer...");
  const resolvedAnswerLabel = answerLabel ?? (isZh ? "提交回答" : "Answer");
  const resolvedAnsweringLabel =
    answeringLabel ?? (isZh ? "提交中..." : "Submitting...");

  if (unanswered.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-200 bg-amber-50/60 p-3",
        className
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800">
        <MessageCircleQuestion className="size-4" />
        {isZh
          ? `${resolvedTitle}（${unanswered.length} 个问题）`
          : `${resolvedTitle} (${unanswered.length} question${unanswered.length > 1 ? "s" : ""})`}
      </div>
      <div className="space-y-3">
        {unanswered.map(question => (
          <QuestionCard
            key={question.questionId}
            question={question}
            onAnswer={onAnswer}
            answerPlaceholder={resolvedAnswerPlaceholder}
            answerLabel={resolvedAnswerLabel}
            answeringLabel={resolvedAnsweringLabel}
            locale={locale}
          />
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
  answerPlaceholder,
  answerLabel,
  answeringLabel,
  locale,
}: {
  question: ClarificationQuestion;
  onAnswer: (
    questionId: string,
    text: string,
    selectedOptions?: string[]
  ) => void | Promise<void>;
  answerPlaceholder: string;
  answerLabel: string;
  answeringLabel: string;
  locale: string;
}) {
  const [freeText, setFreeText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const resolvedQuestion = localizeTaskHubQuestion(
    question,
    locale === "zh-CN" ? "zh-CN" : "en-US"
  );

  const isFreeText = resolvedQuestion.type === "free_text";
  const isSingleChoice = resolvedQuestion.type === "single_choice";
  const isMultiChoice = resolvedQuestion.type === "multi_choice";
  const hasOptions =
    (isSingleChoice || isMultiChoice) &&
    resolvedQuestion.options &&
    resolvedQuestion.options.length > 0;

  const toggleOption = useCallback(
    (option: string) => {
      setSelected(prev => {
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
    [isSingleChoice]
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
      <p className="text-sm font-medium text-stone-800">
        {resolvedQuestion.text}
      </p>
      {resolvedQuestion.context && (
        <p className="mt-1 text-xs text-stone-500">
          {resolvedQuestion.context}
        </p>
      )}

      <div className="mt-2">
        {hasOptions ? (
          <div className="flex flex-wrap gap-2">
            {resolvedQuestion.options!.map(option => (
              <button
                key={option}
                type="button"
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  selected.has(option)
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                    : "border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-300"
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
            onChange={e => setFreeText(e.target.value)}
            placeholder={answerPlaceholder}
            rows={2}
            className="w-full resize-none rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            aria-label={
              locale === "zh-CN"
                ? `回答：${resolvedQuestion.text}`
                : `Answer for: ${resolvedQuestion.text}`
            }
            onKeyDown={e => {
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
          {submitting ? answeringLabel : answerLabel}
        </GlowButton>
      </div>
    </div>
  );
}
