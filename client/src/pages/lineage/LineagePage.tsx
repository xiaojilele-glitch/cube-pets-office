/**
 * LineagePage — Main page assembling all lineage visualization views.
 *
 * Layout:
 * - Top: filter controls + export button
 * - Main area: tab-switched views (DAG / Timeline / Heatmap)
 * - Right panel: node detail (when a node is selected)
 *
 * Uses useLineageStore for state management.
 */

import { useState, useCallback, useRef } from "react";
import { useLineageStore } from "@/lib/lineage-store";
import type { LineageNodeType } from "@shared/lineage/contracts.js";
import LineageDAGView from "@/components/lineage/LineageDAGView";
import LineageTimeline from "@/components/lineage/LineageTimeline";
import LineageHeatmap from "@/components/lineage/LineageHeatmap";
import LineageNodeDetail from "@/components/lineage/LineageNodeDetail";
import LineageExportButton from "@/components/lineage/LineageExportButton";
import { useViewportTier } from "@/hooks/useViewportTier";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ViewTab = "dag" | "timeline" | "heatmap";

const TABS: { key: ViewTab; label: string }[] = [
  { key: "dag", label: "DAG" },
  { key: "timeline", label: "Timeline" },
  { key: "heatmap", label: "Heatmap" },
];

const NODE_TYPES: { value: LineageNodeType | ""; label: string }[] = [
  { value: "", label: "All Types" },
  { value: "source", label: "Source" },
  { value: "transformation", label: "Transformation" },
  { value: "decision", label: "Decision" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LineagePage() {
  const { isMobile } = useViewportTier();
  const [activeTab, setActiveTab] = useState<ViewTab>("dag");
  const selectedNodeId = useLineageStore(s => s.selectedNodeId);
  const filters = useLineageStore(s => s.filters);
  const setFilters = useLineageStore(s => s.setFilters);
  const loading = useLineageStore(s => s.loading);
  const pagePaddingTop = isMobile ? 96 : 16;
  const pagePaddingBottom = isMobile ? 120 : 112;

  // For PNG export — DAGView exposes its canvas via a forwarded ref approach,
  // but since we keep it simple, we grab the canvas from the DOM.
  const dagCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleTypeFilter = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value as LineageNodeType | "";
      setFilters({ nodeType: val || undefined });
    },
    [setFilters]
  );

  const handleAgentFilter = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilters({ agentId: e.target.value || undefined });
    },
    [setFilters]
  );

  const handleSearchFilter = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilters({ searchText: e.target.value || undefined });
    },
    [setFilters]
  );

  const showDetail = !!selectedNodeId;

  return (
    <div
      style={{
        minHeight: "100vh",
        paddingTop: pagePaddingTop,
        paddingBottom: pagePaddingBottom,
        background: "#f9fafb",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: `calc(100vh - ${pagePaddingTop + pagePaddingBottom}px)`,
        }}
      >
        {/* Top bar: filters + export */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 16px",
            borderBottom: "1px solid #e5e7eb",
            background: "#fff",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: 15,
              color: "#111827",
              marginRight: 8,
            }}
          >
            Data Lineage
          </span>

          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: 2,
              background: "#f3f4f6",
              borderRadius: 6,
              padding: 2,
            }}
          >
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: "4px 14px",
                  fontSize: 12,
                  borderRadius: 4,
                  border: "none",
                  background: activeTab === tab.key ? "#fff" : "transparent",
                  color: activeTab === tab.key ? "#111827" : "#6b7280",
                  fontWeight: activeTab === tab.key ? 600 : 400,
                  cursor: "pointer",
                  boxShadow:
                    activeTab === tab.key
                      ? "0 1px 2px rgba(0,0,0,0.06)"
                      : "none",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Filters */}
          <select
            value={filters.nodeType ?? ""}
            onChange={handleTypeFilter}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          >
            {NODE_TYPES.map(t => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Agent ID"
            value={filters.agentId ?? ""}
            onChange={handleAgentFilter}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              width: 120,
            }}
          />

          <input
            type="text"
            placeholder="Search…"
            value={filters.searchText ?? ""}
            onChange={handleSearchFilter}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              width: 140,
            }}
          />

          <LineageExportButton canvasRef={dagCanvasRef} />

          {loading && (
            <span style={{ fontSize: 11, color: "#9ca3af" }}>Loading…</span>
          )}
        </div>

        {/* Main content */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* View area */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {activeTab === "dag" && <LineageDAGView />}
            {activeTab === "timeline" && <LineageTimeline />}
            {activeTab === "heatmap" && <LineageHeatmap />}
          </div>

          {/* Node detail panel */}
          {showDetail && (
            <div
              style={{
                width: 300,
                borderLeft: "1px solid #e5e7eb",
                background: "#fff",
                overflowY: "auto",
                flexShrink: 0,
              }}
            >
              <LineageNodeDetail />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
