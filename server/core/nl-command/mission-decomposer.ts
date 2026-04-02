/**
 * Mission 分解器 (Mission Decomposer)
 *
 * 将最终确认的指令 (FinalizedCommand) 分解为多个 Mission，
 * 识别依赖关系，生成拓扑排序的执行顺序，检测循环依赖，
 * 并可选触发动态组织生成。
 *
 * @see Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 14.1, 14.2, 14.3
 */

import type {
  CommandConstraint,
  CommandPriority,
  DecomposedMission,
  FinalizedCommand,
  MissionDecomposition,
  MissionDependency,
} from '../../../shared/nl-command/contracts.js';
import type { ILLMProvider, LLMMessage } from '../../../shared/llm/contracts.js';
import type { WorkflowOrganizationSnapshot } from '../../../shared/organization-schema.js';
import type { AuditTrail } from './audit-trail.js';
import { topoSortWithGroups, CyclicDependencyError } from './topo-sort.js';
import type { Edge } from './topo-sort.js';

// ─── Options ───

export interface MissionDecomposerOptions {
  llmProvider: ILLMProvider;
  model: string;
  auditTrail: AuditTrail;
  /** Callback invoked after each mission is decomposed (e.g. to create MissionRecord) */
  onMissionCreated?: (mission: DecomposedMission) => Promise<void>;
  /** Callback to trigger organization generation for a mission */
  onOrganizationNeeded?: (missionId: string, complexity: number) => Promise<WorkflowOrganizationSnapshot>;
}

// ─── LLM retry / parse helpers (same pattern as command-analyzer) ───

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
      if (!isTemporary || attempt === MAX_RETRIES) {
        break;
      }
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

// ─── LLM Response Shapes ───

interface MissionsLLMResponse {
  missions: Array<{
    missionId: string;
    title: string;
    description: string;
    objectives: string[];
    constraints: Array<{
      type: CommandConstraint['type'];
      description: string;
      value?: string;
      unit?: string;
    }>;
    estimatedDuration: number;
    estimatedCost: number;
    priority: CommandPriority;
  }>;
}

interface DependenciesLLMResponse {
  dependencies: Array<{
    fromMissionId: string;
    toMissionId: string;
    type: 'blocks' | 'depends_on' | 'related';
    description?: string;
  }>;
}

// ─── MissionDecomposer ───

export class MissionDecomposer {
  private readonly llmProvider: ILLMProvider;
  private readonly model: string;
  private readonly auditTrail: AuditTrail;
  private readonly onMissionCreated?: (mission: DecomposedMission) => Promise<void>;
  private readonly onOrganizationNeeded?: (missionId: string, complexity: number) => Promise<WorkflowOrganizationSnapshot>;

  constructor(options: MissionDecomposerOptions) {
    this.llmProvider = options.llmProvider;
    this.model = options.model;
    this.auditTrail = options.auditTrail;
    this.onMissionCreated = options.onMissionCreated;
    this.onOrganizationNeeded = options.onOrganizationNeeded;
  }

  /**
   * 将 FinalizedCommand 分解为多个 Mission，识别依赖关系，
   * 生成拓扑排序的执行顺序。
   *
   * @see Requirements 3.2, 3.3, 3.4, 3.5, 3.6
   */
  async decompose(command: FinalizedCommand): Promise<MissionDecomposition> {
    const decompositionId = `decomp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Step 1: Call LLM to generate mission list
    const missions = await this.generateMissions(command);

    // Step 2: Call LLM to identify dependencies
    const dependencies = await this.identifyDependencies(command, missions);

    // Step 3: Compute topological execution order
    const missionIds = missions.map((m) => m.missionId);
    const edges: Edge[] = dependencies
      .filter((d) => d.type === 'blocks' || d.type === 'depends_on')
      .map((d) => ({ from: d.fromMissionId, to: d.toMissionId }));

    let executionOrder: string[][];
    try {
      executionOrder = topoSortWithGroups(missionIds, edges);
    } catch (err) {
      if (err instanceof CyclicDependencyError) {
        // Record audit entry for cyclic dependency failure
        await this.auditTrail.record({
          entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          operationType: 'decomposition_completed',
          operator: 'system',
          content: `Decomposition failed: cyclic dependency detected — ${err.message}`,
          timestamp: Date.now(),
          result: 'failure',
          entityId: command.commandId,
          entityType: 'command',
          metadata: { decompositionId, cycle: err.cycle },
        });
        throw err;
      }
      throw err;
    }

    // Step 4: Notify callbacks for each mission
    if (this.onMissionCreated) {
      for (const mission of missions) {
        await this.onMissionCreated(mission);
      }
    }

    const totalEstimatedDuration = missions.reduce((sum, m) => sum + m.estimatedDuration, 0);
    const totalEstimatedCost = missions.reduce((sum, m) => sum + m.estimatedCost, 0);

    const result: MissionDecomposition = {
      decompositionId,
      commandId: command.commandId,
      missions,
      dependencies,
      executionOrder,
      totalEstimatedDuration,
      totalEstimatedCost,
    };

    // Step 5: Record audit entry
    await this.auditTrail.record({
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: 'decomposition_completed',
      operator: 'system',
      content: `Decomposed command into ${missions.length} missions with ${dependencies.length} dependencies`,
      timestamp: Date.now(),
      result: 'success',
      entityId: command.commandId,
      entityType: 'command',
      metadata: { decompositionId, missionCount: missions.length },
    });

    return result;
  }

  /**
   * 为单个 Mission 生成组织结构（通过回调委托）。
   *
   * @see Requirements 14.1, 14.2, 14.3
   */
  async generateOrganization(
    missionId: string,
    complexity: number,
  ): Promise<WorkflowOrganizationSnapshot | null> {
    if (!this.onOrganizationNeeded) {
      return null;
    }
    return this.onOrganizationNeeded(missionId, complexity);
  }

  // ─── Private helpers ───

  private async generateMissions(command: FinalizedCommand): Promise<DecomposedMission[]> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a strategic mission decomposer. Given a finalized command, decompose it into concrete, actionable missions.
Each mission should have a unique missionId (format: "mission-<index>"), title, description, objectives, constraints, estimatedDuration (in minutes), estimatedCost (numeric), and priority.
Return JSON: { "missions": [...] }`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          commandId: command.commandId,
          originalText: command.originalText,
          refinedText: command.refinedText,
          intent: command.analysis.intent,
          objectives: command.analysis.objectives,
          constraints: command.analysis.constraints,
          entities: command.analysis.entities,
        }),
      },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<MissionsLLMResponse>(raw);

    if (!parsed?.missions?.length) {
      throw new Error('LLM returned empty or invalid mission list');
    }

    return parsed.missions.map((m, idx) => ({
      missionId: m.missionId || `mission-${idx + 1}`,
      title: m.title || `Mission ${idx + 1}`,
      description: m.description || '',
      objectives: Array.isArray(m.objectives) ? m.objectives : [],
      constraints: Array.isArray(m.constraints) ? m.constraints : [],
      estimatedDuration: typeof m.estimatedDuration === 'number' ? m.estimatedDuration : 60,
      estimatedCost: typeof m.estimatedCost === 'number' ? m.estimatedCost : 0,
      priority: (['critical', 'high', 'medium', 'low'].includes(m.priority) ? m.priority : 'medium') as CommandPriority,
    }));
  }

  private async identifyDependencies(
    command: FinalizedCommand,
    missions: DecomposedMission[],
  ): Promise<MissionDependency[]> {
    if (missions.length <= 1) {
      return [];
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a dependency analyzer. Given a list of missions decomposed from a strategic command, identify dependency relationships between them.
Dependency types: "blocks" (A must complete before B starts), "depends_on" (B needs output from A), "related" (informational).
Only include real dependencies. Return JSON: { "dependencies": [{ "fromMissionId", "toMissionId", "type", "description" }] }
fromMissionId depends on toMissionId (toMissionId must execute first).`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          commandIntent: command.analysis.intent,
          missions: missions.map((m) => ({
            missionId: m.missionId,
            title: m.title,
            description: m.description,
            objectives: m.objectives,
          })),
        }),
      },
    ];

    const raw = await callLLMWithRetry(this.llmProvider, messages, this.model);
    const parsed = safeParseJSON<DependenciesLLMResponse>(raw);

    if (!parsed?.dependencies) {
      return [];
    }

    const validIds = new Set(missions.map((m) => m.missionId));

    return parsed.dependencies
      .filter(
        (d) =>
          validIds.has(d.fromMissionId) &&
          validIds.has(d.toMissionId) &&
          d.fromMissionId !== d.toMissionId &&
          ['blocks', 'depends_on', 'related'].includes(d.type),
      )
      .map((d) => ({
        fromMissionId: d.fromMissionId,
        toMissionId: d.toMissionId,
        type: d.type as MissionDependency['type'],
        description: d.description,
      }));
  }
}
