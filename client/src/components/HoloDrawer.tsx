import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { X } from 'lucide-react';

/** Height reserved for the bottom HoloDock (icon + padding + glow dot). */
const DOCK_BOTTOM_RESERVE = 80;
/** Top spacing so the drawer doesn't touch the very top edge. */
const TOP_SPACING = 12;

export interface HoloDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Drawer width in px. Clamped to max 420. Default 400. */
  width?: number;
  children?: ReactNode;
}

/* ── Animation variants ── */

const drawerVariants: Variants = {
  hidden: { x: '100%', opacity: 1 },
  visible: {
    x: 0,
    opacity: 1,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 25,
    },
  },
  exit: {
    x: '100%',
    opacity: 0,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1] as const, // ease-out cubic-bezier
    },
  },
};

/**
 * HoloDrawer — full-height side drawer sliding in from the right.
 *
 * - framer-motion AnimatePresence for enter/exit
 * - glass-panel background (holographic glassmorphism)
 * - Leaves bottom space for HoloDock capsule bar
 * - Closes on ESC key or click outside
 * - No background overlay — 3D scene stays visible
 *
 * @see AC-3.1 through AC-3.5
 */
export function HoloDrawer({ open, onClose, title, width = 400, children }: HoloDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const clampedWidth = Math.min(width, 420);

  // ── ESC key close (AC-3.5) ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  // ── Click-outside close (AC-3.5) ──
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    // Delay one frame so the opening click doesn't immediately close.
    const raf = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handlePointerDown);
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          className="glass-panel fixed right-0 z-[55] flex flex-col overflow-hidden rounded-l-2xl"
          style={{
            top: TOP_SPACING,
            width: clampedWidth,
            height: `calc(100vh - ${DOCK_BOTTOM_RESERVE}px - ${TOP_SPACING}px)`,
          }}
          variants={drawerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {/* ── Title bar + close button (AC-3.4) ── */}
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3">
            <h2
              className="truncate text-sm font-semibold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Scrollable content body ── */}
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
