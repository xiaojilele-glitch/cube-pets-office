import { ArrowRight, FolderKanban } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useViewportTier } from "@/hooks/useViewportTier";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  MORE_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  type MoreNavigationId,
  type PrimaryNavigationId,
} from "./navigation-config";

interface MoreDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (href: string) => void;
  onSelectAction: (actionId: MoreNavigationId) => void;
}

export function MoreDrawer({
  open,
  onOpenChange,
  onNavigate,
  onSelectAction,
}: MoreDrawerProps) {
  const { copy } = useI18n();
  const { isMobile } = useViewportTier();

  const handleMoreAction = (id: MoreNavigationId) => {
    const target = MORE_NAV_ITEMS.find(item => item.id === id);
    if (!target) return;

    if (target.href) {
      onNavigate(target.href);
      onOpenChange(false);
      return;
    }

    onSelectAction(id);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "overflow-y-auto border-stone-200/70 bg-[#fbf6ef] p-0 text-stone-900 shadow-[0_20px_70px_rgba(77,58,40,0.18)]",
          isMobile
            ? "h-[86svh] rounded-t-[32px] border-t"
            : "w-full sm:max-w-[420px]"
        )}
      >
        <SheetHeader className="border-b border-stone-200/80 px-6 py-5 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
            {copy.toolbar.moreDrawerEyebrow}
          </p>
          <SheetTitle
            className="text-2xl font-semibold tracking-tight text-stone-900"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {copy.toolbar.moreDrawerTitle}
          </SheetTitle>
          <SheetDescription className="text-sm leading-6 text-stone-600">
            {copy.toolbar.moreDrawerDescription}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-6 py-6">
          <section className="rounded-[28px] border border-stone-200/80 bg-white/75 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
              {copy.toolbar.mainPathsTitle}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["office", "tasks"] as const).map(id => {
                const labels = copy.toolbar.primaryNav[id];
                const href = id === "office" ? "/" : "/tasks";
                const Icon = id === "office" ? PRIMARY_NAV_ITEMS.find(nav => nav.id === "office")?.icon || FolderKanban : FolderKanban;

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      onNavigate(href);
                      onOpenChange(false);
                    }}
                    className="group flex items-center gap-3 rounded-[22px] border border-stone-200/80 bg-white px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:bg-[#fffaf2]"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-stone-700 transition-colors group-hover:bg-[#f4e7d8]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-stone-900">
                        {labels.label}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-stone-600">
                        {labels.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-[28px] border border-stone-200/80 bg-white/75 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
              {copy.toolbar.moreActionsTitle}
            </p>
            <div className="mt-4 space-y-3">
              {MORE_NAV_ITEMS.map(item => {
                const Icon = item.icon;
                const labels = copy.toolbar.moreActions[item.id];

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleMoreAction(item.id)}
                    className="group flex w-full items-center gap-3 rounded-[24px] border border-stone-200/80 bg-white px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:bg-[#fffaf2]"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-stone-700 transition-colors group-hover:bg-[#f4e7d8]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-stone-900">
                        {labels.label}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-stone-600">
                        {labels.description}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-stone-400 transition-transform group-hover:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
