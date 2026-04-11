import {
  ArrowRight,
  BriefcaseBusiness,
  FolderKanban,
  History,
} from "lucide-react";
import { useLocation } from "wouter";

import { LEGACY_COMMAND_CENTER_LEGACY_PATH } from "@/components/navigation-config";
import {
  WorkspacePageShell,
  WorkspacePanel,
} from "@/components/workspace/WorkspacePageShell";
import { useI18n } from "@/i18n";

export default function LegacyCommandCenterPage() {
  const [, setLocation] = useLocation();
  const { copy } = useI18n();

  return (
    <WorkspacePageShell
      eyebrow={copy.legacyRoutes.commandCenter.eyebrow}
      title={copy.legacyRoutes.commandCenter.title}
      description={copy.legacyRoutes.commandCenter.description}
    >
      <WorkspacePanel strong className="p-5 md:p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <button
            type="button"
            onClick={() => setLocation("/tasks")}
            className="rounded-[28px] bg-[linear-gradient(180deg,#c98257,#b86f45)] px-5 py-5 text-left text-[#fffaf4] shadow-[0_18px_34px_rgba(184,111,69,0.24)] transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {copy.legacyRoutes.commandCenter.primaryCta}
                </div>
                <div className="mt-2 text-xs leading-5 text-white/80">
                  {copy.toolbar.primaryNav.tasks.description}
                </div>
              </div>
              <FolderKanban className="mt-0.5 size-5 shrink-0" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setLocation("/")}
            className="workspace-panel workspace-panel-inset rounded-[28px] px-5 py-5 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                  {copy.legacyRoutes.commandCenter.secondaryCta}
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                  {copy.toolbar.primaryNav.office.description}
                </div>
              </div>
              <BriefcaseBusiness className="mt-0.5 size-5 shrink-0 text-[var(--workspace-text-subtle)]" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setLocation(LEGACY_COMMAND_CENTER_LEGACY_PATH)}
            className="workspace-panel workspace-panel-inset rounded-[28px] px-5 py-5 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                  {copy.legacyRoutes.commandCenter.legacyCta}
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                  {copy.legacyRoutes.commandCenter.legacyDescription}
                </div>
              </div>
              <History className="mt-0.5 size-5 shrink-0 text-[var(--workspace-text-subtle)]" />
            </div>
          </button>
        </div>

        <div className="mt-5 rounded-[26px] border border-[var(--workspace-panel-border)] bg-white/44 px-5 py-4 text-sm leading-7 text-[var(--workspace-text-muted)]">
          <div className="flex items-center gap-2 font-semibold text-[var(--workspace-text-strong)]">
            <ArrowRight className="size-4 text-[var(--studio-accent-strong)]" />
            {copy.legacyRoutes.commandCenter.noteTitle}
          </div>
          <p className="mt-2">{copy.legacyRoutes.commandCenter.noteBody}</p>
        </div>
      </WorkspacePanel>
    </WorkspacePageShell>
  );
}
