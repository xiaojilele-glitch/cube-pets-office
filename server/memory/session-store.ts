import db from '../db/index.js';
import {
  appendAgentWorkspaceFile,
  readAgentWorkspaceFile,
  writeAgentWorkspaceFile,
} from '../core/access-guard.js';
import { vectorStore } from './vector-store.js';

export interface SessionEntry {
  timestamp: string;
  workflowId: string | null;
  stage: string | null;
  type: 'message' | 'llm_prompt' | 'llm_response' | 'workflow_summary';
  direction?: 'inbound' | 'outbound';
  agentId?: string;
  otherAgentId?: string;
  preview: string;
  content: string;
  metadata?: any;
}

export interface MemorySummary {
  workflowId: string;
  createdAt: string;
  directive: string;
  status: string;
  role: string;
  stage: string | null;
  summary: string;
  keywords: string[];
  keywordScore?: number;
  vectorScore?: number;
  retrievalMethod?: 'recent' | 'keyword' | 'vector' | 'hybrid';
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\u4e00-\u9fff]{1,8}|[a-z0-9_]+/g) || []).filter(
    (token) => token.length >= 2
  );
}

function uniqueSorted<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function buildKeywordList(text: string, limit: number = 12): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function getSessionFile(workflowId?: string | null): string {
  return `${workflowId || '_general'}.jsonl`;
}

function getSummaryFile(): string {
  return 'summaries.json';
}

function safeParseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readJsonLines(agentId: string, workflowId?: string | null): SessionEntry[] {
  const content = readAgentWorkspaceFile(agentId, getSessionFile(workflowId), 'sessions');
  if (!content) return [];

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionEntry);
}

function readSummaryIndex(agentId: string): MemorySummary[] {
  return safeParseJson<MemorySummary[]>(readAgentWorkspaceFile(agentId, getSummaryFile(), 'memory'), []);
}

function writeSummaryIndex(agentId: string, summaries: MemorySummary[]): void {
  writeAgentWorkspaceFile(agentId, getSummaryFile(), JSON.stringify(summaries, null, 2), 'memory');
}

function compactText(text: string, limit: number = 1200): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.substring(0, limit)}...`;
}

function renderContextEntry(entry: SessionEntry): string {
  const time = entry.timestamp;
  const stage = entry.stage || 'general';
  const direction = entry.direction ? ` ${entry.direction}` : '';
  const relation = entry.otherAgentId ? ` ${entry.otherAgentId}` : '';
  return `[${time}] [${stage}] [${entry.type}${direction}${relation}] ${entry.content}`;
}

class SessionStore {
  appendEntry(agentId: string, entry: Omit<SessionEntry, 'timestamp'> & { timestamp?: string }): void {
    const row: SessionEntry = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    };

    appendAgentWorkspaceFile(
      agentId,
      getSessionFile(row.workflowId),
      `${JSON.stringify(row)}\n`,
      'sessions'
    );
  }

  appendMessageLog(
    agentId: string,
    options: {
      workflowId: string;
      stage: string;
      direction: 'inbound' | 'outbound';
      otherAgentId: string;
      content: string;
      metadata?: any;
    }
  ): void {
    this.appendEntry(agentId, {
      workflowId: options.workflowId,
      stage: options.stage,
      type: 'message',
      direction: options.direction,
      otherAgentId: options.otherAgentId,
      preview: compactText(options.content, 160),
      content: options.content,
      metadata: options.metadata || null,
    });
  }

  appendLLMExchange(
    agentId: string,
    options: {
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: any;
    }
  ): void {
    this.appendEntry(agentId, {
      workflowId: options.workflowId || null,
      stage: options.stage || null,
      type: 'llm_prompt',
      preview: compactText(options.prompt, 160),
      content: options.prompt,
      metadata: options.metadata || null,
    });

    this.appendEntry(agentId, {
      workflowId: options.workflowId || null,
      stage: options.stage || null,
      type: 'llm_response',
      preview: compactText(options.response, 160),
      content: options.response,
      metadata: options.metadata || null,
    });
  }

  getWorkflowEntries(agentId: string, workflowId: string): SessionEntry[] {
    return readJsonLines(agentId, workflowId);
  }

  getRecentEntries(agentId: string, workflowId?: string, limit: number = 8): SessionEntry[] {
    const entries = workflowId ? this.getWorkflowEntries(agentId, workflowId) : readJsonLines(agentId, null);
    return entries.slice(-limit);
  }

  searchMemories(agentId: string, query: string, topK: number = 3): MemorySummary[] {
    const summaries = readSummaryIndex(agentId);
    const queryTokens = uniqueSorted(tokenize(query));
    const keywordHits = new Map<string, MemorySummary>();

    for (const summary of summaries) {
      const haystack = `${summary.directive}\n${summary.summary}\n${summary.keywords.join(' ')}`.toLowerCase();
      const keywordScore = queryTokens.reduce(
        (total, token) => total + (haystack.includes(token) ? 1 : 0),
        0
      );

      if (queryTokens.length === 0 || keywordScore > 0) {
        keywordHits.set(summary.workflowId, {
          ...summary,
          keywordScore,
          retrievalMethod: queryTokens.length === 0 ? 'recent' : 'keyword',
        });
      }
    }

    const vectorHits = vectorStore.searchMemorySummaries(agentId, query, Math.max(topK * 2, 6));
    for (const hit of vectorHits) {
      const existing = keywordHits.get(hit.summary.workflowId);
      keywordHits.set(hit.summary.workflowId, {
        ...(existing || hit.summary),
        ...hit.summary,
        keywordScore: existing?.keywordScore || 0,
        vectorScore: hit.score,
        retrievalMethod: existing ? 'hybrid' : 'vector',
      });
    }

    const ranked = Array.from(keywordHits.values()).sort((left, right) => {
      const leftCombined = (left.keywordScore || 0) + (left.vectorScore || 0);
      const rightCombined = (right.keywordScore || 0) + (right.vectorScore || 0);
      return rightCombined - leftCombined || right.createdAt.localeCompare(left.createdAt);
    });

    if (queryTokens.length === 0 && query.trim() === '') {
      return summaries
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, topK)
        .map((summary) => ({ ...summary, retrievalMethod: 'recent' }));
    }

    return ranked.slice(0, topK);
  }

  buildPromptContext(agentId: string, query: string, workflowId?: string): string[] {
    const sections: string[] = [];

    if (workflowId) {
      const workflowEntries = this.getWorkflowEntries(agentId, workflowId);
      if (workflowEntries.length > 0) {
        const transcript = workflowEntries.map((entry) => renderContextEntry(entry)).join('\n\n');
        sections.push(`以下是你在当前 workflow 中的完整上下文记录，请延续已有判断、承诺和事实，不要丢失前文：\n${transcript}`);
      }
    } else {
      const recentEntries = this.getRecentEntries(agentId, undefined, 8);
      if (recentEntries.length > 0) {
        const recentText = recentEntries
          .map((entry) => `- [${entry.type}] ${entry.preview}`)
          .join('\n');
        sections.push(`以下是你最近的通用记忆片段，可帮助你保持连续性：\n${recentText}`);
      }
    }

    const relevantMemories = this.searchMemories(agentId, query, 3).filter(
      (memory) => memory.workflowId !== workflowId
    );
    if (relevantMemories.length > 0) {
      const memoryText = relevantMemories
        .map((memory) => {
          const scores = [
            typeof memory.keywordScore === 'number' ? `keyword=${memory.keywordScore}` : null,
            typeof memory.vectorScore === 'number' ? `vector=${memory.vectorScore.toFixed(3)}` : null,
          ]
            .filter(Boolean)
            .join(', ');
          return `- 工作流 ${memory.workflowId}（${memory.status}）\n  指令：${memory.directive}\n  摘要：${memory.summary}\n  检索方式：${memory.retrievalMethod || 'unknown'}${scores ? `，${scores}` : ''}`;
        })
        .join('\n');
      sections.push(`以下是与你当前任务相关的历史经验，可作为参考但不要机械复用：\n${memoryText}`);
    }

    return sections;
  }

  materializeWorkflowMemories(workflowId: string): void {
    const workflow = db.getWorkflow(workflowId);
    if (!workflow) return;

    const messages = db.getMessagesByWorkflow(workflowId);
    const tasks = db.getTasksByWorkflow(workflowId);
    const agentIds = uniqueSorted(
      [
        ...messages.flatMap((message) => [message.from_agent, message.to_agent]),
        ...tasks.flatMap((task) => [task.worker_id, task.manager_id]),
        'ceo',
      ].filter(Boolean)
    );

    for (const agentId of agentIds) {
      const agent = db.getAgent(agentId);
      if (!agent) continue;

      const agentMessages = messages.filter(
        (message) => message.from_agent === agentId || message.to_agent === agentId
      );
      const agentTasks = tasks.filter(
        (task) => task.worker_id === agentId || task.manager_id === agentId
      );
      const workflowEntries = this.getWorkflowEntries(agentId, workflowId);

      const summaryParts: string[] = [
        `角色：${agent.role}`,
        `工作流状态：${workflow.status}`,
        `消息数：${agentMessages.length}`,
        `相关任务数：${agentTasks.length}`,
        `完整上下文条目数：${workflowEntries.length}`,
      ];

      if (agentTasks.length > 0) {
        const taskSummary = agentTasks
          .map((task) => {
            const scoreText = task.total_score === null ? '未评分' : `${task.total_score}/20`;
            return `${task.description}（状态：${task.status}，分数：${scoreText}）`;
          })
          .join('；');
        summaryParts.push(`任务摘要：${taskSummary}`);
      }

      if (agentMessages.length > 0) {
        const latestMessages = agentMessages
          .slice(-5)
          .map(
            (message) =>
              `${message.from_agent} -> ${message.to_agent} [${message.stage}] ${compactText(message.content, 120)}`
          )
          .join('；');
        summaryParts.push(`近期消息：${latestMessages}`);
      }

      if (workflowEntries.length > 0) {
        const fullContextSummary = workflowEntries
          .map((entry) => compactText(renderContextEntry(entry), 240))
          .join('\n');
        summaryParts.push(`上下文回放：\n${fullContextSummary}`);
      }

      const summary = summaryParts.join('\n');
      const keywords = buildKeywordList(
        `${workflow.directive}\n${summary}\n${agentMessages.map((message) => message.content).join('\n')}`
      );

      const memory: MemorySummary = {
        workflowId,
        createdAt: new Date().toISOString(),
        directive: workflow.directive,
        status: workflow.status,
        role: agent.role,
        stage: workflow.current_stage,
        summary,
        keywords,
      };

      const summaries = readSummaryIndex(agentId).filter((item) => item.workflowId !== workflowId);
      summaries.push(memory);
      summaries.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      writeSummaryIndex(agentId, summaries);
      vectorStore.upsertMemorySummary(agentId, memory);

      this.appendEntry(agentId, {
        workflowId,
        stage: workflow.current_stage,
        type: 'workflow_summary',
        preview: compactText(summary, 160),
        content: summary,
        metadata: { keywords, workflowEntryCount: workflowEntries.length },
      });
    }
  }
}

export const sessionStore = new SessionStore();
