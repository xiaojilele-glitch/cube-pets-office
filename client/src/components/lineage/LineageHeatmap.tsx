/**
 * LineageHeatmap — Heatmap marking high-frequency data sources and key agents.
 *
 * Grid layout: rows = agents/sources, columns = time buckets.
 * Color depth represents importance (frequency of access).
 *
 * @see Requirements AC-7.4
 */

import { useMemo } from "react";
import type { DataLineageNode } from "@shared/lineage/contracts.js";
import { useLineageStore } from "@/lib/lineage-store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIME_BUCKETS = 10;
const CELL_W = 48;
const CELL_H = 32;
const LABEL_W = 120;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function interpolateColor(ratio: number): string {
  // 0 → light gray, 1 → deep blue
  const r = Math.round(219 - ratio * 160);
  const g = Math.round(234 - ratio * 140);
  const b = Math.round(254 - ratio * 40);
  return `rgb(${r},${g},${b})`;
}

interface HeatmapData {
  rowLabels: string[];
  colLabels: string[];
  cells: number[][]; // [row][col] = count
  maxCount: number;
}

function buildHeatmap(nodes: DataLineageNode[]): HeatmapData {
  if (nodes.length === 0) {
    return { rowLabels: [], colLabels: [], cells: [], maxCount: 0 };
  }

  // Collect unique row keys (agentId or sourceName)
  const rowKeySet = new Set<string>();
  for (const n of nodes) {
    const key = n.agentId ?? n.sourceName ?? n.decisionId ?? "unknown";
    rowKeySet.add(key);
  }
  const rowLabels = [...rowKeySet].sort();

  // Time range → buckets
  const timestamps = nodes.map((n) => n.timestamp);
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const range = Math.max(maxTs - minTs, 1);
  const bucketSize = range / TIME_BUCKETS;

  const colLabels: string[] = [];
  for (let i = 0; i < TIME_BUCKETS; i++) {
    const t = new Date(minTs + i * bucketSize);
    colLabels.push(
      `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`,
    );
  }

  // Count
  const cells: number[][] = rowLabels.map(() => new Array(TIME_BUCKETS).fill(0));
  let maxCount = 0;
  for (const n of nodes) {
    const key = n.agentId ?? n.sourceName ?? n.decisionId ?? "unknown";
    const rowIdx = rowLabels.indexOf(key);
    const colIdx = Math.min(Math.floor((n.timestamp - minTs) / bucketSize), TIME_BUCKETS - 1);
    if (rowIdx >= 0) {
      cells[rowIdx][colIdx]++;
      maxCount = Math.max(maxCount, cells[rowIdx][colIdx]);
    }
  }

  return { rowLabels, colLabels, cells, maxCount };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LineageHeatmap() {
  const graph = useLineageStore((s) => s.graph);

  const heatmap = useMemo(
    () => buildHeatmap(graph?.nodes ?? []),
    [graph],
  );

  if (heatmap.rowLabels.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
        No heatmap data
      </div>
    );
  }

  return (
    <div style={{ overflow: "auto", padding: 12 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ width: LABEL_W, textAlign: "left", padding: "4px 8px", color: "#6b7280", fontWeight: 500 }}>
              Agent / Source
            </th>
            {heatmap.colLabels.map((label, i) => (
              <th key={i} style={{ width: CELL_W, textAlign: "center", padding: "4px 2px", color: "#9ca3af", fontWeight: 400 }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heatmap.rowLabels.map((row, ri) => (
            <tr key={row}>
              <td style={{ padding: "2px 8px", color: "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: LABEL_W }}>
                {row}
              </td>
              {heatmap.cells[ri].map((count, ci) => {
                const ratio = heatmap.maxCount > 0 ? count / heatmap.maxCount : 0;
                return (
                  <td
                    key={ci}
                    title={`${row} — ${heatmap.colLabels[ci]}: ${count}`}
                    style={{
                      width: CELL_W,
                      height: CELL_H,
                      background: count > 0 ? interpolateColor(ratio) : "#f9fafb",
                      border: "1px solid #e5e7eb",
                      textAlign: "center",
                      color: ratio > 0.6 ? "#fff" : "#6b7280",
                      fontWeight: ratio > 0.6 ? 600 : 400,
                      cursor: "default",
                    }}
                  >
                    {count > 0 ? count : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Color legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 10, color: "#9ca3af" }}>
        <span>Low</span>
        <div style={{ display: "flex" }}>
          {[0, 0.25, 0.5, 0.75, 1].map((r) => (
            <div key={r} style={{ width: 20, height: 12, background: interpolateColor(r) }} />
          ))}
        </div>
        <span>High</span>
      </div>
    </div>
  );
}
