/**
 * 血缘导入导出服务
 *
 * LineageExportService — 支持 JSON/CSV 格式的血缘数据导入导出
 * - exportLineage: 按时间范围导出节点和边（AC-10.1 ~ AC-10.2）
 * - importLineage: 导入 + 去重 + 冲突解决（AC-10.3 ~ AC-10.4）
 * - exportIncremental: 增量导出（AC-10.5）
 */

import type {
  DataLineageNode,
  LineageEdge,
  ImportResult,
} from "../../shared/lineage/contracts.js";
import type { LineageStorageAdapter } from "./lineage-store.js";

// ─── CSV 常量 ──────────────────────────────────────────────────────────────

const CSV_EDGE_SEPARATOR = "---EDGES---";

const NODE_CSV_FIELDS: (keyof DataLineageNode)[] = [
  "lineageId",
  "type",
  "timestamp",
  "sourceId",
  "sourceName",
  "queryText",
  "resultHash",
  "resultSize",
  "agentId",
  "operation",
  "codeLocation",
  "dataChanged",
  "executionTimeMs",
  "decisionId",
  "decisionLogic",
  "result",
  "confidence",
  "modelVersion",
];

const EDGE_CSV_FIELDS: (keyof LineageEdge)[] = [
  "fromId",
  "toId",
  "type",
  "weight",
  "timestamp",
];

// ─── CSV 辅助函数 ──────────────────────────────────────────────────────────

/** 将值转为 CSV 安全字符串（含逗号或引号时加引号） */
function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** 解析 CSV 行，处理引号内的逗号 */
function csvParseLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ─── 序列化辅助 ────────────────────────────────────────────────────────────

function nodeToCSVRow(node: DataLineageNode): string {
  return NODE_CSV_FIELDS.map(f =>
    csvEscape((node as unknown as Record<string, unknown>)[f])
  ).join(",");
}

function edgeToCSVRow(edge: LineageEdge): string {
  return EDGE_CSV_FIELDS.map(f =>
    csvEscape((edge as unknown as Record<string, unknown>)[f])
  ).join(",");
}

function csvRowToNode(headers: string[], values: string[]): DataLineageNode {
  const raw: Record<string, unknown> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i];
    const val = values[i] ?? "";
    if (val === "") {
      raw[key] = undefined;
    } else if (
      key === "timestamp" ||
      key === "resultSize" ||
      key === "executionTimeMs" ||
      key === "confidence"
    ) {
      raw[key] = Number(val);
    } else if (key === "dataChanged") {
      raw[key] = val === "true";
    } else {
      raw[key] = val;
    }
  }
  // Reconstruct context (CSV doesn't carry nested context, use empty)
  return { context: {}, ...raw } as unknown as DataLineageNode;
}

function csvRowToEdge(headers: string[], values: string[]): LineageEdge {
  const raw: Record<string, unknown> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i];
    const val = values[i] ?? "";
    if (val === "") {
      raw[key] = undefined;
    } else if (key === "timestamp") {
      raw[key] = Number(val);
    } else if (key === "weight") {
      raw[key] = Number(val);
    } else {
      raw[key] = val;
    }
  }
  return raw as unknown as LineageEdge;
}

// ─── LineageExportService ──────────────────────────────────────────────────

export class LineageExportService {
  constructor(private store: LineageStorageAdapter) {}

  /**
   * AC-10.1 ~ AC-10.2: 导出指定时间范围内的血缘数据
   * 导出数据包含完整的节点和边信息，可独立重建血缘图
   */
  async exportLineage(
    startTime: number,
    endTime: number,
    format: "json" | "csv"
  ): Promise<Buffer> {
    const nodes = await this.store.queryNodes({
      fromTimestamp: startTime,
      toTimestamp: endTime,
    });

    const edges = await this.store.queryEdges({
      fromTimestamp: startTime,
      toTimestamp: endTime,
    });

    if (format === "json") {
      return this.serializeJSON(nodes, edges);
    }
    return this.serializeCSV(nodes, edges);
  }

  /**
   * AC-10.3 ~ AC-10.4: 导入血缘数据 + 去重 + 冲突解决
   * - 去重：lineageId 已存在则跳过（除非冲突解决）
   * - 冲突解决：同 lineageId 不同 timestamp，保留较新的
   */
  async importLineage(
    data: Buffer,
    format: "json" | "csv"
  ): Promise<ImportResult> {
    let nodes: DataLineageNode[];
    let edges: LineageEdge[];

    if (format === "json") {
      ({ nodes, edges } = this.parseJSON(data));
    } else {
      ({ nodes, edges } = this.parseCSV(data));
    }

    const result: ImportResult = {
      importedNodes: 0,
      importedEdges: 0,
      skippedDuplicates: 0,
      errors: [],
    };

    // ── 节点导入：去重 + 冲突解决 ──
    const nodesToInsert: DataLineageNode[] = [];

    for (const node of nodes) {
      try {
        const existing = await this.store.getNode(node.lineageId);
        if (existing) {
          if (existing.timestamp === node.timestamp) {
            // 完全重复，跳过
            result.skippedDuplicates++;
          } else if (node.timestamp > existing.timestamp) {
            // 冲突解决：导入的更新，替换（先删旧再插新）
            // 由于 store 没有 delete 单节点接口，通过 insert 覆盖内存索引
            nodesToInsert.push(node);
            result.importedNodes++;
          } else {
            // 已有的更新，跳过
            result.skippedDuplicates++;
          }
        } else {
          nodesToInsert.push(node);
          result.importedNodes++;
        }
      } catch (err) {
        result.errors.push(
          `Failed to import node ${node.lineageId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (nodesToInsert.length > 0) {
      await this.store.batchInsertNodes(nodesToInsert);
    }

    // ── 边导入：去重（基于 fromId + toId + type） ──
    const existingEdges = await this.store.queryEdges({});
    const edgeKeySet = new Set(
      existingEdges.map(e => `${e.fromId}|${e.toId}|${e.type}`)
    );

    const edgesToInsert: LineageEdge[] = [];
    for (const edge of edges) {
      const key = `${edge.fromId}|${edge.toId}|${edge.type}`;
      if (edgeKeySet.has(key)) {
        result.skippedDuplicates++;
      } else {
        edgesToInsert.push(edge);
        edgeKeySet.add(key);
        result.importedEdges++;
      }
    }

    if (edgesToInsert.length > 0) {
      await this.store.batchInsertEdges(edgesToInsert);
    }

    return result;
  }

  /**
   * AC-10.5: 增量导出（从 sinceTimestamp 到当前时间）
   */
  async exportIncremental(
    sinceTimestamp: number,
    format: "json" | "csv"
  ): Promise<Buffer> {
    return this.exportLineage(sinceTimestamp, Date.now(), format);
  }

  // ─── JSON 序列化 / 反序列化 ──────────────────────────────────────────

  private serializeJSON(
    nodes: DataLineageNode[],
    edges: LineageEdge[]
  ): Buffer {
    const payload = JSON.stringify({ nodes, edges }, null, 2);
    return Buffer.from(payload, "utf-8");
  }

  private parseJSON(data: Buffer): {
    nodes: DataLineageNode[];
    edges: LineageEdge[];
  } {
    const parsed = JSON.parse(data.toString("utf-8"));
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  }

  // ─── CSV 序列化 / 反序列化 ───────────────────────────────────────────

  private serializeCSV(nodes: DataLineageNode[], edges: LineageEdge[]): Buffer {
    const lines: string[] = [];

    // Node header + rows
    lines.push(NODE_CSV_FIELDS.join(","));
    for (const node of nodes) {
      lines.push(nodeToCSVRow(node));
    }

    // Separator
    lines.push(CSV_EDGE_SEPARATOR);

    // Edge header + rows
    lines.push(EDGE_CSV_FIELDS.join(","));
    for (const edge of edges) {
      lines.push(edgeToCSVRow(edge));
    }

    return Buffer.from(lines.join("\n"), "utf-8");
  }

  private parseCSV(data: Buffer): {
    nodes: DataLineageNode[];
    edges: LineageEdge[];
  } {
    const content = data.toString("utf-8");
    const allLines = content.split("\n").filter(l => l.trim() !== "");

    const separatorIdx = allLines.indexOf(CSV_EDGE_SEPARATOR);

    const nodes: DataLineageNode[] = [];
    const edges: LineageEdge[] = [];

    if (separatorIdx === -1) {
      // No separator — treat all as nodes
      if (allLines.length > 1) {
        const headers = csvParseLine(allLines[0]);
        for (let i = 1; i < allLines.length; i++) {
          const values = csvParseLine(allLines[i]);
          nodes.push(csvRowToNode(headers, values));
        }
      }
      return { nodes, edges };
    }

    // Parse nodes section
    if (separatorIdx > 1) {
      const nodeHeaders = csvParseLine(allLines[0]);
      for (let i = 1; i < separatorIdx; i++) {
        const values = csvParseLine(allLines[i]);
        nodes.push(csvRowToNode(nodeHeaders, values));
      }
    }

    // Parse edges section
    if (separatorIdx + 2 < allLines.length) {
      const edgeHeaders = csvParseLine(allLines[separatorIdx + 1]);
      for (let i = separatorIdx + 2; i < allLines.length; i++) {
        const values = csvParseLine(allLines[i]);
        edges.push(csvRowToEdge(edgeHeaders, values));
      }
    }

    return { nodes, edges };
  }
}
