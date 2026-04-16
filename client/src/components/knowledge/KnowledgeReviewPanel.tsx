/**
 * 知识审核面板
 *
 * 显示待审核实体列表，每条显示名称、类型（带颜色点）、置信度、来源、描述摘要。
 * 支持 approve / reject 操作。
 *
 * Requirements: 9.5
 */

import type { Entity, ReviewAction } from "@shared/knowledge/types";
import { getEntityColor } from "./KnowledgeGraphPanel";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KnowledgeReviewPanelProps {
  items: Entity[];
  onReview: (entityId: string, action: ReviewAction) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceLabel(c: number): string {
  if (c >= 0.8) return "High";
  if (c >= 0.5) return "Medium";
  return "Low";
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return "text-green-600";
  if (c >= 0.5) return "text-yellow-600";
  return "text-red-500";
}

function truncate(text: string, max = 120): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KnowledgeReviewPanel({
  items,
  onReview,
  className = "",
}: KnowledgeReviewPanelProps) {
  if (items.length === 0) {
    return (
      <div className={`p-4 text-sm text-gray-500 ${className}`}>
        No items pending review.
      </div>
    );
  }

  return (
    <div
      className={`overflow-y-auto ${className}`}
      role="list"
      aria-label="Review queue"
    >
      {items.map(entity => (
        <div
          key={entity.entityId}
          role="listitem"
          className="flex items-start gap-3 border-b border-gray-200 p-3 last:border-b-0"
        >
          {/* Color dot */}
          <span
            className="mt-1 h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: getEntityColor(entity.entityType) }}
            aria-hidden="true"
          />

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-gray-900">
                {entity.name}
              </span>
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                {entity.entityType}
              </span>
            </div>

            {entity.description && (
              <p className="mt-0.5 text-xs text-gray-500">
                {truncate(entity.description)}
              </p>
            )}

            <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
              <span>
                Source: <span className="text-gray-600">{entity.source}</span>
              </span>
              <span className={confidenceColor(entity.confidence)}>
                {(entity.confidence * 100).toFixed(0)}% (
                {confidenceLabel(entity.confidence)})
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 gap-1.5 self-center">
            <button
              type="button"
              className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
              onClick={() =>
                onReview(entity.entityId, {
                  action: "approve",
                  reviewedBy: "user",
                  reviewerType: "human",
                })
              }
            >
              Approve
            </button>
            <button
              type="button"
              className="rounded bg-red-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600"
              onClick={() =>
                onReview(entity.entityId, {
                  action: "reject",
                  reviewedBy: "user",
                  reviewerType: "human",
                  rejectionReason: "Rejected via review panel",
                })
              }
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
