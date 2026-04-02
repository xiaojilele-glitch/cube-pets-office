/**
 * Agent Registry — Manages all agent instances
 */
import { Agent } from './agent.js';
import db from '../db/index.js';
import type { ReputationProfile } from '../../shared/reputation.js';
import { reputationService } from './reputation/index.js';

class AgentRegistry {
  private agents: Map<string, Agent> = new Map();

  /**
   * Initialize all agents from database
   */
  init(): void {
    this.agents.clear();
    const rows = db.getAgents();
    for (const row of rows) {
      const agent = Agent.fromDB(row.id);
      if (agent) {
        this.agents.set(row.id, agent);
        // Initialize reputation profile for each agent (idempotent)
        reputationService.initializeProfile(row.id, false);
      }
    }
    console.log(`[Registry] Loaded ${this.agents.size} agents`);
  }

  /**
   * Get agent by ID
   */
  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /**
   * Get CEO agent
   */
  getCEO(): Agent | undefined {
    return this.agents.get('ceo');
  }

  /**
   * Get all managers
   */
  getManagers(): Agent[] {
    return Array.from(this.agents.values()).filter((a) => a.config.role === 'manager');
  }

  /**
   * Get manager for a department
   */
  getManagerByDepartment(dept: string): Agent | undefined {
    return Array.from(this.agents.values()).find(
      (a) => a.config.role === 'manager' && a.config.department === dept
    );
  }

  /**
   * Get workers under a manager
   */
  getWorkersByManager(managerId: string): Agent[] {
    return Array.from(this.agents.values()).filter(
      (a) => a.config.role === 'worker' && a.config.managerId === managerId
    );
  }

  /**
   * Get all agents
   */
  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by department
   */
  getByDepartment(dept: string): Agent[] {
    return Array.from(this.agents.values()).filter((a) => a.config.department === dept);
  }

  /**
   * Refresh agent from database (after SOUL.md update)
   */
  refresh(agentId: string): void {
    const agent = Agent.fromDB(agentId);
    if (agent) {
      this.agents.set(agentId, agent);
    }
  }

  refreshAll(): void {
    this.init();
  }

  /**
   * Get agent reputation profile.
   * Delegates to the database layer.
   * @see Requirements 1.5, 3.4
   */
  getReputation(agentId: string): ReputationProfile | undefined {
    return db.getReputationProfile(agentId);
  }
}

export const registry = new AgentRegistry();
