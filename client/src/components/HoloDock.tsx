import { useState, useCallback, useRef } from 'react';
import {
  Brain,
  Globe2,
  HelpCircle,
  Menu,
  MessageCircle,
  Settings,
  Shield,
  Terminal,
  X,
} from 'lucide-react';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { useLocation } from 'wouter';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { PermissionPanel } from '@/components/permissions/PermissionPanel';
import { useViewportTier } from '@/hooks/useViewportTier';
import { useI18n } from '@/i18n';
import { useAppStore } from '@/lib/store';
import { useWorkflowStore } from '@/lib/workflow-store';

type DockButtonId = 'config' | 'workflow' | 'chat' | 'help' | 'commandCenter' | 'permissions';

interface DockItem {
  id: DockButtonId;
  icon: typeof Settings;
  active: boolean;
  onClick: () => void;
}

/* ── Fisheye Dock Icon ── */

function DockIcon({
  item,
  mouseX,
  isMobileView,
}: {
  item: DockItem;
  mouseX: MotionValue<number>;
  index?: number;
  isMobileView: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copy } = useI18n();
  const labels = copy.toolbar.dockButtons[item.id];
  const Icon = item.icon;

  // Distance from mouse to this icon center
  const distance = useTransform(mouseX, (val: number) => {
    if (!ref.current || val < 0) return 150; // far away when mouse not over dock
    const rect = ref.current.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    return Math.abs(val - center);
  });

  // Hovered icon: scale 1.0 → 1.3, adjacent: 1.0 → 1.1 (fisheye)
  const scaleRaw = useTransform(distance, [0, 50, 100], [1.3, 1.1, 1.0]);
  const scale = useSpring(scaleRaw, { stiffness: 400, damping: 17 });

  // On mobile, skip fisheye — just use static size
  const mobileScale = item.active ? 1.05 : 1.0;

  return (
    <motion.button
      ref={ref}
      onClick={item.onClick}
      style={isMobileView ? undefined : { scale }}
      className="group relative flex flex-col items-center outline-none"
      whileTap={{ scale: 0.95 }}
      aria-label={labels.label}
    >
      {/* Icon circle */}
      <div
        className={`flex items-center justify-center rounded-2xl transition-colors duration-150 ${
          isMobileView ? 'h-10 w-10' : 'h-11 w-11 sm:h-12 sm:w-12'
        } ${
          item.active
            ? 'bg-white/30 text-white shadow-[0_0_12px_var(--glow-cyan)]'
            : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
        }`}
        style={isMobileView ? { transform: `scale(${mobileScale})` } : undefined}
      >
        <Icon className={isMobileView ? 'h-4 w-4' : 'h-5 w-5'} />
      </div>

      {/* Active glow indicator dot (AC-2.5) */}
      {item.active && (
        <span
          className="absolute -bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
          style={{
            background: 'var(--status-working)',
            boxShadow: '0 0 6px var(--glow-cyan), 0 0 12px var(--glow-cyan)',
          }}
        />
      )}
    </motion.button>
  );
}

/* ── Language Toggle Button ── */

function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { copy, toggleLocale } = useI18n();
  const locale = useAppStore(state => state.locale);
  return (
    <button
      onClick={toggleLocale}
      className={`flex items-center justify-center rounded-2xl bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white ${
        compact ? 'h-10 w-10' : 'h-11 w-11 sm:h-12 sm:w-12'
      }`}
      title={copy.app.localeSwitch}
    >
      <Globe2 className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
    </button>
  );
}

/* ── Mobile Dock (hamburger menu) ── */

function MobileDock({
  dockItems,
  onToggleLocale,
}: {
  dockItems: DockItem[];
  onToggleLocale: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const localeLabel = locale === 'zh-CN' ? copy.common.englishShort : copy.common.chineseShort;

  const handleClick = useCallback(
    (item: DockItem) => {
      item.onClick();
      setOpen(false);
    },
    []
  );

  return (
    <>
      {/* Floating mobile dock bar */}
      <div
        className="glass-panel-strong fixed inset-x-4 bottom-4 z-[60] flex items-center justify-between rounded-full px-3 py-2"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="flex items-center gap-1">
          {dockItems.slice(0, 3).map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => handleClick(item)}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                  item.active
                    ? 'bg-white/25 text-white shadow-[0_0_8px_var(--glow-cyan)]'
                    : 'text-white/70 hover:bg-white/15 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onToggleLocale}
            className="flex h-9 items-center gap-1 rounded-xl bg-white/10 px-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white/20 hover:text-white"
          >
            <Globe2 className="h-3.5 w-3.5" />
            {localeLabel}
          </button>
          <button
            onClick={() => setOpen(prev => !prev)}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-white"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expanded menu overlay */}
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[59] bg-black/20 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-label={copy.common.close}
          />
          <div
            className="glass-panel-strong fixed inset-x-4 bottom-20 z-[61] rounded-3xl p-4"
            style={{ pointerEvents: 'auto' }}
          >
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/50">
              {copy.toolbar.actionsTitle}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {dockItems.map(item => {
                const Icon = item.icon;
                const labels = copy.toolbar.dockButtons[item.id];
                return (
                  <button
                    key={item.id}
                    onClick={() => handleClick(item)}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center transition-colors ${
                      item.active
                        ? 'bg-white/20 text-white shadow-[0_0_10px_var(--glow-cyan)]'
                        : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-[10px] font-semibold leading-tight">{labels.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ── Main HoloDock Component ── */

export function HoloDock() {
  const {
    toggleConfig,
    toggleChat,
    isConfigOpen,
    isChatOpen,
    locale,
    toggleLocale,
  } = useAppStore();
  const { isWorkflowPanelOpen, toggleWorkflowPanel } = useWorkflowStore();
  const { copy } = useI18n();
  const { isMobile } = useViewportTier();
  const [location, setLocation] = useLocation();

  const [showHelp, setShowHelp] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);

  // Mouse X position for fisheye effect
  const mouseX = useMotionValue(-1);

  const dockItems: DockItem[] = [
    {
      id: 'config',
      icon: Settings,
      active: isConfigOpen,
      onClick: () => toggleConfig(),
    },
    {
      id: 'workflow',
      icon: Brain,
      active: isWorkflowPanelOpen,
      onClick: () => toggleWorkflowPanel(),
    },
    {
      id: 'chat',
      icon: MessageCircle,
      active: isChatOpen,
      onClick: () => toggleChat(),
    },
    {
      id: 'commandCenter',
      icon: Terminal,
      active: location === '/command-center',
      onClick: () => setLocation('/command-center'),
    },
    {
      id: 'permissions',
      icon: Shield,
      active: showPermissions,
      onClick: () => setShowPermissions(prev => !prev),
    },
    {
      id: 'help',
      icon: HelpCircle,
      active: showHelp,
      onClick: () => setShowHelp(prev => !prev),
    },
  ];

  /* ── Mobile layout ── */
  if (isMobile) {
    return (
      <>
        <MobileDock dockItems={dockItems} onToggleLocale={toggleLocale} />

        {/* Permission dialog */}
        <Dialog open={showPermissions} onOpenChange={setShowPermissions}>
          <DialogContent className="glass-panel-strong max-h-[80vh] max-w-[95vw] overflow-hidden rounded-3xl border-white/20 p-0 text-white">
            <DialogHeader className="border-b border-white/10 px-4 py-3">
              <DialogTitle className="flex items-center gap-2 text-sm text-white">
                <Shield className="size-4 text-cyan-400" />
                {locale === 'zh-CN' ? 'Agent 权限管理' : 'Agent Permissions'}
              </DialogTitle>
              <DialogDescription className="text-xs text-white/50">
                {locale === 'zh-CN'
                  ? '管理 Agent 权限角色、查看权限矩阵和审计日志'
                  : 'Manage agent permission roles, view permission matrix and audit logs'}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto">
              <PermissionPanel />
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  /* ── Desktop / Tablet layout ── */
  return (
    <>
      {/* Help tooltip — floats above dock */}
      {showHelp && (
        <div
          className="glass-panel fixed bottom-24 right-6 z-[61] w-[300px] rounded-2xl p-4"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-white/80">{copy.toolbar.helpTitle}</p>
            <button
              onClick={() => setShowHelp(false)}
              className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2">
            {copy.toolbar.quickTips.map(tip => (
              <p key={tip} className="text-[11px] leading-relaxed text-white/60">
                {tip}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* ── Capsule Dock (AC-2.1, AC-2.2, AC-2.6) ── */}
      <motion.div
        className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2"
        style={{ pointerEvents: 'auto' }}
        onMouseMove={e => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(-1)}
      >
        <div className="glass-panel-strong flex items-center gap-1 rounded-full px-4 py-2.5 sm:gap-2 sm:px-5">
          {/* Navigation icons with fisheye */}
          {dockItems.map(item => (
            <DockIcon
              key={item.id}
              item={item}
              mouseX={mouseX}
              isMobileView={false}
            />
          ))}

          {/* Separator */}
          <div className="mx-1 h-6 w-px bg-white/15 sm:mx-2" />

          {/* Language toggle (AC-2.6) */}
          <LanguageToggle />
        </div>
      </motion.div>

      {/* Permission dialog */}
      <Dialog open={showPermissions} onOpenChange={setShowPermissions}>
        <DialogContent className="h-[600px] max-w-4xl rounded-[28px] border-white/20 bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]">
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
    </>
  );
}
