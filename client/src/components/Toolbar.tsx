import { useState } from 'react';
import {
  BookOpen,
  Brain,
  Globe2,
  HelpCircle,
  Menu,
  MessageCircle,
  Monitor,
  Server,
  Settings,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';

import { GitHubRepoBadge } from '@/components/GitHubRepoBadge';
import { useViewportTier } from '@/hooks/useViewportTier';
import { useI18n } from '@/i18n';
import { getAgentToolbarLabel } from '@/lib/agent-config';
import { CAN_USE_ADVANCED_RUNTIME, IS_GITHUB_PAGES } from '@/lib/deploy-target';
import { useAppStore } from '@/lib/store';
import { useWorkflowStore } from '@/lib/workflow-store';

type DockButtonId = 'paper' | 'config' | 'workflow' | 'chat' | 'help';

function RuntimeCard({
  compact = false,
  onAfterAction,
}: {
  compact?: boolean;
  onAfterAction?: () => void;
}) {
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const { copy } = useI18n();

  const handleSwitch = async (mode: 'frontend' | 'advanced') => {
    await setRuntimeMode(mode);
    onAfterAction?.();
  };

  return (
    <div className="rounded-[28px] border border-white/60 bg-white/88 p-4 shadow-[0_16px_44px_rgba(60,44,28,0.14)] backdrop-blur-2xl">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#A08972]">
        {copy.toolbar.modeTitle}
      </p>
      <h4
        className="mt-1 text-sm font-bold text-[#3A2A1A]"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        {runtimeMode === 'frontend'
          ? copy.toolbar.runtimeLabels.frontend
          : copy.toolbar.runtimeLabels.advanced}
      </h4>
      <p className="mt-1 text-[11px] leading-relaxed text-[#6B5A4A]">
        {CAN_USE_ADVANCED_RUNTIME ? copy.toolbar.modeDescription : copy.toolbar.pagesDescription}
      </p>

      <div className={`mt-3 grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <button
          onClick={() => void handleSwitch('frontend')}
          className={`inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold transition-all ${
            runtimeMode === 'frontend'
              ? 'bg-[#2F6A54] text-white shadow-sm'
              : 'bg-[#F4EDE4] text-[#6B5A4A] hover:bg-[#ECE1D5]'
          }`}
        >
          <Monitor className="h-3.5 w-3.5" />
          {copy.common.frontendMode}
        </button>
        {CAN_USE_ADVANCED_RUNTIME ? (
          <button
            onClick={() => void handleSwitch('advanced')}
            className={`inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold transition-all ${
              runtimeMode === 'advanced'
                ? 'bg-[#D07A4F] text-white shadow-sm'
                : 'bg-[#F4EDE4] text-[#6B5A4A] hover:bg-[#ECE1D5]'
            }`}
          >
            <Server className="h-3.5 w-3.5" />
            {copy.common.advancedMode}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HelpCard({ onClose }: { onClose?: () => void }) {
  const { copy } = useI18n();

  return (
    <div className="rounded-[28px] border border-white/60 bg-white/88 p-5 shadow-[0_16px_44px_rgba(60,44,28,0.18)] backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#A08972]">
            {copy.toolbar.helpTitle}
          </p>
          <h4
            className="mt-1 text-sm font-bold text-[#3A2A1A]"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {copy.toolbar.helpDescription}
          </h4>
        </div>
        {onClose ? (
          <button
            onClick={onClose}
            className="rounded-xl p-2 transition-colors hover:bg-[#F0E8E0]"
            title={copy.common.close}
          >
            <X className="h-4 w-4 text-[#8B7355]" />
          </button>
        ) : null}
      </div>

      <div className="space-y-3 text-xs leading-relaxed text-[#5A4A3A]">
        {copy.toolbar.quickTips.map(tip => (
          <div key={tip} className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#D07A4F]" />
            <span>{tip}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Toolbar() {
  const {
    toggleConfig,
    toggleChat,
    togglePdf,
    isConfigOpen,
    isChatOpen,
    isPdfOpen,
    selectedPet,
    locale,
    toggleLocale,
  } = useAppStore();
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const { isWorkflowPanelOpen, toggleWorkflowPanel } = useWorkflowStore();
  const { copy } = useI18n();
  const { isMobile, isTablet } = useViewportTier();

  const [showHelp, setShowHelp] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const showGitHubBadge = IS_GITHUB_PAGES;

  const dockButtons: Array<{
    id: DockButtonId;
    icon: typeof Settings;
    accent: string;
    active: boolean;
    onClick: () => void;
  }> = [
    {
      id: 'paper',
      icon: BookOpen,
      accent: '#9A6F46',
      active: isPdfOpen,
      onClick: () => togglePdf(),
    },
    {
      id: 'config',
      icon: Settings,
      accent: '#2F6A54',
      active: isConfigOpen,
      onClick: () => toggleConfig(),
    },
    {
      id: 'workflow',
      icon: Brain,
      accent: '#D07A4F',
      active: isWorkflowPanelOpen,
      onClick: () => toggleWorkflowPanel(),
    },
    {
      id: 'chat',
      icon: MessageCircle,
      accent: '#A86B4E',
      active: isChatOpen,
      onClick: () => toggleChat(),
    },
    {
      id: 'help',
      icon: HelpCircle,
      accent: '#75604D',
      active: showHelp,
      onClick: () => setShowHelp(prev => !prev),
    },
  ];

  const localeLabel = locale === 'zh-CN' ? copy.common.englishShort : copy.common.chineseShort;
  const focusLabel = selectedPet
    ? getAgentToolbarLabel(selectedPet, locale)
    : copy.toolbar.focusFallback;

  const handleButtonClick = (id: DockButtonId) => {
    const target = dockButtons.find(button => button.id === id);
    target?.onClick();
    if (isMobile) setShowMobileMenu(false);
  };

  if (isMobile) {
    return (
      <>
        <div
          className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+12px)] z-[80] rounded-[26px] border border-white/60 bg-white/84 px-3 py-3 shadow-[0_12px_30px_rgba(60,44,28,0.14)] backdrop-blur-2xl"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#A08972]">
                {copy.app.subtitle}
              </p>
              <h2
                className="truncate text-sm font-bold text-[#3A2A1A]"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                {copy.app.name}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleLocale}
                className="inline-flex h-10 min-w-10 items-center justify-center rounded-2xl bg-[#F4EDE4] px-3 text-xs font-semibold text-[#5A4A3A] transition-colors hover:bg-[#ECE1D5]"
                title={copy.app.localeSwitch}
              >
                <Globe2 className="mr-1 h-3.5 w-3.5" />
                {localeLabel}
              </button>
              <button
                onClick={() => setShowMobileMenu(prev => !prev)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2F6A54] text-white shadow-sm"
                title={copy.toolbar.mobileMenuTitle}
              >
                {showMobileMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-[#F7F1EA] px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#5A4A3A]">
              {CAN_USE_ADVANCED_RUNTIME && !isWorkflowPanelOpen ? (
                <Workflow className="h-3.5 w-3.5 text-[#D07A4F]" />
              ) : (
                <Monitor className="h-3.5 w-3.5 text-[#2F6A54]" />
              )}
              <span>
                {CAN_USE_ADVANCED_RUNTIME
                  ? copy.toolbar.runtimeLabels[runtimeMode === 'advanced' ? 'advanced' : 'frontend']
                  : copy.toolbar.runtimeLabels.frontend}
              </span>
            </div>
            <span className="max-w-[55%] truncate text-[11px] text-[#8B7355]">{focusLabel}</span>
          </div>
        </div>

        {showGitHubBadge && !showMobileMenu ? (
          <div
            className="fixed right-3 top-[calc(env(safe-area-inset-top)+88px)] z-[81] max-w-[calc(100vw-1.5rem)]"
            style={{ pointerEvents: 'auto' }}
          >
            <GitHubRepoBadge />
          </div>
        ) : null}

        {showMobileMenu && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[74] bg-[rgba(48,37,28,0.18)] backdrop-blur-[2px]"
              onClick={() => setShowMobileMenu(false)}
              aria-label={copy.common.close}
            />
            <div
              className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+88px)] z-[82] max-h-[calc(100svh-120px)] overflow-y-auto rounded-[30px] border border-white/60 bg-white/92 p-4 shadow-[0_18px_44px_rgba(60,44,28,0.18)] backdrop-blur-2xl animate-in fade-in slide-in-from-top-4 duration-300"
              style={{ pointerEvents: 'auto' }}
            >
              <div className="mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#A08972]">
                  {copy.toolbar.actionsTitle}
                </p>
                <h3
                  className="mt-1 text-base font-bold text-[#3A2A1A]"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {copy.toolbar.mobileMenuTitle}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[#6B5A4A]">
                  {copy.toolbar.mobileMenuDescription}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {dockButtons.map(button => {
                  const Icon = button.icon;
                  const labels = copy.toolbar.dockButtons[button.id];

                  return (
                    <button
                      key={button.id}
                      onClick={() => handleButtonClick(button.id)}
                      className={`flex items-center gap-3 rounded-[22px] px-4 py-3 text-left transition-all ${
                        button.active ? 'text-white shadow-md' : 'bg-[#F8F3EC] text-[#5A4A3A]'
                      }`}
                      style={{
                        background: button.active
                          ? `linear-gradient(135deg, ${button.accent}, ${button.accent}CC)`
                          : undefined,
                      }}
                    >
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                        style={{
                          background: button.active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.75)',
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{labels.label}</div>
                        <div
                          className="text-[10px] uppercase tracking-[0.16em]"
                          style={{ color: button.active ? 'rgba(255,255,255,0.78)' : '#A08972' }}
                        >
                          {labels.sublabel}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4">
                <RuntimeCard compact onAfterAction={() => setShowMobileMenu(false)} />
              </div>

              <div className="mt-4">
                <HelpCard onClose={() => setShowMobileMenu(false)} />
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div
        className={`fixed z-[60] ${isTablet ? 'left-5 top-5 w-[360px]' : 'left-1/2 top-6 w-[min(46vw,540px)] -translate-x-1/2'}`}
        style={{ pointerEvents: 'auto' }}
      >
        <RuntimeCard compact={isTablet} />
      </div>

      <div
        className={`fixed z-[60] ${isTablet ? 'right-5 top-5 w-[280px]' : 'right-6 top-6 w-[320px]'}`}
        style={{ pointerEvents: 'auto' }}
      >
        {showGitHubBadge ? (
          <div className="mb-3">
            <GitHubRepoBadge />
          </div>
        ) : null}

        <div className="rounded-[28px] border border-white/60 bg-white/84 p-4 shadow-[0_16px_44px_rgba(60,44,28,0.14)] backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#A08972]">
                {copy.common.languageLabel}
              </p>
              <p className="mt-1 text-sm font-semibold text-[#3A2A1A]">{focusLabel}</p>
            </div>
            <button
              onClick={toggleLocale}
              className="inline-flex h-11 min-w-11 items-center justify-center rounded-2xl bg-[#F4EDE4] px-3 text-xs font-semibold text-[#5A4A3A] transition-colors hover:bg-[#ECE1D5]"
              title={copy.app.localeSwitch}
            >
              <Globe2 className="mr-1 h-3.5 w-3.5" />
              {localeLabel}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#6B5A4A]">{copy.app.localeDescription}</p>
        </div>

        {showHelp && (
          <div className="mt-3">
            <HelpCard onClose={() => setShowHelp(false)} />
          </div>
        )}
      </div>

      <div
        className={`fixed left-1/2 z-[60] -translate-x-1/2 ${isTablet ? 'bottom-5' : 'bottom-6'}`}
        style={{ pointerEvents: 'auto' }}
      >
        <div className="rounded-[32px] border border-white/60 bg-white/78 px-3 py-2.5 shadow-[0_14px_40px_rgba(60,44,28,0.14)] backdrop-blur-2xl">
          <div className={`grid gap-2 ${isTablet ? 'grid-cols-5' : 'grid-cols-5'}`}>
            {dockButtons.map(button => {
              const Icon = button.icon;
              const labels = copy.toolbar.dockButtons[button.id];

              return (
                <button
                  key={button.id}
                  onClick={() => button.onClick()}
                  className={`group flex ${isTablet ? 'min-w-[102px]' : 'min-w-[138px]'} items-center gap-3 rounded-[22px] px-4 py-2.5 text-left transition-all duration-300 ${
                    button.active
                      ? '-translate-y-1 shadow-[0_12px_24px_rgba(80,56,36,0.14)]'
                      : 'hover:-translate-y-1 hover:bg-white/70'
                  }`}
                  style={{
                    background: button.active
                      ? `linear-gradient(135deg, ${button.accent}, ${button.accent}CC)`
                      : 'rgba(255,255,255,0.28)',
                    color: button.active ? '#FFFFFF' : '#5A4A3A',
                  }}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl shadow-sm"
                    style={{
                      background: button.active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.74)',
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{labels.label}</div>
                    <div
                      className="text-[10px] uppercase tracking-[0.16em]"
                      style={{ color: button.active ? 'rgba(255,255,255,0.78)' : '#A08972' }}
                    >
                      {labels.sublabel}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
