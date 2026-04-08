import { useState } from 'react';
import {
  Brain,
  FileSearch,
  Globe2,
  HelpCircle,
  Menu,
  MessageCircle,
  Monitor,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';
import { useLocation } from 'wouter';

import { GitHubRepoBadge } from '@/components/GitHubRepoBadge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { AuditPanel } from '@/components/AuditPanel';
import { PermissionPanel } from '@/components/permissions/PermissionPanel';
import { useViewportTier } from '@/hooks/useViewportTier';
import { useI18n } from '@/i18n';
import { getAgentToolbarLabel } from '@/lib/agent-config';
import { CAN_USE_ADVANCED_RUNTIME, IS_GITHUB_PAGES } from '@/lib/deploy-target';
import { useAppStore } from '@/lib/store';
import { useWorkflowStore } from '@/lib/workflow-store';

type DockButtonId = 'config' | 'workflow' | 'chat' | 'help' | 'commandCenter' | 'permissions' | 'audit';

function getRuntimeNarrative(
  locale: string,
  runtimeMode: 'frontend' | 'advanced',
  canUseAdvanced: boolean
) {
  if (locale === 'zh-CN') {
    return {
      title: '组织运行模式',
      heading: runtimeMode === 'frontend' ? '前端预演模式' : '动态执行模式',
      body: canUseAdvanced
        ? runtimeMode === 'frontend'
          ? '当前先在浏览器里预演动态组队流程：你可以看组织生成、角色分布和界面联动，但不会真正向服务端发起完整执行。'
          : '当前会把用户问题交给服务端，让系统先分析需要哪些角色，再动态创建组织、装配 skills 与 MCP，并推进真实工作流。'
        : '当前部署仅保留浏览器内的动态组队预演：可以体验组织生成后的展示和流程，但不会连接服务端执行。',
    };
  }

  return {
    title: 'Organization Mode',
    heading: runtimeMode === 'frontend' ? 'Preview Teaming Mode' : 'Dynamic Execution Mode',
    body: canUseAdvanced
      ? runtimeMode === 'frontend'
        ? 'The browser currently previews the dynamic teaming flow: you can inspect org generation, role placement, and UI reactions without running the full server workflow.'
        : 'The server now analyzes the user ask, creates the needed organization, attaches skills and MCP tools, and runs the real workflow.'
      : 'This deployment keeps only the browser-side dynamic teaming preview: you can inspect the generated org and flow, but it does not connect to the server runtime.',
  };
}

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
  const locale = useAppStore(state => state.locale);
  const narrative = getRuntimeNarrative(locale, runtimeMode, CAN_USE_ADVANCED_RUNTIME);

  const handleSwitch = async (mode: 'frontend' | 'advanced') => {
    await setRuntimeMode(mode);
    onAfterAction?.();
  };

  return (
    <div className="rounded-[22px] studio-surface-strong p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#A08972]">
            {narrative.title}
          </p>
          <h4 className="text-[13px] font-bold text-[#3A2A1A]">
            {narrative.heading}
          </h4>
        </div>
      </div>

      <div className={`mt-2 grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <button
          onClick={() => void handleSwitch('frontend')}
          className={`inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold transition-all ${
            runtimeMode === 'frontend'
              ? 'bg-[#5E8B72] text-white shadow-sm'
              : 'studio-surface text-[#6B5A4A] hover:bg-white/65'
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
                ? 'bg-[#C98257] text-white shadow-sm'
                : 'studio-surface text-[#6B5A4A] hover:bg-white/65'
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
    <div className="rounded-[28px] studio-shell p-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
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
            className="rounded-xl p-2 transition-colors hover:bg-white/45"
            title={copy.common.close}
          >
            <X className="h-4 w-4 text-[#8B7355]" />
          </button>
        ) : null}
      </div>

      <div className="space-y-3 text-xs leading-relaxed text-[#5A4A3A]">
        {copy.toolbar.quickTips.map(tip => (
          <div key={tip} className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#C98257]" />
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
    isConfigOpen,
    isChatOpen,
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
  const [showPermissions, setShowPermissions] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const showGitHubBadge = IS_GITHUB_PAGES;
  const [location, setLocation] = useLocation();

  const dockButtons: Array<{
    id: DockButtonId;
    icon: typeof Settings;
    accent: string;
    active: boolean;
    onClick: () => void;
  }> = [
    {
      id: 'config',
      icon: Settings,
      accent: '#5E8B72',
      active: isConfigOpen,
      onClick: () => toggleConfig(),
    },
    {
      id: 'workflow',
      icon: Brain,
      accent: '#C98257',
      active: isWorkflowPanelOpen,
      onClick: () => toggleWorkflowPanel(),
    },
    {
      id: 'chat',
      icon: MessageCircle,
      accent: '#B77B63',
      active: isChatOpen,
      onClick: () => toggleChat(),
    },
    {
      id: 'commandCenter',
      icon: Terminal,
      accent: '#8B735E',
      active: location === '/command-center',
      onClick: () => setLocation('/command-center'),
    },
    {
      id: 'permissions',
      icon: Shield,
      accent: '#836A88',
      active: showPermissions,
      onClick: () => setShowPermissions(prev => !prev),
    },
    {
      id: 'audit',
      icon: FileSearch,
      accent: '#6B8E7B',
      active: showAudit,
      onClick: () => setShowAudit(prev => !prev),
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
          className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+12px)] z-[80] rounded-[26px] studio-shell px-3 py-3"
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
                className="inline-flex h-10 min-w-10 items-center justify-center rounded-2xl studio-surface px-3 text-xs font-semibold text-[#5A4A3A] transition-colors hover:bg-white/65"
                title={copy.app.localeSwitch}
              >
                <Globe2 className="mr-1 h-3.5 w-3.5" />
                {localeLabel}
              </button>
              <button
                onClick={() => setShowMobileMenu(prev => !prev)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#5E8B72] text-white shadow-sm"
                title={copy.toolbar.mobileMenuTitle}
              >
                {showMobileMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl studio-surface px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#5A4A3A]">
              {CAN_USE_ADVANCED_RUNTIME && !isWorkflowPanelOpen ? (
                <Workflow className="h-3.5 w-3.5 text-[#C98257]" />
              ) : (
                <Monitor className="h-3.5 w-3.5 text-[#5E8B72]" />
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
              className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+88px)] z-[82] max-h-[calc(100svh-120px)] overflow-y-auto rounded-[30px] studio-shell p-4 animate-in fade-in slide-in-from-top-4 duration-300"
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
                        button.active ? 'text-white shadow-md' : 'studio-surface text-[#5A4A3A]'
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
      {/* Help card — floats above dock when open */}
      {showHelp && (
        <div
          className="fixed right-6 bottom-24 z-[61] w-[320px]"
          style={{ pointerEvents: 'auto' }}
        >
          <HelpCard onClose={() => setShowHelp(false)} />
        </div>
      )}

      <div
        className={`fixed left-1/2 z-[60] -translate-x-1/2 ${isTablet ? 'bottom-5' : 'bottom-6'}`}
        style={{ pointerEvents: 'auto' }}
      >
        <div className="rounded-[32px] studio-shell px-3 py-2.5">
          <div className={`grid gap-2 ${isTablet ? 'grid-cols-7' : 'grid-cols-7'}`}>
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
                      : 'hover:-translate-y-1 hover:bg-white/62'
                  }`}
                  style={{
                    background: button.active
                      ? `linear-gradient(135deg, ${button.accent}, ${button.accent}CC)`
                      : 'rgba(255,255,255,0.36)',
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

      {/* Permission management dialog */}
      <Dialog open={showPermissions} onOpenChange={setShowPermissions}>
        <DialogContent className="max-w-4xl h-[600px] rounded-[28px] border-stone-200 bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]">
          <DialogHeader className="border-b border-stone-200/80 px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-stone-900">
              <Shield className="size-4 text-[#7C3AED]" />
              {locale === 'zh-CN' ? 'Agent 权限管理' : 'Agent Permissions'}
            </DialogTitle>
            <DialogDescription className="text-sm text-stone-500">
              {locale === 'zh-CN'
                ? '管理 Agent 权限角色、查看权限矩阵和审计日志'
                : 'Manage agent permission roles, view permission matrix and audit logs'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden" style={{ height: 'calc(600px - 80px)' }}>
            <PermissionPanel />
          </div>
        </DialogContent>
      </Dialog>

      {/* Audit chain dialog */}
      <Dialog open={showAudit} onOpenChange={setShowAudit}>
        <DialogContent className="max-w-4xl h-[600px] rounded-[28px] border-stone-200 bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]">
          <DialogHeader className="border-b border-stone-200/80 px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-stone-900">
              <FileSearch className="size-4 text-[#6B8E7B]" />
              {locale === 'zh-CN' ? '审计链日志' : 'Audit Chain Log'}
            </DialogTitle>
            <DialogDescription className="text-sm text-stone-500">
              {locale === 'zh-CN'
                ? '查看审计事件、验证哈希链完整性、管理异常告警'
                : 'View audit events, verify hash chain integrity, manage anomaly alerts'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden" style={{ height: 'calc(600px - 80px)' }}>
            <AuditPanel />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
