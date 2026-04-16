import type {
  AllocationDecision,
  AllocationStrategy,
  AssessmentResult,
  AutonomyConfig,
} from "../../shared/autonomy-types.js";
import type { CapabilityProfileManager } from "./capability-profile-manager.js";
import type { SelfAssessment, TaskRequest } from "./self-assessment.js";

// ─── Reject-rate sliding window size ─────────────────────────
const REJECT_WINDOW_SIZE = 50;
const REJECT_ALERT_THRESHOLD = 30; // 60% of 50

// ─── TaskAllocator ───────────────────────────────────────────

/**
 * Intelligent task allocator that broadcasts assessment requests to
 * candidate agents, selects the best match, and falls back to
 * force-assignment when all candidates reject.
 */
export class TaskAllocator {
  /** Sliding window of reject/accept booleans per agent (true = rejected) */
  private rejectHistory: Map<string, boolean[]> = new Map();

  constructor(
    private readonly selfAssessment: SelfAssessment,
    private readonly profileManager: CapabilityProfileManager,
    private readonly config: AutonomyConfig
  ) {}

  /**
   * Full allocation pipeline:
   * 1. Filter candidates by specialization tag overlap
   * 2. If autonomy disabled → static assign (first candidate)
   * 3. Broadcast assessment with timeout
   * 4. Select best agent or force-assign
   * 5. Update reject rates
   */
  async allocateTask(taskRequest: TaskRequest): Promise<AllocationDecision> {
    // 1. Filter candidates
    const candidates = this.filterCandidates(taskRequest.requiredSkills);

    if (candidates.length === 0) {
      return this.buildErrorDecision(
        taskRequest.taskId,
        [],
        "NO_CANDIDATES_AVAILABLE"
      );
    }

    // 2. Static assignment when autonomy is disabled
    if (!this.config.enabled) {
      return this.buildStaticDecision(taskRequest.taskId, candidates[0]);
    }

    // 3. Broadcast assessment
    const results = await this.broadcastAssessment(
      taskRequest,
      candidates,
      200
    );

    // 4. Select best agent
    const decision = this.selectBestAgent(results, taskRequest);

    // 5. If selectBestAgent returned null (all REJECT), force-assign
    const finalDecision = decision ?? this.forceAssign(results, taskRequest);

    // 6. Update reject rates for all assessed agents
    for (const r of results) {
      this.updateRejectRate(r.agentId, r.decision === "REJECT_AND_REFER");
    }

    return finalDecision;
  }

  /**
   * Broadcast assessment requests to all candidates in parallel.
   * Each agent that doesn't respond within `timeoutMs` gets a
   * synthetic REJECT result.
   */
  async broadcastAssessment(
    taskRequest: TaskRequest,
    candidates: string[],
    timeoutMs: number = 200
  ): Promise<AssessmentResult[]> {
    const assessmentPromises = candidates.map(agentId => {
      const assessPromise = Promise.resolve(
        this.selfAssessment.assess(agentId, taskRequest)
      );

      const timeoutPromise = new Promise<AssessmentResult>(resolve => {
        setTimeout(() => {
          resolve({
            agentId,
            taskId: taskRequest.taskId,
            fitnessScore: 0,
            decision: "REJECT_AND_REFER",
            reason: "assessment timeout",
            referralList: [],
            assessedAt: Date.now(),
            durationMs: timeoutMs,
          });
        }, timeoutMs);
      });

      return Promise.race([assessPromise, timeoutPromise]);
    });

    return Promise.all(assessmentPromises);
  }

  /**
   * Select the best agent from assessment results.
   *
   * Priority:
   * 1. ACCEPT with highest fitnessScore → DIRECT_ASSIGN
   * 2. ACCEPT_WITH_CAVEAT with highest fitnessScore → CAVEAT_ASSIGN
   * 3. Only REQUEST_ASSIST → TASKFORCE (pick highest fitness)
   * 4. All REJECT → return null (caller should use forceAssign)
   */
  selectBestAgent(
    results: AssessmentResult[],
    taskRequest: TaskRequest
  ): AllocationDecision | null {
    const accepts = results
      .filter(r => r.decision === "ACCEPT")
      .sort((a, b) => b.fitnessScore - a.fitnessScore);

    if (accepts.length > 0) {
      return this.buildDecision(
        taskRequest.taskId,
        "DIRECT_ASSIGN",
        accepts[0].agentId,
        results,
        `Direct assign to highest-fitness ACCEPT agent (fitness=${accepts[0].fitnessScore.toFixed(3)})`
      );
    }

    const caveats = results
      .filter(r => r.decision === "ACCEPT_WITH_CAVEAT")
      .sort((a, b) => b.fitnessScore - a.fitnessScore);

    if (caveats.length > 0) {
      return this.buildDecision(
        taskRequest.taskId,
        "CAVEAT_ASSIGN",
        caveats[0].agentId,
        results,
        `Caveat assign to highest-fitness ACCEPT_WITH_CAVEAT agent (fitness=${caveats[0].fitnessScore.toFixed(3)})`
      );
    }

    const assists = results
      .filter(r => r.decision === "REQUEST_ASSIST")
      .sort((a, b) => b.fitnessScore - a.fitnessScore);

    if (assists.length > 0) {
      return this.buildDecision(
        taskRequest.taskId,
        "TASKFORCE",
        assists[0].agentId,
        results,
        `Taskforce strategy: highest-fitness REQUEST_ASSIST agent (fitness=${assists[0].fitnessScore.toFixed(3)})`
      );
    }

    // All REJECT — return null so caller can forceAssign
    return null;
  }

  /**
   * Force-assign when all candidates rejected.
   *
   * Strategy: count referral frequency across all REJECT results.
   * Pick the agent with the highest referral count.
   * If no referrals, pick the agent with the highest fitnessScore.
   */
  forceAssign(
    results: AssessmentResult[],
    taskRequest: TaskRequest
  ): AllocationDecision {
    // Count referral frequency
    const referralCounts = new Map<string, number>();
    for (const r of results) {
      if (r.decision === "REJECT_AND_REFER") {
        for (const ref of r.referralList) {
          referralCounts.set(ref, (referralCounts.get(ref) ?? 0) + 1);
        }
      }
    }

    let assignedAgentId: string;
    let forceAssignReason: string;

    if (referralCounts.size > 0) {
      // Pick agent with highest referral count
      let maxCount = 0;
      let bestReferral = "";
      for (const [agentId, count] of referralCounts) {
        if (count > maxCount) {
          maxCount = count;
          bestReferral = agentId;
        }
      }
      assignedAgentId = bestReferral;
      forceAssignReason = `Force assigned to most-referred agent (referralCount=${maxCount})`;
    } else {
      // No referrals — pick highest fitnessScore
      const sorted = [...results].sort(
        (a, b) => b.fitnessScore - a.fitnessScore
      );
      assignedAgentId = sorted[0].agentId;
      forceAssignReason = `Force assigned to highest-fitness agent (fitness=${sorted[0].fitnessScore.toFixed(3)}), no referrals available`;
    }

    return {
      taskId: taskRequest.taskId,
      strategy: "FORCE_ASSIGN",
      assignedAgentId,
      assessments: results,
      reason: "All candidates rejected; executing force-assign fallback",
      forceAssignReason,
      timestamp: Date.now(),
    };
  }

  /**
   * Maintain a sliding window of 50 entries per agent.
   * Push the boolean (true = rejected) into the window.
   */
  updateRejectRate(agentId: string, rejected: boolean): void {
    let window = this.rejectHistory.get(agentId);
    if (!window) {
      window = [];
      this.rejectHistory.set(agentId, window);
    }
    window.push(rejected);
    if (window.length > REJECT_WINDOW_SIZE) {
      window.shift();
    }
  }

  /**
   * Check if reject count in the sliding window exceeds 60% (30 of 50).
   */
  checkRejectRateAlert(agentId: string): boolean {
    const window = this.rejectHistory.get(agentId);
    if (!window) return false;
    const rejectCount = window.filter(v => v).length;
    return rejectCount > REJECT_ALERT_THRESHOLD;
  }

  // ─── Private helpers ────────────────────────────────────────

  /**
   * Filter candidates from profileManager whose specializationTags
   * overlap with the task's requiredSkills.
   */
  private filterCandidates(requiredSkills: string[]): string[] {
    const allProfiles = this.profileManager.getAllProfiles();
    const requiredSet = new Set(requiredSkills);

    return allProfiles
      .filter(p => p.specializationTags.some(tag => requiredSet.has(tag)))
      .map(p => p.agentId);
  }

  private buildDecision(
    taskId: string,
    strategy: AllocationStrategy,
    assignedAgentId: string,
    assessments: AssessmentResult[],
    reason: string
  ): AllocationDecision {
    return {
      taskId,
      strategy,
      assignedAgentId,
      assessments,
      reason,
      timestamp: Date.now(),
    };
  }

  private buildErrorDecision(
    taskId: string,
    assessments: AssessmentResult[],
    reason: string
  ): AllocationDecision {
    return {
      taskId,
      strategy: "FORCE_ASSIGN",
      assignedAgentId: "",
      assessments,
      reason,
      timestamp: Date.now(),
    };
  }

  private buildStaticDecision(
    taskId: string,
    agentId: string
  ): AllocationDecision {
    return {
      taskId,
      strategy: "DIRECT_ASSIGN",
      assignedAgentId: agentId,
      assessments: [],
      reason: "Static assignment (autonomy disabled)",
      timestamp: Date.now(),
    };
  }
}
