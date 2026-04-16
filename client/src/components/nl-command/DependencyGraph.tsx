import { useMemo } from "react";
import type { NLExecutionPlan } from "@shared/nl-command/contracts";

/**
 * Dependency graph component rendering missions/tasks as nodes
 * and dependencies as edges using SVG with a simple layered layout.
 *
 * @see Requirements 6.2
 */
export interface DependencyGraphProps {
  plan: NLExecutionPlan;
}

const NODE_W = 120;
const NODE_H = 32;
const GAP_X = 160;
const GAP_Y = 50;
const PAD = 20;

export function DependencyGraph({ plan }: DependencyGraphProps) {
  const { nodes, edges, width, height } = useMemo(() => {
    const entries = plan.timeline?.entries ?? [];
    if (entries.length === 0)
      return { nodes: [], edges: [], width: 0, height: 0 };

    // Build label map
    const labelMap = new Map<string, string>();
    for (const m of plan.missions) labelMap.set(m.missionId, m.title);
    for (const t of plan.tasks) labelMap.set(t.taskId, t.title);

    // Group by parallelGroup for layered layout
    const groups = new Map<number, string[]>();
    for (const e of entries) {
      const g = e.parallelGroup ?? 0;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(e.entityId);
    }
    const sortedLayers = [...groups.keys()].sort((a, b) => a - b);

    // Position nodes
    const posMap = new Map<string, { x: number; y: number }>();
    const nodeList: {
      id: string;
      label: string;
      x: number;
      y: number;
      critical: boolean;
    }[] = [];
    let maxX = 0;
    let maxY = 0;
    for (let li = 0; li < sortedLayers.length; li++) {
      const ids = groups.get(sortedLayers[li])!;
      for (let ni = 0; ni < ids.length; ni++) {
        const x = PAD + li * GAP_X;
        const y = PAD + ni * GAP_Y;
        posMap.set(ids[ni], { x, y });
        const entry = entries.find(e => e.entityId === ids[ni]);
        nodeList.push({
          id: ids[ni],
          label: labelMap.get(ids[ni]) ?? ids[ni],
          x,
          y,
          critical: entry?.isCriticalPath ?? false,
        });
        maxX = Math.max(maxX, x + NODE_W);
        maxY = Math.max(maxY, y + NODE_H);
      }
    }

    // Build edges from timeline ordering (dependencies implied by execution order)
    const edgeList: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let li = 1; li < sortedLayers.length; li++) {
      const prevIds = groups.get(sortedLayers[li - 1])!;
      const curIds = groups.get(sortedLayers[li])!;
      for (const cid of curIds) {
        const to = posMap.get(cid)!;
        for (const pid of prevIds) {
          const from = posMap.get(pid)!;
          edgeList.push({
            x1: from.x + NODE_W,
            y1: from.y + NODE_H / 2,
            x2: to.x,
            y2: to.y + NODE_H / 2,
          });
        }
      }
    }

    return {
      nodes: nodeList,
      edges: edgeList,
      width: maxX + PAD,
      height: maxY + PAD,
    };
  }, [plan]);

  if (nodes.length === 0) {
    return (
      <div className="p-4 text-sm text-stone-400">
        No dependency data available.
      </div>
    );
  }

  return (
    <div
      className="overflow-auto rounded border border-stone-200"
      style={{ maxHeight: 360 }}
    >
      <svg width={width} height={height} className="block">
        <defs>
          <marker
            id="dep-arrow"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L8,3 L0,6 Z" fill="#94a3b8" />
          </marker>
        </defs>
        {edges.map((e, i) => (
          <line
            key={i}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke="#94a3b8"
            strokeWidth={1.5}
            markerEnd="url(#dep-arrow)"
          />
        ))}
        {nodes.map(n => (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={NODE_W}
              height={NODE_H}
              rx={6}
              fill={n.critical ? "#fecdd3" : "#e0e7ff"}
              stroke={n.critical ? "#e11d48" : "#6366f1"}
              strokeWidth={1.5}
            />
            <text
              x={n.x + NODE_W / 2}
              y={n.y + NODE_H / 2 + 4}
              textAnchor="middle"
              fontSize={10}
              fill="#1e293b"
              className="select-none"
            >
              {n.label.length > 14 ? n.label.slice(0, 13) + "…" : n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
