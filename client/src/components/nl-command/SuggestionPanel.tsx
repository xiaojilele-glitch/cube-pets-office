import { GlowButton } from "@/components/ui/GlowButton";
import type { Suggestion } from "@shared/nl-command/api";

/**
 * Decision suggestion panel with one-click apply.
 *
 * @see Requirements 11.4, 18.5
 */
export interface SuggestionPanelProps {
  suggestions: Suggestion[];
  onApply?: (suggestionId: string) => void;
}

const TYPE_ICONS: Record<string, string> = {
  cost: "💰",
  resource: "👥",
  timeline: "⏱️",
  risk: "⚠️",
};

export function SuggestionPanel({
  suggestions,
  onApply,
}: SuggestionPanelProps) {
  if (suggestions.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-stone-400">
        No suggestions.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {suggestions.map(s => (
        <li
          key={s.suggestionId}
          className="rounded-lg border border-stone-200 bg-white px-3 py-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-800">
              {TYPE_ICONS[s.type] ?? "📋"} {s.title}
            </span>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">
              {s.type}
            </span>
          </div>
          <div className="mt-1 text-xs text-stone-500">{s.description}</div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[10px] text-stone-400">
              Impact: {s.estimatedImpact.timelineImpact} ·{" "}
              {s.estimatedImpact.costImpact}
            </span>
            {onApply && (
              <GlowButton
                onClick={() => onApply(s.suggestionId)}
                className="rounded-md"
              >
                Apply
              </GlowButton>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
