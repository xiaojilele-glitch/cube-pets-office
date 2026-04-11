import { useCallback, useEffect, useRef, useState } from "react";
import { DatabaseZap, SearchCode, TriangleAlert } from "lucide-react";

import LineageDAGView from "@/components/lineage/LineageDAGView";
import LineageExportButton from "@/components/lineage/LineageExportButton";
import LineageHeatmap from "@/components/lineage/LineageHeatmap";
import LineageNodeDetail from "@/components/lineage/LineageNodeDetail";
import LineageTimeline from "@/components/lineage/LineageTimeline";
import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { RetryInlineNotice } from "@/components/tasks/RetryInlineNotice";
import { useViewportTier } from "@/hooks/useViewportTier";
import { useLineageStore } from "@/lib/lineage-store";
import type { LineageNodeType } from "@shared/lineage/contracts.js";

type ViewTab = "dag" | "timeline" | "heatmap";

const TABS: Array<{ key: ViewTab; label: string }> = [
  { key: "dag", label: "DAG" },
  { key: "timeline", label: "Timeline" },
  { key: "heatmap", label: "Heatmap" },
];

const NODE_TYPES: Array<{ value: LineageNodeType | ""; label: string }> = [
  { value: "", label: "All Types" },
  { value: "source", label: "Source" },
  { value: "transformation", label: "Transformation" },
  { value: "decision", label: "Decision" },
];

export default function LineagePage() {
  const { isMobile } = useViewportTier();
  const [activeTab, setActiveTab] = useState<ViewTab>("dag");
  const graph = useLineageStore(state => state.graph);
  const selectedNodeId = useLineageStore(state => state.selectedNodeId);
  const filters = useLineageStore(state => state.filters);
  const setFilters = useLineageStore(state => state.setFilters);
  const loading = useLineageStore(state => state.loading);
  const hasLoaded = useLineageStore(state => state.hasLoaded);
  const error = useLineageStore(state => state.error);
  const fetchRecentGraph = useLineageStore(state => state.fetchRecentGraph);
  const retryLastRequest = useLineageStore(state => state.retryLastRequest);

  const pagePaddingTop = isMobile ? 96 : 16;
  const pagePaddingBottom = isMobile ? 120 : 112;
  const dagCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    void fetchRecentGraph();
  }, [fetchRecentGraph, filters.agentId, filters.nodeType, filters.searchText]);

  const handleTypeFilter = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as LineageNodeType | "";
      setFilters({ nodeType: value || undefined });
    },
    [setFilters]
  );

  const handleAgentFilter = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setFilters({ agentId: event.target.value || undefined });
    },
    [setFilters]
  );

  const handleSearchFilter = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setFilters({ searchText: event.target.value || undefined });
    },
    [setFilters]
  );

  const showDetail = Boolean(selectedNodeId);
  const isEmpty =
    hasLoaded && !loading && (graph?.nodes.length ?? 0) === 0 && !error;

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
                type="button"
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
            {NODE_TYPES.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
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
            placeholder="Search node or source"
            value={filters.searchText ?? ""}
            onChange={handleSearchFilter}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              width: 180,
            }}
          />

          <LineageExportButton canvasRef={dagCanvasRef} />

          <button
            type="button"
            onClick={() => void retryLastRequest()}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 999,
              padding: "6px 12px",
              background: "#fff",
              color: "#374151",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Reload
          </button>

          {loading ? (
            <span style={{ fontSize: 11, color: "#9ca3af" }}>Loading...</span>
          ) : null}
        </div>

        {error && graph ? (
          <div className="border-b border-amber-200 bg-white px-4 py-3">
            <RetryInlineNotice
              title="Lineage refresh failed"
              description={error.message}
              actionLabel="Retry"
              onRetry={() => void retryLastRequest()}
            />
          </div>
        ) : null}

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {loading && !graph ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <EmptyHintBlock
                tone="info"
                icon={<DatabaseZap className="size-5" />}
                title="Loading lineage graph"
                description="Fetching the latest lineage nodes so the DAG, timeline, and heatmap can render meaningful data."
                hint="If the backend is starting up, this can take a moment."
              />
            </div>
          ) : null}

          {!loading && error && !graph ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <EmptyHintBlock
                tone={error.kind === "error" ? "danger" : "warning"}
                icon={<TriangleAlert className="size-5" />}
                title={
                  error.kind === "demo"
                    ? "Lineage is running in preview mode"
                    : error.kind === "offline"
                      ? "Lineage service is unavailable"
                      : "Lineage request failed"
                }
                description={
                  error.kind === "demo"
                    ? "The frontend received a fallback page instead of live lineage JSON, so the page stayed in a safe preview state."
                    : error.kind === "offline"
                      ? "The backend could not be reached, so the lineage graph cannot load yet."
                      : "The lineage API returned an unexpected result, and the raw parser error was hidden from the UI."
                }
                hint={error.message}
                actionLabel="Retry"
                onAction={() => void retryLastRequest()}
              />
            </div>
          ) : null}

          {!loading && isEmpty ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <EmptyHintBlock
                tone="info"
                icon={<SearchCode className="size-5" />}
                title="No lineage nodes matched"
                description={
                  filters.agentId || filters.nodeType || filters.searchText
                    ? "The current filters did not match any recent lineage node."
                    : "No recent lineage node has been recorded yet, so the graph is still empty."
                }
                hint={
                  filters.agentId || filters.nodeType || filters.searchText
                    ? "Clear or relax the filters, then retry to load a broader graph."
                    : "Run a workflow or ingest data through the backend, then come back to explore the resulting lineage."
                }
                actionLabel="Reload"
                onAction={() => void retryLastRequest()}
              />
            </div>
          ) : null}

          {graph && graph.nodes.length > 0 ? (
            <>
              <div
                style={{ flex: 1, position: "relative", overflow: "hidden" }}
              >
                {activeTab === "dag" ? <LineageDAGView /> : null}
                {activeTab === "timeline" ? <LineageTimeline /> : null}
                {activeTab === "heatmap" ? <LineageHeatmap /> : null}
              </div>

              {showDetail ? (
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
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
