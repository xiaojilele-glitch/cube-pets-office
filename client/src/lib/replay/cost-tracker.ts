import type {
  ExecutionEvent,
  CostSummary,
  CostAnomaly,
  CostDistribution,
} from '../../../../shared/replay/contracts';

/**
 * CostTracker — 成本追踪分析
 *
 * 基于事件流中的 metadata.cost 字段，提供累计成本计算、
 * 多维度分布分析、异常检测和优化建议。
 */
export class CostTracker {
  /**
   * 计算截至指定时间点的累计成本摘要。
   * 仅统计 timestamp <= upToTime 且 metadata.cost 存在的事件。
   */
  calculateCumulativeCost(
    events: ExecutionEvent[],
    upToTime: number,
  ): CostSummary {
    const relevant = events.filter(
      (e) => e.timestamp <= upToTime && e.metadata?.cost != null,
    );

    let totalCost = 0;
    const byAgent: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byOperationType: Record<string, number> = {};

    for (const e of relevant) {
      const cost = e.metadata!.cost!;
      totalCost += cost;

      // 按 sourceAgent 分组
      byAgent[e.sourceAgent] = (byAgent[e.sourceAgent] ?? 0) + cost;

      // 按模型分组：从 tokenUsage 推断模型标识，回退到 'unknown'
      const model = e.metadata?.tokenUsage ? 'llm' : 'unknown';
      byModel[model] = (byModel[model] ?? 0) + cost;

      // 按操作类型（eventType）分组
      byOperationType[e.eventType] =
        (byOperationType[e.eventType] ?? 0) + cost;
    }

    return {
      totalCost,
      byAgent,
      byModel,
      byOperationType,
      anomalies: [],
    };
  }

  /**
   * 获取成本分布（按 Agent / 模型 / 操作类型三个维度合并为扁平 map）。
   * key 格式: "agent:<id>", "model:<id>", "op:<eventType>"
   */
  getCostDistribution(events: ExecutionEvent[]): CostDistribution {
    const dist: CostDistribution = {};

    for (const e of events) {
      const cost = e.metadata?.cost;
      if (cost == null) continue;

      // agent 维度
      const agentKey = `agent:${e.sourceAgent}`;
      dist[agentKey] = (dist[agentKey] ?? 0) + cost;

      // model 维度
      const model = e.metadata?.tokenUsage ? 'llm' : 'unknown';
      const modelKey = `model:${model}`;
      dist[modelKey] = (dist[modelKey] ?? 0) + cost;

      // operation 维度
      const opKey = `op:${e.eventType}`;
      dist[opKey] = (dist[opKey] ?? 0) + cost;
    }

    return dist;
  }

  /**
   * 检测成本超过阈值的异常事件。
   * 返回所有 metadata.cost > threshold 的事件对应的 CostAnomaly。
   */
  detectCostAnomalies(
    events: ExecutionEvent[],
    threshold: number,
  ): CostAnomaly[] {
    const anomalies: CostAnomaly[] = [];

    for (const e of events) {
      const cost = e.metadata?.cost;
      if (cost != null && cost > threshold) {
        anomalies.push({
          eventId: e.eventId,
          cost,
          threshold,
          reason: `Cost ${cost} exceeds threshold ${threshold}`,
        });
      }
    }

    return anomalies;
  }

  /**
   * 基于成本分布生成优化建议。
   */
  generateOptimizationSuggestions(distribution: CostDistribution): string[] {
    const suggestions: string[] = [];

    // 收集各维度的条目
    const agentEntries: [string, number][] = [];
    const modelEntries: [string, number][] = [];
    const opEntries: [string, number][] = [];

    for (const [key, value] of Object.entries(distribution)) {
      if (key.startsWith('agent:')) agentEntries.push([key, value]);
      else if (key.startsWith('model:')) modelEntries.push([key, value]);
      else if (key.startsWith('op:')) opEntries.push([key, value]);
    }

    // 建议 1：识别成本最高的 Agent
    if (agentEntries.length > 1) {
      const sorted = [...agentEntries].sort((a, b) => b[1] - a[1]);
      const topAgent = sorted[0][0].replace('agent:', '');
      const totalAgentCost = agentEntries.reduce((s, [, v]) => s + v, 0);
      const pct = totalAgentCost > 0
        ? ((sorted[0][1] / totalAgentCost) * 100).toFixed(0)
        : '0';
      suggestions.push(
        `Agent "${topAgent}" accounts for ${pct}% of total cost. Consider optimizing its operations.`,
      );
    }

    // 建议 2：LLM 成本占比高时建议缓存
    const llmCost = distribution['model:llm'] ?? 0;
    const totalModelCost = modelEntries.reduce((s, [, v]) => s + v, 0);
    if (totalModelCost > 0 && llmCost / totalModelCost > 0.7) {
      suggestions.push(
        'LLM calls dominate cost. Consider caching repeated prompts or reducing token usage.',
      );
    }

    // 建议 3：识别成本最高的操作类型
    if (opEntries.length > 1) {
      const sorted = [...opEntries].sort((a, b) => b[1] - a[1]);
      const topOp = sorted[0][0].replace('op:', '');
      suggestions.push(
        `Operation type "${topOp}" is the most expensive. Review if all invocations are necessary.`,
      );
    }

    // 如果分布为空，给出通用建议
    if (suggestions.length === 0) {
      suggestions.push(
        'No significant cost patterns detected. Continue monitoring.',
      );
    }

    return suggestions;
  }
}
