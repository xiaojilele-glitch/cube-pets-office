import { Globe2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

import { MoreDrawer } from "@/components/MoreDrawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useViewportTier } from "@/hooks/useViewportTier";
import { useI18n } from "@/i18n";
import { OFFICE_DESKTOP_OPEN_MORE_EVENT } from "@/lib/navigation-events";
import { useAppStore } from "@/lib/store";

import {
  PRIMARY_NAV_ITEMS,
  getPrimaryNavigationId,
  type MoreNavigationId,
} from "./navigation-config";

export function Toolbar() {
  const locale = useAppStore(state => state.locale);
  const toggleLocale = useAppStore(state => state.toggleLocale);
  const { copy } = useI18n();
  const { isMobile } = useViewportTier();
  const [location, setLocation] = useLocation();

  const [showMore, setShowMore] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const activeId = getPrimaryNavigationId(location);
  const localeLabel =
    locale === "zh-CN" ? copy.common.englishShort : copy.common.chineseShort;
  const officeDesktopUtilityDock = !isMobile && activeId === "office";

  useEffect(() => {
    const handleOpenMore = () => {
      setShowMore(true);
    };

    window.addEventListener(OFFICE_DESKTOP_OPEN_MORE_EVENT, handleOpenMore);
    return () => {
      window.removeEventListener(
        OFFICE_DESKTOP_OPEN_MORE_EVENT,
        handleOpenMore
      );
    };
  }, []);

  const handlePrimaryNavigation = (
    id: (typeof PRIMARY_NAV_ITEMS)[number]["id"]
  ) => {
    const item = PRIMARY_NAV_ITEMS.find(nav => nav.id === id);
    if (!item) return;

    if (id === "more") {
      setShowMore(true);
      return;
    }

    if (item.href && item.href !== location) {
      setLocation(item.href);
    }
  };

  const handleMoreAction = (id: MoreNavigationId) => {
    switch (id) {
      case "debug":
        setLocation("/debug");
        return;
      case "help":
        setShowHelp(true);
        return;
      default:
        return;
    }
  };

  return (
    <>
      <MoreDrawer
        open={showMore}
        onOpenChange={setShowMore}
        onNavigate={setLocation}
        onSelectAction={handleMoreAction}
      />

      {isMobile ? (
        <div
          className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+12px)] z-[80]"
          style={{ pointerEvents: "auto" }}
        >
          <div className="rounded-[28px] studio-shell px-3 py-3 shadow-[0_18px_45px_rgba(78,58,38,0.16)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#A08972]">
                  {copy.toolbar.navigationLabel}
                </p>
                <h2
                  className="truncate text-sm font-bold text-[#3A2A1A]"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {copy.app.name}
                </h2>
              </div>

              <button
                type="button"
                onClick={toggleLocale}
                className="inline-flex h-10 min-w-10 items-center justify-center rounded-2xl studio-surface px-3 text-xs font-semibold text-[#5A4A3A] transition-colors hover:bg-white/65"
                title={copy.app.localeSwitch}
              >
                <Globe2 className="mr-1 h-3.5 w-3.5" />
                {localeLabel}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {PRIMARY_NAV_ITEMS.map(item => {
                const Icon = item.icon;
                const labels = copy.toolbar.primaryNav[item.id];
                const active =
                  item.id === "more"
                    ? showMore || activeId === "more"
                    : activeId === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handlePrimaryNavigation(item.id)}
                    aria-current={
                      item.id !== "more" && active ? "page" : undefined
                    }
                    aria-expanded={item.id === "more" ? showMore : undefined}
                    className={`rounded-[22px] px-3 py-3 text-left transition-all ${
                      active
                        ? "bg-[#5E8B72] text-white shadow-sm"
                        : "studio-surface text-[#5A4A3A]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
                          active ? "bg-white/18" : "bg-white/75"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {labels.label}
                        </div>
                        <div
                          className="text-[10px] uppercase tracking-[0.16em]"
                          style={{
                            color: active
                              ? "rgba(255,255,255,0.78)"
                              : "#A08972",
                          }}
                        >
                          {labels.sublabel}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-xs leading-5 text-[#6B5A4A]">
              {copy.toolbar.primaryNav[activeId].description}
            </p>
          </div>
        </div>
      ) : (
        officeDesktopUtilityDock ? null : (
          <div
            className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2"
            style={{ pointerEvents: "auto" }}
          >
            <div className="studio-shell rounded-[34px] px-3 py-2.5 shadow-[0_18px_45px_rgba(78,58,38,0.16)]">
              <div className="flex items-center gap-2">
                {PRIMARY_NAV_ITEMS.map(item => {
                  const Icon = item.icon;
                  const labels = copy.toolbar.primaryNav[item.id];
                  const active =
                    item.id === "more"
                      ? showMore || activeId === "more"
                      : activeId === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handlePrimaryNavigation(item.id)}
                      aria-current={
                        item.id !== "more" && active ? "page" : undefined
                      }
                      aria-expanded={item.id === "more" ? showMore : undefined}
                      className={`group flex min-w-[150px] items-center gap-3 rounded-[24px] px-4 py-3 text-left transition-all duration-300 ${
                        active
                          ? "-translate-y-1 bg-[#5E8B72] text-white shadow-[0_12px_24px_rgba(80,56,36,0.16)]"
                          : "bg-white/36 text-[#5A4A3A] hover:-translate-y-1 hover:bg-white/70"
                      }`}
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                          active ? "bg-white/18" : "bg-white/74"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">
                          {labels.label}
                        </div>
                        <div
                          className="text-[10px] uppercase tracking-[0.16em]"
                          style={{
                            color: active
                              ? "rgba(255,255,255,0.78)"
                              : "#A08972",
                          }}
                        >
                          {labels.sublabel}
                        </div>
                      </div>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={toggleLocale}
                  className="inline-flex h-12 min-w-12 items-center justify-center rounded-[22px] bg-white/45 px-3 text-xs font-semibold text-[#5A4A3A] transition-colors hover:bg-white/75"
                  title={copy.app.localeSwitch}
                >
                  <Globe2 className="mr-1 h-4 w-4" />
                  {localeLabel}
                </button>
              </div>
            </div>
          </div>
        )
      )}

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="max-w-xl rounded-[28px] border-stone-200 bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]">
          <DialogHeader className="border-b border-stone-200/80 px-6 py-4">
            <DialogTitle className="text-stone-900">
              {copy.toolbar.helpTitle}
            </DialogTitle>
            <DialogDescription className="text-sm text-stone-500">
              {copy.toolbar.helpDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5 text-sm leading-6 text-stone-700">
            {copy.toolbar.quickTips.map(tip => (
              <div
                key={tip}
                className="rounded-2xl border border-stone-200/80 bg-stone-50/80 px-4 py-3"
              >
                {tip}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
