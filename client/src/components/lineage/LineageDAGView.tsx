/**
 * LineageDAGView — Canvas 2D DAG visualization for data lineage.
 *
 * Renders lineage nodes as a layered DAG with:
 * - Nodes colored by type: source=blue, transformation=green, decision=orange
 * - Directed edges with arrows
 * - Click-to-select with full path highlighting
 * - Zoom (mouse wheel) and pan (drag)
 *
 * @see Requirements AC-7.1, AC-7.2
 */

import { useRef, useEffect, useCallback, useState } from "react";
import type { DataLineageNode, LineageEdge } from "@shared/lineage/contracts.js";
import { useLineageStore } from "@/lib/lineage-store";

// ---------------------------------------------------------------------------
// Constants
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

const TYPE_LABELS: Record<string, string> = {
  source: "SRC",
  transformation: "TFM",
  decision: "DEC",
};

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

interface LayoutNode {
  id: string;
  node: DataLineageNode;
  layer: number;
  laneIdx: number;
  x: number;
  y: number;
}

/** Topological sort + layer assignment for DAG layout. */
function computeLayout(
  nodes: DataLineageNode[],
  edges: LineageEdge[],
): LayoutNode[] {
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

  // BFS topological sort
  const queue: string[] = [];
  const layerOf = new Map<string, number>();
  for (const [id, deg] of inDeg) {
    if (deg === 0) {
      queue.push(id);
      layerOf.set(id, 0);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curLayer = layerOf.get(cur) ?? 0;
    for (const next of adj.get(cur) ?? []) {
      const newLayer = curLayer + 1;
      layerOf.set(next, Math.max(layerOf.get(next) ?? 0, newLayer));
      inDeg.set(next, (inDeg.get(next) ?? 0) - 1);
      if (inDeg.get(next) === 0) queue.push(next);
    }
  }

  // Assign layers for any unvisited nodes (cycles / disconnected)
  for (const n of nodes) {
    if (!layerOf.has(n.lineageId)) layerOf.set(n.lineageId, 0);
  }

  // Group by layer, assign lane index
  const layers = new Map<number, DataLineageNode[]>();
  for (const n of nodes) {
    const l = layerOf.get(n.lineageId) ?? 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(n);
  }

  const result: LayoutNode[] = [];
  for (const [layer, group] of layers) {
    group.forEach((node, idx) => {
      result.push({
        id: node.lineageId,
        node,
        layer,
        laneIdx: idx,
        x: PADDING + layer * LAYER_GAP_X,
        y: PADDING + idx * LANE_GAP_Y,
      });
    });
  }
  return result;
}

/** Collect all node IDs on the full path (upstream + downstream) of a selected node. */
function collectPathIds(
  selectedId: string,
  nodes: DataLineageNode[],
  edges: LineageEdge[],
): Set<string> {
  const nodeSet = new Set(nodes.map((n) => n.lineageId));
  const fwd = new Map<string, string[]>();
  const bwd = new Map<string, string[]>();
  for (const e of edges) {
    if (nodeSet.has(e.fromId) && nodeSet.has(e.toId)) {
      if (!fwd.has(e.fromId)) fwd.set(e.fromId, []);
      fwd.get(e.fromId)!.push(e.toId);
      if (!bwd.has(e.toId)) bwd.set(e.toId, []);
      bwd.get(e.toId)!.push(e.fromId);
    }
  }

  const visited = new Set<string>();
  const bfs = (start: string, adjMap: Map<string, string[]>) => {
    const q = [start];
    let h = 0;
    while (h < q.length) {
      const c = q[h++];
      if (visited.has(c)) continue;
      visited.add(c);
      for (const nb of adjMap.get(c) ?? []) q.push(nb);
    }
  };
  bfs(selectedId, fwd);
  bfs(selectedId, bwd);
  return visited;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LineageDAGView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const graph = useLineageStore((s) => s.graph);
  const selectedNodeId = useLineageStore((s) => s.selectedNodeId);
  const selectNode = useLineageStore((s) => s.selectNode);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const layoutRef = useRef<LayoutNode[]>([]);

  // Recompute layout when graph changes
  useEffect(() => {
    if (graph) {
      layoutRef.current = computeLayout(graph.nodes, graph.edges);
    } else {
      layoutRef.current = [];
    }
  }, [graph]);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    const layout = layoutRef.current;
    const posMap = new Map(layout.map((l) => [l.id, l]));
    const nodes = graph?.nodes ?? [];
    const edges = graph?.edges ?? [];

    const highlightIds = selectedNodeId
      ? collectPathIds(selectedNodeId, nodes, edges)
      : null;

    // Draw edges
    for (const edge of edges) {
      const from = posMap.get(edge.fromId);
      const to = posMap.get(edge.toId);
      if (!from || !to) continue;

      const isHighlighted =
        highlightIds && highlightIds.has(edge.fromId) && highlightIds.has(edge.toId);
      const dimmed = highlightIds && !isHighlighted;

      ctx.beginPath();
      ctx.strokeStyle = dimmed ? "#e5e7eb" : "#94a3b8";
      ctx.lineWidth = isHighlighted ? 2 : 1;
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Arrow head
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const arrowLen = 8;
      ctx.beginPath();
      ctx.fillStyle = dimmed ? "#e5e7eb" : "#94a3b8";
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - arrowLen * Math.cos(angle - Math.PI / 6),
        y2 - arrowLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        x2 - arrowLen * Math.cos(angle + Math.PI / 6),
        y2 - arrowLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.fill();
    }

    // Draw nodes
    for (const ln of layout) {
      const isSelected = ln.id === selectedNodeId;
      const dimmed = highlightIds && !highlightIds.has(ln.id);
      const color = TYPE_COLORS[ln.node.type] ?? "#6b7280";

      // Node rect
      ctx.beginPath();
      ctx.roundRect(ln.x, ln.y, NODE_W, NODE_H, 6);
      ctx.fillStyle = dimmed ? "#f3f4f6" : color + "22";
      ctx.fill();
      ctx.strokeStyle = isSelected ? color : dimmed ? "#e5e7eb" : color + "88";
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.stroke();

      // Type badge
      ctx.fillStyle = dimmed ? "#d1d5db" : color;
      ctx.font = "bold 9px sans-serif";
      ctx.fillText(TYPE_LABELS[ln.node.type] ?? "?", ln.x + 6, ln.y + 14);

      // Label
      ctx.fillStyle = dimmed ? "#d1d5db" : "#1f2937";
      ctx.font = "11px sans-serif";
      const label =
        ln.node.sourceName ?? ln.node.agentId ?? ln.node.decisionId ?? ln.id.slice(0, 8);
      const maxTextW = NODE_W - 12;
      let displayLabel = label;
      while (ctx.measureText(displayLabel).width > maxTextW && displayLabel.length > 4) {
        displayLabel = displayLabel.slice(0, -2) + "…";
      }
      ctx.fillText(displayLabel, ln.x + 6, ln.y + 32);
    }

    ctx.restore();
  }, [graph, selectedNodeId, offset, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // --- Interaction handlers ---

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(3, z - e.deltaY * 0.001)));
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 0) {
        setDragging(true);
        setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      }
    },
    [offset],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging) {
        setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
      }
    },
    [dragging, dragStart],
  );

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - offset.x) / zoom;
      const my = (e.clientY - rect.top - offset.y) / zoom;

      for (const ln of layoutRef.current) {
        if (mx >= ln.x && mx <= ln.x + NODE_W && my >= ln.y && my <= ln.y + NODE_H) {
          selectNode(ln.id === selectedNodeId ? null : ln.id);
          return;
        }
      }
      selectNode(null);
    },
    [offset, zoom, selectNode, selectedNodeId],
  );

  if (!graph || graph.nodes.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
        No lineage data to display
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", cursor: dragging ? "grabbing" : "grab" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      />
      {/* Legend */}
      <div style={{ position: "absolute", bottom: 8, left: 8, display: "flex", gap: 12, fontSize: 11, color: "#6b7280" }}>
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <span key={type} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
