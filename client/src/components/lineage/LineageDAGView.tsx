import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DataLineageNode,
  LineageEdge,
} from "@shared/lineage/contracts.js";

import { useLineageStore } from "@/lib/lineage-store";
import { cn } from "@/lib/utils";

import { LINEAGE_NEUTRAL, getLineageTypeMeta } from "./lineage-theme";

const NODE_W = 152;
const NODE_H = 52;
const LAYER_GAP_X = 220;
const LANE_GAP_Y = 86;
const PADDING = 72;

interface LayoutNode {
  id: string;
  node: DataLineageNode;
  layer: number;
  laneIdx: number;
  x: number;
  y: number;
}

function computeLayout(
  nodes: DataLineageNode[],
  edges: LineageEdge[]
): LayoutNode[] {
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

  for (const [nodeId, degree] of Array.from(inDegree.entries())) {
    if (degree !== 0) continue;
    queue.push(nodeId);
    layerByNodeId.set(nodeId, 0);
  }

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
  for (const [layer, group] of Array.from(layers.entries())) {
    group.forEach((node: DataLineageNode, index: number) => {
      result.push({
        id: node.lineageId,
        node,
        layer,
        laneIdx: index,
        x: PADDING + layer * LAYER_GAP_X,
        y: PADDING + index * LANE_GAP_Y,
      });
    });
  }

  return result;
}

function collectPathIds(
  selectedId: string,
  nodes: DataLineageNode[],
  edges: LineageEdge[]
) {
  const nodeIds = new Set(nodes.map(node => node.lineageId));
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) continue;

    if (!forward.has(edge.fromId)) forward.set(edge.fromId, []);
    if (!backward.has(edge.toId)) backward.set(edge.toId, []);
    forward.get(edge.fromId)?.push(edge.toId);
    backward.get(edge.toId)?.push(edge.fromId);
  }

  const visited = new Set<string>();

  const walk = (start: string, adjacency: Map<string, string[]>) => {
    const queue = [start];
    let index = 0;

    while (index < queue.length) {
      const current = queue[index++];
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(adjacency.get(current) ?? []));
    }
  };

  walk(selectedId, forward);
  walk(selectedId, backward);

  return visited;
}

function truncateLabel(label: string, limit: number) {
  if (label.length <= limit) return label;
  return `${label.slice(0, Math.max(limit - 1, 3))}\u2026`;
}

export interface LineageDAGViewProps {
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export default function LineageDAGView({
  canvasRef: externalCanvasRef,
}: LineageDAGViewProps) {
  const internalCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = externalCanvasRef ?? internalCanvasRef;
  const containerRef = useRef<HTMLDivElement>(null);

  const graph = useLineageStore(state => state.graph);
  const selectedNodeId = useLineageStore(state => state.selectedNodeId);
  const selectNode = useLineageStore(state => state.selectNode);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [dragOrigin, setDragOrigin] = useState({ x: 0, y: 0 });

  const layoutRef = useRef<LayoutNode[]>([]);

  useEffect(() => {
    layoutRef.current = graph ? computeLayout(graph.nodes, graph.edges) : [];
  }, [graph]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);

    context.save();
    context.translate(offset.x, offset.y);
    context.scale(zoom, zoom);

    const nodes = graph?.nodes ?? [];
    const edges = graph?.edges ?? [];
    const positions = new Map(layoutRef.current.map(node => [node.id, node]));
    const highlightedIds = selectedNodeId
      ? collectPathIds(selectedNodeId, nodes, edges)
      : null;

    for (const edge of edges) {
      const from = positions.get(edge.fromId);
      const to = positions.get(edge.toId);
      if (!from || !to) continue;

      const isHighlighted =
        highlightedIds &&
        highlightedIds.has(edge.fromId) &&
        highlightedIds.has(edge.toId);
      const isDimmed = highlightedIds !== null && !isHighlighted;

      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;

      context.beginPath();
      context.strokeStyle = isDimmed
        ? LINEAGE_NEUTRAL.canvasEdgeMuted
        : LINEAGE_NEUTRAL.canvasEdge;
      context.lineWidth = isHighlighted ? 2.2 : 1.1;
      context.moveTo(x1, y1);
      context.bezierCurveTo(x1 + 36, y1, x2 - 36, y2, x2, y2);
      context.stroke();

      const angle = Math.atan2(y2 - y1, x2 - x1);
      context.beginPath();
      context.fillStyle = isDimmed
        ? LINEAGE_NEUTRAL.canvasEdgeMuted
        : LINEAGE_NEUTRAL.canvasEdge;
      context.moveTo(x2, y2);
      context.lineTo(
        x2 - 10 * Math.cos(angle - Math.PI / 7),
        y2 - 10 * Math.sin(angle - Math.PI / 7)
      );
      context.lineTo(
        x2 - 10 * Math.cos(angle + Math.PI / 7),
        y2 - 10 * Math.sin(angle + Math.PI / 7)
      );
      context.closePath();
      context.fill();
    }

    for (const layoutNode of layoutRef.current) {
      const meta = getLineageTypeMeta(layoutNode.node.type);
      const isSelected = layoutNode.id === selectedNodeId;
      const isDimmed =
        highlightedIds !== null && !highlightedIds.has(layoutNode.id);

      context.beginPath();
      context.roundRect(layoutNode.x, layoutNode.y, NODE_W, NODE_H, 14);
      context.fillStyle = isDimmed ? "#f6efe7" : meta.softColor;
      context.fill();
      context.strokeStyle = isSelected
        ? meta.color
        : isDimmed
          ? LINEAGE_NEUTRAL.canvasEdgeMuted
          : meta.borderColor;
      context.lineWidth = isSelected ? 2.4 : 1.2;
      context.stroke();

      context.fillStyle = isDimmed ? LINEAGE_NEUTRAL.empty : meta.color;
      context.font = "700 10px 'DM Sans', sans-serif";
      context.fillText(meta.shortLabel, layoutNode.x + 12, layoutNode.y + 18);

      const label =
        layoutNode.node.sourceName ??
        layoutNode.node.agentId ??
        layoutNode.node.decisionId ??
        layoutNode.id.slice(0, 8);
      const shortLabel = truncateLabel(label, 20);

      context.fillStyle = isDimmed
        ? LINEAGE_NEUTRAL.textSubtle
        : LINEAGE_NEUTRAL.text;
      context.font = "600 12px 'DM Sans', sans-serif";
      context.fillText(shortLabel, layoutNode.x + 12, layoutNode.y + 34);

      context.fillStyle = LINEAGE_NEUTRAL.textMuted;
      context.font = "500 10px 'JetBrains Mono', monospace";
      context.fillText(
        truncateLabel(layoutNode.id, 18),
        layoutNode.x + 12,
        layoutNode.y + 46
      );
    }

    context.restore();
  }, [canvasRef, graph, offset, selectedNodeId, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => draw());
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [draw]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    setZoom(currentZoom =>
      Math.max(0.28, Math.min(2.5, currentZoom - event.deltaY * 0.001))
    );
  }, []);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      setDragging(true);
      setDragOrigin({
        x: event.clientX - offset.x,
        y: event.clientY - offset.y,
      });
    },
    [offset.x, offset.y]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!dragging) return;
      setOffset({
        x: event.clientX - dragOrigin.x,
        y: event.clientY - dragOrigin.y,
      });
    },
    [dragOrigin.x, dragOrigin.y, dragging]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = (event.clientX - rect.left - offset.x) / zoom;
      const mouseY = (event.clientY - rect.top - offset.y) / zoom;

      for (const node of layoutRef.current) {
        const withinX = mouseX >= node.x && mouseX <= node.x + NODE_W;
        const withinY = mouseY >= node.y && mouseY <= node.y + NODE_H;
        if (!withinX || !withinY) continue;
        selectNode(node.id === selectedNodeId ? null : node.id);
        return;
      }

      selectNode(null);
    },
    [canvasRef, offset.x, offset.y, selectNode, selectedNodeId, zoom]
  );

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--workspace-text-subtle)]">
        No lineage data to display yet.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-[24px]"
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "h-full w-full",
          dragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      />

      <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2">
        {(["source", "transformation", "decision"] as const).map(type => {
          const meta = getLineageTypeMeta(type);

          return (
            <span
              key={type}
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
          );
        })}
      </div>
    </div>
  );
}
