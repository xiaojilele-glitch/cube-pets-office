import { useMemo } from "react";
import { X } from "lucide-react";

import type { DataLineageNode } from "@shared/lineage/contracts.js";

import { useLineageStore } from "@/lib/lineage-store";

import { getLineageTypeMeta } from "./lineage-theme";

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value === undefined || value === null || value === "") return null;

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
        {label}
      </div>
      <div className="break-all text-sm leading-6 text-[var(--workspace-text)]">
        {value}
      </div>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
      <div className="text-xs font-semibold text-[var(--workspace-text-muted)]">
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function LinkedIds({
  label,
  ids,
  onSelect,
}: {
  label: string;
  ids: string[];
  onSelect: (id: string) => void;
}) {
  if (ids.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {ids.map(id => (
          <button
            key={id}
            type="button"
            className="workspace-control rounded-full px-3 py-1 text-xs font-semibold"
            onClick={() => onSelect(id)}
          >
            {id.slice(0, 8)}...
          </button>
        ))}
      </div>
    </div>
  );
}

export default function LineageNodeDetail() {
  const graph = useLineageStore(state => state.graph);
  const selectedNodeId = useLineageStore(state => state.selectedNodeId);
  const selectNode = useLineageStore(state => state.selectNode);

  const node: DataLineageNode | undefined = useMemo(
    () => graph?.nodes.find(item => item.lineageId === selectedNodeId),
    [graph, selectedNodeId]
  );

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--workspace-text-subtle)]">
        Select a node to inspect its lineage context.
      </div>
    );
  }

  const meta = getLineageTypeMeta(node.type);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-3 rounded-[24px] border border-[var(--workspace-panel-border)] bg-white/58 p-4">
        <div className="min-w-0">
          <span
            className="workspace-badge text-[11px] font-semibold"
            style={{
              background: meta.softColor,
              borderColor: meta.borderColor,
              color: meta.color,
            }}
          >
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: meta.color }}
            />
            {meta.label}
          </span>
          <div className="mt-3 font-data text-xs text-[var(--workspace-text-subtle)]">
            {node.lineageId}
          </div>
        </div>

        <button
          type="button"
          className="workspace-control inline-flex size-9 items-center justify-center rounded-2xl"
          onClick={() => selectNode(null)}
          aria-label="Close details"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <DetailSection title="General">
          <DetailField label="Type" value={meta.label} />
          <DetailField
            label="Timestamp"
            value={formatTimestamp(node.timestamp)}
          />
          {node.complianceTags && node.complianceTags.length > 0 ? (
            <DetailField
              label="Compliance Tags"
              value={
                <span className="flex flex-wrap gap-2">
                  {node.complianceTags.map(tag => (
                    <span
                      key={tag}
                      className="workspace-badge text-[11px] font-semibold"
                      data-tone="warning"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              }
            />
          ) : null}
        </DetailSection>

        {node.context ? (
          <DetailSection title="Context">
            <DetailField label="Session ID" value={node.context.sessionId} />
            <DetailField label="User ID" value={node.context.userId} />
            <DetailField label="Request ID" value={node.context.requestId} />
            <DetailField label="Environment" value={node.context.environment} />
            <DetailField label="Mission ID" value={node.context.missionId} />
            <DetailField label="Workflow ID" value={node.context.workflowId} />
          </DetailSection>
        ) : null}

        {node.type === "source" ? (
          <DetailSection title="Source">
            <DetailField label="Source ID" value={node.sourceId} />
            <DetailField label="Source Name" value={node.sourceName} />
            <DetailField label="Query" value={node.queryText} />
            <DetailField label="Result Hash" value={node.resultHash} />
            <DetailField
              label="Result Size"
              value={
                node.resultSize !== undefined
                  ? `${node.resultSize} bytes`
                  : undefined
              }
            />
          </DetailSection>
        ) : null}

        {node.type === "transformation" ? (
          <DetailSection title="Transformation">
            <DetailField label="Agent ID" value={node.agentId} />
            <DetailField label="Operation" value={node.operation} />
            <DetailField label="Code Location" value={node.codeLocation} />
            <DetailField
              label="Data Changed"
              value={
                node.dataChanged !== undefined
                  ? String(node.dataChanged)
                  : undefined
              }
            />
            <DetailField
              label="Execution Time"
              value={
                node.executionTimeMs !== undefined
                  ? `${node.executionTimeMs} ms`
                  : undefined
              }
            />
            {node.parameters ? (
              <DetailField
                label="Parameters"
                value={
                  <pre className="overflow-x-auto rounded-[16px] bg-[#f9f1e8] p-3 text-[11px] leading-5 text-[var(--workspace-text)]">
                    {JSON.stringify(node.parameters, null, 2)}
                  </pre>
                }
              />
            ) : null}
          </DetailSection>
        ) : null}

        {node.type === "decision" ? (
          <DetailSection title="Decision">
            <DetailField label="Decision ID" value={node.decisionId} />
            <DetailField label="Logic" value={node.decisionLogic} />
            <DetailField label="Result" value={node.result} />
            <DetailField
              label="Confidence"
              value={
                node.confidence !== undefined
                  ? `${(node.confidence * 100).toFixed(1)}%`
                  : undefined
              }
            />
            <DetailField label="Model Version" value={node.modelVersion} />
          </DetailSection>
        ) : null}

        <DetailSection title="Links">
          <LinkedIds
            label="Upstream"
            ids={node.upstream ?? []}
            onSelect={selectNode}
          />
          <LinkedIds
            label="Downstream"
            ids={node.downstream ?? []}
            onSelect={selectNode}
          />
          <LinkedIds
            label="Input Lineage IDs"
            ids={node.inputLineageIds ?? []}
            onSelect={selectNode}
          />
          {node.outputLineageId ? (
            <DetailField
              label="Output Lineage ID"
              value={
                <button
                  type="button"
                  className="font-medium text-[var(--studio-sage-strong)] underline decoration-[var(--studio-sage)] underline-offset-4"
                  onClick={() => selectNode(node.outputLineageId ?? null)}
                >
                  {node.outputLineageId}
                </button>
              }
            />
          ) : null}
        </DetailSection>

        {node.metadata && Object.keys(node.metadata).length > 0 ? (
          <DetailSection title="Metadata">
            <pre className="overflow-x-auto rounded-[16px] bg-[#f9f1e8] p-3 text-[11px] leading-5 text-[var(--workspace-text)]">
              {JSON.stringify(node.metadata, null, 2)}
            </pre>
          </DetailSection>
        ) : null}
      </div>
    </div>
  );
}
