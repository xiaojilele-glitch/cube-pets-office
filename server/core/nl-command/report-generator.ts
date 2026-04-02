/**
 * 报告生成器 (Report Generator)
 *
 * 生成执行报告，支持 Markdown 和 JSON 导出，
 * 支持计划与实际对比分析。
 *
 * @see Requirements 13.1, 13.2, 13.3, 13.4, 13.5
 */

import type {
  ExecutionReport,
  ProgressAnalysis,
  CostAnalysisResult,
  RiskAssessment,
  NLExecutionPlan,
  AuditEntry,
} from '../../../shared/nl-command/contracts.js';
import type { AuditTrail } from './audit-trail.js';

// ─── Public types ───

export interface ReportComparison {
  planId: string;
  report1Id: string;
  report2Id: string;
  progressDiff: {
    overallProgressDelta: number;
    completedMissionsDelta: number;
    completedTasksDelta: number;
  };
  costDiff: {
    plannedCostDelta: number;
    actualCostDelta: number;
    varianceDelta: number;
  };
  riskDiff: {
    riskLevelChanged: boolean;
    report1RiskLevel: string;
    report2RiskLevel: string;
  };
}

export interface ReportGeneratorOptions {
  auditTrail: AuditTrail;
}

// ─── Helpers ───

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


export class ReportGenerator {
  private readonly auditTrail: AuditTrail;
  private readonly reports = new Map<string, ExecutionReport>();

  constructor(options: ReportGeneratorOptions) {
    this.auditTrail = options.auditTrail;
  }

  // ─── Public API ───

  /**
   * Generate an execution report for a plan.
   * Optionally filter to specific sections: 'progress', 'cost', 'risk'.
   *
   * Property 22: report SHALL contain non-empty summary, progressAnalysis, costAnalysis, riskAnalysis.
   *
   * @see Requirement 13.1, 13.3
   */
  generate(plan: NLExecutionPlan, sections?: string[]): ExecutionReport {
    const includeSections = sections && sections.length > 0 ? new Set(sections) : null;

    const progressAnalysis = this.computeProgressAnalysis(plan);
    const costAnalysis = this.computeCostAnalysis(plan);
    const riskAnalysis = this.extractRiskAnalysis(plan);

    const summaryParts: string[] = [];
    summaryParts.push(`Execution report for plan ${plan.planId}.`);
    summaryParts.push(`Overall progress: ${(progressAnalysis.overallProgress * 100).toFixed(1)}%.`);
    if (costAnalysis.variance !== 0) {
      const direction = costAnalysis.variance > 0 ? 'over' : 'under';
      summaryParts.push(`Cost is ${direction} budget by ${Math.abs(costAnalysis.variancePercentage).toFixed(1)}%.`);
    } else {
      summaryParts.push('Cost is on budget.');
    }
    summaryParts.push(`Overall risk level: ${riskAnalysis.overallRiskLevel}.`);

    const report: ExecutionReport = {
      reportId: generateId('report'),
      planId: plan.planId,
      summary: summaryParts.join(' '),
      progressAnalysis: !includeSections || includeSections.has('progress')
        ? progressAnalysis
        : this.emptyProgressAnalysis(),
      costAnalysis: !includeSections || includeSections.has('cost')
        ? costAnalysis
        : this.emptyCostAnalysis(),
      riskAnalysis: !includeSections || includeSections.has('risk')
        ? riskAnalysis
        : this.emptyRiskAnalysis(),
      generatedAt: Date.now(),
    };

    this.reports.set(report.reportId, report);

    // Fire-and-forget audit
    void this.recordAudit(report.reportId, 'report_generated', `Report generated for plan ${plan.planId}`);

    return report;
  }

  /**
   * Export a report as JSON or Markdown.
   *
   * Property 22: JSON export SHALL be valid JSON. Markdown export SHALL contain section headers.
   *
   * @see Requirement 13.2, 13.5
   */
  export(report: ExecutionReport, format: 'json' | 'markdown'): string {
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }
    return this.toMarkdown(report);
  }

  /**
   * Compare two reports (plan-vs-actual or across time).
   *
   * Property 23: variance = actualCost - plannedCost,
   *              variancePercentage = variance / plannedCost * 100
   *
   * @see Requirement 13.4
   */
  compare(report1: ExecutionReport, report2: ExecutionReport): ReportComparison {
    return {
      planId: report1.planId,
      report1Id: report1.reportId,
      report2Id: report2.reportId,
      progressDiff: {
        overallProgressDelta: report2.progressAnalysis.overallProgress - report1.progressAnalysis.overallProgress,
        completedMissionsDelta: report2.progressAnalysis.completedMissions - report1.progressAnalysis.completedMissions,
        completedTasksDelta: report2.progressAnalysis.completedTasks - report1.progressAnalysis.completedTasks,
      },
      costDiff: {
        plannedCostDelta: report2.costAnalysis.plannedCost - report1.costAnalysis.plannedCost,
        actualCostDelta: report2.costAnalysis.actualCost - report1.costAnalysis.actualCost,
        varianceDelta: report2.costAnalysis.variance - report1.costAnalysis.variance,
      },
      riskDiff: {
        riskLevelChanged: report1.riskAnalysis.overallRiskLevel !== report2.riskAnalysis.overallRiskLevel,
        report1RiskLevel: report1.riskAnalysis.overallRiskLevel,
        report2RiskLevel: report2.riskAnalysis.overallRiskLevel,
      },
    };
  }

  /** Retrieve a stored report by ID. */
  getReport(reportId: string): ExecutionReport | undefined {
    return this.reports.get(reportId);
  }

  // ─── Internal: Progress Analysis ───

  /**
   * Compute ProgressAnalysis from plan missions/tasks status.
   * Completed missions: status === 'completed' on the plan itself.
   * Since DecomposedMission/DecomposedTask don't carry runtime status,
   * we derive completion from the plan's overall status and timeline entries.
   */
  private computeProgressAnalysis(plan: NLExecutionPlan): ProgressAnalysis {
    const totalMissions = plan.missions.length;
    const totalTasks = plan.tasks.length;

    // Determine completed items based on plan status
    let completedMissions = 0;
    let completedTasks = 0;

    if (plan.status === 'completed') {
      completedMissions = totalMissions;
      completedTasks = totalTasks;
    } else if (plan.status === 'executing') {
      // Use timeline entries to estimate: entries whose endTime <= now are "done"
      const now = Date.now();
      const completedTaskIds = new Set(
        plan.timeline.entries
          .filter((e) => e.entityType === 'task' && e.endTime <= now)
          .map((e) => e.entityId),
      );
      completedTasks = completedTaskIds.size;

      // A mission is completed if all its tasks are completed
      // Since we don't have a direct mission→task mapping, count missions on critical path
      const completedMissionIds = new Set(
        plan.timeline.entries
          .filter((e) => e.entityType === 'mission' && e.endTime <= now)
          .map((e) => e.entityId),
      );
      completedMissions = completedMissionIds.size;
    }

    const overallProgress = totalTasks === 0 ? 0 : completedTasks / totalTasks;

    // Delayed items: tasks on critical path that haven't completed by their endTime
    const now = Date.now();
    const delayedItems: string[] = [];
    const onTrackItems: string[] = [];

    for (const entry of plan.timeline.entries) {
      if (entry.endTime <= now && entry.entityType === 'task') {
        onTrackItems.push(entry.entityId);
      } else if (entry.startTime <= now && entry.endTime > now) {
        // In progress — check if it's behind schedule
        if (entry.isCriticalPath) {
          delayedItems.push(entry.entityId);
        } else {
          onTrackItems.push(entry.entityId);
        }
      }
    }

    return {
      totalMissions,
      completedMissions,
      totalTasks,
      completedTasks,
      overallProgress,
      delayedItems,
      onTrackItems,
    };
  }

  // ─── Internal: Cost Analysis ───

  /**
   * Compute CostAnalysisResult.
   *
   * Property 23 invariant:
   *   variance = actualCost - plannedCost
   *   variancePercentage = variance / plannedCost * 100
   */
  private computeCostAnalysis(plan: NLExecutionPlan): CostAnalysisResult {
    const plannedCost = plan.costBudget.totalBudget;

    // Actual cost = sum of task costs (proxy for actual spend)
    const actualCost = Object.values(plan.costBudget.taskCosts).reduce((sum, c) => sum + c, 0);

    const variance = actualCost - plannedCost;
    const variancePercentage = plannedCost === 0 ? 0 : (variance / plannedCost) * 100;

    // Build costByMission: planned from missionCosts, actual proportional from tasks
    const costByMission: Record<string, { planned: number; actual: number }> = {};
    for (const [missionId, planned] of Object.entries(plan.costBudget.missionCosts)) {
      costByMission[missionId] = { planned, actual: planned }; // default: actual = planned
    }

    // Override actual mission costs if we can map tasks to missions
    // Since DecomposedTask doesn't have missionId, use missionCosts as actual proxy
    // Adjust proportionally based on task cost ratio
    if (plannedCost > 0) {
      for (const missionId of Object.keys(costByMission)) {
        const missionPlanned = costByMission[missionId].planned;
        const ratio = missionPlanned / plannedCost;
        costByMission[missionId].actual = actualCost * ratio;
      }
    }

    return {
      plannedCost,
      actualCost,
      variance,
      variancePercentage,
      costByMission,
      costByAgent: { ...plan.costBudget.agentCosts },
      costByModel: { ...plan.costBudget.modelCosts },
    };
  }

  // ─── Internal: Risk Analysis ───

  private extractRiskAnalysis(plan: NLExecutionPlan): RiskAssessment {
    return {
      risks: [...plan.riskAssessment.risks],
      overallRiskLevel: plan.riskAssessment.overallRiskLevel,
    };
  }

  // ─── Internal: Markdown export ───

  private toMarkdown(report: ExecutionReport): string {
    const lines: string[] = [];

    lines.push(`# Execution Report: ${report.planId}`);
    lines.push('');
    lines.push(`**Report ID:** ${report.reportId}`);
    lines.push(`**Generated At:** ${new Date(report.generatedAt).toISOString()}`);
    lines.push('');

    lines.push('## Summary');
    lines.push('');
    lines.push(report.summary);
    lines.push('');

    lines.push('## Progress Analysis');
    lines.push('');
    const p = report.progressAnalysis;
    lines.push(`- Total Missions: ${p.totalMissions}`);
    lines.push(`- Completed Missions: ${p.completedMissions}`);
    lines.push(`- Total Tasks: ${p.totalTasks}`);
    lines.push(`- Completed Tasks: ${p.completedTasks}`);
    lines.push(`- Overall Progress: ${(p.overallProgress * 100).toFixed(1)}%`);
    if (p.delayedItems.length > 0) {
      lines.push(`- Delayed Items: ${p.delayedItems.join(', ')}`);
    }
    if (p.onTrackItems.length > 0) {
      lines.push(`- On Track Items: ${p.onTrackItems.join(', ')}`);
    }
    lines.push('');

    lines.push('## Cost Analysis');
    lines.push('');
    const c = report.costAnalysis;
    lines.push(`- Planned Cost: ${c.plannedCost}`);
    lines.push(`- Actual Cost: ${c.actualCost}`);
    lines.push(`- Variance: ${c.variance}`);
    lines.push(`- Variance Percentage: ${c.variancePercentage.toFixed(1)}%`);
    lines.push('');

    lines.push('## Risk Analysis');
    lines.push('');
    const r = report.riskAnalysis;
    lines.push(`- Overall Risk Level: ${r.overallRiskLevel}`);
    if (r.risks.length > 0) {
      lines.push(`- Identified Risks: ${r.risks.length}`);
      for (const risk of r.risks) {
        lines.push(`  - [${risk.level}] ${risk.description} (mitigation: ${risk.mitigation})`);
      }
    }
    lines.push('');

    return lines.join('\n');
  }

  // ─── Internal: Empty section defaults ───

  private emptyProgressAnalysis(): ProgressAnalysis {
    return {
      totalMissions: 0, completedMissions: 0,
      totalTasks: 0, completedTasks: 0,
      overallProgress: 0, delayedItems: [], onTrackItems: [],
    };
  }

  private emptyCostAnalysis(): CostAnalysisResult {
    return {
      plannedCost: 0, actualCost: 0,
      variance: 0, variancePercentage: 0,
      costByMission: {}, costByAgent: {}, costByModel: {},
    };
  }

  private emptyRiskAnalysis(): RiskAssessment {
    return { risks: [], overallRiskLevel: 'low' };
  }

  // ─── Internal: Audit ───

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
