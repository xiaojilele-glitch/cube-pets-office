import type { AppLocale } from "@/lib/locale";
import type { LineageNodeType } from "@shared/lineage/contracts.js";

export interface LineageTypeMeta {
  color: string;
  softColor: string;
  borderColor: string;
  label: string;
  shortLabel: string;
}

interface LineageTypePalette {
  color: string;
  softColor: string;
  borderColor: string;
}

function t(locale: AppLocale, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export const LINEAGE_TYPE_META: Record<LineageNodeType, LineageTypePalette> = {
  source: {
    color: "#5B89A5",
    softColor: "rgba(91, 137, 165, 0.18)",
    borderColor: "rgba(91, 137, 165, 0.32)",
  },
  transformation: {
    color: "#5E8B72",
    softColor: "rgba(94, 139, 114, 0.18)",
    borderColor: "rgba(94, 139, 114, 0.32)",
  },
  decision: {
    color: "#C98257",
    softColor: "rgba(201, 130, 87, 0.18)",
    borderColor: "rgba(201, 130, 87, 0.32)",
  },
};

export const LINEAGE_NEUTRAL = {
  empty: "#A08972",
  text: "#4A3727",
  textMuted: "#7D6856",
  textSubtle: "#A08972",
  border: "rgba(174, 146, 120, 0.22)",
  borderStrong: "rgba(151, 120, 90, 0.32)",
  panel: "rgba(255, 255, 255, 0.64)",
  panelStrong: "rgba(255, 250, 244, 0.92)",
  canvasLaneEven: "#faf4ec",
  canvasLaneOdd: "#fffaf5",
  canvasGrid: "#eadccd",
  canvasEdge: "#b09a86",
  canvasEdgeMuted: "#e8ddd2",
};

export function getLineageTypeMeta(
  type: LineageNodeType | string,
  locale: AppLocale = "en-US"
): LineageTypeMeta {
  const base = LINEAGE_TYPE_META[type as LineageNodeType] ?? {
    color: LINEAGE_NEUTRAL.textMuted,
    softColor: "rgba(125, 104, 86, 0.16)",
    borderColor: LINEAGE_NEUTRAL.border,
  };

  if (type === "source") {
    return {
      ...base,
      label: t(locale, "来源", "Source"),
      shortLabel: t(locale, "源", "SRC"),
    };
  }

  if (type === "transformation") {
    return {
      ...base,
      label: t(locale, "转换", "Transformation"),
      shortLabel: t(locale, "转", "TFM"),
    };
  }

  if (type === "decision") {
    return {
      ...base,
      label: t(locale, "决策", "Decision"),
      shortLabel: t(locale, "决", "DEC"),
    };
  }

  return {
    ...base,
    label: t(locale, "节点", "Node"),
    shortLabel: t(locale, "点", "NOD"),
  };
}
