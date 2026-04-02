/**
 * ReputationBadge — displays S/A/B/C/D grade badge and trust tier label.
 * @see Requirement 9.1
 */

import type { ReputationGrade, TrustTier } from "@shared/reputation";

const GRADE_COLORS: Record<ReputationGrade, string> = {
  S: "bg-yellow-500 text-black",
  A: "bg-purple-500 text-white",
  B: "bg-blue-500 text-white",
  C: "bg-orange-500 text-white",
  D: "bg-red-600 text-white",
};

const TIER_LABELS: Record<TrustTier, { text: string; className: string }> = {
  trusted: { text: "Trusted", className: "text-green-400" },
  standard: { text: "Standard", className: "text-gray-400" },
  probation: { text: "Probation", className: "text-red-400" },
};

interface ReputationBadgeProps {
  grade: ReputationGrade;
  trustTier: TrustTier;
  showTier?: boolean;
  size?: "sm" | "md";
}

export function ReputationBadge({
  grade,
  trustTier,
  showTier = true,
  size = "sm",
}: ReputationBadgeProps) {
  const sizeClass = size === "md" ? "w-7 h-7 text-sm" : "w-5 h-5 text-xs";
  const tier = TIER_LABELS[trustTier];

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`${GRADE_COLORS[grade]} ${sizeClass} inline-flex items-center justify-center rounded font-bold`}
        title={`Grade ${grade}`}
      >
        {grade}
      </span>
      {showTier && (
        <span className={`text-xs ${tier.className}`}>{tier.text}</span>
      )}
    </span>
  );
}
