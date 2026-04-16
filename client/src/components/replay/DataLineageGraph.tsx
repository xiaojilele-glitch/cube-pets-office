/**
 * DataLineageGraph — SVG-based directed graph for data lineage visualization.
 *
 * Builds lineage graph from events, renders nodes and edges as SVG.
 * Click a node to trace its lineage chain.
 *
 * Requirements: 10.1, 10.2, 10.4
 */

import { useCallback, useMemo, useState } from "react";

import type {
  ExecutionEvent,
  LineageNode,
} from "../../../../shared/replay/contracts";
import { DataLineageTracker } from "@/lib/replay/data-lineage";

export interface DataLineageGraphProps {
  events: ExecutionEvent[];
}

export function DataLineageGraph({ events }: DataLineageGraphProps) {
  const tracker = useMemo(() => new DataLineageTracker(), []);
  const graph = useMemo(
    () => tracker.buildLineageGraph(events),
    [tracker, events]
  );
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const chain = tracker.traceDataPoint(nodeId);
      setHighlighted(new Set(chain.nodes.map(n => n.id)));
    },
    [tracker]
  );

  // Simple layout: arrange nodes in a grid by timestamp order
  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const sorted = [...graph.nodes].sort((a, b) => a.timestamp - b.timestamp);
    const cols = Math.max(Math.ceil(Math.sqrt(sorted.length)), 1);
    sorted.forEach((node, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.set(node.id, { x: 40 + col * 100, y: 30 + row * 60 });
    });
    return positions;
  }, [graph.nodes]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-white/40">
        No lineage data
      </div>
    );
  }

  const svgWidth = Math.max(
    200,
    (Math.ceil(Math.sqrt(graph.nodes.length)) + 1) * 100
  );
  const svgHeight = Math.max(
    120,
    (Math.ceil(graph.nodes.length / Math.ceil(Math.sqrt(graph.nodes.length))) +
      1) *
      60
  );

  return (
    <div className="h-full overflow-auto rounded-lg border border-white/10 bg-[#1a1a2e]/95 backdrop-blur">
      <p className="px-3 pt-2 text-[11px] font-semibold text-white/80">
        Data Lineage
      </p>
      <svg
        width={svgWidth}
        height={svgHeight}
        className="min-h-full min-w-full"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#60a5fa" />
          </marker>
        </defs>

        {/* Edges */}
        {graph.edges.map((edge, i) => {
          const from = nodePositions.get(edge.from);
          const to = nodePositions.get(edge.to);
          if (!from || !to) return null;
          const isHighlighted =
            highlighted.has(edge.from) && highlighted.has(edge.to);
          return (
            <line
              key={`e-${i}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={isHighlighted ? "#f59e0b" : "#60a5fa"}
              strokeWidth={isHighlighted ? 2 : 1}
              opacity={isHighlighted ? 1 : 0.4}
              markerEnd="url(#arrow)"
            />
          );
        })}

        {/* Nodes */}
        {graph.nodes.map(node => {
          const pos = nodePositions.get(node.id);
          if (!pos) return null;
          const isHighlighted2 = highlighted.has(node.id);
          return (
            <g
              key={node.id}
              onClick={() => handleNodeClick(node.id)}
              className="cursor-pointer"
            >
              <circle
                cx={pos.x}
                cy={pos.y}
                r={10}
                fill={isHighlighted2 ? "#f59e0b" : "#3b82f6"}
                opacity={isHighlighted2 ? 1 : 0.7}
              />
              <text
                x={pos.x}
                y={pos.y + 22}
                textAnchor="middle"
                fontSize={8}
                fill="#aaa"
              >
                {node.agentId.slice(0, 8)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
