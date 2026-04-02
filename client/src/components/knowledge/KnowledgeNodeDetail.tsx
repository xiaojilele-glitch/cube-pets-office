/**
 * 知识图谱节点详情面板
 *
 * 显示实体属性（名称、类型、描述、置信度、状态、来源等）、
 * 扩展属性、以及关联实体列表（含关系类型）。
 *
 * Requirements: 9.2
 */

import type { Entity, Relation } from "@shared/knowledge/types";
import { getEntityColor } from "./KnowledgeGraphPanel";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KnowledgeNodeDetailProps {
  entity: Entity | null;
  relatedEntities: Entity[];
  relations: Relation[];
  onClose: () => void;
  onNavigate: (entityId: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Find the relation type connecting the current entity to a related entity. */
function getRelationType(
  entityId: string,
  relatedId: string,
  relations: Relation[],
): { type: string; direction: "outgoing" | "incoming" } | null {
  for (const r of relations) {
    if (r.sourceEntityId === entityId && r.targetEntityId === relatedId) {
      return { type: r.relationType, direction: "outgoing" };
    }
    if (r.targetEntityId === entityId && r.sourceEntityId === relatedId) {
      return { type: r.relationType, direction: "incoming" };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KnowledgeNodeDetail({
  entity,
  relatedEntities,
  relations,
  onClose,
  onNavigate,
  className = "",
}: KnowledgeNodeDetailProps) {
  if (!entity) return null;

  const color = getEntityColor(entity.entityType);
  const extAttrs = entity.extendedAttributes ?? {};
  const extKeys = Object.keys(extAttrs);

  return (
    <div
      className={`bg-white border border-gray-200 rounded-lg shadow-lg p-4 overflow-y-auto text-sm ${className}`}
      role="region"
      aria-label={`Details for ${entity.name}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <h3 className="font-semibold text-gray-900 truncate">{entity.name}</h3>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 ml-2 flex-shrink-0"
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      {/* Core attributes */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-600 mb-3">
        <dt className="text-gray-500">Type</dt>
        <dd>{entity.entityType}</dd>

        {entity.description && (
          <>
            <dt className="text-gray-500">Description</dt>
            <dd>{entity.description}</dd>
          </>
        )}

        <dt className="text-gray-500">Confidence</dt>
        <dd>
          <span
            className={entity.confidence < 0.5 ? "text-amber-600 font-medium" : ""}
          >
            {entity.confidence.toFixed(2)}
          </span>
        </dd>

        <dt className="text-gray-500">Status</dt>
        <dd className="capitalize">{entity.status}</dd>

        <dt className="text-gray-500">Source</dt>
        <dd>{entity.source}</dd>

        <dt className="text-gray-500">Created</dt>
        <dd>{formatDate(entity.createdAt)}</dd>

        <dt className="text-gray-500">Updated</dt>
        <dd>{formatDate(entity.updatedAt)}</dd>
      </dl>

      {/* Extended attributes */}
      {extKeys.length > 0 && (
        <div className="mb-3">
          <h4 className="font-semibold text-gray-700 mb-1">Extended Attributes</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-600">
            {extKeys.map((key) => (
              <ExtAttrRow key={key} label={key} value={extAttrs[key]} />
            ))}
          </dl>
        </div>
      )}

      {/* Related entities */}
      {relatedEntities.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-1">
            Related Entities ({relatedEntities.length})
          </h4>
          <ul className="space-y-1">
            {relatedEntities.map((re) => {
              const rel = getRelationType(entity.entityId, re.entityId, relations);
              return (
                <li key={re.entityId}>
                  <button
                    onClick={() => onNavigate(re.entityId)}
                    className="flex items-center gap-2 w-full text-left px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getEntityColor(re.entityType) }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-gray-800">{re.name}</span>
                    {rel && (
                      <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                        {rel.direction === "outgoing" ? "→" : "←"} {rel.type}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: extended attribute row
// ---------------------------------------------------------------------------

function ExtAttrRow({ label, value }: { label: string; value: unknown }) {
  let display: string;
  if (Array.isArray(value)) {
    display = value.join(", ");
  } else if (typeof value === "object" && value !== null) {
    display = JSON.stringify(value);
  } else {
    display = String(value ?? "");
  }

  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="break-all">{display}</dd>
    </>
  );
}
