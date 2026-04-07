import { GlowButton } from "@/components/ui/GlowButton";
import type { PlanTemplate } from "@shared/nl-command/contracts";

/**
 * Template management component: save, load, and view version history.
 *
 * @see Requirements 19.3, 19.4, 19.5
 */
export interface TemplateManagerProps {
  templates: PlanTemplate[];
  onSave?: (templateId: string) => void;
  onLoad?: (template: PlanTemplate) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function TemplateManager({ templates, onSave, onLoad }: TemplateManagerProps) {
  if (templates.length === 0) {
    return <div className="py-4 text-center text-sm text-stone-400">No templates saved.</div>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {templates.map((t) => (
        <li
          key={t.templateId}
          className="rounded-lg border border-stone-200 bg-white px-3 py-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-800">{t.name}</span>
            <span className="text-[10px] text-stone-400">v{t.version}</span>
          </div>
          <div className="mt-0.5 text-xs text-stone-500 line-clamp-1">{t.description}</div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-stone-400">
            <span>
              by {t.createdBy} · {formatDate(t.createdAt)}
              {t.versions.length > 1 && ` · ${t.versions.length} versions`}
            </span>
            <div className="flex gap-1.5">
              {onLoad && (
                <GlowButton
                  onClick={() => onLoad(t)}
                  className="rounded-md"
                >
                  Load
                </GlowButton>
              )}
              {onSave && (
                <button
                  onClick={() => onSave(t.templateId)}
                  className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600 transition-colors hover:bg-stone-200"
                >
                  Update
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
