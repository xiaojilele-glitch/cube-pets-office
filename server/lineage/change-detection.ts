/**
 * 变更检测服务 (ChangeDetectionService)
 *
 * - detectChanges: 哈希对比检测数据变更 (AC-8.1)
 * - analyzeChangeImpact: 变更影响分析 + 告警生成 (AC-8.2 ~ AC-8.3)
 * - getStateAtTime: 时间点回溯查询 (AC-8.4)
 * - measureQuality: 数据质量指标计算 (AC-8.5)
 */

import { randomUUID } from "node:crypto";
import type {
  ChangeAlert,
  DataLineageNode,
  DataQualityMetrics,
  ImpactAnalysisResult,
  LineageGraph,
} from "../../shared/lineage/contracts.js";
import type { LineageStorageAdapter } from "./lineage-store.js";
import type { LineageQueryService } from "./lineage-query.js";

/** 90 天（毫秒），用于新鲜度衰减窗口 */
const FRESHNESS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export class ChangeDetectionService {
  constructor(
    private store: LineageStorageAdapter,
    private queryService: LineageQueryService
  ) {}

  // ─── AC-8.1: 哈希对比检测变更 ──────────────────────────────────────

  async detectChanges(sourceId: string): Promise<ChangeAlert | null> {
    // 查询所有 source 类型且 sourceId 匹配的节点，按时间排序
    const nodes = await this.store.queryNodes({ type: "source" });
    const matched = nodes
      .filter(n => n.sourceId === sourceId)
      .sort((a, b) => a.timestamp - b.timestamp);

    // 不足两条记录，无法对比
    if (matched.length < 2) return null;

    const previous = matched[matched.length - 2];
    const current = matched[matched.length - 1];

    // 哈希相同，无变更
    if (previous.resultHash === current.resultHash) return null;

    // 哈希不同，生成告警
    return {
      id: randomUUID(),
      type: "hash_mismatch",
      dataId: current.lineageId,
      previousHash: previous.resultHash,
      currentHash: current.resultHash,
      affectedAgents: [],
      affectedDecisions: [],
      riskLevel: "medium",
      timestamp: Date.now(),
      details: `Source "${sourceId}" hash changed from ${previous.resultHash ?? "undefined"} to ${current.resultHash ?? "undefined"}`,
    };
  }

  // ─── AC-8.2 ~ AC-8.3: 变更影响分析 + 告警生成 ─────────────────────

  async analyzeChangeImpact(alert: ChangeAlert): Promise<ImpactAnalysisResult> {
    // 获取影响分析
    const impact = await this.queryService.getImpactAnalysis(alert.dataId);

    // 填充告警的受影响 Agent 和决策
    const agentIds = new Set<string>();
    for (const node of impact.affectedNodes) {
      if (node.agentId) agentIds.add(node.agentId);
    }
    alert.affectedAgents = Array.from(agentIds);

    const decisionIds: string[] = [];
    for (const node of impact.affectedDecisions) {
      if (node.decisionId) decisionIds.push(node.decisionId);
    }
    alert.affectedDecisions = decisionIds;

    // 同步风险等级
    alert.riskLevel = impact.riskLevel;

    return impact;
  }

  // ─── AC-8.4: 时间点回溯查询 ────────────────────────────────────────

  async getStateAtTime(
    decisionId: string,
    timestamp: number
  ): Promise<LineageGraph> {
    // 查询决策节点
    const decisionNodes = await this.store.queryNodes({ decisionId });
    if (decisionNodes.length === 0) return { nodes: [], edges: [] };

    const decisionNode = decisionNodes[0];

    // 获取决策的上游图
    const upstream = await this.queryService.getUpstream(
      decisionNode.lineageId
    );

    // 过滤：只保留 timestamp <= 给定时间的节点
    const filteredNodeIds = new Set<string>();
    const filteredNodes: DataLineageNode[] = [];
    for (const node of upstream.nodes) {
      if (node.timestamp <= timestamp) {
        filteredNodes.push(node);
        filteredNodeIds.add(node.lineageId);
      }
    }

    // 过滤边：两端节点都在过滤后的集合中
    const filteredEdges = upstream.edges.filter(
      e => filteredNodeIds.has(e.fromId) && filteredNodeIds.has(e.toId)
    );

    return { nodes: filteredNodes, edges: filteredEdges };
  }

  // ─── AC-8.5: 数据质量指标计算 ──────────────────────────────────────

  async measureQuality(dataId: string): Promise<DataQualityMetrics> {
    const node = await this.store.getNode(dataId);
    const now = Date.now();

    if (!node) {
      return {
        dataId,
        freshness: 0,
        completeness: 0,
        accuracy: 0,
        measuredAt: now,
      };
    }

    // 新鲜度：基于数据时间距今的衰减（90 天窗口）
    const freshness = Math.max(
      0,
      1 - (now - node.timestamp) / FRESHNESS_WINDOW_MS
    );

    // 完整度：统计可选字段的填充率
    const completeness = this.calculateCompleteness(node);

    // 准确度：基于 resultHash 存在性和变更检测
    const accuracy = await this.calculateAccuracy(node);

    return {
      dataId,
      freshness: Math.round(freshness * 1000) / 1000,
      completeness: Math.round(completeness * 1000) / 1000,
      accuracy: Math.round(accuracy * 1000) / 1000,
      measuredAt: now,
    };
  }

  // ─── 内部方法 ────────────────────────────────────────────────────────

  private calculateCompleteness(node: DataLineageNode): number {
    // 定义各类型节点的可选字段
    const optionalFields: (keyof DataLineageNode)[] = [
      "sourceId",
      "sourceName",
      "queryText",
      "resultHash",
      "resultSize",
      "agentId",
      "operation",
      "codeLocation",
      "parameters",
      "inputLineageIds",
      "outputLineageId",
      "dataChanged",
      "executionTimeMs",
      "decisionId",
      "decisionLogic",
      "result",
      "confidence",
      "modelVersion",
      "metadata",
      "complianceTags",
      "upstream",
      "downstream",
    ];

    let filled = 0;
    for (const field of optionalFields) {
      if (node[field] !== undefined) filled++;
    }

    return optionalFields.length > 0 ? filled / optionalFields.length : 0;
  }

  private async calculateAccuracy(node: DataLineageNode): Promise<number> {
    if (!node.resultHash) return 0.5;

    // 有哈希，检查是否存在哈希不匹配
    if (node.sourceId) {
      const alert = await this.detectChanges(node.sourceId);
      if (alert) return 0.7; // 存在哈希变更，准确度降低
    }

    return 1.0; // 有哈希且无变更
  }
}
