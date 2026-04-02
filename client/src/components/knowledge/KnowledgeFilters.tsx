/**
 * 知识图谱过滤器组件
 *
 * 提供 entityType 勾选、confidence 阈值滑块、status 过滤、relationType 勾选。
 * 用于控制 KnowledgeGraphPanel 中显示的节点和边。
 *
 * Requirements: 9.3
 */

import type { EntityStatus } from "@shared/knowledge/types";
import { getEntityColor } from "./KnowledgeGraphPanel";

// ---------------------------------------------------------------------------
// 10 core entity types (from OntologyRegistry)
// ---------------------------------------------------------------------------

export const CORE_ENTITY_TYPES = [
  "CodeModule",
  "API",
  "BusinessRule",
  "ArchitectureDecision",
  "TechStack",
  "Agent",
  "Role",
  "Mission",
  "Bug",
  "Config",
] as const;

// ---------------------------------------------------------------------------
// 11 core relation types (from OntologyRegistry)
// ---------------------------------------------------------------------------

export const CORE_RELATION_TYPES = [
  "DEPENDS_ON",
  "CALLS",
  "IMPLEMENTS",
  "DECIDED_BY",
  "SUPERSEDES",
  "USES",
  "CAUSED_BY",
  "RESOLVED_BY",
  "BELONGS_TO",
  "EXECUTED_BY",
  "KNOWS_ABOUT",
] as const;

// ---------------------------------------------------------------------------
// Status options
// ---------------------------------------------------------------------------

export const STATUS_OPTIONS: Array<{ value: EntityStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "deprecated", label: "Deprecated" },
  { value: "archived", label: "Archived" },
];

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

export interface KnowledgeFilterState {
  /** Set of visible entity types (unchecked types are hidden) */
  entityTypes: Set<string>;
  /** Minimum confidence threshold 0.0 – 1.0 */
  confidenceMin: number;
  /** Status filter — "all" shows every status */
  status: EntityStatus | "all";
  /** Set of visible relation types */
  relationTypes: Set<string>;
}

export function createDefaultFilterState(): KnowledgeFilterState {
  return {
    entityTypes: new Set<string>(CORE_ENTITY_TYPES),
    confidenceMin: 0,
    status: "active",
    relationTypes: new Set<string>(CORE_RELATION_TYPES),
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KnowledgeFiltersProps {
  filters: KnowledgeFilterState;
  onChange: (next: KnowledgeFilterState) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KnowledgeFilters({
  filters,
  onChange,
  className = "",
}: KnowledgeFiltersProps) {
  // -- helpers ---------------------------------------------------------------

  function toggleEntityType(type: string) {
    const next = new Set(filters.entityTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange({ ...filters, entityTypes: next });
  }

  function toggleRelationType(type: string) {
    const next = new Set(filters.relationTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange({ ...filters, relationTypes: next });
  }

  function setConfidenceMin(value: number) {
    onChange({ ...filters, confidenceMin: value });
  }

  function setStatus(value: EntityStatus | "all") {
    onChange({ ...filters, status: value });
  }

  // -- render ----------------------------------------------------------------

  return (
    <div className={`flex flex-col gap-4 text-sm ${className}`}>
      {/* Entity type checkboxes */}
      <fieldset>
        <legend className="font-semibold text-gray-700 mb-1">Entity Types</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {CORE_ENTITY_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.entityTypes.has(t)}
                onChange={() => toggleEntityType(t)}
                className="accent-blue-600"
              />
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: getEntityColor(t) }}
              />
              <span className="text-gray-600">{t}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Confidence threshold slider */}
      <fieldset>
        <legend className="font-semibold text-gray-700 mb-1">
          Confidence ≥ {filters.confidenceMin.toFixed(2)}
        </legend>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={filters.confidenceMin}
          onChange={(e) => setConfidenceMin(Number(e.target.value))}
          className="w-full accent-blue-600"
          aria-label="Minimum confidence threshold"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>0</span>
          <span>0.5</span>
          <span>1</span>
        </div>
      </fieldset>

      {/* Status filter */}
      <fieldset>
        <legend className="font-semibold text-gray-700 mb-1">Status</legend>
        <select
          value={filters.status}
          onChange={(e) => setStatus(e.target.value as EntityStatus | "all")}
          className="border border-gray-300 rounded px-2 py-1 text-gray-700 bg-white"
          aria-label="Entity status filter"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </fieldset>

      {/* Relation type checkboxes */}
      <fieldset>
        <legend className="font-semibold text-gray-700 mb-1">Relation Types</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {CORE_RELATION_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.relationTypes.has(t)}
                onChange={() => toggleRelationType(t)}
                className="accent-blue-600"
              />
              <span className="text-gray-600">{t}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
