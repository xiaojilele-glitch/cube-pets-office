/**
 * 血缘查询引擎 (LineageQueryService)
 *
 * 提供图遍历查询能力：
 * - getUpstream: BFS 上游追溯 (AC-5.1)
 * - getDownstream: BFS 下游影响 (AC-5.2)
 * - getFullPath: 双向 BFS 完整链路 (AC-5.3)
 * - getImpactAnalysis: 影响分析 + 风险等级 (AC-5.4)
 */

import type {
  DataLineageNode,
  LineageEdge,
  LineageGraph,
  ImpactAnalysisResult,
  RiskLevel,
} from "../../shared/lineage/contracts.js";
import type { LineageStorageAdapter } from "./lineage-store.js";

export class LineageQueryService {
  constructor(private store: LineageStorageAdapter) {}

  // ─── AC-5.1: 上游追溯 (BFS) ──────────────────────────────────────────

  async getUpstream(dataId: string, depth?: number): Promise<LineageGraph> {
    const visitedNodes = new Map<string, DataLineageNode>();
    const collectedEdges: LineageEdge[] = [];
    const queue: Array<{ id: string; currentDepth: number }> = [];

    const startNode = await this.store.getNode(dataId);
    if (!startNode) return { nodes: [], edges: [] };

    visitedNodes.set(dataId, startNode);
    queue.push({ id: dataId, currentDepth: 0 });

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      if (depth !== undefined && currentDepth >= depth) continue;

      const node = visitedNodes.get(id)!;
      const upstreamIds: string[] = [];

      // 1) Use node.upstream array
      if (node.upstream) {
        for (const uid of node.upstream) {
          if (upstreamIds.indexOf(uid) === -1) upstreamIds.push(uid);
        }
      }

      // 2) Query edges where toId === current node
      const incomingEdges = await this.store.queryEdges({ toId: id });
      for (const edge of incomingEdges) {
        if (upstreamIds.indexOf(edge.fromId) === -1)
          upstreamIds.push(edge.fromId);
        if (!this.hasEdge(collectedEdges, edge.fromId, edge.toId)) {
          collectedEdges.push(edge);
        }
      }

      // Visit each upstream node
      for (const uid of upstreamIds) {
        if (visitedNodes.has(uid)) continue;
        const upNode = await this.store.getNode(uid);
        if (!upNode) continue;
        visitedNodes.set(uid, upNode);
        queue.push({ id: uid, currentDepth: currentDepth + 1 });

        // Ensure edge exists in collected edges
        if (!this.hasEdge(collectedEdges, uid, id)) {
          collectedEdges.push({
            fromId: uid,
            toId: id,
            type: "derived-from",
            timestamp: Math.min(upNode.timestamp, node.timestamp),
          });
        }
      }
    }

    return {
      nodes: Array.from(visitedNodes.values()),
      edges: collectedEdges,
    };
  }

  // ─── AC-5.2: 下游影响 (BFS) ──────────────────────────────────────────

  async getDownstream(dataId: string, depth?: number): Promise<LineageGraph> {
    const visitedNodes = new Map<string, DataLineageNode>();
    const collectedEdges: LineageEdge[] = [];
    const queue: Array<{ id: string; currentDepth: number }> = [];

    const startNode = await this.store.getNode(dataId);
    if (!startNode) return { nodes: [], edges: [] };

    visitedNodes.set(dataId, startNode);
    queue.push({ id: dataId, currentDepth: 0 });

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      if (depth !== undefined && currentDepth >= depth) continue;

      const node = visitedNodes.get(id)!;
      const downstreamIds: string[] = [];

      // 1) Use node.downstream array (if populated)
      if (node.downstream) {
        for (const did of node.downstream) {
          if (downstreamIds.indexOf(did) === -1) downstreamIds.push(did);
        }
      }

      // 2) Query edges where fromId === current node
      const outgoingEdges = await this.store.queryEdges({ fromId: id });
      for (const edge of outgoingEdges) {
        if (downstreamIds.indexOf(edge.toId) === -1)
          downstreamIds.push(edge.toId);
        if (!this.hasEdge(collectedEdges, edge.fromId, edge.toId)) {
          collectedEdges.push(edge);
        }
      }

      // 3) Query nodes that have current id in their upstream array
      const allNodes = await this.store.queryNodes({});
      for (const candidate of allNodes) {
        if (candidate.upstream && candidate.upstream.indexOf(id) !== -1) {
          if (downstreamIds.indexOf(candidate.lineageId) === -1) {
            downstreamIds.push(candidate.lineageId);
          }
        }
      }

      // Visit each downstream node
      for (const did of downstreamIds) {
        if (visitedNodes.has(did)) continue;
        const downNode = await this.store.getNode(did);
        if (!downNode) continue;
        visitedNodes.set(did, downNode);
        queue.push({ id: did, currentDepth: currentDepth + 1 });

        if (!this.hasEdge(collectedEdges, id, did)) {
          collectedEdges.push({
            fromId: id,
            toId: did,
            type: "derived-from",
            timestamp: Math.min(node.timestamp, downNode.timestamp),
          });
        }
      }
    }

    return {
      nodes: Array.from(visitedNodes.values()),
      edges: collectedEdges,
    };
  }

  // ─── AC-5.3: 完整链路 (BFS from source to decision) ──────────────────

  async getFullPath(
    sourceId: string,
    decisionId: string
  ): Promise<LineageGraph> {
    const sourceNode = await this.store.getNode(sourceId);
    const decisionNode = await this.store.getNode(decisionId);
    if (!sourceNode || !decisionNode) return { nodes: [], edges: [] };

    // BFS from sourceId downstream, tracking parents for path reconstruction
    const visited = new Map<string, DataLineageNode>();
    // parentMap: child -> parent ids (as array)
    const parentMap = new Map<string, string[]>();
    // edgeMap: "fromId->toId" -> edge
    const edgeMap = new Map<string, LineageEdge>();
    const queue: string[] = [];

    visited.set(sourceId, sourceNode);
    queue.push(sourceId);

    let found = false;

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === decisionId) {
        found = true;
        continue; // don't expand beyond target
      }

      const node = visited.get(id)!;
      const downstreamIds: string[] = [];

      // Outgoing edges
      const outgoingEdges = await this.store.queryEdges({ fromId: id });
      for (const edge of outgoingEdges) {
        if (downstreamIds.indexOf(edge.toId) === -1)
          downstreamIds.push(edge.toId);
        const key = `${edge.fromId}->${edge.toId}`;
        if (!edgeMap.has(key)) edgeMap.set(key, edge);
      }

      // Nodes with current id in upstream
      const allNodes = await this.store.queryNodes({});
      for (const candidate of allNodes) {
        if (candidate.upstream && candidate.upstream.indexOf(id) !== -1) {
          if (downstreamIds.indexOf(candidate.lineageId) === -1) {
            downstreamIds.push(candidate.lineageId);
          }
        }
      }

      for (const did of downstreamIds) {
        // Track parent relationship
        const parents = parentMap.get(did) || [];
        if (parents.indexOf(id) === -1) {
          parents.push(id);
          parentMap.set(did, parents);
        }

        const key = `${id}->${did}`;
        if (!edgeMap.has(key)) {
          const downNode = await this.store.getNode(did);
          edgeMap.set(key, {
            fromId: id,
            toId: did,
            type: "derived-from",
            timestamp: downNode
              ? Math.min(node.timestamp, downNode.timestamp)
              : node.timestamp,
          });
        }

        if (!visited.has(did)) {
          const downNode = await this.store.getNode(did);
          if (downNode) {
            visited.set(did, downNode);
            queue.push(did);
          }
        }
      }
    }

    if (!found) return { nodes: [], edges: [] };

    // Backtrack from decisionId to sourceId to collect path nodes
    const pathNodeIds: string[] = [decisionId];
    const backQueue: string[] = [decisionId];

    while (backQueue.length > 0) {
      const id = backQueue.shift()!;
      const parents = parentMap.get(id);
      if (!parents) continue;
      for (const pid of parents) {
        if (pathNodeIds.indexOf(pid) === -1) {
          pathNodeIds.push(pid);
          backQueue.push(pid);
        }
      }
    }

    // Only include nodes and edges on the path
    const pathNodes: DataLineageNode[] = [];
    const pathEdges: LineageEdge[] = [];

    for (const nid of pathNodeIds) {
      const node = visited.get(nid);
      if (node) pathNodes.push(node);
    }

    edgeMap.forEach(edge => {
      if (
        pathNodeIds.indexOf(edge.fromId) !== -1 &&
        pathNodeIds.indexOf(edge.toId) !== -1
      ) {
        pathEdges.push(edge);
      }
    });

    return { nodes: pathNodes, edges: pathEdges };
  }

  // ─── AC-5.4: 影响分析 ────────────────────────────────────────────────

  async getImpactAnalysis(dataId: string): Promise<ImpactAnalysisResult> {
    const downstream = await this.getDownstream(dataId);

    const affectedNodes = downstream.nodes.filter(n => n.lineageId !== dataId);
    const affectedDecisions = downstream.nodes.filter(
      n => n.type === "decision" && n.lineageId !== dataId
    );

    const riskLevel = this.calculateRiskLevel(affectedDecisions);

    return {
      affectedNodes,
      affectedDecisions,
      riskLevel,
      paths: downstream,
    };
  }

  // ─── 内部工具 ────────────────────────────────────────────────────────

  private calculateRiskLevel(decisions: DataLineageNode[]): RiskLevel {
    const count = decisions.length;

    // critical: > 10 affected decisions or any decision with confidence > 0.9
    if (count > 10) return "critical";
    if (decisions.some(d => d.confidence !== undefined && d.confidence > 0.9))
      return "critical";

    // high: > 5 affected decisions
    if (count > 5) return "high";

    // medium: > 2 affected decisions
    if (count > 2) return "medium";

    // low: <= 2 affected decisions
    return "low";
  }

  private hasEdge(edges: LineageEdge[], fromId: string, toId: string): boolean {
    return edges.some(e => e.fromId === fromId && e.toId === toId);
  }
}
