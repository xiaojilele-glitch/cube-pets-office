/**
 * Task 分解器 (Task Decomposer)
 *
 * 将 DecomposedMission 进一步分解为具体的 Task 列表，
 * 识别 Task 之间的依赖关系，生成拓扑排序的执行顺序，
 * 检测循环依赖。
 *
 * @see Requirements 4.2, 4.3, 4.4, 4.5, 4.6
 */

import type {
  CommandConstraint,
  CommandPriority,
  DecomposedMission,
  DecomposedTask,
  MissionDecomposition,
  TaskDecomposition,
  TaskDependency,
} from "../../../shared/nl-command/contracts.js";
import type {
  ILLMProvider,
  LLMMessage,
} from "../../../shared/llm/contracts.js";
import type { AuditTrail } from "./audit-trail.js";
import { topoSortWithGroups, CyclicDependencyError } from "./topo-sort.js";
import type { Edge } from "./topo-sort.js";

// ─── Options ───

export interface TaskDecomposerOptions {
  llmProvider: ILLMProvider;
  model: string;
  auditTrail: AuditTrail;
}

// ─── LLM retry / parse helpers (same pattern as mission-decomposer) ───

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
      if (!isTemporary || attempt === MAX_RETRIES) {
        break;
      }
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

interface TasksLLMResponse {
  tasks: Array<{
    taskId: string;
    title: string;
    description: string;
    objectives: string[];
    constraints: Array<{
      type: CommandConstraint["type"];
      description: string;
      value?: string;
      unit?: string;
    }>;
    estimatedDuration: number;
    estimatedCost: number;
    requiredSkills: string[];
    priority: CommandPriority;
  }>;
}

interface TaskDependenciesLLMResponse {
  dependencies: Array<{
    fromTaskId: string;
    toTaskId: string;
    type: "blocks" | "depends_on";
    description?: string;
  }>;
}

// ─── TaskDecomposer ───

export class TaskDecomposer {
  private readonly llmProvider: ILLMProvider;
  private readonly model: string;
  private readonly auditTrail: AuditTrail;

  constructor(options: TaskDecomposerOptions) {
    this.llmProvider = options.llmProvider;
    this.model = options.model;
    this.auditTrail = options.auditTrail;
  }

  /**
   * 将 DecomposedMission 分解为 Task 列表，识别依赖关系，
   * 生成拓扑排序的执行顺序。
   *
   * @see Requirements 4.2, 4.3, 4.4, 4.5, 4.6
   */
  async decompose(
    mission: DecomposedMission,
    context: MissionDecomposition
  ): Promise<TaskDecomposition> {
    const decompositionId = `task-decomp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Step 1: Call LLM to generate task list
    const tasks = await this.generateTasks(mission, context);

    // Step 2: Call LLM to identify task dependencies
    const dependencies = await this.identifyDependencies(mission, tasks);

    // Step 3: Compute topological execution order
    const taskIds = tasks.map(t => t.taskId);
    const edges: Edge[] = dependencies.map(d => ({
      from: d.fromTaskId,
      to: d.toTaskId,
    }));

    let executionOrder: string[][];
    try {
      executionOrder = topoSortWithGroups(taskIds, edges);
    } catch (err) {
      if (err instanceof CyclicDependencyError) {
        // Record audit entry for cyclic dependency failure
        await this.auditTrail.record({
          entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          operationType: "decomposition_completed",
          operator: "system",
          content: `Task decomposition failed: cyclic dependency detected — ${err.message}`,
          timestamp: Date.now(),
          result: "failure",
          entityId: mission.missionId,
          entityType: "mission",
          metadata: { decompositionId, cycle: err.cycle },
        });
        throw err;
      }
      throw err;
    }

    const result: TaskDecomposition = {
      decompositionId,
      missionId: mission.missionId,
      tasks,
      dependencies,
      executionOrder,
    };

    // Step 4: Record audit entry
    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: "decomposition_completed",
      operator: "system",
      content: `Decomposed mission "${mission.title}" into ${tasks.length} tasks with ${dependencies.length} dependencies`,
      timestamp: Date.now(),
      result: "success",
      entityId: mission.missionId,
      entityType: "mission",
      metadata: { decompositionId, taskCount: tasks.length },
    });

    return result;
  }

  // ─── Private helpers ───

  private async generateTasks(
    mission: DecomposedMission,
    context: MissionDecomposition
  ): Promise<DecomposedTask[]> {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: `You are a task decomposer. Given a mission and its broader context, decompose the mission into concrete, actionable tasks.
Each task should have a unique taskId (format: "task-<missionIndex>-<taskIndex>"), title, description, objectives, constraints, estimatedDuration (in minutes), estimatedCost (numeric), requiredSkills (array of strings), and priority.
Return JSON: { "tasks": [...] }`,
      },
      {
        role: "user",
        content: JSON.stringify({
          mission: {
            missionId: mission.missionId,
            title: mission.title,
            description: mission.description,
            objectives: mission.objectives,
            constraints: mission.constraints,
            estimatedDuration: mission.estimatedDuration,
            estimatedCost: mission.estimatedCost,
            priority: mission.priority,
          },
          context: {
            commandId: context.commandId,
            totalMissions: context.missions.length,
            relatedMissions: context.missions
              .filter(m => m.missionId !== mission.missionId)
              .map(m => ({ missionId: m.missionId, title: m.title })),
          },
        }),
      },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<TasksLLMResponse>(raw);

    if (!parsed?.tasks?.length) {
      throw new Error("LLM returned empty or invalid task list");
    }

    return parsed.tasks.map((t, idx) => ({
      taskId: t.taskId || `task-${mission.missionId}-${idx + 1}`,
      title: t.title || `Task ${idx + 1}`,
      description: t.description || "",
      objectives: Array.isArray(t.objectives) ? t.objectives : [],
      constraints: Array.isArray(t.constraints) ? t.constraints : [],
      estimatedDuration:
        typeof t.estimatedDuration === "number" ? t.estimatedDuration : 30,
      estimatedCost: typeof t.estimatedCost === "number" ? t.estimatedCost : 0,
      requiredSkills: Array.isArray(t.requiredSkills) ? t.requiredSkills : [],
      priority: (["critical", "high", "medium", "low"].includes(t.priority)
        ? t.priority
        : mission.priority) as CommandPriority,
    }));
  }

  private async identifyDependencies(
    mission: DecomposedMission,
    tasks: DecomposedTask[]
  ): Promise<TaskDependency[]> {
    if (tasks.length <= 1) {
      return [];
    }

    const messages: LLMMessage[] = [
      {
        role: "system",
        content: `You are a dependency analyzer. Given a list of tasks decomposed from a mission, identify dependency relationships between them.
Dependency types: "blocks" (A must complete before B starts), "depends_on" (B needs output from A).
Only include real dependencies. Return JSON: { "dependencies": [{ "fromTaskId", "toTaskId", "type", "description" }] }
fromTaskId depends on toTaskId (toTaskId must execute first).`,
      },
      {
        role: "user",
        content: JSON.stringify({
          missionTitle: mission.title,
          missionDescription: mission.description,
          tasks: tasks.map(t => ({
            taskId: t.taskId,
            title: t.title,
            description: t.description,
            objectives: t.objectives,
          })),
        }),
      },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<TaskDependenciesLLMResponse>(raw);

    if (!parsed?.dependencies) {
      return [];
    }

    const validIds = new Set(tasks.map(t => t.taskId));

    return parsed.dependencies
      .filter(
        d =>
          validIds.has(d.fromTaskId) &&
          validIds.has(d.toTaskId) &&
          d.fromTaskId !== d.toTaskId &&
          ["blocks", "depends_on"].includes(d.type)
      )
      .map(d => ({
        fromTaskId: d.fromTaskId,
        toTaskId: d.toTaskId,
        type: d.type as TaskDependency["type"],
      }));
  }
}
