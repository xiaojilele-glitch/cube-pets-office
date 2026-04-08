/**
 * LineageExportButton — Export current lineage canvas as PNG or SVG.
 *
 * - PNG: uses canvas.toDataURL()
 * - SVG: generates SVG markup from graph data
 * - Downloads via temporary anchor element
 *
 * @see Requirements AC-7.5
 */

import { useCallback, useState } from "react";
import type { DataLineageNode, LineageEdge } from "@shared/lineage/contracts.js";
import { useLineageStore } from "@/lib/lineage-store";

// ---------------------------------------------------------------------------
// Constants (mirror DAGView layout for SVG generation)
// ---------------------------------------------------------------------------

const NODE_W = 140;
const NODE_H = 44;
const LAYER_GAP_X = 200;
const LANE_GAP_Y = 70;
const PADDING = 60;

const TYPE_COLORS: Record<string, string> = {
  source: "#3B82F6",
  transformation: "#10B981",
  decision: "#F59E0B",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface LayoutNode {
  id: string;
  node: DataLineageNode;
  x: number;
  y: number;
}

function computeSimpleLayout(nodes: DataLineageNode[], edges: LineageEdge[]): LayoutNode[] {
  if (nodes.length === 0) return [];

  const nodeMap = new Map(nodes.map((n) => [n.lineageId, n]));
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDeg.set(n.lineageId, 0);
    adj.set(n.lineageId, []);
  }
  for (const e of edges) {
    if (nodeMap.has(e.fromId) && nodeMap.has(e.toId)) {
      adj.get(e.fromId)!.push(e.toId);
      inDeg.set(e.toId, (inDeg.get(e.toId) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  const layerOf = new Map<string, number>();
  Array.from(inDeg.entries()).forEach(([id, deg]) => {
    if (deg === 0) { queue.push(id); layerOf.set(id, 0); }
  });
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curLayer = layerOf.get(cur) ?? 0;
    for (const next of adj.get(cur) ?? []) {
      layerOf.set(next, Math.max(layerOf.get(next) ?? 0, curLayer + 1));
      inDeg.set(next, (inDeg.get(next) ?? 0) - 1);
      if (inDeg.get(next) === 0) queue.push(next);
    }
  }
  for (const n of nodes) {
    if (!layerOf.has(n.lineageId)) layerOf.set(n.lineageId, 0);
  }

  const layers = new Map<number, DataLineageNode[]>();
  for (const n of nodes) {
    const l = layerOf.get(n.lineageId) ?? 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(n);
  }

  const result: LayoutNode[] = [];
  Array.from(layers.entries()).forEach(([layer, group]) => {
    group.forEach((node: DataLineageNode, idx: number) => {
      result.push({
        id: node.lineageId,
        node,
        x: PADDING + layer * LAYER_GAP_X,
        y: PADDING + idx * LANE_GAP_Y,
      });
    });
  });
  return result;
}

function generateSVG(nodes: DataLineageNode[], edges: LineageEdge[]): string {
  const layout = computeSimpleLayout(nodes, edges);
  const posMap = new Map(layout.map((l) => [l.id, l]));

  const maxX = Math.max(...layout.map((l) => l.x + NODE_W), 400) + PADDING;
  const maxY = Math.max(...layout.map((l) => l.y + NODE_H), 200) + PADDING;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">`);
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // Edges
  for (const e of edges) {
    const from = posMap.get(e.fromId);
    const to = posMap.get(e.toId);
    if (!from || !to) continue;
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" stroke-width="1" marker-end="url(#arrow)"/>`);
  }

  // Arrow marker
  parts.push(`<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8"/></marker></defs>`);

  // Nodes
  for (const ln of layout) {
    const color = TYPE_COLORS[ln.node.type] ?? "#6b7280";
    const label = ln.node.sourceName ?? ln.node.agentId ?? ln.node.decisionId ?? ln.id.slice(0, 8);
    const escaped = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    parts.push(`<rect x="${ln.x}" y="${ln.y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${color}22" stroke="${color}" stroke-width="1"/>`);
    parts.push(`<text x="${ln.x + 6}" y="${ln.y + 14}" font-size="9" font-weight="bold" fill="${color}">${ln.node.type.toUpperCase().slice(0, 3)}</text>`);
    parts.push(`<text x="${ln.x + 6}" y="${ln.y + 32}" font-size="11" fill="#1f2937">${escaped}</text>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface LineageExportButtonProps {
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export default function LineageExportButton({ canvasRef }: LineageExportButtonProps) {
  const graph = useLineageStore((s) => s.graph);
  const [open, setOpen] = useState(false);

  const exportPNG = useCallback(() => {
    const canvas = canvasRef?.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) download(blob, "lineage-dag.png");
    }, "image/png");
    setOpen(false);
  }, [canvasRef]);

  const exportSVG = useCallback(() => {
    if (!graph) return;
    const svg = generateSVG(graph.nodes, graph.edges);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    download(blob, "lineage-dag.svg");
    setOpen(false);
  }, [graph]);

  const disabled = !graph || graph.nodes.length === 0;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        style={{
          padding: "4px 12px",
          fontSize: 12,
          borderRadius: 4,
          border: "1px solid #d1d5db",
          background: disabled ? "#f3f4f6" : "#fff",
          color: disabled ? "#9ca3af" : "#374151",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        Export ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            zIndex: 10,
            minWidth: 120,
          }}
        >
          <button
            onClick={exportPNG}
            disabled={!canvasRef?.current}
            style={{ display: "block", width: "100%", padding: "8px 12px", fontSize: 12, textAlign: "left", border: "none", background: "none", cursor: "pointer", color: "#374151" }}
          >
            Export PNG
          </button>
          <button
            onClick={exportSVG}
            style={{ display: "block", width: "100%", padding: "8px 12px", fontSize: 12, textAlign: "left", border: "none", background: "none", cursor: "pointer", color: "#374151", borderTop: "1px solid #f3f4f6" }}
          >
            Export SVG
          </button>
        </div>
      )}
    </div>
  );
}
