import {
  ArrowRight,
  BriefcaseBusiness,
  FolderKanban,
  History,
} from "lucide-react";
import { useLocation } from "wouter";

import { useI18n } from "@/i18n";
import { LEGACY_COMMAND_CENTER_LEGACY_PATH } from "@/components/navigation-config";

export default function LegacyCommandCenterPage() {
  const [, setLocation] = useLocation();
  const { copy } = useI18n();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(94,139,114,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(201,130,87,0.14),transparent_28%),linear-gradient(180deg,#fffdf8,#f2eadf)] px-4 pb-32 pt-[calc(env(safe-area-inset-top)+104px)] text-stone-900 md:px-6 md:pb-40 md:pt-16">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-[32px] border border-stone-200/80 bg-white/80 p-6 shadow-[0_20px_60px_rgba(112,84,51,0.10)] backdrop-blur md:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">
            {copy.legacyRoutes.commandCenter.eyebrow}
          </p>
          <h1
            className="mt-3 text-3xl font-semibold tracking-tight text-stone-900 md:text-4xl"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {copy.legacyRoutes.commandCenter.title}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600 md:text-base">
            {copy.legacyRoutes.commandCenter.description}
          </p>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={() => setLocation("/tasks")}
              className="flex items-center justify-between rounded-[24px] bg-[#d07a4f] px-5 py-4 text-left text-white shadow-sm transition-colors hover:bg-[#bf6c43]"
            >
              <div>
                <div className="text-sm font-semibold">
                  {copy.legacyRoutes.commandCenter.primaryCta}
                </div>
                <div className="mt-1 text-xs text-white/78">
                  {copy.toolbar.primaryNav.tasks.description}
                </div>
              </div>
              <FolderKanban className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setLocation("/")}
              className="flex items-center justify-between rounded-[24px] border border-stone-200/80 bg-white px-5 py-4 text-left text-stone-900 transition-colors hover:bg-stone-50"
            >
              <div>
                <div className="text-sm font-semibold">
                  {copy.legacyRoutes.commandCenter.secondaryCta}
                </div>
                <div className="mt-1 text-xs text-stone-500">
                  {copy.toolbar.primaryNav.office.description}
                </div>
              </div>
              <BriefcaseBusiness className="h-5 w-5 text-stone-500" />
            </button>

            <button
              type="button"
              onClick={() => setLocation(LEGACY_COMMAND_CENTER_LEGACY_PATH)}
              className="flex items-center justify-between rounded-[24px] border border-stone-200/80 bg-white px-5 py-4 text-left text-stone-900 transition-colors hover:bg-stone-50"
            >
              <div>
                <div className="text-sm font-semibold">
                  {copy.legacyRoutes.commandCenter.legacyCta}
                </div>
                <div className="mt-1 text-xs text-stone-500">
                  {copy.legacyRoutes.commandCenter.legacyDescription}
                </div>
              </div>
              <History className="h-5 w-5 text-stone-500" />
            </button>
          </div>

          <div className="mt-8 rounded-[26px] border border-stone-200/80 bg-stone-50/80 px-5 py-4 text-sm leading-6 text-stone-600">
            <div className="flex items-center gap-2 font-semibold text-stone-900">
              <ArrowRight className="h-4 w-4 text-[#d07a4f]" />
              {copy.legacyRoutes.commandCenter.noteTitle}
            </div>
            <p className="mt-2">{copy.legacyRoutes.commandCenter.noteBody}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
