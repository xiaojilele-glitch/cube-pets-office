/**
 * LineageTimeline — Time axis view showing data flow in execution order.
 *
 * Nodes arranged horizontally by timestamp, with vertical lanes for
 * different node types (source / transformation / decision).
 *
 * @see Requirements AC-7.3
 */

import { useRef, useEffect, useCallback, useState } from "react";
import type { DataLineageNode } from "@shared/lineage/contracts.js";
import { useLineageStore } from "@/lib/lineage-store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANE_LABELS: Record<string, string> = {
  source: "Source",
  transformation: "Transform",
  decision: "Decision",
};

const LANE_COLORS: Record<string, string> = {
  source: "#3B82F6",
  transformation: "#10B981",
  decision: "#F59E0B",
};

const LANE_ORDER = ["source", "transformation", "decision"];
const LANE_HEIGHT = 60;
const HEADER_W = 90;
const NODE_R = 14;
const TOP_PAD = 36;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LineageTimeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const graph = useLineageStore((s) => s.graph);
  const selectedNodeId = useLineageStore((s) => s.selectedNodeId);
  const selectNode = useLineageStore((s) => s.selectNode);

  const [scrollX, setScrollX] = useState(0);

  // Sorted nodes by timestamp
  const sortedNodes = useRef<DataLineageNode[]>([]);
  useEffect(() => {
    if (graph) {
      sortedNodes.current = [...graph.nodes].sort((a, b) => a.timestamp - b.timestamp);
    } else {
      sortedNodes.current = [];
    }
  }, [graph]);

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

    const nodes = sortedNodes.current;
    if (nodes.length === 0) return;

    const minTs = nodes[0].timestamp;
    const maxTs = nodes[nodes.length - 1].timestamp;
    const range = Math.max(maxTs - minTs, 1);
    const contentW = Math.max(rect.width - HEADER_W - 40, 400);

    // Lane backgrounds
    LANE_ORDER.forEach((type, i) => {
      const y = TOP_PAD + i * LANE_HEIGHT;
      ctx.fillStyle = i % 2 === 0 ? "#f9fafb" : "#ffffff";
      ctx.fillRect(0, y, rect.width, LANE_HEIGHT);

      // Lane label
      ctx.fillStyle = LANE_COLORS[type] ?? "#6b7280";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText(LANE_LABELS[type] ?? type, 8, y + LANE_HEIGHT / 2 + 4);
    });

    // Time axis
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    const axisY = TOP_PAD - 4;
    ctx.beginPath();
    ctx.moveTo(HEADER_W, axisY);
    ctx.lineTo(rect.width - 20, axisY);
    ctx.stroke();

    // Time ticks
    const tickCount = Math.min(nodes.length, 8);
    ctx.fillStyle = "#9ca3af";
    ctx.font = "9px sans-serif";
    for (let i = 0; i <= tickCount; i++) {
      const t = minTs + (range * i) / tickCount;
      const x = HEADER_W + ((t - minTs) / range) * contentW + scrollX;
      if (x < HEADER_W || x > rect.width - 20) continue;
      ctx.fillText(fmtTime(t), x - 16, axisY - 4);
      ctx.beginPath();
      ctx.moveTo(x, axisY);
      ctx.lineTo(x, axisY + 4);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      const laneIdx = LANE_ORDER.indexOf(node.type);
      if (laneIdx < 0) continue;
      const x = HEADER_W + ((node.timestamp - minTs) / range) * contentW + scrollX;
      const y = TOP_PAD + laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;

      if (x < HEADER_W - NODE_R || x > rect.width) continue;

      const isSelected = node.lineageId === selectedNodeId;
      const color = LANE_COLORS[node.type] ?? "#6b7280";

      ctx.beginPath();
      ctx.arc(x, y, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? color : color + "44";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.stroke();

      // Tiny label
      ctx.fillStyle = isSelected ? "#fff" : "#374151";
      ctx.font = "8px sans-serif";
      const label = node.sourceName ?? node.agentId ?? node.decisionId ?? "";
      const short = label.length > 6 ? label.slice(0, 5) + "…" : label;
      const tw = ctx.measureText(short).width;
      ctx.fillText(short, x - tw / 2, y + 3);
    }
  }, [graph, selectedNodeId, scrollX]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScrollX((s) => s - e.deltaX - e.deltaY);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !graph) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const nodes = sortedNodes.current;
      if (nodes.length === 0) return;
      const minTs = nodes[0].timestamp;
      const maxTs = nodes[nodes.length - 1].timestamp;
      const range = Math.max(maxTs - minTs, 1);
      const contentW = Math.max(rect.width - HEADER_W - 40, 400);

      for (const node of nodes) {
        const laneIdx = LANE_ORDER.indexOf(node.type);
        if (laneIdx < 0) continue;
        const x = HEADER_W + ((node.timestamp - minTs) / range) * contentW + scrollX;
        const y = TOP_PAD + laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;
        const dist = Math.sqrt((mx - x) ** 2 + (my - y) ** 2);
        if (dist <= NODE_R + 4) {
          selectNode(node.lineageId === selectedNodeId ? null : node.lineageId);
          return;
        }
      }
      selectNode(null);
    },
    [graph, scrollX, selectNode, selectedNodeId],
  );

  if (!graph || graph.nodes.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
        No timeline data
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: TOP_PAD + LANE_ORDER.length * LANE_HEIGHT + 8 }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", cursor: "default" }}
        onWheel={handleWheel}
        onClick={handleClick}
      />
    </div>
  );
}
