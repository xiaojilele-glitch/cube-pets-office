import db, { type AgentCapabilityRow, type TaskRow } from '../db/index.js';

const ACTION_HINTS = [
  'design',
  'plan',
  'analyze',
  'implement',
  'optimize',
  'integrate',
  'research',
  'draft',
  'build',
  'verify',
  '设计',
  '规划',
  '分析',
  '实现',
  '优化',
  '集成',
  '研究',
  '撰写',
  '制定',
  '验证',
  '策划',
  '拆解',
  '诊断',
  '评估',
  '落地',
];

interface CapabilityUpdateSummary {
  agentId: string;
  capabilities: AgentCapabilityRow[];
}

function bestDeliverable(task: TaskRow): string {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || '';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cleanCapability(raw: string): string | null {
  const cleaned = normalizeWhitespace(
    raw
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*+]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .replace(/[|`*_~]/g, '')
      .replace(/[：:;；,，。.!！?？]+$/g, '')
  );

  if (cleaned.length < 4 || cleaned.length > 80) {
    return null;
  }

  return cleaned;
}

function hasActionSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return ACTION_HINTS.some((hint) => lower.includes(hint));
}

function splitCandidateSegments(text: string): string[] {
  return text
    .split(/\r?\n|[。！？!?；;]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractTaskCapabilities(task: TaskRow): string[] {
  const candidates = [
    ...splitCandidateSegments(task.description),
    ...splitCandidateSegments(bestDeliverable(task)).slice(0, 12),
  ];

  const extracted: string[] = [];
  for (const candidate of candidates) {
    const capability = cleanCapability(candidate);
    if (!capability || !hasActionSignal(capability)) {
      continue;
    }

    extracted.push(capability);
    if (extracted.length >= 5) {
      break;
    }
  }

  if (extracted.length === 0) {
    const fallback = cleanCapability(task.description);
    if (fallback) {
      extracted.push(fallback);
    }
  }

  return unique(extracted).slice(0, 5);
}

function scoreToConfidence(totalScore: number): number {
  return clamp(0.35 + (totalScore / 20) * 0.6, 0.35, 0.95);
}

class CapabilityRegistry {
  registerTask(task: TaskRow): AgentCapabilityRow[] {
    if (task.total_score === null || task.total_score < 12) {
      return [];
    }

    const capabilities = extractTaskCapabilities(task);
    if (capabilities.length === 0) {
      return [];
    }

    const existing = db.getAgentCapabilities(task.worker_id);
    const updated: AgentCapabilityRow[] = [];

    for (const capability of capabilities) {
      const previous = existing.find(
        (item) => item.capability.trim().toLowerCase() === capability.trim().toLowerCase()
      );
      const evidence = scoreToConfidence(task.total_score);
      const confidence = previous ? previous.confidence * 0.7 + evidence * 0.3 : evidence;

      updated.push(
        db.upsertAgentCapability({
          agent_id: task.worker_id,
          capability,
          confidence,
          demo_count: 1,
          last_demonstrated_at: task.updated_at || task.created_at,
        })
      );
    }

    return updated;
  }

  registerWorkflow(tasks: TaskRow[]): CapabilityUpdateSummary[] {
    const summaries = new Map<string, AgentCapabilityRow[]>();

    for (const task of tasks) {
      const updated = this.registerTask(task);
      if (updated.length === 0) {
        continue;
      }

      const list = summaries.get(task.worker_id) || [];
      list.push(...updated);
      summaries.set(task.worker_id, list);
    }

    return Array.from(summaries.entries()).map(([agentId, capabilities]) => ({
      agentId,
      capabilities: unique(capabilities).slice(0, 10),
    }));
  }
}

export const capabilityRegistry = new CapabilityRegistry();
