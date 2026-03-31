import db from '../db/index.js';
import type { AgentRow, TaskRow, WorkflowRun } from '../db/index.js';
import { isLLMTemporarilyUnavailableError } from './llm-client.js';
import {
  reportStore,
  type HeartbeatReport,
  type HeartbeatReportSummary,
  type HeartbeatSearchResult,
} from '../memory/report-store.js';
import { registry } from './registry.js';
import { emitEvent } from './socket.js';

type HeartbeatTrigger = HeartbeatReport['trigger'];
type HeartbeatRuntimeState = 'idle' | 'scheduled' | 'running' | 'error';

interface StoredHeartbeatConfig {
  enabled?: boolean;
  intervalMinutes?: number;
  keywords?: string[];
  focus?: string;
  maxResults?: number;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  keywords: string[];
  focus: string;
  maxResults: number;
}

export interface HeartbeatStatus {
  agentId: string;
  agentName: string;
  department: string;
  enabled: boolean;
  state: HeartbeatRuntimeState;
  intervalMinutes: number;
  keywords: string[];
  focus: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastReportId: string | null;
  lastReportTitle: string | null;
  lastReportAt: string | null;
  reportCount: number;
}

interface HeartbeatLLMResult {
  title?: string;
  summary?: string;
  observations?: string[];
  actionItems?: string[];
}

interface SearchCandidate {
  sourceType: HeartbeatSearchResult['sourceType'];
  sourceId: string;
  title: string;
  snippet: string;
  matchedKeywords: string[];
  score: number;
}

const DEPARTMENT_KEYWORDS: Record<string, string[]> = {
  game: ['玩法', '活动', '体验', '增长'],
  ai: ['模型', '数据', '评估', '应用'],
  life: ['内容', '社区', '用户', '传播'],
  meta: ['流程', '质量', '协作', '复盘'],
};

const ROLE_KEYWORDS: Record<string, string[]> = {
  ceo: ['战略', '协同', '风险'],
  manager: ['交付', '进度', '总结'],
  worker: ['执行', '问题', '改进'],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  return keywords
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function excerpt(text: string, maxLength: number = 360): string {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'No content available.';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
}

function createReportId(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function parseRetryDelayMs(error: unknown, fallbackMs: number = 30000): number {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/about\s+(\d+)s/i);
  if (!match) {
    return fallbackMs;
  }

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return fallbackMs;
  }

  return seconds * 1000;
}

function heartbeatRetryJitterMs(agentId: string): number {
  const seed = agentId
    .split('')
    .reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
  return 500 + (seed % 2500);
}

function buildDefaultConfig(agent: AgentRow): HeartbeatConfig {
  const defaultInterval = clamp(Number(process.env.HEARTBEAT_INTERVAL_MINUTES) || 360, 5, 1440);
  const defaultMaxResults = clamp(Number(process.env.HEARTBEAT_MAX_RESULTS) || 6, 3, 12);
  const departmentKeywords = DEPARTMENT_KEYWORDS[agent.department] || [];
  const roleKeywords = ROLE_KEYWORDS[agent.role] || [];

  return {
    enabled: agent.is_active === 1,
    intervalMinutes: defaultInterval,
    keywords: [...departmentKeywords, ...roleKeywords, agent.id].slice(0, 6),
    focus:
      agent.role === 'ceo'
        ? 'Scan cross-team signals and summarize organization-level changes.'
        : agent.role === 'manager'
          ? 'Track department execution signals and notable changes.'
          : 'Track execution patterns, issues, and improvement opportunities.',
    maxResults: defaultMaxResults,
  };
}

function extractMatchedKeywords(text: string, keywords: string[]): string[] {
  const normalized = normalizeText(text);
  return keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
}

function scoreCandidate(text: string, keywords: string[]): { score: number; matchedKeywords: string[] } {
  const matchedKeywords = extractMatchedKeywords(text, keywords);
  const score = matchedKeywords.length * 10;
  return { score, matchedKeywords };
}

function byRecentDateDesc(a: { generatedAt: string }, b: { generatedAt: string }): number {
  return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime();
}

export class HeartbeatScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private states = new Map<string, HeartbeatStatus>();
  private started = false;
  private llmUnavailableUntil = 0;

  start(): void {
    if (this.started) return;
    this.started = true;

    for (const agent of db.getAgents()) {
      this.syncAgent(agent.id);
    }
  }

  stop(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.started = false;
    this.llmUnavailableUntil = 0;
  }

  getStatuses(): HeartbeatStatus[] {
    return Array.from(this.states.values()).sort((a, b) => a.agentId.localeCompare(b.agentId));
  }

  getStatus(agentId: string): HeartbeatStatus | null {
    return this.states.get(agentId) || null;
  }

  syncAgent(agentId: string): HeartbeatStatus | null {
    const agent = db.getAgent(agentId);
    if (!agent) return null;

    const config = this.loadConfig(agentId);
    const previous = this.states.get(agentId);
    const latestReport = reportStore.listHeartbeatReports(agentId, 1)[0] || null;

    const nextState: HeartbeatStatus = {
      agentId: agent.id,
      agentName: agent.name,
      department: agent.department,
      enabled: config.enabled,
      state: config.enabled ? previous?.state || 'scheduled' : 'idle',
      intervalMinutes: config.intervalMinutes,
      keywords: [...config.keywords],
      focus: config.focus,
      nextRunAt: config.enabled ? previous?.nextRunAt || null : null,
      lastRunAt: previous?.lastRunAt || null,
      lastSuccessAt: previous?.lastSuccessAt || null,
      lastError: previous?.lastError || null,
      lastReportId: latestReport?.reportId || previous?.lastReportId || null,
      lastReportTitle: latestReport?.title || previous?.lastReportTitle || null,
      lastReportAt: latestReport?.generatedAt || previous?.lastReportAt || null,
      reportCount: reportStore.listHeartbeatReports(agentId, 200).length,
    };

    this.states.set(agentId, nextState);
    if (config.enabled) {
      this.scheduleNext(agentId);
    } else {
      this.clearTimer(agentId);
      this.publishStatus(agentId);
    }

    return this.states.get(agentId) || null;
  }

  async trigger(agentId: string, trigger: HeartbeatTrigger = 'manual'): Promise<HeartbeatReport> {
    const agentRow = db.getAgent(agentId);
    if (!agentRow) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const config = this.loadConfig(agentId);
    if (!config.enabled) {
      throw new Error(`Heartbeat is disabled for ${agentId}`);
    }

    const llmCooldownRemainingMs = this.getLLMUnavailableRemainingMs();
    if (llmCooldownRemainingMs > 0) {
      throw new Error(
        `LLM providers are temporarily unavailable for heartbeat. Retry in about ${Math.max(
          1,
          Math.ceil(llmCooldownRemainingMs / 1000)
        )}s.`
      );
    }

    const existing = this.states.get(agentId);
    if (existing?.state === 'running') {
      throw new Error(`Heartbeat is already running for ${agentId}`);
    }

    const agent = registry.get(agentId);
    if (!agent) {
      throw new Error(`Agent instance ${agentId} is not available`);
    }

    const now = new Date().toISOString();
    this.states.set(agentId, {
      ...(existing || {
        agentId: agentRow.id,
        agentName: agentRow.name,
        department: agentRow.department,
        enabled: true,
        intervalMinutes: config.intervalMinutes,
        keywords: [...config.keywords],
        focus: config.focus,
        nextRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        lastReportId: null,
        lastReportTitle: null,
        lastReportAt: null,
        reportCount: 0,
      }),
      enabled: true,
      state: 'running',
      intervalMinutes: config.intervalMinutes,
      keywords: [...config.keywords],
      focus: config.focus,
      lastRunAt: now,
      lastError: null,
      nextRunAt: null,
    });
    this.publishStatus(agentId);

    emitEvent({ type: 'agent_active', agentId, action: 'heartbeat' });

    try {
      const searchResults = this.search(agentRow, config);
      const llmResult = await agent.invokeJson<HeartbeatLLMResult>(
        `You are writing an autonomous heartbeat report for ${agentRow.name}.

Focus:
${config.focus}

Keywords:
${config.keywords.join(', ')}

Search results:
${searchResults
  .map(
    (item, index) =>
      `${index + 1}. [${item.sourceType}] ${item.title}\nMatched keywords: ${item.matchedKeywords.join(', ') || 'none'}\n${item.snippet}`
  )
  .join('\n\n')}

Return valid JSON with this shape:
{
  "title": "short report title",
  "summary": "1 short paragraph summary",
  "observations": ["observation 1", "observation 2"],
  "actionItems": ["action 1", "action 2"]
}

Rules:
- Keep it concise and concrete.
- Prefer insights grounded in the search results.
- If the search results are sparse, explicitly say the signal is weak.`,
        undefined,
        { stage: 'heartbeat' }
      );

      const generatedAt = new Date().toISOString();
      const report: HeartbeatReport = {
        kind: 'heartbeat_report',
        version: 1,
        reportId: createReportId(new Date(generatedAt)),
        generatedAt,
        trigger,
        agent: {
          id: agentRow.id,
          name: agentRow.name,
          department: agentRow.department,
        },
        config: {
          intervalMinutes: config.intervalMinutes,
          keywords: [...config.keywords],
          focus: config.focus,
          maxResults: config.maxResults,
        },
        title: llmResult.title?.trim() || `${agentRow.name} heartbeat`,
        summary:
          llmResult.summary?.trim() ||
          `Heartbeat completed with ${searchResults.length} search signals.`,
        observations: Array.isArray(llmResult.observations)
          ? llmResult.observations.filter((item) => typeof item === 'string' && item.trim()).slice(0, 6)
          : [],
        actionItems: Array.isArray(llmResult.actionItems)
          ? llmResult.actionItems.filter((item) => typeof item === 'string' && item.trim()).slice(0, 6)
          : [],
        searchResults,
      };

      const savedPaths = reportStore.saveHeartbeatReport(report);
      const summary: HeartbeatReportSummary | undefined = reportStore.listHeartbeatReports(agentId, 1)[0];
      const current = this.states.get(agentId);

      this.states.set(agentId, {
        ...(current || this.createEmptyStatus(agentRow, config)),
        state: 'scheduled',
        lastSuccessAt: generatedAt,
        lastError: null,
        lastReportId: report.reportId,
        lastReportTitle: report.title,
        lastReportAt: generatedAt,
        reportCount: (current?.reportCount || 0) + 1,
      });

      emitEvent({
        type: 'heartbeat_report_saved',
        agentId,
        reportId: report.reportId,
        title: report.title,
        generatedAt,
        summary: excerpt(report.summary, 180),
        jsonPath: savedPaths.jsonPath,
        markdownPath: savedPaths.markdownPath,
      });

      if (summary) {
        emitEvent({
          type: 'heartbeat_status',
          status: {
            ...(this.states.get(agentId) || this.createEmptyStatus(agentRow, config)),
            reportCount: summary ? reportStore.listHeartbeatReports(agentId, 200).length : 0,
          },
        });
      } else {
        this.publishStatus(agentId);
      }

      this.scheduleNext(agentId);
      emitEvent({ type: 'agent_active', agentId, action: 'idle' });
      return report;
    } catch (error: any) {
      const failedAt = new Date().toISOString();
      const current = this.states.get(agentId);
      const temporarilyUnavailable = isLLMTemporarilyUnavailableError(error);
      const retryDelayMs = temporarilyUnavailable
        ? parseRetryDelayMs(error, 30000)
        : config.intervalMinutes * 60 * 1000;

      if (temporarilyUnavailable) {
        this.openLLMUnavailableWindow(retryDelayMs);
      }

      this.states.set(agentId, {
        ...(current || this.createEmptyStatus(agentRow, config)),
        state: 'error',
        lastRunAt: current?.lastRunAt || failedAt,
        lastError: error?.message || 'Unknown heartbeat error',
      });
      this.publishStatus(agentId);
      this.scheduleNext(agentId, retryDelayMs);
      emitEvent({ type: 'agent_active', agentId, action: 'idle' });
      throw error;
    }
  }

  private createEmptyStatus(agent: AgentRow, config: HeartbeatConfig): HeartbeatStatus {
    return {
      agentId: agent.id,
      agentName: agent.name,
      department: agent.department,
      enabled: config.enabled,
      state: config.enabled ? 'scheduled' : 'idle',
      intervalMinutes: config.intervalMinutes,
      keywords: [...config.keywords],
      focus: config.focus,
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastReportId: null,
      lastReportTitle: null,
      lastReportAt: null,
      reportCount: reportStore.listHeartbeatReports(agent.id, 200).length,
    };
  }

  private loadConfig(agentId: string): HeartbeatConfig {
    const agent = db.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const defaults = buildDefaultConfig(agent);
    const stored = (agent.heartbeat_config || {}) as StoredHeartbeatConfig;

    return {
      enabled: stored.enabled ?? defaults.enabled,
      intervalMinutes: clamp(
        Number(stored.intervalMinutes ?? defaults.intervalMinutes) || defaults.intervalMinutes,
        5,
        1440
      ),
      keywords: normalizeKeywords(stored.keywords).length > 0
        ? normalizeKeywords(stored.keywords)
        : defaults.keywords,
      focus: typeof stored.focus === 'string' && stored.focus.trim() ? stored.focus.trim() : defaults.focus,
      maxResults: clamp(
        Number(stored.maxResults ?? defaults.maxResults) || defaults.maxResults,
        3,
        12
      ),
    };
  }

  private scheduleNext(agentId: string, overrideDelayMs?: number): void {
    const agent = db.getAgent(agentId);
    if (!agent) return;

    const config = this.loadConfig(agentId);
    if (!config.enabled) {
      this.clearTimer(agentId);
      return;
    }

    const delayMs =
      overrideDelayMs && Number.isFinite(overrideDelayMs) && overrideDelayMs > 0
        ? overrideDelayMs
        : config.intervalMinutes * 60 * 1000;
    const nextRunAt = new Date(Date.now() + delayMs).toISOString();
    const current = this.states.get(agentId) || this.createEmptyStatus(agent, config);

    this.clearTimer(agentId);
    this.states.set(agentId, {
      ...current,
      state: current.state === 'error' ? 'error' : 'scheduled',
      nextRunAt,
      intervalMinutes: config.intervalMinutes,
      keywords: [...config.keywords],
      focus: config.focus,
    });
    this.publishStatus(agentId);

    const timer = setTimeout(() => {
      const remainingMs = this.getLLMUnavailableRemainingMs();
      if (remainingMs > 0) {
        this.scheduleNext(agentId, remainingMs + heartbeatRetryJitterMs(agentId));
        return;
      }

      void this.trigger(agentId, 'scheduled').catch((error) => {
        if (isLLMTemporarilyUnavailableError(error)) {
          console.warn(
            `[Heartbeat] ${agentId} delayed: ${error.message}`
          );
          return;
        }
        console.error(`[Heartbeat] ${agentId} failed:`, error);
      });
    }, delayMs);

    this.timers.set(agentId, timer);
  }

  private clearTimer(agentId: string): void {
    const timer = this.timers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(agentId);
    }
  }

  private publishStatus(agentId: string): void {
    const status = this.states.get(agentId);
    if (!status) return;
    emitEvent({ type: 'heartbeat_status', status });
  }

  private openLLMUnavailableWindow(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    this.llmUnavailableUntil = Math.max(
      this.llmUnavailableUntil,
      Date.now() + durationMs
    );
  }

  private getLLMUnavailableRemainingMs(): number {
    return Math.max(0, this.llmUnavailableUntil - Date.now());
  }

  private search(agent: AgentRow, config: HeartbeatConfig): HeartbeatSearchResult[] {
    const candidates: SearchCandidate[] = [];
    const workflows = db.getWorkflows().slice(0, 40);
    const tasks = workflows.flatMap((workflow) => db.getTasksByWorkflow(workflow.id));
    const relatedTasks = this.getRelatedTasks(agent, tasks);
    const relatedWorkflowIds = new Set(relatedTasks.map((task) => task.workflow_id));

    for (const workflow of workflows) {
      if (!this.isWorkflowRelevant(agent, workflow, relatedWorkflowIds)) continue;

      const summaryText = [
        workflow.directive,
        workflow.results?.ceo_feedback || '',
        workflow.results?.summaries || '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const scored = scoreCandidate(summaryText, config.keywords);
      if (scored.score === 0 && candidates.length >= config.maxResults * 2) continue;

      candidates.push({
        sourceType: 'workflow',
        sourceId: workflow.id,
        title: `Workflow ${workflow.id}`,
        snippet: excerpt(summaryText || workflow.directive),
        matchedKeywords: scored.matchedKeywords,
        score: scored.score + this.recencyBonus(workflow.created_at),
      });
    }

    for (const task of relatedTasks.slice(0, 40)) {
      const text = [task.description, task.manager_feedback, bestTaskResult(task)].filter(Boolean).join('\n\n');
      const scored = scoreCandidate(text, config.keywords);
      if (scored.score === 0 && candidates.length >= config.maxResults * 3) continue;

      candidates.push({
        sourceType: 'task',
        sourceId: String(task.id),
        title: `Task ${task.id} / ${task.worker_id}`,
        snippet: excerpt(text),
        matchedKeywords: scored.matchedKeywords,
        score: scored.score + this.recencyBonus(task.updated_at),
      });
    }

    for (const log of db.getEvolutionLogs(agent.id).slice(-12)) {
      const text = `${log.dimension || 'general'} ${log.patch_content || ''}`;
      const scored = scoreCandidate(text, config.keywords);
      candidates.push({
        sourceType: 'evolution',
        sourceId: String(log.id),
        title: `Evolution ${log.id}`,
        snippet: excerpt(text),
        matchedKeywords: scored.matchedKeywords,
        score: scored.score + this.recencyBonus(log.created_at),
      });
    }

    for (const previous of reportStore.listHeartbeatReports(agent.id, 3)) {
      const text = `${previous.title}\n${previous.summaryPreview}`;
      const scored = scoreCandidate(text, config.keywords);
      candidates.push({
        sourceType: 'heartbeat_report',
        sourceId: previous.reportId,
        title: `Previous heartbeat / ${previous.title}`,
        snippet: excerpt(previous.summaryPreview),
        matchedKeywords: scored.matchedKeywords,
        score: scored.score + this.recencyBonus(previous.generatedAt),
      });
    }

    const deduped = new Map<string, SearchCandidate>();
    for (const candidate of candidates) {
      const key = `${candidate.sourceType}:${candidate.sourceId}`;
      const existing = deduped.get(key);
      if (!existing || candidate.score > existing.score) {
        deduped.set(key, candidate);
      }
    }

    const results = Array.from(deduped.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxResults)
      .map<HeartbeatSearchResult>(({ sourceType, sourceId, title, snippet, matchedKeywords }) => ({
        sourceType,
        sourceId,
        title,
        snippet,
        matchedKeywords,
      }));

    if (results.length > 0) {
      return results;
    }

    return [
      {
        sourceType: 'workflow',
        sourceId: 'fallback',
        title: 'No strong matches found',
        snippet: 'The system has not accumulated enough matching workflow or task history for this heartbeat yet.',
        matchedKeywords: [],
      },
    ];
  }

  private getRelatedTasks(agent: AgentRow, tasks: TaskRow[]): TaskRow[] {
    if (agent.role === 'ceo') return tasks;
    if (agent.role === 'manager') {
      return tasks.filter((task) => task.manager_id === agent.id || task.department === agent.department);
    }
    return tasks.filter((task) => task.worker_id === agent.id);
  }

  private isWorkflowRelevant(
    agent: AgentRow,
    workflow: WorkflowRun,
    relatedWorkflowIds: Set<string>
  ): boolean {
    if (agent.role === 'ceo') return true;
    if (relatedWorkflowIds.has(workflow.id)) return true;
    return (workflow.departments_involved || []).includes(agent.department);
  }

  private recencyBonus(value: string | null | undefined): number {
    if (!value) return 0;
    const ageMs = Date.now() - new Date(value).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours <= 24) return 4;
    if (ageHours <= 72) return 2;
    return 0;
  }
}

function bestTaskResult(task: TaskRow): string {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || '';
}

export const heartbeatScheduler = new HeartbeatScheduler();
