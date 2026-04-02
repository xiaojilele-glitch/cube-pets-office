import type {
  AssessmentResult,
  AutonomyConfig,
  TaskforceMember,
  TaskforceSession,
} from '../../shared/autonomy-types.js';
import type { CapabilityProfileManager } from './capability-profile-manager.js';
import type { SelfAssessment, TaskRequest } from './self-assessment.js';

// ─── Local Types ─────────────────────────────────────────────

/** Subset of the real MessageBus used by TaskforceManager for room management. */
export interface RuntimeMessageBus {
  createRoom(roomId: string): void;
  broadcastToRoom(roomId: string, message: any): void;
  destroyRoom(roomId: string): void;
}

/** Application submitted by an agent wanting to join a taskforce. */
export interface TaskforceApplication {
  agentId: string;
  fitnessScore: number;
  loadFactor: number;
  estimatedCompletionTime: number;
}

// ─── TaskforceManager ────────────────────────────────────────

/**
 * Manages the lifecycle of temporary taskforces:
 * formation, recruitment, heartbeat monitoring, and dissolution.
 */
export class TaskforceManager {
  private activeSessions: Map<string, TaskforceSession> = new Map();

  constructor(
    private readonly selfAssessment: SelfAssessment,
    private readonly profileManager: CapabilityProfileManager,
    private readonly messageBus: RuntimeMessageBus,
    private readonly config: AutonomyConfig,
  ) {}

  /**
   * Form a new taskforce for the given task.
   * Generates a unique taskforceId, elects a lead, creates a message bus room,
   * and returns the session in "recruiting" status.
   */
  async formTaskforce(task: TaskRequest, triggerAgentId: string): Promise<TaskforceSession> {
    const taskforceId = `tf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Assess all available agents to find candidates for lead election
    const allProfiles = this.profileManager.getAllProfiles();
    const candidates: AssessmentResult[] = [];

    for (const profile of allProfiles) {
      const result = this.selfAssessment.assess(profile.agentId, task);
      candidates.push(result);
    }

    const leadAgentId = this.electLead(candidates) || triggerAgentId;

    const session: TaskforceSession = {
      taskforceId,
      taskId: task.taskId,
      leadAgentId,
      members: [
        {
          agentId: leadAgentId,
          role: 'lead',
          joinedAt: Date.now(),
          lastHeartbeat: Date.now(),
          online: true,
        },
      ],
      status: 'recruiting',
      subTasks: [],
      createdAt: Date.now(),
    };

    this.activeSessions.set(taskforceId, session);
    this.messageBus.createRoom(`taskforce:${taskforceId}`);

    return session;
  }

  /**
   * Elect a lead from candidates by selecting the one with the highest fitnessScore.
   * Returns empty string if candidates array is empty.
   */
  electLead(candidates: AssessmentResult[]): string {
    if (candidates.length === 0) return '';

    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].fitnessScore > best.fitnessScore) {
        best = candidates[i];
      }
    }
    return best.agentId;
  }

  /**
   * Process applications from agents wanting to join a taskforce.
   * Filters by fitnessScore >= 0.5 AND loadFactor < 0.8,
   * sorts by fitnessScore descending (skill complementarity placeholder),
   * and creates TaskforceMember entries with role "worker".
   */
  async processApplications(
    taskforceId: string,
    applications: TaskforceApplication[],
  ): Promise<TaskforceMember[]> {
    const session = this.activeSessions.get(taskforceId);
    if (!session) return [];

    // Filter eligible applications
    const eligible = applications.filter(
      (app) => app.fitnessScore >= 0.5 && app.loadFactor < 0.8,
    );

    // Sort by fitnessScore descending (complementarity placeholder)
    eligible.sort((a, b) => b.fitnessScore - a.fitnessScore);

    const now = Date.now();
    const members: TaskforceMember[] = eligible.map((app) => ({
      agentId: app.agentId,
      role: 'worker' as const,
      joinedAt: now,
      lastHeartbeat: now,
      online: true,
    }));

    // Add new members to the session
    session.members.push(...members);

    return members;
  }

  /**
   * Handle a heartbeat from a taskforce member.
   * Updates lastHeartbeat timestamp and sets online = true.
   */
  handleHeartbeat(taskforceId: string, agentId: string): void {
    const session = this.activeSessions.get(taskforceId);
    if (!session) return;

    const member = session.members.find((m) => m.agentId === agentId);
    if (!member) return;

    member.lastHeartbeat = Date.now();
    member.online = true;
  }

  /**
   * Check all members of a taskforce for offline status.
   * A member is offline if currentTime - lastHeartbeat > 3 * heartbeatIntervalMs.
   * Returns array of offline agentIds.
   */
  checkOfflineMembers(taskforceId: string): string[] {
    const session = this.activeSessions.get(taskforceId);
    if (!session) return [];

    const now = Date.now();
    const threshold = 3 * this.config.taskforce.heartbeatIntervalMs;
    const offlineIds: string[] = [];

    for (const member of session.members) {
      if (now - member.lastHeartbeat > threshold) {
        member.online = false;
        offlineIds.push(member.agentId);
      }
    }

    return offlineIds;
  }

  /**
   * Dissolve a taskforce: set status to "dissolved", record dissolvedAt,
   * destroy the message bus room, and remove from activeSessions.
   */
  async dissolveTaskforce(taskforceId: string): Promise<void> {
    const session = this.activeSessions.get(taskforceId);
    if (!session) return;

    session.status = 'dissolved';
    session.dissolvedAt = Date.now();
    this.messageBus.destroyRoom(`taskforce:${taskforceId}`);
    this.activeSessions.delete(taskforceId);
  }

  /**
   * Return all active (non-dissolved) taskforce sessions.
   */
  getActiveTaskforces(): TaskforceSession[] {
    return Array.from(this.activeSessions.values()).filter(
      (s) => s.status !== 'dissolved',
    );
  }
}
