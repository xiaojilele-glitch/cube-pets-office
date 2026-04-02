import type {
  AutonomyConfig,
  CapabilityProfile,
  TaskHistoryEntry,
} from '../../shared/autonomy-types.js';
import { RingBuffer } from '../../shared/ring-buffer.js';

/**
 * Manages in-memory CapabilityProfile instances for all registered agents.
 * Provides EMA skill updates, load tracking, confidence recalculation,
 * skill decay, competition rewards, and serialization.
 */
export class CapabilityProfileManager {
  private profiles: Map<string, CapabilityProfile> = new Map();
  private activeTasks: Map<string, number> = new Map();
  private maxConcurrentTasks = 5;

  constructor(private readonly config: AutonomyConfig) {}

  /** Return profile or undefined */
  getProfile(agentId: string): CapabilityProfile | undefined {
    return this.profiles.get(agentId);
  }

  /** Return all registered profiles */
  getAllProfiles(): CapabilityProfile[] {
    return Array.from(this.profiles.values());
  }

  /** Create and register a new agent profile */
  initProfile(agentId: string, specializationTags: string[]): CapabilityProfile {
    const profile: CapabilityProfile = {
      agentId,
      skillVector: new Map(),
      loadFactor: 0,
      confidenceScore: 0.5,
      resourceQuota: {
        remainingTokenBudget: 100_000,
        memoryMb: 512,
        cpuPercent: 100,
      },
      specializationTags,
      avgLatencyMs: new Map(),
      taskHistory: new RingBuffer<TaskHistoryEntry>(100),
      needsReview: true,
      completedTaskCount: 0,
      lastUpdatedAt: Date.now(),
    };
    this.profiles.set(agentId, profile);
    this.activeTasks.set(agentId, 0);
    return profile;
  }

  /**
   * Update skill after task completion using EMA formula.
   * newSkill = alpha * taskQuality + (1 - alpha) * oldSkill, alpha = 0.1
   * Also records task history, increments completedTaskCount,
   * and recalculates confidence.
   */
  updateSkillAfterTask(agentId: string, skillCategory: string, taskQuality: number): void {
    const profile = this.profiles.get(agentId);
    if (!profile) return;

    const alpha = 0.1;
    const oldSkill = profile.skillVector.get(skillCategory) ?? 0;
    const newSkill = clamp(alpha * taskQuality + (1 - alpha) * oldSkill, 0, 1);
    profile.skillVector.set(skillCategory, newSkill);

    // Record task history entry
    const entry: TaskHistoryEntry = {
      taskId: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      skillCategory,
      qualityScore: clamp(taskQuality, 0, 1),
      success: taskQuality >= 0.5,
      completedAt: Date.now(),
    };
    profile.taskHistory.push(entry);

    profile.completedTaskCount++;
    if (profile.completedTaskCount >= 20) {
      profile.needsReview = false;
    }

    profile.lastUpdatedAt = Date.now();
    this.recalculateConfidence(agentId);
  }

  /** Increase active tasks for agent, recalculate loadFactor */
  incrementLoad(agentId: string): void {
    const profile = this.profiles.get(agentId);
    if (!profile) return;

    const current = this.activeTasks.get(agentId) ?? 0;
    const next = current + 1;
    this.activeTasks.set(agentId, next);
    profile.loadFactor = clamp(next / this.maxConcurrentTasks, 0, 1);
    profile.lastUpdatedAt = Date.now();
  }

  /** Decrease active tasks for agent (min 0), recalculate loadFactor */
  decrementLoad(agentId: string): void {
    const profile = this.profiles.get(agentId);
    if (!profile) return;

    const current = this.activeTasks.get(agentId) ?? 0;
    const next = Math.max(0, current - 1);
    this.activeTasks.set(agentId, next);
    profile.loadFactor = clamp(next / this.maxConcurrentTasks, 0, 1);
    profile.lastUpdatedAt = Date.now();
  }

  /**
   * Recalculate confidenceScore based on taskHistory RingBuffer.
   * Weighted average: 0.6 * successRate + 0.4 * avgQualityScore.
   * Clamped to [0, 1].
   */
  recalculateConfidence(agentId: string): void {
    const profile = this.profiles.get(agentId);
    if (!profile) return;

    const history = profile.taskHistory.toArray();
    if (history.length === 0) return;

    const successCount = history.filter((e) => e.success).length;
    const successRate = successCount / history.length;
    const avgQuality =
      history.reduce((sum, e) => sum + e.qualityScore, 0) / history.length;

    profile.confidenceScore = clamp(0.6 * successRate + 0.4 * avgQuality, 0, 1);
    profile.lastUpdatedAt = Date.now();
  }

  /**
   * Apply skill decay for ALL profiles.
   * For each skill: if last task in that category was > config.skillDecay.inactiveDays ago,
   * apply decay: skill * (0.95 ^ weeksInactive). If decayed < 0.001, set to 0.
   */
  applySkillDecay(): void {
    const now = Date.now();
    const inactiveDaysThreshold = this.config.skillDecay.inactiveDays;

    for (const profile of Array.from(this.profiles.values())) {
      const history = profile.taskHistory.toArray();

      for (const [skill, value] of Array.from(profile.skillVector.entries())) {
        // Find the most recent task in this skill category
        const lastTask = history
          .filter((e: TaskHistoryEntry) => e.skillCategory === skill)
          .sort((a: TaskHistoryEntry, b: TaskHistoryEntry) => b.completedAt - a.completedAt)[0];

        if (!lastTask) {
          // No history for this skill — treat as fully inactive from profile creation
          // Skip decay if no history exists (can't determine inactivity period)
          continue;
        }

        const daysSinceLastTask = (now - lastTask.completedAt) / (1000 * 60 * 60 * 24);
        if (daysSinceLastTask <= inactiveDaysThreshold) continue;

        const weeksInactive = daysSinceLastTask / 7;
        const decayed = value * Math.pow(0.95, weeksInactive);

        profile.skillVector.set(skill, decayed < 0.001 ? 0 : decayed);
      }

      profile.lastUpdatedAt = now;
    }
  }

  /**
   * Add delta to ALL skills in the agent's skillVector.
   * Each skill is clamped to [0.0, 1.0].
   */
  applyCompetitionReward(agentId: string, delta: number): void {
    const profile = this.profiles.get(agentId);
    if (!profile) return;

    for (const [skill, value] of Array.from(profile.skillVector.entries())) {
      profile.skillVector.set(skill, clamp(value + delta, 0, 1));
    }
    profile.lastUpdatedAt = Date.now();
  }

  /**
   * Serialize all profiles to a JSON string.
   * Converts Maps to arrays of entries and uses RingBuffer.toJSON().
   */
  serialize(): string {
    const entries: Array<[string, SerializedProfile]> = [];

    for (const [id, profile] of Array.from(this.profiles.entries())) {
      entries.push([
        id,
        {
          agentId: profile.agentId,
          skillVector: Array.from(profile.skillVector.entries()),
          loadFactor: profile.loadFactor,
          confidenceScore: profile.confidenceScore,
          resourceQuota: profile.resourceQuota,
          specializationTags: profile.specializationTags,
          avgLatencyMs: Array.from(profile.avgLatencyMs.entries()),
          taskHistory: profile.taskHistory.toJSON(),
          needsReview: profile.needsReview,
          completedTaskCount: profile.completedTaskCount,
          lastUpdatedAt: profile.lastUpdatedAt,
        },
      ]);
    }

    return JSON.stringify(entries);
  }

  /**
   * Restore a CapabilityProfileManager from a JSON string.
   * Reconstructs Maps and RingBuffers.
   */
  static deserialize(json: string, config: AutonomyConfig): CapabilityProfileManager {
    const manager = new CapabilityProfileManager(config);
    const entries: Array<[string, SerializedProfile]> = JSON.parse(json);

    for (const [id, data] of entries) {
      const profile: CapabilityProfile = {
        agentId: data.agentId,
        skillVector: new Map(data.skillVector),
        loadFactor: data.loadFactor,
        confidenceScore: data.confidenceScore,
        resourceQuota: data.resourceQuota,
        specializationTags: data.specializationTags,
        avgLatencyMs: new Map(data.avgLatencyMs),
        taskHistory: RingBuffer.fromJSON<TaskHistoryEntry>(data.taskHistory),
        needsReview: data.needsReview,
        completedTaskCount: data.completedTaskCount,
        lastUpdatedAt: data.lastUpdatedAt,
      };
      manager.profiles.set(id, profile);
      manager.activeTasks.set(id, 0);
    }

    return manager;
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Internal serialization shape for a CapabilityProfile */
interface SerializedProfile {
  agentId: string;
  skillVector: [string, number][];
  loadFactor: number;
  confidenceScore: number;
  resourceQuota: { remainingTokenBudget: number; memoryMb: number; cpuPercent: number };
  specializationTags: string[];
  avgLatencyMs: [string, number][];
  taskHistory: { capacity: number; items: TaskHistoryEntry[] };
  needsReview: boolean;
  completedTaskCount: number;
  lastUpdatedAt: number;
}
