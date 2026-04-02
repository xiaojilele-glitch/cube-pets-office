import type {
  AutonomyConfig,
  CompetitionSession,
  ContestantEntry,
} from '../../shared/autonomy-types.js';
import type { CapabilityProfileManager } from './capability-profile-manager.js';
import type { TaskRequest } from './self-assessment.js';

// ─── Local Types ─────────────────────────────────────────────

/** Extended task request with competition-specific fields. */
export interface CompetitionTaskRequest extends TaskRequest {
  priority: 'critical' | 'high' | 'normal' | 'low';
  qualityRequirement: 'high' | 'normal' | 'low';
  dataSecurityLevel: 'sensitive' | 'normal';
  estimatedDurationMs: number;
  manualCompetition: boolean;
  historicalFailRate: number;
  descriptionAmbiguity: number;
}

/** Minimal CostMonitor interface — real implementation in Task 9. */
export interface CostMonitor {
  checkCompetitionBudget(
    estimatedTokens: number,
    missionRemainingBudget: number,
  ): { approved: boolean; reason?: string };
}

// ─── CompetitionEngine ──────────────────────────────────────

/**
 * Handles competition-mode triggering, contestant selection,
 * session creation, data-security checks, and deadline computation.
 */
export class CompetitionEngine {
  constructor(
    private readonly profileManager: CapabilityProfileManager,
    private readonly costMonitor: CostMonitor,
    private readonly config: AutonomyConfig,
  ) {}

  /**
   * Return true if competition mode should be triggered.
   *
   * Conditions (any one suffices):
   * - task.priority === 'critical'
   * - task.qualityRequirement === 'high'
   * - computeUncertainty(task, bestFitness) > 0.7
   * - task.manualCompetition === true
   */
  shouldTrigger(task: CompetitionTaskRequest, bestFitness: number): boolean {
    if (task.priority === 'critical') return true;
    if (task.qualityRequirement === 'high') return true;
    if (this.computeUncertainty(task, bestFitness) > 0.7) return true;
    if (task.manualCompetition === true) return true;
    return false;
  }

  /**
   * Compute task uncertainty as a weighted combination.
   *
   * uncertainty = 0.4 * historicalFailRate
   *             + 0.35 * (1 - bestFitness)
   *             + 0.25 * descriptionAmbiguity
   *
   * Result clamped to [0, 1].
   */
  computeUncertainty(task: CompetitionTaskRequest, bestFitness: number): number {
    const raw =
      0.4 * task.historicalFailRate +
      0.35 * (1 - bestFitness) +
      0.25 * task.descriptionAmbiguity;
    return clamp(raw, 0, 1);
  }

  /**
   * Diversity-first contestant selection.
   *
   * 1. Pick the candidate with the highest fitnessScore as seed.
   * 2. For each subsequent slot, pick the candidate with the maximum
   *    cosine distance from the already-selected set AND fitnessScore >= 0.5.
   * 3. Return exactly `count` agents (or fewer if not enough qualify).
   */
  selectContestants(candidates: string[], count: number): string[] {
    if (candidates.length === 0 || count <= 0) return [];

    // Build fitness + skillVector lookup
    const candidateData = candidates
      .map((id) => {
        const profile = this.profileManager.getProfile(id);
        if (!profile) return null;
        // Compute a simple fitnessScore proxy: average of skill values
        const skills = profile.skillVector;
        const vals = Array.from(skills.values());
        const avgSkill = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        // Use confidenceScore as a rough fitness proxy
        const fitness = avgSkill * 0.5 + profile.confidenceScore * 0.5;
        return { id, fitness, skills };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (candidateData.length === 0) return [];

    // Step 1: seed = highest fitness
    candidateData.sort((a, b) => b.fitness - a.fitness);
    const selected: Array<{ id: string; skills: Map<string, number> }> = [];
    const selectedIds = new Set<string>();

    // Always pick the seed (even if fitness < 0.5)
    const seed = candidateData[0];
    selected.push({ id: seed.id, skills: seed.skills });
    selectedIds.add(seed.id);

    // Step 2: subsequent picks — max cosine distance, fitness >= 0.5
    while (selected.length < count) {
      let bestCandidate: typeof candidateData[0] | null = null;
      let bestDistance = -1;

      for (const candidate of candidateData) {
        if (selectedIds.has(candidate.id)) continue;
        if (candidate.fitness < 0.5) continue;

        // Compute minimum cosine distance to any already-selected agent
        const minDist = Math.min(
          ...selected.map((s) => cosineDistance(candidate.skills, s.skills)),
        );

        if (minDist > bestDistance) {
          bestDistance = minDist;
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) break; // no more qualifying candidates
      selected.push({ id: bestCandidate.id, skills: bestCandidate.skills });
      selectedIds.add(bestCandidate.id);
    }

    return selected.map((s) => s.id);
  }

  /**
   * Create a CompetitionSession. For now, sets up the session structure
   * with status "running". Actual parallel execution will be integrated later.
   */
  async runCompetition(
    task: CompetitionTaskRequest,
    contestants: string[],
    deadline: number,
  ): Promise<CompetitionSession> {
    const entries: ContestantEntry[] = contestants.map((agentId) => {
      const profile = this.profileManager.getProfile(agentId);
      const isExternal = profile
        ? profile.specializationTags.includes('external')
        : false;
      return {
        agentId,
        isExternal,
        tokenConsumed: 0,
        timedOut: false,
      };
    });

    const session: CompetitionSession = {
      id: `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.taskId,
      contestants: entries,
      status: 'running',
      deadline,
      budgetApproved: true,
      startedAt: Date.now(),
    };

    return session;
  }

  /**
   * Check data security for an agent on a task.
   *
   * If task.dataSecurityLevel === 'sensitive', external agents are blocked.
   * An agent is considered external if its profile has the 'external' tag.
   * Returns false for external agents on sensitive tasks, true otherwise.
   */
  checkDataSecurity(agentId: string, task: CompetitionTaskRequest): boolean {
    if (task.dataSecurityLevel !== 'sensitive') return true;

    const profile = this.profileManager.getProfile(agentId);
    if (!profile) return false; // unknown agent on sensitive task → block

    const isExternal = profile.specializationTags.includes('external');
    return !isExternal;
  }

  /**
   * Compute deadline for a competition.
   * Returns min(estimatedDurationMs * 1.5, config.competition.maxDeadlineMs).
   */
  computeDeadline(estimatedDurationMs: number): number {
    return Math.min(
      estimatedDurationMs * 1.5,
      this.config.competition.maxDeadlineMs,
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Cosine distance between two skill vectors.
 * distance = 1 - cosineSimilarity.
 * Returns 1.0 if either vector is zero-magnitude (maximally distant).
 */
function cosineDistance(a: Map<string, number>, b: Map<string, number>): number {
  const allKeys = new Set([...a.keys(), ...b.keys()]);

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const key of allKeys) {
    const va = a.get(key) ?? 0;
    const vb = b.get(key) ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 1.0;

  const similarity = dot / denom;
  return 1 - clamp(similarity, 0, 1);
}
