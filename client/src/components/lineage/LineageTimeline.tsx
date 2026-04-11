import { useCallback, useEffect, useRef, useState } from "react";

import type { DataLineageNode } from "@shared/lineage/contracts.js";

import { useLineageStore } from "@/lib/lineage-store";

import { LINEAGE_NEUTRAL, getLineageTypeMeta } from "./lineage-theme";

const LANE_ORDER = ["source", "transformation", "decision"] as const;
const LANE_HEIGHT = 84;
const HEADER_WIDTH = 108;
const NODE_RADIUS = 16;
const TOP_PADDING = 42;

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}

function truncateLabel(label: string, limit: number) {
  if (label.length <= limit) return label;
  return `${label.slice(0, Math.max(limit - 1, 3))}\u2026`;
}

export default function LineageTimeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const graph = useLineageStore(state => state.graph);
  const selectedNodeId = useLineageStore(state => state.selectedNodeId);
  const selectNode = useLineageStore(state => state.selectNode);

  const [scrollX, setScrollX] = useState(0);
  const sortedNodesRef = useRef<DataLineageNode[]>([]);

  useEffect(() => {
    sortedNodesRef.current = graph
      ? [...graph.nodes].sort((a, b) => a.timestamp - b.timestamp)
      : [];
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

    const nodes = sortedNodesRef.current;
    if (nodes.length === 0) return;

    const minTimestamp = nodes[0].timestamp;
    const maxTimestamp = nodes[nodes.length - 1].timestamp;
    const timestampRange = Math.max(maxTimestamp - minTimestamp, 1);
    const contentWidth = Math.max(rect.width - HEADER_WIDTH - 52, 480);

    LANE_ORDER.forEach((type, index) => {
      const meta = getLineageTypeMeta(type);
      const top = TOP_PADDING + index * LANE_HEIGHT;

      context.fillStyle =
        index % 2 === 0
          ? LINEAGE_NEUTRAL.canvasLaneEven
          : LINEAGE_NEUTRAL.canvasLaneOdd;
      context.fillRect(0, top, rect.width, LANE_HEIGHT);

      context.strokeStyle = LINEAGE_NEUTRAL.canvasGrid;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, top);
      context.lineTo(rect.width, top);
      context.stroke();

      context.fillStyle = meta.color;
      context.font = "700 11px 'DM Sans', sans-serif";
      context.fillText(meta.label, 12, top + LANE_HEIGHT / 2 - 4);
      context.fillStyle = LINEAGE_NEUTRAL.textSubtle;
      context.font = "600 9px 'JetBrains Mono', monospace";
      context.fillText(meta.shortLabel, 12, top + LANE_HEIGHT / 2 + 12);
    });

    const axisY = TOP_PADDING - 10;
    context.strokeStyle = LINEAGE_NEUTRAL.canvasGrid;
    context.beginPath();
    context.moveTo(HEADER_WIDTH, axisY);
    context.lineTo(rect.width - 24, axisY);
    context.stroke();

    const tickCount = Math.min(nodes.length, 8);
    context.fillStyle = LINEAGE_NEUTRAL.textSubtle;
    context.font = "500 10px 'JetBrains Mono', monospace";
    for (let index = 0; index <= tickCount; index += 1) {
      const timestamp = minTimestamp + (timestampRange * index) / tickCount;
      const x =
        HEADER_WIDTH +
        ((timestamp - minTimestamp) / timestampRange) * contentWidth +
        scrollX;
      if (x < HEADER_WIDTH - 24 || x > rect.width - 12) continue;

      context.fillText(formatTime(timestamp), x - 24, axisY - 6);
      context.beginPath();
      context.moveTo(x, axisY);
      context.lineTo(x, axisY + 6);
      context.stroke();
    }

    for (const node of nodes) {
      const laneIndex = LANE_ORDER.indexOf(node.type);
      if (laneIndex < 0) continue;

      const meta = getLineageTypeMeta(node.type);
      const x =
        HEADER_WIDTH +
        ((node.timestamp - minTimestamp) / timestampRange) * contentWidth +
        scrollX;
      const y = TOP_PADDING + laneIndex * LANE_HEIGHT + LANE_HEIGHT / 2;

      if (x < HEADER_WIDTH - NODE_RADIUS || x > rect.width + NODE_RADIUS) {
        continue;
      }

      const isSelected = node.lineageId === selectedNodeId;

      context.beginPath();
      context.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
      context.fillStyle = isSelected ? meta.color : meta.softColor;
      context.fill();
      context.strokeStyle = isSelected ? meta.color : meta.borderColor;
      context.lineWidth = isSelected ? 2.6 : 1.2;
      context.stroke();

      const label =
        node.sourceName ?? node.agentId ?? node.decisionId ?? node.lineageId;
      const shortLabel = truncateLabel(label, 8);
      const labelWidth = context.measureText(shortLabel).width;

      context.fillStyle = isSelected ? "#fffaf4" : LINEAGE_NEUTRAL.text;
      context.font = "700 9px 'DM Sans', sans-serif";
      context.fillText(shortLabel, x - labelWidth / 2, y + 3);
    }
  }, [graph, scrollX, selectedNodeId]);

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
    setScrollX(current => current - event.deltaX - event.deltaY);
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const nodes = sortedNodesRef.current;
      if (nodes.length === 0) return;

      const minTimestamp = nodes[0].timestamp;
      const maxTimestamp = nodes[nodes.length - 1].timestamp;
      const timestampRange = Math.max(maxTimestamp - minTimestamp, 1);
      const contentWidth = Math.max(rect.width - HEADER_WIDTH - 52, 480);

      for (const node of nodes) {
        const laneIndex = LANE_ORDER.indexOf(node.type);
        if (laneIndex < 0) continue;

        const x =
          HEADER_WIDTH +
          ((node.timestamp - minTimestamp) / timestampRange) * contentWidth +
          scrollX;
        const y = TOP_PADDING + laneIndex * LANE_HEIGHT + LANE_HEIGHT / 2;
        const distance = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
        if (distance > NODE_RADIUS + 4) continue;

        selectNode(node.lineageId === selectedNodeId ? null : node.lineageId);
        return;
      }

      selectNode(null);
    },
    [scrollX, selectNode, selectedNodeId]
  );

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--workspace-text-subtle)]">
        No timeline data yet.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full rounded-[24px]"
      style={{ minHeight: TOP_PADDING + LANE_ORDER.length * LANE_HEIGHT + 12 }}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-default"
        onWheel={handleWheel}
        onClick={handleClick}
      />
    </div>
  );
}
