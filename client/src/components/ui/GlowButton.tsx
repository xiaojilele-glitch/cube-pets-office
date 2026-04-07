import * as React from "react";
import { cn } from "@/lib/utils";

export type GlowButtonVariant = "primary" | "danger" | "ghost";

export interface GlowButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: GlowButtonVariant;
}

/**
 * Variant-specific gradient + glow styles.
 *
 * - primary: cyan → blue gradient, cyan glow
 * - danger:  red → orange gradient, red glow
 * - ghost:   transparent bg, white border, subtle white glow
 */
const variantStyles: Record<
  GlowButtonVariant,
  { base: string; glow: string }
> = {
  primary: {
    base: "bg-gradient-to-r from-[#5E8B72] to-[#87AFC7]",
    glow: "hover:shadow-[0_0_20px_rgba(94,139,114,0.35)]",
  },
  danger: {
    base: "bg-gradient-to-r from-red-500 to-orange-500",
    glow: "hover:shadow-[0_0_20px_rgba(239,68,68,0.5)]",
  },
  ghost: {
    base: "bg-transparent border border-white/60",
    glow: "hover:shadow-[0_0_20px_rgba(255,255,255,0.2)]",
  },
};

/**
 * GlowButton — holographic CTA button with gradient background,
 * hover glow, click ripple, and disabled desaturation.
 *
 * @see AC-4.1 through AC-4.5
 */
const GlowButton = React.forwardRef<HTMLButtonElement, GlowButtonProps>(
  ({ variant = "primary", className, disabled, children, onClick, ...props }, ref) => {
    const [ripples, setRipples] = React.useState<
      { id: number; x: number; y: number }[]
    >([]);

    const nextId = React.useRef(0);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;

      // Calculate ripple origin relative to button
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = nextId.current++;

      setRipples((prev) => [...prev, { id, x, y }]);

      // Clean up ripple after animation completes (600ms)
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 600);

      onClick?.(e);
    };

    const v = variantStyles[variant];

    return (
      <button
        ref={ref}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          // Base layout
          "relative inline-flex items-center justify-center overflow-hidden",
          "rounded-lg px-5 py-2.5 text-sm font-semibold text-white",
          // Transition for glow (200ms ease-in-out per design spec)
          "transition-shadow duration-200 ease-in-out",
          // Variant gradient
          v.base,
          // Hover glow (disabled state removes it via group below)
          !disabled && v.glow,
          // Disabled: desaturate + no pointer events
          disabled && "saturate-[0.35] opacity-60 cursor-not-allowed shadow-none",
          // Focus ring
          "outline-none focus-visible:ring-2 focus-visible:ring-[#5E8B72]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
          className,
        )}
        {...props}
      >
        {/* Ripple layer */}
        {ripples.map((ripple) => (
          <span
            key={ripple.id}
            className="pointer-events-none absolute rounded-full bg-white/30"
            style={{
              left: ripple.x,
              top: ripple.y,
              width: 10,
              height: 10,
              marginLeft: -5,
              marginTop: -5,
              animation: "ripple 600ms ease-out forwards",
            }}
          />
        ))}
        {/* Content */}
        <span className="relative z-10">{children}</span>
      </button>
    );
  },
);

GlowButton.displayName = "GlowButton";

export { GlowButton };
