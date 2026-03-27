/**
 * Database Layer — JSON file-based storage
 * Compatible with the MySQL schema design from ROADMAP.
 * Can be swapped to MySQL by changing this module.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data");
const DB_FILE = path.join(DATA_DIR, "database.json");

// ============================================================
// Type Definitions (mirrors MySQL schema)
// ============================================================
export interface AgentRow {
  id: string;
  name: string;
  department: string;
  role: "ceo" | "manager" | "worker";
  manager_id: string | null;
  model: string;
  soul_md: string | null;
  heartbeat_config: any;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed";

export interface WorkflowRun {
  id: string;
  directive: string;
  status: WorkflowStatus;
  current_stage: string | null;
  departments_involved: string[];
  started_at: string | null;
  completed_at: string | null;
  results: any;
  created_at: string;
}

export interface MessageRow {
  id: number;
  workflow_id: string;
  from_agent: string;
  to_agent: string;
  stage: string;
  content: string;
  metadata: any;
  created_at: string;
}

export interface TaskRow {
  id: number;
  workflow_id: string;
  worker_id: string;
  manager_id: string;
  department: string;
  description: string;
  deliverable: string | null;
  deliverable_v2: string | null;
  deliverable_v3: string | null;
  score_accuracy: number | null;
  score_completeness: number | null;
  score_actionability: number | null;
  score_format: number | null;
  total_score: number | null;
  manager_feedback: string | null;
  meta_audit_feedback: string | null;
  verify_result: any;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface EvolutionLogRow {
  id: number;
  agent_id: string;
  workflow_id: string | null;
  dimension: string | null;
  old_score: number | null;
  new_score: number | null;
  patch_content: string | null;
  applied: number;
  created_at: string;
}

export interface HeartbeatKeywordRow {
  id: number;
  agent_id: string;
  keyword: string;
  category: "effective" | "neutral" | "ineffective";
  correlation: number;
  occurrence_count: number;
  last_seen_at: string | null;
  created_at: string;
}

export interface AgentCapabilityRow {
  id: number;
  agent_id: string;
  capability: string;
  confidence: number;
  demo_count: number;
  last_demonstrated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DatabaseSchema {
  agents: AgentRow[];
  workflow_runs: WorkflowRun[];
  messages: MessageRow[];
  tasks: TaskRow[];
  evolution_log: EvolutionLogRow[];
  heartbeat_keywords: HeartbeatKeywordRow[];
  agent_capabilities: AgentCapabilityRow[];
  _counters: {
    messages: number;
    tasks: number;
    evolution_log: number;
    heartbeat_keywords: number;
    agent_capabilities: number;
  };
}

// ============================================================
// Database Class
// ============================================================
class Database {
  private data: DatabaseSchema;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.data = this.load();
  }

  private getDefaultData(): DatabaseSchema {
    return {
      agents: [],
      workflow_runs: [],
      messages: [],
      tasks: [],
      evolution_log: [],
      heartbeat_keywords: [],
      agent_capabilities: [],
      _counters: {
        messages: 0,
        tasks: 0,
        evolution_log: 0,
        heartbeat_keywords: 0,
        agent_capabilities: 0,
      },
    };
  }

  private maxId(rows: Array<{ id: number }>): number {
    return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
  }

  private normalize(raw: any): DatabaseSchema {
    const data = raw && typeof raw === "object" ? raw : {};

    const agents = Array.isArray(data.agents) ? data.agents : [];
    const workflowRuns = Array.isArray(data.workflow_runs)
      ? data.workflow_runs
      : [];
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const evolutionLog = Array.isArray(data.evolution_log)
      ? data.evolution_log
      : [];
    const heartbeatKeywords = Array.isArray(data.heartbeat_keywords)
      ? data.heartbeat_keywords
      : [];
    const agentCapabilities = Array.isArray(data.agent_capabilities)
      ? data.agent_capabilities
      : [];

    const counters = data._counters || {};

    return {
      agents,
      workflow_runs: workflowRuns,
      messages,
      tasks,
      evolution_log: evolutionLog,
      heartbeat_keywords: heartbeatKeywords,
      agent_capabilities: agentCapabilities,
      _counters: {
        messages: Math.max(
          Number(counters.messages) || 0,
          this.maxId(messages)
        ),
        tasks: Math.max(Number(counters.tasks) || 0, this.maxId(tasks)),
        evolution_log: Math.max(
          Number(counters.evolution_log) || 0,
          this.maxId(evolutionLog)
        ),
        heartbeat_keywords: Math.max(
          Number(counters.heartbeat_keywords) || 0,
          this.maxId(heartbeatKeywords)
        ),
        agent_capabilities: Math.max(
          Number(counters.agent_capabilities) || 0,
          this.maxId(agentCapabilities)
        ),
      },
    };
  }

  private load(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        return this.normalize(JSON.parse(raw));
      }
    } catch (e) {
      console.error("[DB] Failed to load database, starting fresh:", e);
    }
    return this.getDefaultData();
  }

  private save(): void {
    // Debounced save to avoid excessive writes
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        if (!fs.existsSync(DATA_DIR))
          fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), "utf-8");
      } catch (e) {
        console.error("[DB] Failed to save:", e);
      }
    }, 100);
  }

  forceSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), "utf-8");
  }

  private now(): string {
    return new Date().toISOString();
  }

  private normalizeDirective(directive: string): string {
    return directive.trim().replace(/\s+/g, " ");
  }

  // ============================================================
  // Agents
  // ============================================================
  getAgents(): AgentRow[] {
    return this.data.agents;
  }

  getAgent(id: string): AgentRow | undefined {
    return this.data.agents.find(a => a.id === id);
  }

  getAgentsByRole(role: "ceo" | "manager" | "worker"): AgentRow[] {
    return this.data.agents.filter(a => a.role === role);
  }

  getAgentsByDepartment(dept: string): AgentRow[] {
    return this.data.agents.filter(a => a.department === dept);
  }

  getWorkersByManager(managerId: string): AgentRow[] {
    return this.data.agents.filter(
      a => a.manager_id === managerId && a.role === "worker"
    );
  }

  upsertAgent(agent: Partial<AgentRow> & { id: string }): void {
    const idx = this.data.agents.findIndex(a => a.id === agent.id);
    const now = this.now();
    if (idx >= 0) {
      this.data.agents[idx] = {
        ...this.data.agents[idx],
        ...agent,
        updated_at: now,
      };
    } else {
      this.data.agents.push({
        id: agent.id,
        name: agent.name || agent.id,
        department: agent.department || "general",
        role: agent.role || "worker",
        manager_id: agent.manager_id ?? null,
        model: agent.model || "gpt-4o-mini",
        soul_md: agent.soul_md ?? null,
        heartbeat_config: agent.heartbeat_config ?? null,
        is_active: agent.is_active ?? 1,
        created_at: now,
        updated_at: now,
      });
    }
    this.save();
  }

  updateAgentSoul(agentId: string, soulMd: string): void {
    const agent = this.getAgent(agentId);
    if (agent) {
      agent.soul_md = soulMd;
      agent.updated_at = this.now();
      this.save();
    }
  }

  updateAgentHeartbeatConfig(agentId: string, heartbeatConfig: any): void {
    const agent = this.getAgent(agentId);
    if (agent) {
      agent.heartbeat_config = heartbeatConfig;
      agent.updated_at = this.now();
      this.save();
    }
  }

  // ============================================================
  // Workflow Runs
  // ============================================================
  createWorkflow(
    id: string,
    directive: string,
    departments: string[]
  ): WorkflowRun {
    const now = this.now();
    const wf: WorkflowRun = {
      id,
      directive,
      status: "pending",
      current_stage: null,
      departments_involved: departments,
      started_at: null,
      completed_at: null,
      results: null,
      created_at: now,
    };
    this.data.workflow_runs.push(wf);
    this.save();
    return wf;
  }

  getWorkflow(id: string): WorkflowRun | undefined {
    return this.data.workflow_runs.find(w => w.id === id);
  }

  getWorkflows(): WorkflowRun[] {
    return [...this.data.workflow_runs].reverse();
  }

  findWorkflowByDirective(
    directive: string,
    options: {
      statuses?: WorkflowStatus[];
      maxAgeMs?: number;
    } = {}
  ): WorkflowRun | undefined {
    const normalized = this.normalizeDirective(directive);
    const statuses = options.statuses;
    const maxAgeMs = options.maxAgeMs;
    const now = Date.now();

    return [...this.data.workflow_runs].reverse().find(workflow => {
      if (statuses && !statuses.includes(workflow.status)) {
        return false;
      }
      if (maxAgeMs !== undefined) {
        const createdAtMs = Date.parse(workflow.created_at);
        if (!Number.isFinite(createdAtMs) || now - createdAtMs > maxAgeMs) {
          return false;
        }
      }
      return this.normalizeDirective(workflow.directive) === normalized;
    });
  }

  updateWorkflow(id: string, updates: Partial<WorkflowRun>): void {
    const wf = this.getWorkflow(id);
    if (wf) {
      Object.assign(wf, updates);
      this.save();
    }
  }

  // ============================================================
  // Messages
  // ============================================================
  createMessage(msg: Omit<MessageRow, "id" | "created_at">): MessageRow {
    this.data._counters.messages++;
    const row: MessageRow = {
      ...msg,
      id: this.data._counters.messages,
      created_at: this.now(),
    };
    this.data.messages.push(row);
    this.save();
    return row;
  }

  getMessagesByWorkflow(workflowId: string): MessageRow[] {
    return this.data.messages.filter(m => m.workflow_id === workflowId);
  }

  getInbox(agentId: string, workflowId?: string): MessageRow[] {
    return this.data.messages.filter(
      m =>
        m.to_agent === agentId && (!workflowId || m.workflow_id === workflowId)
    );
  }

  // ============================================================
  // Tasks
  // ============================================================
  createTask(task: Omit<TaskRow, "id" | "created_at" | "updated_at">): TaskRow {
    this.data._counters.tasks++;
    const now = this.now();
    const row: TaskRow = {
      ...task,
      id: this.data._counters.tasks,
      created_at: now,
      updated_at: now,
    };
    this.data.tasks.push(row);
    this.save();
    return row;
  }

  getTasksByWorkflow(workflowId: string): TaskRow[] {
    return this.data.tasks.filter(t => t.workflow_id === workflowId);
  }

  getTask(id: number): TaskRow | undefined {
    return this.data.tasks.find(t => t.id === id);
  }

  updateTask(id: number, updates: Partial<TaskRow>): void {
    const task = this.getTask(id);
    if (task) {
      Object.assign(task, updates, { updated_at: this.now() });
      this.save();
    }
  }

  // ============================================================
  // Evolution Log
  // ============================================================
  createEvolutionLog(
    log: Omit<EvolutionLogRow, "id" | "created_at">
  ): EvolutionLogRow {
    this.data._counters.evolution_log++;
    const row: EvolutionLogRow = {
      ...log,
      id: this.data._counters.evolution_log,
      created_at: this.now(),
    };
    this.data.evolution_log.push(row);
    this.save();
    return row;
  }

  getEvolutionLogs(agentId?: string): EvolutionLogRow[] {
    if (agentId)
      return this.data.evolution_log.filter(e => e.agent_id === agentId);
    return this.data.evolution_log;
  }

  updateEvolutionLog(id: number, updates: Partial<EvolutionLogRow>): void {
    const log = this.data.evolution_log.find(item => item.id === id);
    if (!log) return;
    Object.assign(log, updates);
    this.save();
  }

  // ============================================================
  // Heartbeat Keywords
  // ============================================================
  upsertHeartbeatKeyword(
    keywordRow: Omit<HeartbeatKeywordRow, "id" | "created_at">
  ): HeartbeatKeywordRow {
    const normalizedKeyword = keywordRow.keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      throw new Error("keyword is required");
    }

    const existing = this.data.heartbeat_keywords.find(
      item =>
        item.agent_id === keywordRow.agent_id &&
        item.keyword.trim().toLowerCase() === normalizedKeyword
    );

    if (existing) {
      const previousOccurrences = existing.occurrence_count || 0;
      const incomingOccurrences = keywordRow.occurrence_count || 0;
      const totalOccurrences = previousOccurrences + incomingOccurrences;

      existing.correlation =
        totalOccurrences > 0
          ? (existing.correlation * previousOccurrences +
              keywordRow.correlation * incomingOccurrences) /
            totalOccurrences
          : keywordRow.correlation;
      existing.occurrence_count = totalOccurrences;
      existing.category = keywordRow.category;
      existing.last_seen_at = keywordRow.last_seen_at;
      this.save();
      return existing;
    }

    this.data._counters.heartbeat_keywords++;
    const row: HeartbeatKeywordRow = {
      ...keywordRow,
      keyword: normalizedKeyword,
      id: this.data._counters.heartbeat_keywords,
      created_at: this.now(),
    };
    this.data.heartbeat_keywords.push(row);
    this.save();
    return row;
  }

  getHeartbeatKeywords(agentId?: string): HeartbeatKeywordRow[] {
    const rows = agentId
      ? this.data.heartbeat_keywords.filter(item => item.agent_id === agentId)
      : this.data.heartbeat_keywords;

    return [...rows].sort(
      (a, b) =>
        b.occurrence_count - a.occurrence_count ||
        Math.abs(b.correlation) - Math.abs(a.correlation)
    );
  }

  // ============================================================
  // Agent Capabilities
  // ============================================================
  upsertAgentCapability(
    capabilityRow: Omit<AgentCapabilityRow, "id" | "created_at" | "updated_at">
  ): AgentCapabilityRow {
    const normalizedCapability = capabilityRow.capability.trim();
    if (!normalizedCapability) {
      throw new Error("capability is required");
    }

    const existing = this.data.agent_capabilities.find(
      item =>
        item.agent_id === capabilityRow.agent_id &&
        item.capability.trim().toLowerCase() ===
          normalizedCapability.toLowerCase()
    );

    if (existing) {
      existing.confidence = Math.max(0, Math.min(1, capabilityRow.confidence));
      existing.demo_count += capabilityRow.demo_count;
      existing.last_demonstrated_at =
        capabilityRow.last_demonstrated_at || existing.last_demonstrated_at;
      existing.updated_at = this.now();
      this.save();
      return existing;
    }

    this.data._counters.agent_capabilities++;
    const now = this.now();
    const row: AgentCapabilityRow = {
      ...capabilityRow,
      capability: normalizedCapability,
      confidence: Math.max(0, Math.min(1, capabilityRow.confidence)),
      id: this.data._counters.agent_capabilities,
      created_at: now,
      updated_at: now,
    };
    this.data.agent_capabilities.push(row);
    this.save();
    return row;
  }

  getAgentCapabilities(agentId?: string): AgentCapabilityRow[] {
    const rows = agentId
      ? this.data.agent_capabilities.filter(item => item.agent_id === agentId)
      : this.data.agent_capabilities;

    return [...rows].sort(
      (a, b) => b.confidence - a.confidence || b.demo_count - a.demo_count
    );
  }

  // ============================================================
  // Scores helpers
  // ============================================================
  getScoresForWorkflow(workflowId: string): TaskRow[] {
    return this.data.tasks.filter(
      t => t.workflow_id === workflowId && t.total_score !== null
    );
  }

  getRecentScores(agentId: string, limit: number = 5): TaskRow[] {
    return this.data.tasks
      .filter(t => t.worker_id === agentId && t.total_score !== null)
      .slice(-limit);
  }
}

// Singleton
const db = new Database();
export default db;
