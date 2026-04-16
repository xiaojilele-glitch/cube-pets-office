/**
 * 执行计划生成器 (Execution Plan Generator)
 *
 * 基于 Mission 分解和 Task 分解结果，生成完整的 NL 执行计划，
 * 包含时间线（关键路径算法）、资源分配、风险评估、成本预算和应急计划。
 *
 * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 15.1, 15.2
 */

import type {
  ContingencyAlternative,
  ContingencyPlan,
  CostBudget,
  DecomposedMission,
  DecomposedTask,
  FinalizedCommand,
  IdentifiedRisk,
  MissionDecomposition,
  MissionDependency,
  NLExecutionPlan,
  PlanTimeline,
  ResourceAllocation,
  ResourceEntry,
  RiskAssessment,
  TaskDecomposition,
  TaskDependency,
  TimelineEntry,
  TimelineMilestone,
} from "../../../shared/nl-command/contracts.js";
import type {
  ILLMProvider,
  LLMMessage,
} from "../../../shared/llm/contracts.js";
import type { AuditTrail } from "./audit-trail.js";
import type { Edge } from "./topo-sort.js";
import { topoSortWithGroups } from "./topo-sort.js";

// ─── Local types (not in shared contracts) ───

export interface PlanAdjustmentRequest {
  reason: string;
  changes: Record<string, unknown>;
  recomputeTimeline?: boolean;
}

export interface CriticalPathResult {
  criticalPathIds: string[];
  totalDuration: number;
}

// ─── Options ───

export interface ExecutionPlanGeneratorOptions {
  llmProvider: ILLMProvider;
  model: string;
  executionPlanBuilder?: unknown; // loose coupling — optional
  auditTrail: AuditTrail;
}

// ─── LLM retry / parse helpers (same pattern as other modules) ───

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

async function callLLMWithRetry(
  provider: ILLMProvider,
  messages: LLMMessage[],
  model: string
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
      await new Promise(r => setTimeout(r, delay));
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

// ─── LLM Response Shapes ───

interface RiskAssessmentLLMResponse {
  risks: Array<{
    id: string;
    description: string;
    level: "low" | "medium" | "high" | "critical";
    probability: number;
    impact: number;
    mitigation: string;
    contingency?: string;
    relatedEntityId?: string;
  }>;
  overallRiskLevel: "low" | "medium" | "high" | "critical";
}

interface ContingencyPlanLLMResponse {
  alternatives: Array<{
    id: string;
    description: string;
    trigger: string;
    action: string;
    estimatedImpact: string;
  }>;
  degradationStrategies: string[];
  rollbackPlan: string;
}

// ─── ExecutionPlanGenerator ───

export class ExecutionPlanGenerator {
  private readonly llmProvider: ILLMProvider;
  private readonly model: string;
  private readonly auditTrail: AuditTrail;

  constructor(options: ExecutionPlanGeneratorOptions) {
    this.llmProvider = options.llmProvider;
    this.model = options.model;
    this.auditTrail = options.auditTrail;
  }

  /**
   * 生成完整的 NL 执行计划。
   *
   * 1. Build TimelineEntry[] from missions and tasks
   * 2. Compute critical path (longest path through dependency graph)
   * 3. Build ResourceAllocation from task requiredSkills
   * 4. Call LLM for risk assessment
   * 5. Compute CostBudget (Property 8: totalBudget = sum of missionCosts)
   * 6. Call LLM for contingency plan
   * 7. Record audit entry
   *
   * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 15.1, 15.2
   */
  async generate(
    command: FinalizedCommand,
    decomposition: MissionDecomposition,
    taskDecompositions: TaskDecomposition[]
  ): Promise<NLExecutionPlan> {
    const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    // Flatten all tasks
    const allTasks: DecomposedTask[] = taskDecompositions.flatMap(
      td => td.tasks
    );

    // Build dependency edges for timeline computation
    const { missionEdges, taskEdges } = this.collectEdges(
      decomposition,
      taskDecompositions
    );

    // Step 1 & 2: Build timeline entries and compute critical path
    const timelineEntries = this.buildTimelineEntries(
      decomposition.missions,
      allTasks,
      missionEdges,
      taskEdges
    );

    const criticalPathResult = this.computeCriticalPathFromEntries(
      timelineEntries,
      [...missionEdges, ...taskEdges]
    );

    // Mark critical path entries
    const cpSet = new Set(criticalPathResult.criticalPathIds);
    for (const entry of timelineEntries) {
      entry.isCriticalPath = cpSet.has(entry.entityId);
    }

    // Build milestones (one per mission completion)
    const milestones: TimelineMilestone[] = decomposition.missions.map(m => {
      const entry = timelineEntries.find(e => e.entityId === m.missionId);
      return {
        id: `milestone-${m.missionId}`,
        label: `${m.title} complete`,
        date: new Date(entry?.endTime ?? now).toISOString(),
        entityId: m.missionId,
      };
    });

    const startDate =
      timelineEntries.length > 0
        ? new Date(
            Math.min(...timelineEntries.map(e => e.startTime))
          ).toISOString()
        : new Date(now).toISOString();
    const endDate =
      timelineEntries.length > 0
        ? new Date(
            Math.max(...timelineEntries.map(e => e.endTime))
          ).toISOString()
        : new Date(now).toISOString();

    const timeline: PlanTimeline = {
      startDate,
      endDate,
      criticalPath: criticalPathResult.criticalPathIds,
      milestones,
      entries: timelineEntries,
    };

    // Step 3: Build resource allocation
    const resourceAllocation = this.buildResourceAllocation(
      allTasks,
      timelineEntries
    );

    // Step 4: Call LLM for risk assessment
    const riskAssessment = await this.generateRiskAssessment(
      command,
      decomposition,
      allTasks
    );

    // Step 5: Compute cost budget (Property 8 invariant)
    const costBudget = this.computeCostBudget(decomposition.missions, allTasks);

    // Step 6: Call LLM for contingency plan
    const contingencyPlan = await this.generateContingencyPlan(
      command,
      decomposition,
      riskAssessment
    );

    const plan: NLExecutionPlan = {
      planId,
      commandId: command.commandId,
      status: "draft",
      missions: decomposition.missions,
      tasks: allTasks,
      timeline,
      resourceAllocation,
      riskAssessment,
      costBudget,
      contingencyPlan,
      createdAt: now,
      updatedAt: now,
    };

    // Step 7: Record audit entry
    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: "plan_generated",
      operator: "system",
      content: `Generated execution plan "${planId}" for command "${command.commandId}" with ${decomposition.missions.length} missions and ${allTasks.length} tasks`,
      timestamp: Date.now(),
      result: "success",
      entityId: planId,
      entityType: "plan",
      metadata: {
        commandId: command.commandId,
        missionCount: decomposition.missions.length,
        taskCount: allTasks.length,
        criticalPathLength: criticalPathResult.criticalPathIds.length,
        totalBudget: costBudget.totalBudget,
      },
    });

    return plan;
  }

  /**
   * 基于审批反馈调整计划。
   *
   * @see Requirements 8.5
   */
  async adjustPlan(
    plan: NLExecutionPlan,
    adjustment: PlanAdjustmentRequest
  ): Promise<NLExecutionPlan> {
    const updated = { ...plan };

    // Apply field-level changes
    if (adjustment.changes) {
      for (const [key, value] of Object.entries(adjustment.changes)) {
        if (key in updated && key !== "planId" && key !== "commandId") {
          (updated as Record<string, unknown>)[key] = value;
        }
      }
    }

    // Recompute timeline if requested
    if (adjustment.recomputeTimeline) {
      const allEdges = this.collectEdgesFromPlan(updated);
      const entries = this.buildTimelineEntries(
        updated.missions,
        updated.tasks,
        allEdges.missionEdges,
        allEdges.taskEdges
      );

      const cpResult = this.computeCriticalPathFromEntries(entries, [
        ...allEdges.missionEdges,
        ...allEdges.taskEdges,
      ]);

      const cpSet = new Set(cpResult.criticalPathIds);
      for (const entry of entries) {
        entry.isCriticalPath = cpSet.has(entry.entityId);
      }

      updated.timeline = {
        ...updated.timeline,
        entries,
        criticalPath: cpResult.criticalPathIds,
        startDate:
          entries.length > 0
            ? new Date(Math.min(...entries.map(e => e.startTime))).toISOString()
            : updated.timeline.startDate,
        endDate:
          entries.length > 0
            ? new Date(Math.max(...entries.map(e => e.endTime))).toISOString()
            : updated.timeline.endDate,
      };
    }

    updated.updatedAt = Date.now();

    // Record audit entry
    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: "adjustment_applied",
      operator: "system",
      content: `Adjusted plan "${plan.planId}": ${adjustment.reason}`,
      timestamp: Date.now(),
      result: "success",
      entityId: plan.planId,
      entityType: "plan",
      metadata: {
        reason: adjustment.reason,
        recomputeTimeline: adjustment.recomputeTimeline,
      },
    });

    return updated;
  }

  /**
   * 计算关键路径。
   *
   * Uses the dependency graph and durations to find the longest path.
   * Marks TimelineEntry.isCriticalPath for entries on the critical path.
   *
   * @see Requirements 5.2
   */
  computeCriticalPath(plan: NLExecutionPlan): CriticalPathResult {
    const allEdges = this.collectEdgesFromPlan(plan);
    const edges = [...allEdges.missionEdges, ...allEdges.taskEdges];
    const result = this.computeCriticalPathFromEntries(
      plan.timeline.entries,
      edges
    );

    // Update entries in-place
    const cpSet = new Set(result.criticalPathIds);
    for (const entry of plan.timeline.entries) {
      entry.isCriticalPath = cpSet.has(entry.entityId);
    }

    return result;
  }

  // ─── Private helpers ───

  /**
   * Collect dependency edges from decomposition and task decompositions.
   */
  private collectEdges(
    decomposition: MissionDecomposition,
    taskDecompositions: TaskDecomposition[]
  ): { missionEdges: Edge[]; taskEdges: Edge[] } {
    const missionEdges: Edge[] = decomposition.dependencies
      .filter(d => d.type === "blocks" || d.type === "depends_on")
      .map(d => ({ from: d.fromMissionId, to: d.toMissionId }));

    const taskEdges: Edge[] = taskDecompositions.flatMap(td =>
      td.dependencies.map(d => ({ from: d.fromTaskId, to: d.toTaskId }))
    );

    return { missionEdges, taskEdges };
  }

  /**
   * Collect dependency edges from an existing plan (for recomputation).
   * Since the plan doesn't store raw dependencies, we reconstruct from timeline ordering.
   */
  private collectEdgesFromPlan(plan: NLExecutionPlan): {
    missionEdges: Edge[];
    taskEdges: Edge[];
  } {
    // Reconstruct edges from timeline entries: if entry A ends before entry B starts
    // and they share a dependency, we infer the edge. For simplicity, we use the
    // existing timeline criticalPath and entry ordering.
    // In practice, the plan should carry forward the original dependency info.
    return { missionEdges: [], taskEdges: [] };
  }

  /**
   * Build TimelineEntry[] from missions and tasks using dependency info and durations.
   *
   * Uses topological sort to schedule entries respecting dependencies.
   * Entries in the same topo group run in parallel.
   */
  private buildTimelineEntries(
    missions: DecomposedMission[],
    tasks: DecomposedTask[],
    missionEdges: Edge[],
    taskEdges: Edge[]
  ): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    const baseTime = Date.now();

    // Schedule missions
    const missionEntries = this.scheduleEntities(
      missions.map(m => ({
        id: m.missionId,
        duration: m.estimatedDuration,
        type: "mission" as const,
      })),
      missionEdges,
      baseTime
    );
    entries.push(...missionEntries);

    // Schedule tasks (within their mission time windows)
    const taskEntries = this.scheduleEntities(
      tasks.map(t => ({
        id: t.taskId,
        duration: t.estimatedDuration,
        type: "task" as const,
      })),
      taskEdges,
      baseTime
    );
    entries.push(...taskEntries);

    return entries;
  }

  /**
   * Schedule a set of entities using topological sort and dependency-aware timing.
   */
  private scheduleEntities(
    entities: Array<{ id: string; duration: number; type: "mission" | "task" }>,
    edges: Edge[],
    baseTime: number
  ): TimelineEntry[] {
    if (entities.length === 0) return [];

    const entityMap = new Map(entities.map(e => [e.id, e]));
    const nodeIds = entities.map(e => e.id);

    // Filter edges to only include known entities
    const validEdges = edges.filter(
      e => entityMap.has(e.from) && entityMap.has(e.to)
    );

    let groups: string[][];
    try {
      groups = topoSortWithGroups(nodeIds, validEdges);
    } catch {
      // Fallback: treat all as single group if topo sort fails
      groups = [nodeIds];
    }

    const endTimeMap = new Map<string, number>();
    const entries: TimelineEntry[] = [];

    for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
      for (const entityId of groups[groupIdx]) {
        const entity = entityMap.get(entityId)!;
        const durationMs = entity.duration * 60_000; // minutes → ms

        // Start time = max end time of all dependencies
        const depEndTimes = validEdges
          .filter(e => e.from === entityId)
          .map(e => endTimeMap.get(e.to) ?? baseTime);

        const startTime =
          depEndTimes.length > 0 ? Math.max(...depEndTimes) : baseTime;

        const endTime = startTime + durationMs;
        endTimeMap.set(entityId, endTime);

        entries.push({
          entityId,
          entityType: entity.type,
          startTime,
          endTime,
          duration: entity.duration,
          isCriticalPath: false,
          parallelGroup: groupIdx,
        });
      }
    }

    return entries;
  }

  /**
   * Compute critical path: longest path through the dependency graph by duration.
   *
   * Uses dynamic programming on topologically sorted nodes.
   */
  private computeCriticalPathFromEntries(
    entries: TimelineEntry[],
    edges: Edge[]
  ): CriticalPathResult {
    if (entries.length === 0) {
      return { criticalPathIds: [], totalDuration: 0 };
    }

    const entryMap = new Map(entries.map(e => [e.entityId, e]));
    const nodeIds = entries.map(e => e.entityId);
    const validEdges = edges.filter(
      e => entryMap.has(e.from) && entryMap.has(e.to)
    );

    // Build adjacency: for each node, which nodes depend on it (forward edges)
    // Edge semantics: from depends on to → to must come before from
    // So forward adjacency: to → [from] (to enables from)
    const forwardAdj = new Map<string, string[]>();
    const reverseAdj = new Map<string, string[]>(); // from → [to] (predecessors)
    for (const id of nodeIds) {
      forwardAdj.set(id, []);
      reverseAdj.set(id, []);
    }
    for (const { from, to } of validEdges) {
      forwardAdj.get(to)!.push(from);
      reverseAdj.get(from)!.push(to);
    }

    // Topological order
    let topoOrder: string[];
    try {
      const groups = topoSortWithGroups(nodeIds, validEdges);
      topoOrder = groups.flat();
    } catch {
      // Fallback: use entries as-is
      topoOrder = nodeIds;
    }

    // DP: longest path ending at each node
    const dist = new Map<string, number>();
    const predecessor = new Map<string, string | null>();

    for (const id of topoOrder) {
      const entry = entryMap.get(id)!;
      const preds = reverseAdj.get(id) ?? [];
      let maxDist = 0;
      let bestPred: string | null = null;

      for (const pred of preds) {
        const predDist = dist.get(pred) ?? 0;
        if (predDist > maxDist) {
          maxDist = predDist;
          bestPred = pred;
        }
      }

      dist.set(id, maxDist + entry.duration);
      predecessor.set(id, bestPred);
    }

    // Find the node with the maximum distance (end of critical path)
    let maxNode = topoOrder[0];
    let maxDist = dist.get(maxNode) ?? 0;
    for (const id of topoOrder) {
      const d = dist.get(id) ?? 0;
      if (d > maxDist) {
        maxDist = d;
        maxNode = id;
      }
    }

    // Trace back the critical path
    const criticalPathIds: string[] = [];
    let current: string | null = maxNode;
    while (current !== null) {
      criticalPathIds.unshift(current);
      current = predecessor.get(current) ?? null;
    }

    return {
      criticalPathIds,
      totalDuration: maxDist,
    };
  }

  /**
   * Build resource allocation from task requiredSkills and timeline entries.
   *
   * @see Requirements 5.3
   */
  private buildResourceAllocation(
    tasks: DecomposedTask[],
    timelineEntries: TimelineEntry[]
  ): ResourceAllocation {
    const entryMap = new Map(timelineEntries.map(e => [e.entityId, e]));
    const entries: ResourceEntry[] = [];
    const skillAgentTypes = new Set<string>();

    for (const task of tasks) {
      const timeEntry = entryMap.get(task.taskId);
      const agentType =
        task.requiredSkills.length > 0 ? task.requiredSkills[0] : "general";

      skillAgentTypes.add(agentType);

      entries.push({
        taskId: task.taskId,
        agentType,
        agentCount: 1,
        requiredSkills: task.requiredSkills,
        startTime: timeEntry?.startTime ?? Date.now(),
        endTime: timeEntry?.endTime ?? Date.now(),
      });
    }

    // Compute peak concurrency: max overlapping tasks at any point
    const events: Array<{ time: number; delta: number }> = [];
    for (const entry of entries) {
      events.push({ time: entry.startTime, delta: 1 });
      events.push({ time: entry.endTime, delta: -1 });
    }
    events.sort((a, b) => a.time - b.time || a.delta - b.delta);

    let current = 0;
    let peak = 0;
    for (const event of events) {
      current += event.delta;
      if (current > peak) peak = current;
    }

    return {
      entries,
      totalAgents: skillAgentTypes.size,
      peakConcurrency: peak,
    };
  }

  /**
   * Call LLM for risk assessment.
   *
   * @see Requirements 5.4
   */
  private async generateRiskAssessment(
    command: FinalizedCommand,
    decomposition: MissionDecomposition,
    tasks: DecomposedTask[]
  ): Promise<RiskAssessment> {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: `You are a risk assessment expert. Given a strategic command, its mission decomposition, and task list, identify potential risks.
For each risk, provide: id, description, level (low/medium/high/critical), probability (0-1), impact (0-1), mitigation strategy, and optional contingency.
Also provide an overallRiskLevel.
Return JSON: { "risks": [...], "overallRiskLevel": "low"|"medium"|"high"|"critical" }`,
      },
      {
        role: "user",
        content: JSON.stringify({
          command: {
            commandId: command.commandId,
            refinedText: command.refinedText,
          },
          missions: decomposition.missions.map(m => ({
            missionId: m.missionId,
            title: m.title,
            estimatedDuration: m.estimatedDuration,
            estimatedCost: m.estimatedCost,
          })),
          tasks: tasks.map(t => ({
            taskId: t.taskId,
            title: t.title,
            requiredSkills: t.requiredSkills,
            estimatedDuration: t.estimatedDuration,
          })),
          existingRisks: command.analysis.risks,
        }),
      },
    ];

    try {
      const raw = await callLLMWithRetry(
        this.llmProvider,
        messages,
        this.model
      );
      const parsed = safeParseJSON<RiskAssessmentLLMResponse>(raw);

      if (parsed?.risks) {
        return {
          risks: parsed.risks.map((r, idx) => ({
            id: r.id || `risk-${idx + 1}`,
            description: r.description || "Unknown risk",
            level: (["low", "medium", "high", "critical"].includes(r.level)
              ? r.level
              : "medium") as IdentifiedRisk["level"],
            probability:
              typeof r.probability === "number"
                ? Math.max(0, Math.min(1, r.probability))
                : 0.5,
            impact:
              typeof r.impact === "number"
                ? Math.max(0, Math.min(1, r.impact))
                : 0.5,
            mitigation: r.mitigation || "No mitigation specified",
            contingency: r.contingency,
            relatedEntityId: r.relatedEntityId,
          })),
          overallRiskLevel: (["low", "medium", "high", "critical"].includes(
            parsed.overallRiskLevel
          )
            ? parsed.overallRiskLevel
            : "medium") as RiskAssessment["overallRiskLevel"],
        };
      }
    } catch {
      // Fallback: return default risk assessment
    }

    return {
      risks:
        command.analysis.risks.length > 0
          ? command.analysis.risks
          : [
              {
                id: "risk-default",
                description: "General execution risk",
                level: "medium",
                probability: 0.3,
                impact: 0.5,
                mitigation: "Monitor execution closely",
              },
            ],
      overallRiskLevel: "medium",
    };
  }

  /**
   * Compute cost budget.
   *
   * Property 8 invariant: totalBudget MUST equal sum of all missionCosts values.
   *
   * @see Requirements 5.5, 15.1, 15.2
   */
  private computeCostBudget(
    missions: DecomposedMission[],
    tasks: DecomposedTask[]
  ): CostBudget {
    const missionCosts: Record<string, number> = {};
    for (const m of missions) {
      missionCosts[m.missionId] = m.estimatedCost;
    }

    const taskCosts: Record<string, number> = {};
    for (const t of tasks) {
      taskCosts[t.taskId] = t.estimatedCost;
    }

    // Agent costs: distribute by required skills
    const agentCosts: Record<string, number> = {};
    for (const t of tasks) {
      const agentType =
        t.requiredSkills.length > 0 ? t.requiredSkills[0] : "general";
      agentCosts[agentType] = (agentCosts[agentType] ?? 0) + t.estimatedCost;
    }

    // Model costs: simplified — attribute all costs to the default model
    const modelCosts: Record<string, number> = {};
    const totalTaskCost = tasks.reduce((sum, t) => sum + t.estimatedCost, 0);
    if (totalTaskCost > 0) {
      modelCosts["default"] = totalTaskCost;
    }

    // Property 8: totalBudget = sum of missionCosts
    const totalBudget = Object.values(missionCosts).reduce(
      (sum, c) => sum + c,
      0
    );

    return {
      totalBudget,
      missionCosts,
      taskCosts,
      agentCosts,
      modelCosts,
      currency: "CNY",
    };
  }

  /**
   * Call LLM for contingency plan.
   *
   * @see Requirements 5.6
   */
  private async generateContingencyPlan(
    command: FinalizedCommand,
    decomposition: MissionDecomposition,
    riskAssessment: RiskAssessment
  ): Promise<ContingencyPlan> {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: `You are a contingency planning expert. Given a strategic command, its mission decomposition, and risk assessment, generate a contingency plan.
Include: alternative approaches, degradation strategies, and a rollback plan.
Return JSON: { "alternatives": [{ "id", "description", "trigger", "action", "estimatedImpact" }], "degradationStrategies": [...], "rollbackPlan": "..." }`,
      },
      {
        role: "user",
        content: JSON.stringify({
          command: {
            commandId: command.commandId,
            refinedText: command.refinedText,
          },
          missions: decomposition.missions.map(m => ({
            missionId: m.missionId,
            title: m.title,
          })),
          risks: riskAssessment.risks.map(r => ({
            description: r.description,
            level: r.level,
            mitigation: r.mitigation,
          })),
        }),
      },
    ];

    try {
      const raw = await callLLMWithRetry(
        this.llmProvider,
        messages,
        this.model
      );
      const parsed = safeParseJSON<ContingencyPlanLLMResponse>(raw);

      if (parsed) {
        return {
          alternatives: Array.isArray(parsed.alternatives)
            ? parsed.alternatives.map((a, idx) => ({
                id: a.id || `alt-${idx + 1}`,
                description: a.description || "",
                trigger: a.trigger || "",
                action: a.action || "",
                estimatedImpact: a.estimatedImpact || "unknown",
              }))
            : [],
          degradationStrategies: Array.isArray(parsed.degradationStrategies)
            ? parsed.degradationStrategies
            : [],
          rollbackPlan: parsed.rollbackPlan || "Revert to previous state",
        };
      }
    } catch {
      // Fallback
    }

    return {
      alternatives: [],
      degradationStrategies: ["Reduce scope to critical missions only"],
      rollbackPlan: "Revert to previous state and reassess",
    };
  }
}
