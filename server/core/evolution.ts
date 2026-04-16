import fs from "fs";
import path from "path";

import db, {
  type AgentCapabilityRow,
  type AgentRow,
  type TaskRow,
} from "../db/index.js";
import { ensureAgentWorkspace } from "../memory/workspace.js";
import { capabilityRegistry } from "./capability-registry.js";
import { registry } from "./registry.js";

type ScoreDimension = "accuracy" | "completeness" | "actionability" | "format";

interface KeywordSignal {
  keyword: string;
  positive: number;
  negative: number;
  occurrence: number;
  correlation: number;
}

interface HeartbeatConfig {
  focus_keywords: string[];
  avoid_keywords: string[];
  effective_keywords: Array<{
    keyword: string;
    correlation: number;
    occurrence_count: number;
  }>;
  ineffective_keywords: Array<{
    keyword: string;
    correlation: number;
    occurrence_count: number;
  }>;
  capability_hints: string[];
  updated_at: string;
  source_workflow_id: string;
}

export interface EvolutionAgentSummary {
  agentId: string;
  weakDimensions: ScoreDimension[];
  learnedKeywords: string[];
  discouragedKeywords: string[];
  capabilities: string[];
  soulFile: string;
  heartbeatFile: string;
}

export interface EvolutionWorkflowSummary {
  workflowId: string;
  generatedAt: string;
  agentCount: number;
  totalWeakDimensions: number;
  totalLearnedKeywords: number;
  totalCapabilities: number;
  agents: EvolutionAgentSummary[];
}

const DIMENSIONS: ScoreDimension[] = [
  "accuracy",
  "completeness",
  "actionability",
  "format",
];

const DIMENSION_BEHAVIORS: Record<ScoreDimension, string> = {
  accuracy: "- 回答前先核对事实、数字和前提，避免未经验证的判断。",
  completeness: "- 交付前用清单确认目标、约束、步骤和风险是否覆盖完整。",
  actionability: "- 输出必须包含可执行步骤、优先级或验收方式，减少空泛建议。",
  format: "- 使用稳定的结构化格式组织答案，先给结论，再展开细节。",
};

const KEYWORD_STOPWORDS = new Set([
  "我们",
  "你们",
  "他们",
  "这个",
  "那个",
  "这些",
  "那些",
  "以及",
  "然后",
  "需要",
  "可以",
  "应该",
  "如果",
  "已经",
  "进行",
  "相关",
  "当前",
  "方案",
  "任务",
  "交付",
  "内容",
  "工作",
  "问题",
  "建议",
  "输出",
  "具体",
  "通过",
  "负责",
  "一个",
  "一些",
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "have",
  "will",
  "your",
  "about",
]);

function bestDeliverable(task: TaskRow): string {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function tokenize(text: string): string[] {
  return (
    text.toLowerCase().match(/[\u4e00-\u9fff]{2,8}|[a-z][a-z0-9_-]{1,31}/g) ||
    []
  ).filter(token => !KEYWORD_STOPWORDS.has(token));
}

function averageByDimension(tasks: TaskRow[]): Record<ScoreDimension, number> {
  const result = {
    accuracy: 0,
    completeness: 0,
    actionability: 0,
    format: 0,
  };

  if (tasks.length === 0) {
    return result;
  }

  for (const dim of DIMENSIONS) {
    const key = `score_${dim}` as keyof TaskRow;
    result[dim] =
      tasks.reduce((sum, task) => sum + (Number(task[key]) || 0), 0) /
      Math.max(tasks.length, 1);
  }

  return result;
}

function analyzeWeakDimensions(tasks: TaskRow[]): {
  weakDimensions: ScoreDimension[];
  averages: Record<ScoreDimension, number>;
} {
  const averages = averageByDimension(tasks);
  return {
    weakDimensions: DIMENSIONS.filter(
      dim => averages[dim] > 0 && averages[dim] < 3
    ),
    averages,
  };
}

function upsertBulletSection(
  markdown: string,
  title: string,
  bullets: string[]
): { markdown: string; addedBullets: string[] } {
  const normalizedBullets = unique(
    bullets
      .map(bullet => bullet.trim())
      .filter(bullet => bullet.startsWith("- "))
  );
  if (normalizedBullets.length === 0) {
    return { markdown, addedBullets: [] };
  }

  const heading = `## ${title}`;
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex(line => line.trim() === heading);

  if (startIndex === -1) {
    const nextMarkdown = `${markdown.trimEnd()}\n\n## ${title}\n${normalizedBullets.join("\n")}\n`;
    return { markdown: nextMarkdown, addedBullets: normalizedBullets };
  }

  let endIndex = lines.findIndex(
    (line, index) => index > startIndex && /^##\s/.test(line.trim())
  );
  if (endIndex === -1) {
    endIndex = lines.length;
  }

  const existingBullets = lines
    .slice(startIndex + 1, endIndex)
    .map(line => line.trim())
    .filter(line => line.startsWith("- "));
  const additions = normalizedBullets.filter(
    bullet => !existingBullets.includes(bullet)
  );

  if (additions.length === 0) {
    return { markdown, addedBullets: [] };
  }

  const nextLines = [
    ...lines.slice(0, endIndex),
    ...additions,
    ...lines.slice(endIndex),
  ];

  return {
    markdown: nextLines.join("\n"),
    addedBullets: additions,
  };
}

function buildKeywordSignals(tasks: TaskRow[]): KeywordSignal[] {
  const stats = new Map<
    string,
    {
      positive: number;
      negative: number;
      occurrence: number;
    }
  >();

  for (const task of tasks) {
    if (task.total_score === null) {
      continue;
    }

    const score = task.total_score;
    const weight = score >= 16 ? 2 : score >= 12 ? 0.75 : -1.5;
    const sourceText = [
      task.description,
      bestDeliverable(task),
      task.manager_feedback || "",
      task.meta_audit_feedback || "",
    ]
      .filter(Boolean)
      .join("\n");

    const tokens = unique(tokenize(sourceText)).slice(0, 32);
    for (const token of tokens) {
      const current = stats.get(token) || {
        positive: 0,
        negative: 0,
        occurrence: 0,
      };
      current.occurrence += 1;
      if (weight > 0) {
        current.positive += weight;
      } else {
        current.negative += Math.abs(weight);
      }
      stats.set(token, current);
    }
  }

  return Array.from(stats.entries()).map(([keyword, value]) => ({
    keyword,
    positive: value.positive,
    negative: value.negative,
    occurrence: value.occurrence,
    correlation:
      value.occurrence > 0
        ? clamp((value.positive - value.negative) / value.occurrence, -3, 3)
        : 0,
  }));
}

function renderHeartbeatMarkdown(
  agent: AgentRow,
  heartbeatConfig: HeartbeatConfig,
  capabilities: AgentCapabilityRow[]
): string {
  const focusKeywords =
    heartbeatConfig.focus_keywords.length > 0
      ? heartbeatConfig.focus_keywords.map(keyword => `- ${keyword}`).join("\n")
      : "- 暂无高置信关键词";

  const avoidKeywords =
    heartbeatConfig.avoid_keywords.length > 0
      ? heartbeatConfig.avoid_keywords.map(keyword => `- ${keyword}`).join("\n")
      : "- 暂无明显低效关键词";

  const capabilityLines =
    capabilities.length > 0
      ? capabilities
          .slice(0, 8)
          .map(
            item =>
              `- ${item.capability} (confidence: ${item.confidence.toFixed(2)}, demos: ${item.demo_count})`
          )
          .join("\n")
      : "- 暂无已登记能力";

  return `# HEARTBEAT

- Agent: ${agent.name} (${agent.id})
- Updated At: ${heartbeatConfig.updated_at}
- Source Workflow: ${heartbeatConfig.source_workflow_id}

## Focus Keywords
${focusKeywords}

## Avoid Keywords
${avoidKeywords}

## Capability Signals
${capabilityLines}
`;
}

class EvolutionService {
  evolveWorkflow(workflowId: string): EvolutionWorkflowSummary {
    const tasks = db
      .getTasksByWorkflow(workflowId)
      .filter(task => task.total_score !== null);
    const capabilitySummaries = capabilityRegistry.registerWorkflow(tasks);
    const capabilityMap = new Map(
      capabilitySummaries.map(item => [
        item.agentId,
        item.capabilities.map(row => row.capability),
      ])
    );

    const tasksByAgent = new Map<string, TaskRow[]>();
    for (const task of tasks) {
      const list = tasksByAgent.get(task.worker_id) || [];
      list.push(task);
      tasksByAgent.set(task.worker_id, list);
    }

    const summaries: EvolutionAgentSummary[] = [];

    for (const [agentId, agentTasks] of Array.from(tasksByAgent.entries())) {
      const agent = db.getAgent(agentId);
      if (!agent) {
        continue;
      }

      const recentScores = db.getRecentScores(agentId, 5);
      const { weakDimensions, averages } = analyzeWeakDimensions(recentScores);
      let nextSoul = agent.soul_md || `# ${agent.name}`;

      if (weakDimensions.length > 0) {
        const personaUpdate = upsertBulletSection(
          nextSoul,
          "Learned Behaviors (Auto-evolved)",
          weakDimensions.map(dim => DIMENSION_BEHAVIORS[dim])
        );
        nextSoul = personaUpdate.markdown;

        for (const dim of weakDimensions) {
          db.createEvolutionLog({
            agent_id: agentId,
            workflow_id: workflowId,
            dimension: dim,
            old_score: Number(averages[dim].toFixed(3)),
            new_score: null,
            patch_content: DIMENSION_BEHAVIORS[dim],
            applied: 1,
          });
        }
      }

      if (nextSoul !== (agent.soul_md || "")) {
        db.updateAgentSoul(agentId, nextSoul);
        registry.refresh(agentId);
      }

      const keywordSignals = buildKeywordSignals(agentTasks);
      const effectiveKeywords = keywordSignals
        .filter(item => item.correlation > 0.4)
        .sort(
          (a, b) => b.correlation - a.correlation || b.occurrence - a.occurrence
        )
        .slice(0, 8);
      const ineffectiveKeywords = keywordSignals
        .filter(item => item.correlation < -0.25)
        .sort(
          (a, b) => a.correlation - b.correlation || b.occurrence - a.occurrence
        )
        .slice(0, 6);

      for (const item of effectiveKeywords) {
        db.upsertHeartbeatKeyword({
          agent_id: agentId,
          keyword: item.keyword,
          category: "effective",
          correlation: Number(item.correlation.toFixed(3)),
          occurrence_count: item.occurrence,
          last_seen_at: new Date().toISOString(),
        });
      }

      for (const item of ineffectiveKeywords) {
        db.upsertHeartbeatKeyword({
          agent_id: agentId,
          keyword: item.keyword,
          category: "ineffective",
          correlation: Number(item.correlation.toFixed(3)),
          occurrence_count: item.occurrence,
          last_seen_at: new Date().toISOString(),
        });
      }

      const persistedKeywords = db.getHeartbeatKeywords(agentId);
      const focusKeywords = persistedKeywords
        .filter(item => item.category === "effective")
        .slice(0, 8);
      const avoidKeywords = persistedKeywords
        .filter(item => item.category === "ineffective")
        .slice(0, 6);
      const capabilities = db.getAgentCapabilities(agentId).slice(0, 8);

      const heartbeatConfig: HeartbeatConfig = {
        focus_keywords: focusKeywords.map(item => item.keyword),
        avoid_keywords: avoidKeywords.map(item => item.keyword),
        effective_keywords: focusKeywords.map(item => ({
          keyword: item.keyword,
          correlation: Number(item.correlation.toFixed(3)),
          occurrence_count: item.occurrence_count,
        })),
        ineffective_keywords: avoidKeywords.map(item => ({
          keyword: item.keyword,
          correlation: Number(item.correlation.toFixed(3)),
          occurrence_count: item.occurrence_count,
        })),
        capability_hints: capabilities.map(item => item.capability),
        updated_at: new Date().toISOString(),
        source_workflow_id: workflowId,
      };

      db.updateAgentHeartbeatConfig(agentId, heartbeatConfig);

      const { rootDir } = ensureAgentWorkspace(agentId);
      const soulFile = path.join(rootDir, "SOUL.md");
      const heartbeatFile = path.join(rootDir, "HEARTBEAT.md");
      fs.writeFileSync(soulFile, nextSoul, "utf-8");
      fs.writeFileSync(
        heartbeatFile,
        renderHeartbeatMarkdown(agent, heartbeatConfig, capabilities),
        "utf-8"
      );

      summaries.push({
        agentId,
        weakDimensions,
        learnedKeywords: heartbeatConfig.focus_keywords,
        discouragedKeywords: heartbeatConfig.avoid_keywords,
        capabilities:
          capabilityMap.get(agentId) ||
          capabilities.map(item => item.capability),
        soulFile: toRelativePath(soulFile),
        heartbeatFile: toRelativePath(heartbeatFile),
      });
    }

    return {
      workflowId,
      generatedAt: new Date().toISOString(),
      agentCount: summaries.length,
      totalWeakDimensions: summaries.reduce(
        (sum, item) => sum + item.weakDimensions.length,
        0
      ),
      totalLearnedKeywords: summaries.reduce(
        (sum, item) => sum + item.learnedKeywords.length,
        0
      ),
      totalCapabilities: summaries.reduce(
        (sum, item) => sum + item.capabilities.length,
        0
      ),
      agents: summaries,
    };
  }
}

export const evolutionService = new EvolutionService();
