/**
 * 决策支持引擎 (Decision Support Engine)
 *
 * 提供风险分析、成本优化建议、资源调整建议，
 * 收集执行指标用于学习，生成优化报告。
 *
 * @see Requirements 11.1, 11.2, 11.3, 11.4, 20.1, 20.2, 20.5
 */

import type {
  ExecutionMetrics,
  NLExecutionPlan,
  OptimizationReport,
  RiskAssessment,
  AuditEntry,
} from '../../../shared/nl-command/contracts.js';
import type { ILLMProvider, LLMMessage } from '../../../shared/llm/contracts.js';
import type { AuditTrail } from './audit-trail.js';

// ─── Public types ───

export interface CostOptimizationSuggestion {
  suggestionId: string;
  type: 'cost';
  title: string;
  description: string;
  estimatedImpact: string;
}

export interface ResourceAdjustmentSuggestion {
  suggestionId: string;
  type: 'resource';
  title: string;
  description: string;
  estimatedImpact: string;
}

export interface DecisionSupportEngineOptions {
  llmProvider: ILLMProvider;
  model: string;
  auditTrail: AuditTrail;
}

// ─── LLM response shapes ───

interface RiskAnalysisLLMResponse {
  risks: Array<{
    id: string;
    description: string;
    level: 'low' | 'medium' | 'high' | 'critical';
    probability: number;
    impact: number;
    mitigation: string;
    contingency?: string;
  }>;
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface CostSuggestionsLLMResponse {
  suggestions: Array<{
    title: string;
    description: string;
    estimatedImpact: string;
  }>;
}

interface ResourceSuggestionsLLMResponse {
  suggestions: Array<{
    title: string;
    description: string;
    estimatedImpact: string;
  }>;
}

// ─── Helpers (same pattern as command-analyzer.ts) ───

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

async function callLLMWithRetry(
  provider: ILLMProvider,
  messages: LLMMessage[],
  model: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await provider.generate(messages, {
        model,
        jsonMode: true,
        temperature: 0.3,
      });
      return result.content;
    } catch (err) {
      lastError = err;
      const isTemporary = provider.isTemporaryError?.(err) ?? true;
      if (!isTemporary || attempt === MAX_RETRIES) break;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function safeParseJSON<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim()) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


export class DecisionSupportEngine {
  private readonly llmProvider: ILLMProvider;
  private readonly model: string;
  private readonly auditTrail: AuditTrail;

  /** In-memory store of collected execution metrics. */
  private readonly metricsStore: ExecutionMetrics[] = [];

  constructor(options: DecisionSupportEngineOptions) {
    this.llmProvider = options.llmProvider;
    this.model = options.model;
    this.auditTrail = options.auditTrail;
  }

  // ─── Public API ───

  /**
   * Analyze risks for an execution plan via LLM.
   * @see Requirement 11.1
   */
  async analyzeRisks(plan: NLExecutionPlan): Promise<RiskAssessment> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content:
          'You are a risk analysis expert. Analyze the execution plan and return a JSON object with "risks" (array of {id, description, level, probability, impact, mitigation, contingency?}) and "overallRiskLevel" ("low"|"medium"|"high"|"critical").',
      },
      {
        role: 'user',
        content: `Analyze risks for this execution plan:\n${JSON.stringify({
          planId: plan.planId,
          missions: plan.missions.map((m) => ({ id: m.missionId, title: m.title, duration: m.estimatedDuration, cost: m.estimatedCost })),
          tasks: plan.tasks.map((t) => ({ id: t.taskId, title: t.title, duration: t.estimatedDuration, cost: t.estimatedCost })),
          timeline: { criticalPath: plan.timeline.criticalPath },
          costBudget: { totalBudget: plan.costBudget.totalBudget },
        })}`,
      },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<RiskAnalysisLLMResponse>(raw);

    if (!parsed) {
      return this.fallbackRiskAssessment(plan);
    }

    return {
      risks: parsed.risks.map((r) => ({
        id: r.id || generateId('risk'),
        description: r.description,
        level: r.level,
        probability: r.probability,
        impact: r.impact,
        mitigation: r.mitigation,
        contingency: r.contingency,
      })),
      overallRiskLevel: parsed.overallRiskLevel,
    };
  }

  /**
   * Generate cost optimization suggestions via LLM.
   * @see Requirement 11.2
   */
  async suggestCostOptimization(plan: NLExecutionPlan): Promise<CostOptimizationSuggestion[]> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content:
          'You are a cost optimization expert. Analyze the execution plan and return a JSON object with "suggestions" (array of {title, description, estimatedImpact}).',
      },
      {
        role: 'user',
        content: `Suggest cost optimizations for this plan:\n${JSON.stringify({
          planId: plan.planId,
          costBudget: plan.costBudget,
          missions: plan.missions.map((m) => ({ id: m.missionId, title: m.title, cost: m.estimatedCost })),
          tasks: plan.tasks.map((t) => ({ id: t.taskId, title: t.title, cost: t.estimatedCost })),
        })}`,
      },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<CostSuggestionsLLMResponse>(raw);

    if (!parsed || !Array.isArray(parsed.suggestions)) {
      return [];
    }

    return parsed.suggestions.map((s) => ({
      suggestionId: generateId('cost-sug'),
      type: 'cost' as const,
      title: s.title,
      description: s.description,
      estimatedImpact: s.estimatedImpact,
    }));
  }

  /**
   * Generate resource adjustment suggestions via LLM.
   * @see Requirement 11.3
   */
  async suggestResourceAdjustment(plan: NLExecutionPlan): Promise<ResourceAdjustmentSuggestion[]> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content:
          'You are a resource optimization expert. Analyze the execution plan and return a JSON object with "suggestions" (array of {title, description, estimatedImpact}).',
      },
      {
        role: 'user',
        content: `Suggest resource adjustments for this plan:\n${JSON.stringify({
          planId: plan.planId,
          resourceAllocation: plan.resourceAllocation,
          tasks: plan.tasks.map((t) => ({ id: t.taskId, title: t.title, skills: t.requiredSkills, duration: t.estimatedDuration })),
        })}`,
      },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<ResourceSuggestionsLLMResponse>(raw);

    if (!parsed || !Array.isArray(parsed.suggestions)) {
      return [];
    }

    return parsed.suggestions.map((s) => ({
      suggestionId: generateId('res-sug'),
      type: 'resource' as const,
      title: s.title,
      description: s.description,
      estimatedImpact: s.estimatedImpact,
    }));
  }

  /**
   * Collect execution data from a completed plan and compute deviation metrics.
   *
   * Property 21: durationDeviation = (actualDuration - plannedDuration) / plannedDuration
   *              costDeviation = (actualCost - plannedCost) / plannedCost
   *
   * @see Requirements 20.1, 20.2
   */
  async collectExecutionData(plan: NLExecutionPlan): Promise<ExecutionMetrics> {
    const plannedDuration = plan.timeline.entries.reduce((sum, e) => sum + e.duration, 0);
    const plannedCost = plan.costBudget.totalBudget;

    // Compute actual values from timeline entries
    const actualDuration = this.computeActualDuration(plan);
    const actualCost = this.computeActualCost(plan);

    const durationDeviation = plannedDuration === 0 ? 0 : (actualDuration - plannedDuration) / plannedDuration;
    const costDeviation = plannedCost === 0 ? 0 : (actualCost - plannedCost) / plannedCost;

    const metrics: ExecutionMetrics = {
      planId: plan.planId,
      actualDuration,
      actualCost,
      plannedDuration,
      plannedCost,
      durationDeviation,
      costDeviation,
      completedAt: Date.now(),
    };

    this.metricsStore.push(metrics);

    await this.recordAudit(plan.planId, 'report_generated', `Execution metrics collected for plan ${plan.planId}`);

    return metrics;
  }

  /**
   * Generate an optimization report aggregating all collected metrics.
   * @see Requirement 20.5
   */
  async generateOptimizationReport(): Promise<OptimizationReport> {
    const now = Date.now();
    const metrics = this.metricsStore;

    if (metrics.length === 0) {
      return {
        reportId: generateId('opt-report'),
        period: { start: now, end: now },
        durationAccuracy: 1,
        costAccuracy: 1,
        decompositionQuality: 1,
        recommendations: ['No execution data available yet. Run more plans to generate meaningful insights.'],
        generatedAt: now,
      };
    }

    const start = Math.min(...metrics.map((m) => m.completedAt));
    const end = Math.max(...metrics.map((m) => m.completedAt));

    // Duration accuracy: 1 - average absolute duration deviation
    const avgAbsDurationDev = metrics.reduce((sum, m) => sum + Math.abs(m.durationDeviation), 0) / metrics.length;
    const durationAccuracy = Math.max(0, 1 - avgAbsDurationDev);

    // Cost accuracy: 1 - average absolute cost deviation
    const avgAbsCostDev = metrics.reduce((sum, m) => sum + Math.abs(m.costDeviation), 0) / metrics.length;
    const costAccuracy = Math.max(0, 1 - avgAbsCostDev);

    // Decomposition quality: average of duration and cost accuracy
    const decompositionQuality = (durationAccuracy + costAccuracy) / 2;

    const recommendations = this.generateRecommendations(metrics, durationAccuracy, costAccuracy);

    const report: OptimizationReport = {
      reportId: generateId('opt-report'),
      period: { start, end },
      durationAccuracy,
      costAccuracy,
      decompositionQuality,
      recommendations,
      generatedAt: now,
    };

    await this.recordAudit(report.reportId, 'report_generated', `Optimization report generated covering ${metrics.length} plans`);

    return report;
  }

  /** Expose collected metrics (for testing / reporting). */
  getMetrics(): ReadonlyArray<ExecutionMetrics> {
    return this.metricsStore;
  }

  // ─── Internal helpers ───

  private computeActualDuration(plan: NLExecutionPlan): number {
    // Use timeline entries to compute total span
    const entries = plan.timeline.entries;
    if (entries.length === 0) return 0;
    const minStart = Math.min(...entries.map((e) => e.startTime));
    const maxEnd = Math.max(...entries.map((e) => e.endTime));
    return maxEnd - minStart;
  }

  private computeActualCost(plan: NLExecutionPlan): number {
    // Sum task costs from cost budget as actual cost proxy
    const taskCosts = plan.costBudget.taskCosts;
    return Object.values(taskCosts).reduce((sum, c) => sum + c, 0);
  }

  private fallbackRiskAssessment(plan: NLExecutionPlan): RiskAssessment {
    return {
      risks: plan.riskAssessment.risks,
      overallRiskLevel: plan.riskAssessment.overallRiskLevel,
    };
  }

  private generateRecommendations(
    metrics: ExecutionMetrics[],
    durationAccuracy: number,
    costAccuracy: number,
  ): string[] {
    const recommendations: string[] = [];

    if (durationAccuracy < 0.7) {
      recommendations.push('Duration estimates are frequently inaccurate. Consider adjusting estimation models with historical data.');
    }
    if (costAccuracy < 0.7) {
      recommendations.push('Cost estimates show significant deviation. Review cost calculation methodology.');
    }

    const overruns = metrics.filter((m) => m.costDeviation > 0.1);
    if (overruns.length > metrics.length / 2) {
      recommendations.push('More than half of plans exceed cost budget. Consider adding buffer to cost estimates.');
    }

    const delays = metrics.filter((m) => m.durationDeviation > 0.1);
    if (delays.length > metrics.length / 2) {
      recommendations.push('More than half of plans exceed duration estimates. Consider adding buffer to timeline estimates.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Estimation accuracy is within acceptable range. Continue monitoring.');
    }

    return recommendations;
  }

  private async recordAudit(entityId: string, operationType: AuditEntry['operationType'], content: string): Promise<void> {
    const entry: AuditEntry = {
      entryId: generateId('audit'),
      operationType,
      operator: 'system',
      content,
      timestamp: Date.now(),
      result: 'success',
      entityId,
      entityType: 'plan',
    };
    await this.auditTrail.record(entry);
  }
}
