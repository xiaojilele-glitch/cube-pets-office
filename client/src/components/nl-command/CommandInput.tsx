import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

import { GlowButton } from "@/components/ui/GlowButton";
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
  className?: string;
}

export function CommandInput({ onSubmit, loading, commandHistory = [], className }: CommandInputProps) {
  const [text, setText] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed || trimmed.length < 2) return [];
    const unique = Array.from(new Set(commandHistory));
    return unique.filter((cmd) => cmd.toLowerCase().includes(trimmed)).slice(0, 5);
  }, [text, commandHistory]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    await onSubmit(trimmed);
    setText("");
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, [text, loading, onSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSuggestions && suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i: number) => (i < suggestions.length - 1 ? i + 1 : 0));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i: number) => (i > 0 ? i - 1 : suggestions.length - 1));
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
    [showSuggestions, suggestions, selectedIndex, handleSubmit],
  );

  const handleChange = useCallback((value: string) => {
    setText(value);
    setShowSuggestions(value.trim().length >= 2);
    setSelectedIndex(-1);
  }, []);

  const selectSuggestion = useCallback((suggestion: string) => {
    setText(suggestion);
    setShowSuggestions(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  }, []);

  return (
    <div className={cn("relative", className)}>
      <label className="mb-1.5 block text-xs font-medium text-stone-500">
        Enter strategic command
      </label>
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => text.trim().length >= 2 && setShowSuggestions(true)}
            onBlur={() => {
              // Delay to allow click on suggestion
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            placeholder='e.g. "Refactor the payment module with zero downtime"'
            rows={2}
            disabled={loading}
            className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
            aria-label="Strategic command input"
            aria-autocomplete="list"
            aria-expanded={showSuggestions && suggestions.length > 0}
          />

          {/* Auto-complete suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-auto rounded-xl border border-stone-200 bg-white shadow-lg"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={cn(
                    "cursor-pointer px-3 py-2 text-sm text-stone-700 transition-colors",
                    index === selectedIndex
                      ? "bg-indigo-50 text-indigo-800"
                      : "hover:bg-stone-50",
                  )}
                  onMouseDown={(e) => {
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

        <GlowButton
          type="button"
          disabled={!text.trim() || loading}
          className="shrink-0 rounded-xl"
          onClick={() => void handleSubmit()}
        >
          <Send className="size-4" />
          {loading ? "Sending..." : "Send"}
        </GlowButton>
      </div>
    </div>
  );
}
