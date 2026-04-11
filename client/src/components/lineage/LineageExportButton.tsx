import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";

import type {
  DataLineageNode,
  LineageEdge,
} from "@shared/lineage/contracts.js";

import { Button } from "@/components/ui/button";
import { useLineageStore } from "@/lib/lineage-store";
import { cn } from "@/lib/utils";

import { getLineageTypeMeta } from "./lineage-theme";

const NODE_W = 152;
const NODE_H = 52;
const LAYER_GAP_X = 220;
const LANE_GAP_Y = 86;
const PADDING = 72;

interface LayoutNode {
  id: string;
  node: DataLineageNode;
  x: number;
  y: number;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function computeSimpleLayout(nodes: DataLineageNode[], edges: LineageEdge[]) {
  if (nodes.length === 0) return [];

  const nodeMap = new Map(nodes.map(node => [node.lineageId, node]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.lineageId, 0);
    adjacency.set(node.lineageId, []);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.fromId) || !nodeMap.has(edge.toId)) continue;
    adjacency.get(edge.fromId)?.push(edge.toId);
    inDegree.set(edge.toId, (inDegree.get(edge.toId) ?? 0) + 1);
  }

  const queue: string[] = [];
  const layerByNodeId = new Map<string, number>();
  Array.from(inDegree.entries()).forEach(([nodeId, degree]) => {
    if (degree !== 0) return;
    queue.push(nodeId);
    layerByNodeId.set(nodeId, 0);
  });

  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const current = queue[queueIndex++];
    const currentLayer = layerByNodeId.get(current) ?? 0;

    for (const next of adjacency.get(current) ?? []) {
      layerByNodeId.set(
        next,
        Math.max(layerByNodeId.get(next) ?? 0, currentLayer + 1)
      );
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  for (const node of nodes) {
    if (!layerByNodeId.has(node.lineageId)) {
      layerByNodeId.set(node.lineageId, 0);
    }
  }

  const layers = new Map<number, DataLineageNode[]>();
  for (const node of nodes) {
    const layer = layerByNodeId.get(node.lineageId) ?? 0;
    if (!layers.has(layer)) {
      layers.set(layer, []);
    }
    layers.get(layer)?.push(node);
  }

  const result: LayoutNode[] = [];
  Array.from(layers.entries()).forEach(([layer, group]) => {
    group.forEach((node, index) => {
      result.push({
        id: node.lineageId,
        node,
        x: PADDING + layer * LAYER_GAP_X,
        y: PADDING + index * LANE_GAP_Y,
      });
    });
  });

  return result;
}

function generateSVG(nodes: DataLineageNode[], edges: LineageEdge[]) {
  const layout = computeSimpleLayout(nodes, edges);
  const positions = new Map(layout.map(node => [node.id, node]));

  const maxX = Math.max(...layout.map(node => node.x + NODE_W), 480) + PADDING;
  const maxY = Math.max(...layout.map(node => node.y + NODE_H), 280) + PADDING;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">`
  );
  parts.push(
    `<rect width="100%" height="100%" fill="#fffaf4" rx="24" ry="24"/>`
  );

  for (const edge of edges) {
    const from = positions.get(edge.fromId);
    const to = positions.get(edge.toId);
    if (!from || !to) continue;

    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;

    parts.push(
      `<path d="M ${x1} ${y1} C ${x1 + 36} ${y1}, ${x2 - 36} ${y2}, ${x2} ${y2}" stroke="#b09a86" stroke-width="1.2" fill="none" marker-end="url(#arrow)"/>`
    );
  }

  parts.push(
    `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#b09a86"/></marker></defs>`
  );

  for (const layoutNode of layout) {
    const meta = getLineageTypeMeta(layoutNode.node.type);
    const label =
      layoutNode.node.sourceName ??
      layoutNode.node.agentId ??
      layoutNode.node.decisionId ??
      layoutNode.id.slice(0, 8);
    const safeLabel = label
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

    parts.push(
      `<rect x="${layoutNode.x}" y="${layoutNode.y}" width="${NODE_W}" height="${NODE_H}" rx="14" fill="${meta.softColor}" stroke="${meta.borderColor}" stroke-width="1.2"/>`
    );
    parts.push(
      `<text x="${layoutNode.x + 12}" y="${layoutNode.y + 18}" font-size="10" font-weight="700" fill="${meta.color}">${meta.shortLabel}</text>`
    );
    parts.push(
      `<text x="${layoutNode.x + 12}" y="${layoutNode.y + 34}" font-size="12" font-weight="600" fill="#4A3727">${safeLabel}</text>`
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}

export interface LineageExportButtonProps {
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export default function LineageExportButton({
  canvasRef,
}: LineageExportButtonProps) {
  const graph = useLineageStore(state => state.graph);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const exportPNG = useCallback(() => {
    const canvas = canvasRef?.current;
    if (!canvas) return;

    canvas.toBlob(blob => {
      if (!blob) return;
      download(blob, "lineage-dag.png");
    }, "image/png");
    setOpen(false);
  }, [canvasRef]);

  const exportSVG = useCallback(() => {
    if (!graph) return;
    const svg = generateSVG(graph.nodes, graph.edges);
    download(new Blob([svg], { type: "image/svg+xml" }), "lineage-dag.svg");
    setOpen(false);
  }, [graph]);

  const disabled = !graph || graph.nodes.length === 0;

  return (
    <div ref={containerRef} className="relative inline-flex">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className={cn(
          "workspace-control rounded-full px-3.5 text-xs font-semibold",
          disabled && "cursor-not-allowed opacity-60"
        )}
        onClick={() => setOpen(current => !current)}
      >
        <Download className="size-4" />
        Export
        <ChevronDown className="size-4" />
      </Button>

      {open ? (
        <div className="workspace-panel workspace-panel-strong absolute right-0 top-[calc(100%+8px)] z-20 min-w-[170px] rounded-[22px] p-1.5">
          <button
            type="button"
            disabled={!canvasRef?.current}
            className="flex w-full items-center justify-between rounded-[16px] px-3 py-2 text-left text-sm font-medium text-[var(--workspace-text)] transition hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-45"
            onClick={exportPNG}
          >
            Export PNG
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
              Canvas
            </span>
          </button>
          <button
            type="button"
            className="mt-1 flex w-full items-center justify-between rounded-[16px] px-3 py-2 text-left text-sm font-medium text-[var(--workspace-text)] transition hover:bg-white/60"
            onClick={exportSVG}
          >
            Export SVG
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
              Vector
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
