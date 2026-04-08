/**
 * 血缘存储层
 *
 * LineageStorageAdapter 接口 + JsonLineageStorage 默认实现
 * - JSONL 文件持久化（追加写入）
 * - 内存 Map 索引（byId、byAgent、bySession、byDecision、byTimestamp）
 * - 数据保留策略（purgeExpired）
 */

import fs from "node:fs";
import path from "node:path";
import type {
  DataLineageNode,
  LineageEdge,
  LineageQueryFilter,
  LineageEdgeFilter,
  LineageStoreStats,
  LineageNodeType,
} from "../../shared/lineage/contracts.js";

// ─── 存储适配器接口 ────────────────────────────────────────────────────────

export interface LineageStorageAdapter {
  /** 批量写入节点 */
  batchInsertNodes(nodes: DataLineageNode[]): Promise<void>;
  /** 批量写入边 */
  batchInsertEdges(edges: LineageEdge[]): Promise<void>;
  /** 按 ID 查询节点 */
  getNode(lineageId: string): Promise<DataLineageNode | undefined>;
  /** 按条件查询节点 */
  queryNodes(filter: LineageQueryFilter): Promise<DataLineageNode[]>;
  /** 查询边 */
  queryEdges(filter: LineageEdgeFilter): Promise<LineageEdge[]>;
  /** 删除过期数据 */
  purgeExpired(beforeTimestamp: number): Promise<number>;
  /** 统计信息 */
  getStats(): Promise<LineageStoreStats>;
}

// ─── 默认保留天数 ──────────────────────────────────────────────────────────

const DEFAULT_RETENTION_DAYS = 90;

export function getRetentionDays(): number {
  const env = process.env.LINEAGE_RETENTION_DAYS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_RETENTION_DAYS;
}

// ─── JsonLineageStorage 实现 ───────────────────────────────────────────────

export class JsonLineageStorage implements LineageStorageAdapter {
  // 内存索引
  private byId = new Map<string, DataLineageNode>();
  private byAgent = new Map<string, DataLineageNode[]>();
  private bySession = new Map<string, DataLineageNode[]>();
  private byDecision = new Map<string, DataLineageNode>();
  private byTimestamp: DataLineageNode[] = []; // sorted by timestamp asc

  private edges: LineageEdge[] = [];

  private readonly nodesPath: string;
  private readonly edgesPath: string;

  constructor(private readonly dataDir: string) {
    this.nodesPath = path.join(dataDir, "nodes.jsonl");
    this.edgesPath = path.join(dataDir, "edges.jsonl");
  }

  /** 初始化：创建目录、从 JSONL 文件恢复内存索引 */
  init(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.loadNodes();
    this.loadEdges();
  }

  // ─── 写入 ──────────────────────────────────────────────────────────────

  async batchInsertNodes(nodes: DataLineageNode[]): Promise<void> {
    if (nodes.length === 0) return;
    const lines = nodes.map((n) => JSON.stringify(n)).join("\n") + "\n";
    fs.appendFileSync(this.nodesPath, lines, "utf-8");
    for (const node of nodes) {
      this.indexNode(node);
    }
  }

  async batchInsertEdges(edges: LineageEdge[]): Promise<void> {
    if (edges.length === 0) return;
    const lines = edges.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.appendFileSync(this.edgesPath, lines, "utf-8");
    for (const edge of edges) {
      this.edges.push(edge);
    }
  }

  // ─── 查询 ──────────────────────────────────────────────────────────────

  async getNode(lineageId: string): Promise<DataLineageNode | undefined> {
    return this.byId.get(lineageId);
  }

  async queryNodes(filter: LineageQueryFilter): Promise<DataLineageNode[]> {
    let candidates: DataLineageNode[] | undefined;

    // 优先使用索引缩小范围
    if (filter.decisionId) {
      const node = this.byDecision.get(filter.decisionId);
      candidates = node ? [node] : [];
    } else if (filter.agentId) {
      candidates = this.byAgent.get(filter.agentId) ?? [];
    } else if (filter.sessionId) {
      candidates = this.bySession.get(filter.sessionId) ?? [];
    } else if (filter.fromTimestamp !== undefined || filter.toTimestamp !== undefined) {
      candidates = this.rangeByTimestamp(filter.fromTimestamp, filter.toTimestamp);
    } else {
      candidates = this.byTimestamp;
    }

    let results = candidates.filter((node) => {
      if (filter.type && node.type !== filter.type) return false;
      if (filter.agentId && node.agentId !== filter.agentId) return false;
      if (filter.sessionId && node.context.sessionId !== filter.sessionId) return false;
      if (filter.missionId && node.context.missionId !== filter.missionId) return false;
      if (filter.decisionId && node.decisionId !== filter.decisionId) return false;
      if (filter.fromTimestamp !== undefined && node.timestamp < filter.fromTimestamp) return false;
      if (filter.toTimestamp !== undefined && node.timestamp > filter.toTimestamp) return false;
      return true;
    });

    if (filter.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async queryEdges(filter: LineageEdgeFilter): Promise<LineageEdge[]> {
    let results = this.edges.filter((edge) => {
      if (filter.fromId && edge.fromId !== filter.fromId) return false;
      if (filter.toId && edge.toId !== filter.toId) return false;
      if (filter.type && edge.type !== filter.type) return false;
      if (filter.fromTimestamp !== undefined && edge.timestamp < filter.fromTimestamp) return false;
      if (filter.toTimestamp !== undefined && edge.timestamp > filter.toTimestamp) return false;
      return true;
    });

    if (filter.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  // ─── 过期清理 ──────────────────────────────────────────────────────────

  async purgeExpired(beforeTimestamp: number): Promise<number> {
    const toRemove: string[] = [];

    this.byId.forEach((node, id) => {
      if (node.timestamp < beforeTimestamp) {
        toRemove.push(id);
      }
    });

    if (toRemove.length === 0) return 0;

    // 从所有索引中移除
    for (const id of toRemove) {
      const node = this.byId.get(id)!;
      this.byId.delete(id);

      if (node.agentId) {
        const arr = this.byAgent.get(node.agentId);
        if (arr) {
          const filtered = arr.filter((n) => n.lineageId !== id);
          if (filtered.length === 0) this.byAgent.delete(node.agentId);
          else this.byAgent.set(node.agentId, filtered);
        }
      }

      if (node.context.sessionId) {
        const arr = this.bySession.get(node.context.sessionId);
        if (arr) {
          const filtered = arr.filter((n) => n.lineageId !== id);
          if (filtered.length === 0) this.bySession.delete(node.context.sessionId);
          else this.bySession.set(node.context.sessionId, filtered);
        }
      }

      if (node.decisionId) {
        this.byDecision.delete(node.decisionId);
      }
    }

    // 重建 byTimestamp
    this.byTimestamp = this.byTimestamp.filter((n) => n.timestamp >= beforeTimestamp);

    // 移除关联的边
    this.edges = this.edges.filter(
      (e) => !toRemove.includes(e.fromId) && !toRemove.includes(e.toId),
    );

    // 重写 JSONL 文件
    this.rewriteFiles();

    return toRemove.length;
  }

  // ─── 统计 ──────────────────────────────────────────────────────────────

  async getStats(): Promise<LineageStoreStats> {
    const nodesByType: Record<LineageNodeType, number> = {
      source: 0,
      transformation: 0,
      decision: 0,
    };

    let oldest = Infinity;
    let newest = 0;

    this.byId.forEach((node) => {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
      if (node.timestamp < oldest) oldest = node.timestamp;
      if (node.timestamp > newest) newest = node.timestamp;
    });

    if (this.byId.size === 0) {
      oldest = 0;
      newest = 0;
    }

    return {
      totalNodes: this.byId.size,
      totalEdges: this.edges.length,
      nodesByType,
      oldestTimestamp: oldest,
      newestTimestamp: newest,
    };
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────────

  /** 将节点加入所有内存索引 */
  private indexNode(node: DataLineageNode): void {
    this.byId.set(node.lineageId, node);

    if (node.agentId) {
      const arr = this.byAgent.get(node.agentId) ?? [];
      arr.push(node);
      this.byAgent.set(node.agentId, arr);
    }

    if (node.context.sessionId) {
      const arr = this.bySession.get(node.context.sessionId) ?? [];
      arr.push(node);
      this.bySession.set(node.context.sessionId, arr);
    }

    if (node.decisionId) {
      this.byDecision.set(node.decisionId, node);
    }

    // 插入 byTimestamp（保持排序）
    this.insertSorted(node);
  }

  /** 二分插入保持 byTimestamp 有序 */
  private insertSorted(node: DataLineageNode): void {
    let lo = 0;
    let hi = this.byTimestamp.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.byTimestamp[mid].timestamp <= node.timestamp) lo = mid + 1;
      else hi = mid;
    }
    this.byTimestamp.splice(lo, 0, node);
  }

  /** 按时间范围查询（利用有序数组二分查找） */
  private rangeByTimestamp(from?: number, to?: number): DataLineageNode[] {
    const arr = this.byTimestamp;
    if (arr.length === 0) return [];

    let startIdx = 0;
    if (from !== undefined) {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid].timestamp < from) lo = mid + 1;
        else hi = mid;
      }
      startIdx = lo;
    }

    let endIdx = arr.length;
    if (to !== undefined) {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid].timestamp <= to) lo = mid + 1;
        else hi = mid;
      }
      endIdx = lo;
    }

    return arr.slice(startIdx, endIdx);
  }

  /** 从 JSONL 文件加载节点到内存 */
  private loadNodes(): void {
    if (!fs.existsSync(this.nodesPath)) return;
    const content = fs.readFileSync(this.nodesPath, "utf-8");
    if (!content.trim()) return;
    const lines = content.trim().split("\n");
    for (const line of lines) {
      try {
        const node = JSON.parse(line) as DataLineageNode;
        this.indexNode(node);
      } catch {
        // skip corrupted lines
      }
    }
  }

  /** 从 JSONL 文件加载边到内存 */
  private loadEdges(): void {
    if (!fs.existsSync(this.edgesPath)) return;
    const content = fs.readFileSync(this.edgesPath, "utf-8");
    if (!content.trim()) return;
    const lines = content.trim().split("\n");
    for (const line of lines) {
      try {
        const edge = JSON.parse(line) as LineageEdge;
        this.edges.push(edge);
      } catch {
        // skip corrupted lines
      }
    }
  }

  /** 重写 JSONL 文件（purge 后调用） */
  private rewriteFiles(): void {
    // 重写节点文件 — 按 byTimestamp 顺序保持一致
    const allNodes: DataLineageNode[] = [];
    this.byId.forEach((n) => allNodes.push(n));
    const nodeLines = allNodes.map((n) => JSON.stringify(n)).join("\n");
    fs.writeFileSync(this.nodesPath, nodeLines ? nodeLines + "\n" : "", "utf-8");

    // 重写边文件
    const edgeLines = this.edges.map((e) => JSON.stringify(e)).join("\n");
    fs.writeFileSync(this.edgesPath, edgeLines ? edgeLines + "\n" : "", "utf-8");
  }
}
