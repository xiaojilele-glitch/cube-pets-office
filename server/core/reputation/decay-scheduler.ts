/**
 * DecayScheduler — 不活跃衰减调度器
 *
 * 定时检查所有 Agent 的活跃状态，对不活跃超过 inactivityDays 的 Agent
 * 执行 overallScore 衰减（维度子分不变），衰减下限为 decayFloor。
 *
 * @see Requirements 6.1, 6.2, 6.3
 */

import db from '../../db/index.js';
import { ReputationCalculator } from './reputation-calculator.js';
import { TrustTierEvaluator } from './trust-tier-evaluator.js';
import type { ReputationConfig, ReputationProfile } from '../../../shared/reputation.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class DecayScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private config: ReputationConfig,
    private evaluator: TrustTierEvaluator,
    private calculator: ReputationCalculator,
  ) {}

  /** Start daily decay check (every 24 hours) */
  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.runDecayCycle(), MS_PER_DAY);
  }

  /** Stop the scheduler */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Run one decay cycle: iterate all profiles, decay inactive ones */
  runDecayCycle(): void {
    const profiles = db.getAllReputationProfiles();
    const now = Date.now();
    const inactivityMs = this.config.decay.inactivityDays * MS_PER_DAY;

    for (const profile of profiles) {
      if (!this.isInactive(profile, now, inactivityMs)) continue;

      const oldOverallScore = profile.overallScore;

      // Already at or below floor — nothing to do
      if (oldOverallScore <= this.config.decay.decayFloor) continue;

      // Subtract decayRate, clamp to decayFloor
      profile.overallScore = Math.max(
        this.config.decay.decayFloor,
        oldOverallScore - this.config.decay.decayRate,
      );

      // Dimensions stay unchanged (Requirement 6.2)

      // Recompute grade and trustTier after decay
      profile.grade = this.evaluator.computeGrade(profile.overallScore);
      if (profile.isExternal) {
        profile.trustTier = this.evaluator.evaluateExternalUpgrade(profile);
      } else {
        profile.trustTier = this.evaluator.computeTrustTier(profile.grade);
      }

      profile.updatedAt = new Date().toISOString();

      // Save updated profile
      db.upsertReputationProfile(profile);

      // Create change event with reason "inactivity_decay"
      db.createReputationEvent({
        agentId: profile.agentId,
        taskId: null,
        dimensionDeltas: {
          qualityDelta: 0,
          speedDelta: 0,
          efficiencyDelta: 0,
          collaborationDelta: 0,
          reliabilityDelta: 0,
        },
        oldOverallScore,
        newOverallScore: profile.overallScore,
        reason: 'inactivity_decay',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** Check whether a profile is inactive (lastActiveAt is null or older than threshold) */
  private isInactive(profile: ReputationProfile, nowMs: number, inactivityMs: number): boolean {
    if (profile.lastActiveAt === null) return true;
    const lastActive = Date.parse(profile.lastActiveAt);
    if (!Number.isFinite(lastActive)) return true;
    return nowMs - lastActive >= inactivityMs;
  }
}
