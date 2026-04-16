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
import {
  getLineageCopy,
  getLineageNodeTypeOptions,
  getLineageTabs,
  type LineageViewTab,
} from "@/components/lineage/lineage-copy";
import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { RetryInlineNotice } from "@/components/tasks/RetryInlineNotice";
import { Button } from "@/components/ui/button";
import {
  WorkspacePageShell,
  WorkspacePanel,
} from "@/components/workspace/WorkspacePageShell";
import { useI18n } from "@/i18n";
import { useLineageStore } from "@/lib/lineage-store";
import { cn } from "@/lib/utils";
import type { LineageNodeType } from "@shared/lineage/contracts.js";

export function LineageContent({ embedded = false }: { embedded?: boolean }) {
  const { locale } = useI18n();
  const copy = getLineageCopy(locale);
  const tabs = getLineageTabs(locale);
  const nodeTypeOptions = getLineageNodeTypeOptions(locale);
  const [activeTab, setActiveTab] = useState<LineageViewTab>("dag");
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

  const activeTabMeta = tabs.find(tab => tab.key === activeTab) ?? tabs[0];

  const toolbar = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabs.map(tab => (
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
            {nodeTypeOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder={copy.page.agentIdPlaceholder}
            value={filters.agentId ?? ""}
            onChange={handleAgentFilter}
            className="workspace-control h-11 rounded-full px-4 text-sm placeholder:text-[var(--workspace-text-subtle)]"
          />

          <input
            type="text"
            placeholder={copy.page.searchPlaceholder}
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
              ? copy.page.refreshingStatus
              : error
                ? copy.page.fallbackStatus
                : copy.page.readyStatus}
          </span>
          {filters.agentId || filters.nodeType || filters.searchText ? (
            <span className="workspace-badge">{copy.page.filteredView}</span>
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
        {copy.page.reload}
      </Button>
    </>
  );

  const content = (
    <>
      {error && graph ? (
        <WorkspacePanel className="p-3">
          <RetryInlineNotice
            title={copy.page.refreshFailed}
            description={error.message}
            actionLabel={copy.page.retry}
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
                  title={copy.page.loadingTitle}
                  description={copy.page.loadingDescription}
                  hint={copy.page.loadingHint}
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
                      ? copy.page.previewModeTitle
                      : error.kind === "offline"
                        ? copy.page.serviceUnavailableTitle
                        : copy.page.requestFailedTitle
                  }
                  description={
                    error.kind === "demo"
                      ? copy.page.previewModeDescription
                      : error.kind === "offline"
                        ? copy.page.serviceUnavailableDescription
                        : copy.page.requestFailedDescription
                  }
                  hint={error.message}
                  actionLabel={copy.page.retry}
                  onAction={() => void retryLastRequest()}
                />
              </div>
            ) : null}

            {!loading && isEmpty ? (
              <div className="flex flex-1 items-center justify-center px-6 py-8">
                <EmptyHintBlock
                  tone="info"
                  icon={<SearchCode className="size-5" />}
                  title={copy.page.emptyTitle}
                  description={
                    filters.agentId || filters.nodeType || filters.searchText
                      ? copy.page.emptyFilteredDescription
                      : copy.page.emptyDefaultDescription
                  }
                  hint={
                    filters.agentId || filters.nodeType || filters.searchText
                      ? copy.page.emptyFilteredHint
                      : copy.page.emptyDefaultHint
                  }
                  actionLabel={copy.page.reload}
                  onAction={() => void retryLastRequest()}
                />
              </div>
            ) : null}

            {graph && graph.nodes.length > 0 ? (
              <div className="flex flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-[var(--workspace-panel-border)] px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--workspace-text)]">
                    <GitBranch className="size-4 text-[var(--studio-accent-strong)]" />
                    {activeTabMeta.label} {copy.page.viewSuffix}
                  </div>
                  <div className="font-data text-xs text-[var(--workspace-text-subtle)]">
                    {copy.page.nodesCount(graph.nodes.length)}
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
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col gap-4">
        <WorkspacePanel className="p-4 md:p-5">
          <div className="flex justify-between mb-4">{actions}</div>
          {toolbar}
        </WorkspacePanel>
        {content}
      </div>
    );
  }

  return (
    <WorkspacePageShell
      eyebrow={copy.page.eyebrow}
      title={copy.page.title}
      description={copy.page.description}
      actions={actions}
      toolbar={toolbar}
    >
      {content}
    </WorkspacePageShell>
  );
}

export default function LineagePage() {
  return <LineageContent />;
}
