import { useMemo } from "react";

import type { DataLineageNode } from "@shared/lineage/contracts.js";

import { useI18n } from "@/i18n";
import { useLineageStore } from "@/lib/lineage-store";

import { getLineageCopy } from "./lineage-copy";
import { LINEAGE_NEUTRAL } from "./lineage-theme";

const TIME_BUCKETS = 10;
const CELL_WIDTH = 52;
const CELL_HEIGHT = 36;
const LABEL_WIDTH = 160;

interface HeatmapData {
  rowLabels: string[];
  columnLabels: string[];
  cells: number[][];
  maxCount: number;
}

function interpolateColor(ratio: number) {
  const red = Math.round(248 - ratio * 70);
  const green = Math.round(236 - ratio * 82);
  const blue = Math.round(223 - ratio * 106);
  return `rgb(${red},${green},${blue})`;
}

function buildHeatmap(
  nodes: DataLineageNode[],
  unknownLabel: string
): HeatmapData {
  if (nodes.length === 0) {
    return {
      rowLabels: [],
      columnLabels: [],
      cells: [],
      maxCount: 0,
    };
  }

  const rowLabelSet = new Set<string>();
  for (const node of nodes) {
    rowLabelSet.add(
      node.agentId ?? node.sourceName ?? node.decisionId ?? unknownLabel
    );
  }

  const rowLabels = Array.from(rowLabelSet).sort();
  const timestamps = nodes.map(node => node.timestamp);
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const timestampRange = Math.max(maxTimestamp - minTimestamp, 1);
  const bucketSize = timestampRange / TIME_BUCKETS;

  const columnLabels = Array.from({ length: TIME_BUCKETS }, (_, index) => {
    const date = new Date(minTimestamp + index * bucketSize);
    return `${date.getHours().toString().padStart(2, "0")}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  });

  const cells = rowLabels.map(() => new Array(TIME_BUCKETS).fill(0));
  let maxCount = 0;

  for (const node of nodes) {
    const key =
      node.agentId ?? node.sourceName ?? node.decisionId ?? unknownLabel;
    const rowIndex = rowLabels.indexOf(key);
    const columnIndex = Math.min(
      Math.floor((node.timestamp - minTimestamp) / bucketSize),
      TIME_BUCKETS - 1
    );

    if (rowIndex < 0) continue;
    cells[rowIndex][columnIndex] += 1;
    maxCount = Math.max(maxCount, cells[rowIndex][columnIndex]);
  }

  return {
    rowLabels,
    columnLabels,
    cells,
    maxCount,
  };
}

export default function LineageHeatmap() {
  const { locale } = useI18n();
  const copy = getLineageCopy(locale);
  const graph = useLineageStore(state => state.graph);

  const heatmap = useMemo(
    () => buildHeatmap(graph?.nodes ?? [], copy.heatmap.unknownLabel),
    [copy.heatmap.unknownLabel, graph]
  );

  if (heatmap.rowLabels.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--workspace-text-subtle)]">
        {copy.heatmap.empty}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-[24px] bg-white/28 p-3">
      <table className="workspace-data-table min-w-full text-[11px]">
        <thead>
          <tr>
            <th
              className="sticky left-0 z-10 rounded-l-[16px] bg-[#fbf6ef] px-3 py-2 text-left"
              style={{ minWidth: LABEL_WIDTH }}
            >
              {copy.heatmap.rowLabel}
            </th>
            {heatmap.columnLabels.map(label => (
              <th key={label} className="px-1.5 py-2 text-center font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heatmap.rowLabels.map((rowLabel, rowIndex) => (
            <tr key={rowLabel}>
              <td
                className="sticky left-0 z-10 border-b border-[var(--workspace-panel-border)] bg-[#fffaf4]/95 px-3 py-2 font-medium text-[var(--workspace-text)]"
                style={{ maxWidth: LABEL_WIDTH }}
                title={rowLabel}
              >
                <div className="truncate">{rowLabel}</div>
              </td>

              {heatmap.cells[rowIndex].map((count, columnIndex) => {
                const ratio =
                  heatmap.maxCount === 0 ? 0 : count / heatmap.maxCount;
                const background =
                  count > 0 ? interpolateColor(ratio) : "#f9f2ea";
                const color =
                  ratio > 0.58 ? "#fffaf4" : LINEAGE_NEUTRAL.textMuted;

                return (
                  <td key={`${rowLabel}-${columnIndex}`} className="p-1">
                    <div
                      className="flex items-center justify-center rounded-[14px] border text-center font-semibold"
                      style={{
                        width: CELL_WIDTH,
                        minWidth: CELL_WIDTH,
                        height: CELL_HEIGHT,
                        background,
                        borderColor:
                          count > 0
                            ? "rgba(151, 120, 90, 0.22)"
                            : LINEAGE_NEUTRAL.border,
                        color,
                      }}
                      title={copy.heatmap.cellTooltip(
                        rowLabel,
                        heatmap.columnLabels[columnIndex],
                        count
                      )}
                    >
                      {count > 0 ? count : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex items-center gap-3 text-[10px] text-[var(--workspace-text-subtle)]">
        <span>{copy.heatmap.low}</span>
        <div className="flex overflow-hidden rounded-full border border-[var(--workspace-panel-border)]">
          {[0, 0.25, 0.5, 0.75, 1].map(step => (
            <div
              key={step}
              className="h-3 w-6"
              style={{ background: interpolateColor(step) }}
            />
          ))}
        </div>
        <span>{copy.heatmap.high}</span>
      </div>
    </div>
  );
}
