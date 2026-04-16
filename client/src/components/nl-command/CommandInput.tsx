import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Send } from "lucide-react";

import { GlowButton } from "@/components/ui/GlowButton";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Natural language command text input component.
 *
 * - Supports history command auto-complete
 * - Supports clarification dialog interaction
 * - Keyboard shortcut: Enter to submit, ArrowUp/Down to navigate history suggestions
 *
 * @see Requirements 18.2, 2.3
 */
export interface CommandInputProps {
  onSubmit: (text: string) => void | Promise<void>;
  loading?: boolean;
  /** Previous command texts for auto-complete suggestions */
  commandHistory?: string[];
  value?: string;
  label?: string;
  hideLabel?: boolean;
  dense?: boolean;
  placeholder?: string;
  submitLabel?: string;
  sendingLabel?: string;
  onTextChange?: (value: string) => void;
  rows?: number;
  className?: string;
  hideSubmitButton?: boolean;
}

export function CommandInput({
  onSubmit,
  loading,
  commandHistory = [],
  value,
  label,
  hideLabel = false,
  dense = false,
  placeholder,
  submitLabel,
  sendingLabel,
  onTextChange,
  rows,
  className,
  hideSubmitButton = false,
}: CommandInputProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const resolvedLabel =
    label ?? (isZh ? "输入战略指令" : "Enter strategic command");
  const resolvedPlaceholder =
    placeholder ??
    (isZh
      ? '例如："在不停机的前提下重构支付模块"'
      : 'e.g. "Refactor the payment module with zero downtime"');
  const resolvedSubmitLabel = submitLabel ?? (isZh ? "发送" : "Send");
  const resolvedSendingLabel =
    sendingLabel ?? (isZh ? "发送中..." : "Sending...");
  const [internalText, setInternalText] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const text = value ?? internalText;

  const setText = useCallback(
    (nextValue: string) => {
      if (value === undefined) {
        setInternalText(nextValue);
      }
      onTextChange?.(nextValue);
    },
    [onTextChange, value]
  );

  const suggestions = useMemo(() => {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed || trimmed.length < 2) return [];
    const unique = Array.from(new Set(commandHistory));
    return unique
      .filter(cmd => cmd.toLowerCase().includes(trimmed))
      .slice(0, 5);
  }, [text, commandHistory]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    await onSubmit(trimmed);
    setText("");
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, [text, loading, onSubmit, setText]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSuggestions && suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i: number) =>
            i < suggestions.length - 1 ? i + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i: number) =>
            i > 0 ? i - 1 : suggestions.length - 1
          );
          return;
        }
        if (e.key === "Enter" && !e.shiftKey && selectedIndex >= 0) {
          e.preventDefault();
          setText(suggestions[selectedIndex]);
          setShowSuggestions(false);
          setSelectedIndex(-1);
          return;
        }
        if (e.key === "Escape") {
          setShowSuggestions(false);
          setSelectedIndex(-1);
          return;
        }
      }

      // Submit on Enter (without Shift)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [showSuggestions, suggestions, selectedIndex, handleSubmit]
  );

  const handleChange = useCallback(
    (value: string) => {
      setText(value);
      setShowSuggestions(value.trim().length >= 2);
      setSelectedIndex(-1);
    },
    [setText]
  );

  const selectSuggestion = useCallback(
    (suggestion: string) => {
      setText(suggestion);
      setShowSuggestions(false);
      setSelectedIndex(-1);
      inputRef.current?.focus();
    },
    [setText]
  );

  return (
    <div className={cn("relative", className)}>
      {!hideLabel ? (
        <label className="mb-0.5 block text-[10px] font-medium text-stone-500">
          {resolvedLabel}
        </label>
      ) : null}
      <div className="space-y-1.5">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={text}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => text.trim().length >= 2 && setShowSuggestions(true)}
            onBlur={() => {
              // Delay to allow click on suggestion
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            placeholder={resolvedPlaceholder}
            rows={rows ?? 2}
            disabled={loading}
            className={cn(
              "w-full resize-none rounded-xl border border-stone-200 bg-stone-50/60 text-stone-900 placeholder:text-stone-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50",
              dense
                ? "rounded-[12px] px-2.5 py-1.5 text-[12px] leading-5"
                : "px-3 py-2.5 text-sm"
            )}
            aria-label={isZh ? "战略指令输入框" : "Strategic command input"}
            aria-autocomplete="list"
            aria-expanded={showSuggestions && suggestions.length > 0}
          />

          {/* Auto-complete suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute left-0 right-0 top-full z-10 mt-1 max-h-36 overflow-auto rounded-[12px] border border-stone-200 bg-white shadow-lg"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={cn(
                    "cursor-pointer px-2.5 py-1.5 text-[12px] text-stone-700 transition-colors",
                    index === selectedIndex
                      ? "bg-indigo-50 text-indigo-800"
                      : "hover:bg-stone-50"
                  )}
                  onMouseDown={e => {
                    e.preventDefault();
                    selectSuggestion(suggestion);
                  }}
                >
                  {suggestion}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!hideSubmitButton ? (
          <div className="flex justify-end">
            <GlowButton
              type="button"
              disabled={!text.trim() || loading}
              className={cn(
                "shrink-0 rounded-[12px]",
                dense &&
                  "h-9 gap-1.5 px-3 text-[10px] font-semibold shadow-[0_8px_20px_rgba(94,139,114,0.18)]"
              )}
              onClick={() => void handleSubmit()}
            >
              <Send className={cn(dense ? "size-3.5" : "size-4")} />
              {loading ? resolvedSendingLabel : resolvedSubmitLabel}
            </GlowButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
