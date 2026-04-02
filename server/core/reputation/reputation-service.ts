/**
 * ReputationService — 信誉服务入口
 *
 * 组装 ReputationCalculator、TrustTierEvaluator、AnomalyDetector，
 * 提供完整的信誉更新流程、查询、运维操作和排行榜功能。
 *
 * @see Requirements 1.3, 1.4, 1.5, 2.1, 2.3, 2.5, 3.1, 3.2, 3.4
 */

import db from '../../db/index.js';
import { emitReputationChanged, emitTrustTierChanged } from '../socket.js';
import { ReputationCalculator } from './reputation-calculator.js';
import { TrustTierEvaluator } from './trust-tier-evaluator.js';
import { AnomalyDetector } from './anomaly-detector.js';
import type {
  ReputationConfig,
  ReputationProfile,
  ReputationSignal,
  RoleReputationRecord,
  DimensionScores,
  DimensionDeltas,
  ReputationGrade,
  TrustTier,
} from '../../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Leaderboard types
// ---------------------------------------------------------------------------

export interface LeaderboardOptions {
  sortBy?: keyof DimensionScores | 'overallScore';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  trustTier?: TrustTier;
}

export interface LeaderboardEntry {
  agentId: string;
  overallScore: number;
  dimensions: DimensionScores;
  grade: ReputationGrade;
  trustTier: TrustTier;
  totalTasks: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a value to [min, max] */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function makeDimensions(score: number): DimensionScores {
  return {
    qualityScore: score,
    speedScore: score,
    efficiencyScore: score,
    collaborationScore: score,
    reliabilityScore: score,
  };
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// ReputationService
// ---------------------------------------------------------------------------

export class ReputationService {
  constructor(
    private calculator: ReputationCalculator,
    private evaluator: TrustTierEvaluator,
    private detector: AnomalyDetector,
    private config: ReputationConfig,
  ) {}

  // -------------------------------------------------------------------------
  // initializeProfile
  // -------------------------------------------------------------------------

  /**
   * Initialize a reputation profile for a new agent.
   * Internal agents start at 500, external agents at 400 with probation.
   *
   * @see Requirements 1.3, 1.4
   */
  initializeProfile(agentId: string, isExternal: boolean): ReputationProfile {
    const existing = db.getReputationProfile(agentId);
    if (existing) return existing;

    const score = isExternal
      ? this.config.externalInitialScore
      : this.config.internalInitialScore;

    const grade = this.evaluator.computeGrade(score);
    const trustTier = isExternal ? 'probation' as TrustTier : this.evaluator.computeTrustTier(grade);

    const ts = now();
    const profile: ReputationProfile = {
      agentId,
      overallScore: score,
      dimensions: makeDimensions(score),
      grade,
      trustTier,
      isExternal,
      totalTasks: 0,
      consecutiveHighQuality: 0,
      roleReputation: {},
      lastActiveAt: null,
      createdAt: ts,
      updatedAt: ts,
    };

    db.upsertReputationProfile(profile);
    return profile;
  }

  // -------------------------------------------------------------------------
  // handleTaskCompleted
  // -------------------------------------------------------------------------

  /**
   * Full reputation update flow on task completion.
   *
   * 1. Get or create profile
   * 2. Anomaly detection
   * 3. Grinding pattern check
   * 4. Probation damping
   * 5. Compute dimension deltas
   * 6. Apply grinding weight + probation damping to positive deltas
   * 7. Clamp deltas
   * 8. Apply deltas to dimensions (clamp each to [0, 1000])
   * 9. Compute new overall score
   * 10. Update grade and trust tier
   * 11. Evaluate grade change events
   * 12. Update role reputation if roleId present
   * 13. Track consecutiveHighQuality streak
   * 14. Update lastActiveAt, totalTasks
   * 15. Save profile and create change event
   *
   * @see Requirements 2.1, 2.3, 2.5, 3.1, 3.2
   */
  handleTaskCompleted(signal: ReputationSignal): void {
    // 1. Get or create profile
    let profile = db.getReputationProfile(signal.agentId);
    if (!profile) {
      profile = this.initializeProfile(signal.agentId, false);
    }

    const oldOverallScore = profile.overallScore;
    const oldGrade = profile.grade;

    // 2. Anomaly detection
    const recentEvents = db.getReputationEvents(signal.agentId, 100);
    const anomalyResult = this.detector.checkAnomalyThreshold(signal.agentId, recentEvents);
    if (anomalyResult.isAnomaly) {
      db.createAuditEntry({
        agentId: signal.agentId,
        type: 'anomaly',
        detail: `Anomaly detected: total delta ${anomalyResult.totalDelta} exceeds threshold ${this.config.anomaly.threshold}. Update paused.`,
        snapshot: { ...profile },
        timestamp: now(),
      });
      return;
    }

    // 3. Check grinding pattern
    // Build recent tasks from recent events (approximate using events as task summaries)
    const grindingResult = this.detector.checkGrindingPattern(signal.agentId, [
      {
        taskId: signal.taskId,
        complexity: signal.taskComplexity ?? 'medium',
        completedAt: signal.timestamp,
      },
    ]);
    const grindingWeight = grindingResult.weight;

    // 4. Probation damping
    const probationDamping = this.detector.getProbationDamping(profile);

    // 5. Compute dimension deltas
    const rawDeltas = this.calculator.computeDimensionDeltas(
      profile.dimensions,
      signal,
      profile.consecutiveHighQuality,
    );

    // 6. Apply grinding weight and probation damping to positive deltas
    const adjustedDeltas: DimensionDeltas = {
      qualityDelta: rawDeltas.qualityDelta > 0
        ? rawDeltas.qualityDelta * grindingWeight * probationDamping
        : rawDeltas.qualityDelta,
      speedDelta: rawDeltas.speedDelta > 0
        ? rawDeltas.speedDelta * grindingWeight * probationDamping
        : rawDeltas.speedDelta,
      efficiencyDelta: rawDeltas.efficiencyDelta > 0
        ? rawDeltas.efficiencyDelta * grindingWeight * probationDamping
        : rawDeltas.efficiencyDelta,
      collaborationDelta: rawDeltas.collaborationDelta > 0
        ? rawDeltas.collaborationDelta * grindingWeight * probationDamping
        : rawDeltas.collaborationDelta,
      reliabilityDelta: rawDeltas.reliabilityDelta > 0
        ? rawDeltas.reliabilityDelta * grindingWeight * probationDamping
        : rawDeltas.reliabilityDelta,
    };

    // 7. Clamp deltas
    const clampedDeltas = this.calculator.clampDeltas(adjustedDeltas, this.config.maxDeltaPerUpdate);

    // 8. Apply deltas to dimensions (clamp each to [0, 1000])
    profile.dimensions.qualityScore = clamp(
      Math.round(profile.dimensions.qualityScore + clampedDeltas.qualityDelta), 0, 1000,
    );
    profile.dimensions.speedScore = clamp(
      Math.round(profile.dimensions.speedScore + clampedDeltas.speedDelta), 0, 1000,
    );
    profile.dimensions.efficiencyScore = clamp(
      Math.round(profile.dimensions.efficiencyScore + clampedDeltas.efficiencyDelta), 0, 1000,
    );
    profile.dimensions.collaborationScore = clamp(
      Math.round(profile.dimensions.collaborationScore + clampedDeltas.collaborationDelta), 0, 1000,
    );
    profile.dimensions.reliabilityScore = clamp(
      Math.round(profile.dimensions.reliabilityScore + clampedDeltas.reliabilityDelta), 0, 1000,
    );

    // 9. Compute new overall score
    profile.overallScore = this.calculator.computeOverallScore(profile.dimensions);

    // 10. Update grade and trust tier
    const newGrade = this.evaluator.computeGrade(profile.overallScore);
    profile.grade = newGrade;
    if (profile.isExternal) {
      profile.trustTier = this.evaluator.evaluateExternalUpgrade(profile);
    } else {
      profile.trustTier = this.evaluator.computeTrustTier(newGrade);
    }

    // 11. Evaluate grade change events
    const gradeEvents = this.evaluator.evaluateGradeChange(
      oldGrade, newGrade, signal.agentId, signal.taskId,
    );
    for (const evt of gradeEvents) {
      db.createAuditEntry({
        agentId: signal.agentId,
        type: 'anomaly_review',
        detail: `${evt.type}: ${evt.detail}`,
        timestamp: now(),
      });
    }

    // 12. Update role reputation if roleId present
    if (signal.roleId) {
      this.updateRoleReputation(profile, signal);
    }

    // 13. Track consecutiveHighQuality streak
    if (signal.taskQualityScore >= this.config.streak.qualityMin) {
      profile.consecutiveHighQuality += 1;
    } else {
      profile.consecutiveHighQuality = 0;
    }

    // 14. Update lastActiveAt, totalTasks
    profile.lastActiveAt = signal.timestamp;
    profile.totalTasks += 1;
    profile.updatedAt = now();

    // 15. Save profile and create change event
    db.upsertReputationProfile(profile);

    db.createReputationEvent({
      agentId: signal.agentId,
      taskId: signal.taskId,
      dimensionDeltas: clampedDeltas,
      oldOverallScore,
      newOverallScore: profile.overallScore,
      reason: 'task_completed',
      timestamp: now(),
    });

    // WebSocket: push reputation change event
    emitReputationChanged({
      agentId: signal.agentId,
      oldScore: oldOverallScore,
      newScore: profile.overallScore,
      grade: profile.grade,
      dimensionDeltas: clampedDeltas,
    });

    // WebSocket: push trust tier change if it changed
    const oldTier = oldGrade === 'S' || oldGrade === 'A' ? 'trusted'
      : oldGrade === 'B' ? 'standard' : 'probation';
    if (profile.trustTier !== oldTier) {
      emitTrustTierChanged({
        agentId: signal.agentId,
        oldTier,
        newTier: profile.trustTier,
        reason: `Grade changed from ${oldGrade} to ${newGrade} after task ${signal.taskId}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Role reputation helper
  // -------------------------------------------------------------------------

  private updateRoleReputation(profile: ReputationProfile, signal: ReputationSignal): void {
    const roleId = signal.roleId!;
    let roleRep = profile.roleReputation[roleId];

    if (!roleRep) {
      const initScore = profile.isExternal
        ? this.config.externalInitialScore
        : this.config.internalInitialScore;
      roleRep = {
        roleId,
        overallScore: initScore,
        dimensions: makeDimensions(initScore),
        totalTasksInRole: 0,
        lowConfidence: true,
      };
    }

    // Compute deltas for role dimensions using same signal
    const roleDeltas = this.calculator.computeDimensionDeltas(
      roleRep.dimensions, signal, profile.consecutiveHighQuality,
    );
    const clampedRoleDeltas = this.calculator.clampDeltas(roleDeltas, this.config.maxDeltaPerUpdate);

    // Apply deltas
    roleRep.dimensions.qualityScore = clamp(
      Math.round(roleRep.dimensions.qualityScore + clampedRoleDeltas.qualityDelta), 0, 1000,
    );
    roleRep.dimensions.speedScore = clamp(
      Math.round(roleRep.dimensions.speedScore + clampedRoleDeltas.speedDelta), 0, 1000,
    );
    roleRep.dimensions.efficiencyScore = clamp(
      Math.round(roleRep.dimensions.efficiencyScore + clampedRoleDeltas.efficiencyDelta), 0, 1000,
    );
    roleRep.dimensions.collaborationScore = clamp(
      Math.round(roleRep.dimensions.collaborationScore + clampedRoleDeltas.collaborationDelta), 0, 1000,
    );
    roleRep.dimensions.reliabilityScore = clamp(
      Math.round(roleRep.dimensions.reliabilityScore + clampedRoleDeltas.reliabilityDelta), 0, 1000,
    );

    roleRep.overallScore = this.calculator.computeOverallScore(roleRep.dimensions);
    roleRep.totalTasksInRole += 1;
    roleRep.lowConfidence = roleRep.totalTasksInRole < this.config.lowConfidence.taskThreshold;

    profile.roleReputation[roleId] = roleRep;
  }

  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------

  /**
   * Return the full reputation profile for an agent.
   * @see Requirement 1.5
   */
  getReputation(agentId: string): ReputationProfile | undefined {
    return db.getReputationProfile(agentId);
  }

  /**
   * Return the role reputation record for an agent in a specific role.
   * @see Requirement 3.4
   */
  getReputationByRole(agentId: string, roleId: string): RoleReputationRecord | undefined {
    const profile = db.getReputationProfile(agentId);
    if (!profile) return undefined;
    return profile.roleReputation[roleId];
  }

  // -------------------------------------------------------------------------
  // Admin operations
  // -------------------------------------------------------------------------

  /**
   * Manually adjust a specific dimension score.
   * Recomputes overall score, saves, and creates audit entry.
   */
  adjustReputation(agentId: string, dimension: keyof DimensionScores, delta: number, reason: string): void {
    const profile = db.getReputationProfile(agentId);
    if (!profile) return;

    const oldOverallScore = profile.overallScore;

    profile.dimensions[dimension] = clamp(
      Math.round(profile.dimensions[dimension] + delta), 0, 1000,
    );
    profile.overallScore = this.calculator.computeOverallScore(profile.dimensions);
    profile.grade = this.evaluator.computeGrade(profile.overallScore);
    if (profile.isExternal) {
      profile.trustTier = this.evaluator.evaluateExternalUpgrade(profile);
    } else {
      profile.trustTier = this.evaluator.computeTrustTier(profile.grade);
    }
    profile.updatedAt = now();

    db.upsertReputationProfile(profile);

    // Build dimension deltas (only the adjusted dimension has a delta)
    const dimensionDeltas: DimensionDeltas = {
      qualityDelta: 0,
      speedDelta: 0,
      efficiencyDelta: 0,
      collaborationDelta: 0,
      reliabilityDelta: 0,
    };
    const deltaKey = dimension.replace('Score', 'Delta') as keyof DimensionDeltas;
    (dimensionDeltas as any)[deltaKey] = delta;

    db.createReputationEvent({
      agentId,
      taskId: null,
      dimensionDeltas,
      oldOverallScore,
      newOverallScore: profile.overallScore,
      reason: 'admin_adjust',
      timestamp: now(),
    });

    db.createAuditEntry({
      agentId,
      type: 'admin_adjust',
      detail: `Admin adjusted ${dimension} by ${delta}: ${reason}`,
      timestamp: now(),
    });
  }

  /**
   * Reset an agent's reputation to initial values.
   */
  resetReputation(agentId: string): void {
    const profile = db.getReputationProfile(agentId);
    if (!profile) return;

    const oldOverallScore = profile.overallScore;
    const score = profile.isExternal
      ? this.config.externalInitialScore
      : this.config.internalInitialScore;

    profile.overallScore = score;
    profile.dimensions = makeDimensions(score);
    profile.grade = this.evaluator.computeGrade(score);
    profile.trustTier = profile.isExternal
      ? 'probation'
      : this.evaluator.computeTrustTier(profile.grade);
    profile.consecutiveHighQuality = 0;
    profile.roleReputation = {};
    profile.updatedAt = now();

    db.upsertReputationProfile(profile);

    db.createReputationEvent({
      agentId,
      taskId: null,
      dimensionDeltas: {
        qualityDelta: 0,
        speedDelta: 0,
        efficiencyDelta: 0,
        collaborationDelta: 0,
        reliabilityDelta: 0,
      },
      oldOverallScore,
      newOverallScore: score,
      reason: 'admin_reset',
      timestamp: now(),
    });

    db.createAuditEntry({
      agentId,
      type: 'admin_reset',
      detail: `Admin reset reputation to ${score}`,
      timestamp: now(),
    });
  }

  // -------------------------------------------------------------------------
  // Leaderboard
  // -------------------------------------------------------------------------

  /**
   * Return a sorted, filtered, paginated leaderboard.
   * @see Requirement 8.4
   */
  getLeaderboard(options: LeaderboardOptions = {}): LeaderboardEntry[] {
    const {
      sortBy = 'overallScore',
      order = 'desc',
      limit = 50,
      offset = 0,
      trustTier,
    } = options;

    let profiles = db.getAllReputationProfiles();

    // Filter by trustTier
    if (trustTier) {
      profiles = profiles.filter(p => p.trustTier === trustTier);
    }

    // Sort
    profiles.sort((a, b) => {
      const aVal = sortBy === 'overallScore' ? a.overallScore : a.dimensions[sortBy];
      const bVal = sortBy === 'overallScore' ? b.overallScore : b.dimensions[sortBy];
      return order === 'desc' ? bVal - aVal : aVal - bVal;
    });

    // Paginate
    const paged = profiles.slice(offset, offset + limit);

    return paged.map(p => ({
      agentId: p.agentId,
      overallScore: p.overallScore,
      dimensions: { ...p.dimensions },
      grade: p.grade,
      trustTier: p.trustTier,
      totalTasks: p.totalTasks,
    }));
  }
}
