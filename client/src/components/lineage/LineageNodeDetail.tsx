/**
 * LineageNodeDetail — Side panel showing selected node details.
 *
 * Displays all fields: lineageId, type, timestamp, context,
 * source/transformation/decision fields, upstream/downstream links.
 */

import { useMemo } from "react";
import type { DataLineageNode } from "@shared/lineage/contracts.js";
import { useLineageStore } from "@/lib/lineage-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  source: "#3B82F6",
  transformation: "#10B981",
  decision: "#F59E0B",
};

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#1f2937", wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, borderBottom: "1px solid #e5e7eb", paddingBottom: 2 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function LinkList({ label, ids, onSelect }: { label: string; ids: string[]; onSelect: (id: string) => void }) {
  if (!ids || ids.length === 0) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
        {ids.map((id) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            style={{
              fontSize: 11,
              color: "#3B82F6",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 4,
              padding: "1px 6px",
              cursor: "pointer",
            }}
          >
            {id.slice(0, 8)}…
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LineageNodeDetail() {
  const graph = useLineageStore((s) => s.graph);
  const selectedNodeId = useLineageStore((s) => s.selectedNodeId);
  const selectNode = useLineageStore((s) => s.selectNode);

  const node: DataLineageNode | undefined = useMemo(
    () => graph?.nodes.find((n) => n.lineageId === selectedNodeId),
    [graph, selectedNodeId],
  );

  if (!node) {
    return (
      <div style={{ padding: 16, color: "#9ca3af", fontSize: 13, textAlign: "center" }}>
        Select a node to view details
      </div>
    );
  }

  const color = TYPE_COLORS[node.type] ?? "#6b7280";

  return (
    <div style={{ padding: 12, overflowY: "auto", height: "100%", fontSize: 13 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
          <span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{node.type}</span>
        </div>
        <button
          onClick={() => selectNode(null)}
          style={{ fontSize: 18, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Core fields */}
      <Section title="General">
        <Field label="Lineage ID" value={node.lineageId} />
        <Field label="Type" value={node.type} />
        <Field label="Timestamp" value={fmtTs(node.timestamp)} />
        {node.complianceTags && node.complianceTags.length > 0 && (
          <Field
            label="Compliance Tags"
            value={
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {node.complianceTags.map((t) => (
                  <span key={t} style={{ background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "0 4px", fontSize: 10 }}>
                    {t}
                  </span>
                ))}
              </span>
            }
          />
        )}
      </Section>

      {/* Context */}
      {node.context && (
        <Section title="Context">
          <Field label="Session ID" value={node.context.sessionId} />
          <Field label="User ID" value={node.context.userId} />
          <Field label="Request ID" value={node.context.requestId} />
          <Field label="Environment" value={node.context.environment} />
          <Field label="Mission ID" value={node.context.missionId} />
          <Field label="Workflow ID" value={node.context.workflowId} />
        </Section>
      )}

      {/* Source fields */}
      {node.type === "source" && (
        <Section title="Source">
          <Field label="Source ID" value={node.sourceId} />
          <Field label="Source Name" value={node.sourceName} />
          <Field label="Query" value={node.queryText} />
          <Field label="Result Hash" value={node.resultHash} />
          <Field label="Result Size" value={node.resultSize != null ? `${node.resultSize} bytes` : undefined} />
        </Section>
      )}

      {/* Transformation fields */}
      {node.type === "transformation" && (
        <Section title="Transformation">
          <Field label="Agent ID" value={node.agentId} />
          <Field label="Operation" value={node.operation} />
          <Field label="Code Location" value={node.codeLocation} />
          <Field label="Data Changed" value={node.dataChanged != null ? String(node.dataChanged) : undefined} />
          <Field label="Execution Time" value={node.executionTimeMs != null ? `${node.executionTimeMs}ms` : undefined} />
          {node.parameters && (
            <Field label="Parameters" value={<pre style={{ fontSize: 10, margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(node.parameters, null, 2)}</pre>} />
          )}
        </Section>
      )}

      {/* Decision fields */}
      {node.type === "decision" && (
        <Section title="Decision">
          <Field label="Decision ID" value={node.decisionId} />
          <Field label="Logic" value={node.decisionLogic} />
          <Field label="Result" value={node.result} />
          <Field label="Confidence" value={node.confidence != null ? `${(node.confidence * 100).toFixed(1)}%` : undefined} />
          <Field label="Model Version" value={node.modelVersion} />
        </Section>
      )}

      {/* Links */}
      <Section title="Links">
        <LinkList label="Upstream" ids={node.upstream ?? []} onSelect={selectNode} />
        <LinkList label="Downstream" ids={node.downstream ?? []} onSelect={selectNode} />
        {node.inputLineageIds && node.inputLineageIds.length > 0 && (
          <LinkList label="Input Lineage IDs" ids={node.inputLineageIds} onSelect={selectNode} />
        )}
        {node.outputLineageId && (
          <Field label="Output Lineage ID" value={
            <button
              onClick={() => selectNode(node.outputLineageId!)}
              style={{ fontSize: 11, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            >
              {node.outputLineageId}
            </button>
          } />
        )}
      </Section>

      {/* Metadata */}
      {node.metadata && Object.keys(node.metadata).length > 0 && (
        <Section title="Metadata">
          <pre style={{ fontSize: 10, color: "#374151", margin: 0, whiteSpace: "pre-wrap", background: "#f9fafb", padding: 6, borderRadius: 4 }}>
            {JSON.stringify(node.metadata, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}
