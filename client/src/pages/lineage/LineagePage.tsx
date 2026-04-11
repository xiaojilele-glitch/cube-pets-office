import { useCallback, useEffect, useRef, useState } from "react";
import {
  DatabaseZap,
  GitBranch,
  RefreshCw,
  SearchCode,
  TriangleAlert,
} from "lucide-react";

import LineageDAGView from "@/components/lineage/LineageDAGView";
import LineageExportButton from "@/components/lineage/LineageExportButton";
import LineageHeatmap from "@/components/lineage/LineageHeatmap";
import LineageNodeDetail from "@/components/lineage/LineageNodeDetail";
import LineageTimeline from "@/components/lineage/LineageTimeline";
import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { RetryInlineNotice } from "@/components/tasks/RetryInlineNotice";
import { Button } from "@/components/ui/button";
import {
  WorkspacePageShell,
  WorkspacePanel,
} from "@/components/workspace/WorkspacePageShell";
import { useLineageStore } from "@/lib/lineage-store";
import { cn } from "@/lib/utils";
import type { LineageNodeType } from "@shared/lineage/contracts.js";

type ViewTab = "dag" | "timeline" | "heatmap";

const TABS: Array<{ key: ViewTab; label: string; description: string }> = [
  {
    key: "dag",
    label: "DAG",
    description: "Explore upstream and downstream dependencies",
  },
  {
    key: "timeline",
    label: "Timeline",
    description: "Follow events in execution order",
  },
  {
    key: "heatmap",
    label: "Heatmap",
    description: "Spot dense sources and active agents",
  },
];

const NODE_TYPES: Array<{ value: LineageNodeType | ""; label: string }> = [
  { value: "", label: "All Types" },
  { value: "source", label: "Source" },
  { value: "transformation", label: "Transformation" },
  { value: "decision", label: "Decision" },
];

export default function LineagePage() {
  const [activeTab, setActiveTab] = useState<ViewTab>("dag");
  const dagCanvasRef = useRef<HTMLCanvasElement>(null);

  const graph = useLineageStore(state => state.graph);
  const selectedNodeId = useLineageStore(state => state.selectedNodeId);
  const filters = useLineageStore(state => state.filters);
  const setFilters = useLineageStore(state => state.setFilters);
  const loading = useLineageStore(state => state.loading);
  const hasLoaded = useLineageStore(state => state.hasLoaded);
  const error = useLineageStore(state => state.error);
  const fetchRecentGraph = useLineageStore(state => state.fetchRecentGraph);
  const retryLastRequest = useLineageStore(state => state.retryLastRequest);

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

  const activeTabMeta = TABS.find(tab => tab.key === activeTab) ?? TABS[0];

  const toolbar = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              className="workspace-pill rounded-full px-4 py-2 text-sm font-semibold"
              data-active={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:flex xl:flex-wrap xl:justify-end">
          <select
            value={filters.nodeType ?? ""}
            onChange={handleTypeFilter}
            className="workspace-control h-11 rounded-full px-4 text-sm"
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
            className="workspace-control h-11 rounded-full px-4 text-sm placeholder:text-[var(--workspace-text-subtle)]"
          />

          <input
            type="text"
            placeholder="Search node or source"
            value={filters.searchText ?? ""}
            onChange={handleSearchFilter}
            className="workspace-control h-11 rounded-full px-4 text-sm placeholder:text-[var(--workspace-text-subtle)] sm:col-span-2 xl:min-w-[260px]"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <p className="text-sm leading-6 text-[var(--workspace-text-muted)]">
          {activeTabMeta.description}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className="workspace-badge"
            data-tone={loading ? "info" : error ? "warning" : "success"}
          >
            {loading
              ? "Refreshing graph"
              : error
                ? "Fallback state"
                : "Recent lineage ready"}
          </span>
          {filters.agentId || filters.nodeType || filters.searchText ? (
            <span className="workspace-badge">Filtered view</span>
          ) : null}
        </div>
      </div>
    </div>
  );

  const actions = (
    <>
      <LineageExportButton canvasRef={dagCanvasRef} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="workspace-control rounded-full px-4 text-sm font-semibold"
        onClick={() => void retryLastRequest()}
      >
        <RefreshCw className="size-4" />
        Reload
      </Button>
    </>
  );

  return (
    <WorkspacePageShell
      eyebrow="More / Governance"
      title="Data Lineage"
      description="Bring the lineage graph, execution trace, and node context into the same warm workspace language as the rest of the product, without losing the tooling feel."
      actions={actions}
      toolbar={toolbar}
    >
      {error && graph ? (
        <WorkspacePanel className="p-3">
          <RetryInlineNotice
            title="Lineage refresh failed"
            description={error.message}
            actionLabel="Retry"
            onRetry={() => void retryLastRequest()}
          />
        </WorkspacePanel>
      ) : null}

      <div
        className={cn(
          "grid gap-4",
          showDetail ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1"
        )}
      >
        <WorkspacePanel
          strong
          className="min-h-[560px] overflow-hidden p-4 md:p-5"
        >
          <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-[24px] bg-white/22">
            {loading && !graph ? (
              <div className="flex flex-1 items-center justify-center px-6 py-8">
                <EmptyHintBlock
                  tone="info"
                  icon={<DatabaseZap className="size-5" />}
                  title="Loading lineage graph"
                  description="Fetching recent lineage nodes so the graph, timeline, and heatmap can render a meaningful view."
                  hint="If the backend is still starting up, this can take a moment."
                />
              </div>
            ) : null}

            {!loading && error && !graph ? (
              <div className="flex flex-1 items-center justify-center px-6 py-8">
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
              <div className="flex flex-1 items-center justify-center px-6 py-8">
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
              <div className="flex flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-[var(--workspace-panel-border)] px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--workspace-text)]">
                    <GitBranch className="size-4 text-[var(--studio-accent-strong)]" />
                    {activeTabMeta.label} View
                  </div>
                  <div className="font-data text-xs text-[var(--workspace-text-subtle)]">
                    {graph.nodes.length} nodes
                  </div>
                </div>

                <div className="min-h-0 flex-1 p-3 md:p-4">
                  <div className="h-full rounded-[24px] border border-[var(--workspace-panel-border)] bg-[rgba(255,251,246,0.88)] p-2 md:p-3">
                    {activeTab === "dag" ? (
                      <LineageDAGView canvasRef={dagCanvasRef} />
                    ) : null}
                    {activeTab === "timeline" ? <LineageTimeline /> : null}
                    {activeTab === "heatmap" ? <LineageHeatmap /> : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </WorkspacePanel>

        {showDetail ? (
          <WorkspacePanel className="min-h-[560px] overflow-hidden">
            <LineageNodeDetail />
          </WorkspacePanel>
        ) : null}
      </div>
    </WorkspacePageShell>
  );
}
