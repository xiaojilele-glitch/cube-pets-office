import fs from 'fs';
import path from 'path';

import db, { type TaskRow, type WorkflowRun } from '../db/index.js';
import { ensureAgentWorkspace } from './workspace.js';

interface AgentIdentity {
  id: string;
  name: string;
  department?: string;
}

export interface DepartmentReport {
  kind: 'department_report';
  version: 1;
  workflowId: string;
  generatedAt: string;
  workflow: {
    directive: string;
    status: string;
  };
  manager: AgentIdentity;
  summary: string;
  stats: {
    taskCount: number;
    passedTaskCount: number;
    averageScore: number | null;
  };
  tasks: Array<{
    id: number;
    workerId: string;
    description: string;
    status: string;
    totalScore: number | null;
    deliverablePreview: string;
  }>;
}

export interface FinalWorkflowReport {
  kind: 'final_workflow_report';
  version: 1;
  workflowId: string;
  generatedAt: string;
  workflow: {
    rootAgentId: string;
    rootAgentName: string;
    directive: string;
    status: string;
    currentStage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    departmentsInvolved: string[];
  };
  stats: {
    messageCount: number;
    taskCount: number;
    passedTaskCount: number;
    revisedTaskCount: number;
    averageScore: number | null;
  };
  departmentReports: Array<{
    managerId: string;
    managerName: string;
    department: string;
    summary: string;
    taskCount: number;
    averageScore: number | null;
    reportJsonPath: string;
    reportMarkdownPath: string;
  }>;
  ceoFeedback: string;
  keyIssues: string[];
  tasks: Array<{
    id: number;
    department: string;
    workerId: string;
    managerId: string;
    status: string;
    totalScore: number | null;
    description: string;
    deliverablePreview: string;
  }>;
}

export interface HeartbeatSearchResult {
  sourceType: 'workflow' | 'task' | 'evolution' | 'heartbeat_report';
  sourceId: string;
  title: string;
  snippet: string;
  matchedKeywords: string[];
}

export interface HeartbeatReport {
  kind: 'heartbeat_report';
  version: 1;
  reportId: string;
  generatedAt: string;
  trigger: 'scheduled' | 'manual' | 'startup';
  agent: AgentIdentity;
  config: {
    intervalMinutes: number;
    keywords: string[];
    focus: string;
    maxResults: number;
  };
  title: string;
  summary: string;
  observations: string[];
  actionItems: string[];
  searchResults: HeartbeatSearchResult[];
}

export interface HeartbeatReportSummary {
  reportId: string;
  generatedAt: string;
  trigger: HeartbeatReport['trigger'];
  agentId: string;
  agentName: string;
  department: string;
  title: string;
  summaryPreview: string;
  keywords: string[];
  searchResultCount: number;
  jsonPath: string;
  markdownPath: string;
}

interface SavedReportPaths {
  jsonPath: string;
  markdownPath: string;
}

type ReportFormat = 'json' | 'md';

function bestDeliverable(task: TaskRow): string {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || '(no deliverable)';
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

function ensureJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function ensureTextFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
}

function averageScore(tasks: TaskRow[]): number | null {
  const scored = tasks.filter((task) => task.total_score !== null);
  if (scored.length === 0) return null;
  return scored.reduce((sum, task) => sum + (task.total_score || 0), 0) / scored.length;
}

function trimBlock(text: string, maxLength: number): string {
  const normalized = (text || '').trim();
  if (!normalized) return 'N/A';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
}

function renderDepartmentMarkdown(report: DepartmentReport): string {
  return `# Department Report

- Workflow ID: ${report.workflowId}
- Generated At: ${report.generatedAt}
- Manager: ${report.manager.name} (${report.manager.id})
- Department: ${report.manager.department || 'unknown'}
- Status: ${report.workflow.status}
- Task Count: ${report.stats.taskCount}
- Passed Tasks: ${report.stats.passedTaskCount}
- Average Score: ${report.stats.averageScore === null ? 'N/A' : report.stats.averageScore.toFixed(1)}

## Directive

${report.workflow.directive}

## Manager Summary

${report.summary}

## Tasks

${report.tasks
  .map(
    (task) => `### Task ${task.id} / ${task.workerId}

- Status: ${task.status}
- Score: ${task.totalScore === null ? 'N/A' : `${task.totalScore}/20`}
- Description: ${task.description}

#### Deliverable Preview

${task.deliverablePreview}`
  )
  .join('\n\n')}`;
}

function renderFinalWorkflowMarkdown(report: FinalWorkflowReport): string {
  return `# Final Workflow Report

- Workflow ID: ${report.workflowId}
- Generated At: ${report.generatedAt}
- Root Agent: ${report.workflow.rootAgentName} (${report.workflow.rootAgentId})
- Status: ${report.workflow.status}
- Current Stage: ${report.workflow.currentStage || 'completed'}
- Started At: ${report.workflow.startedAt || 'N/A'}
- Completed At: ${report.workflow.completedAt || 'N/A'}
- Departments: ${report.workflow.departmentsInvolved.join(', ') || 'N/A'}
- Messages: ${report.stats.messageCount}
- Tasks: ${report.stats.taskCount}
- Passed Tasks: ${report.stats.passedTaskCount}
- Revised Tasks: ${report.stats.revisedTaskCount}
- Average Score: ${report.stats.averageScore === null ? 'N/A' : report.stats.averageScore.toFixed(1)}

## Directive

${report.workflow.directive}

## Department Reports

${report.departmentReports
  .map(
    (item) => `### ${item.department} / ${item.managerName}

- Task Count: ${item.taskCount}
- Average Score: ${item.averageScore === null ? 'N/A' : item.averageScore.toFixed(1)}
- JSON Report: ${item.reportJsonPath}
- Markdown Report: ${item.reportMarkdownPath}

${item.summary}`
  )
  .join('\n\n')}

## CEO Feedback

${report.ceoFeedback || 'N/A'}

## Key Issues

${report.keyIssues.length > 0 ? report.keyIssues.map((issue) => `- ${issue}`).join('\n') : '- None'}

## Task Snapshot

${report.tasks
  .map(
    (task) => `### Task ${task.id} / ${task.workerId}

- Department: ${task.department}
- Manager: ${task.managerId}
- Status: ${task.status}
- Score: ${task.totalScore === null ? 'N/A' : `${task.totalScore}/20`}
- Description: ${task.description}

#### Deliverable Preview

${task.deliverablePreview}`
  )
  .join('\n\n')}`;
}

function renderHeartbeatMarkdown(report: HeartbeatReport): string {
  return `# Heartbeat Report

- Report ID: ${report.reportId}
- Generated At: ${report.generatedAt}
- Trigger: ${report.trigger}
- Agent: ${report.agent.name} (${report.agent.id})
- Department: ${report.agent.department || 'unknown'}
- Interval Minutes: ${report.config.intervalMinutes}
- Focus: ${report.config.focus}
- Keywords: ${report.config.keywords.join(', ') || 'N/A'}

## Title

${report.title}

## Summary

${report.summary}

## Observations

${report.observations.length > 0
  ? report.observations.map((item) => `- ${item}`).join('\n')
  : '- None'}

## Action Items

${report.actionItems.length > 0
  ? report.actionItems.map((item) => `- ${item}`).join('\n')
  : '- None'}

## Search Results

${report.searchResults
  .map(
    (item, index) => `### ${index + 1}. ${item.title}

- Type: ${item.sourceType}
- Source ID: ${item.sourceId}
- Matched Keywords: ${item.matchedKeywords.join(', ') || 'N/A'}

${item.snippet}`
  )
  .join('\n\n')}`;
}

function buildHeartbeatSummary(report: HeartbeatReport, paths: SavedReportPaths): HeartbeatReportSummary {
  return {
    reportId: report.reportId,
    generatedAt: report.generatedAt,
    trigger: report.trigger,
    agentId: report.agent.id,
    agentName: report.agent.name,
    department: report.agent.department || 'unknown',
    title: report.title,
    summaryPreview: trimBlock(report.summary, 220),
    keywords: [...report.config.keywords],
    searchResultCount: report.searchResults.length,
    jsonPath: paths.jsonPath,
    markdownPath: paths.markdownPath,
  };
}

class ReportStore {
  saveDepartmentReport(report: DepartmentReport): SavedReportPaths {
    const { reportsDir } = ensureAgentWorkspace(report.manager.id);
    const basename = `${report.workflowId}__department-report`;
    const jsonPath = path.join(reportsDir, `${basename}.json`);
    const markdownPath = path.join(reportsDir, `${basename}.md`);

    ensureJsonFile(jsonPath, report);
    ensureTextFile(markdownPath, renderDepartmentMarkdown(report));

    return {
      jsonPath: toRelativePath(jsonPath),
      markdownPath: toRelativePath(markdownPath),
    };
  }

  saveFinalWorkflowReport(report: FinalWorkflowReport): SavedReportPaths {
    const { reportsDir } = ensureAgentWorkspace(report.workflow.rootAgentId);
    const basename = `${report.workflowId}__final-report`;
    const jsonPath = path.join(reportsDir, `${basename}.json`);
    const markdownPath = path.join(reportsDir, `${basename}.md`);

    ensureJsonFile(jsonPath, report);
    ensureTextFile(markdownPath, renderFinalWorkflowMarkdown(report));

    return {
      jsonPath: toRelativePath(jsonPath),
      markdownPath: toRelativePath(markdownPath),
    };
  }

  saveHeartbeatReport(report: HeartbeatReport): SavedReportPaths {
    const { reportsDir } = ensureAgentWorkspace(report.agent.id);
    const basename = `${report.reportId}__heartbeat-report`;
    const jsonPath = path.join(reportsDir, `${basename}.json`);
    const markdownPath = path.join(reportsDir, `${basename}.md`);

    ensureJsonFile(jsonPath, report);
    ensureTextFile(markdownPath, renderHeartbeatMarkdown(report));

    return {
      jsonPath: toRelativePath(jsonPath),
      markdownPath: toRelativePath(markdownPath),
    };
  }

  readFinalWorkflowReport(workflowId: string): FinalWorkflowReport | null {
    const workflow = db.getWorkflow(workflowId);
    const relativePath = workflow?.results?.final_report?.json_path;
    if (!relativePath || typeof relativePath !== 'string') return null;
    const jsonPath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(jsonPath)) return null;

    try {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as FinalWorkflowReport;
    } catch {
      return null;
    }
  }

  readHeartbeatReport(agentId: string, reportId: string): HeartbeatReport | null {
    const { reportsDir } = ensureAgentWorkspace(agentId);
    const jsonPath = path.join(reportsDir, `${reportId}__heartbeat-report.json`);
    if (!fs.existsSync(jsonPath)) return null;

    try {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as HeartbeatReport;
    } catch {
      return null;
    }
  }

  listHeartbeatReports(agentId?: string, limit: number = 20): HeartbeatReportSummary[] {
    const agentIds = agentId ? [agentId] : db.getAgents().map((agent) => agent.id);
    const summaries: HeartbeatReportSummary[] = [];

    for (const currentAgentId of agentIds) {
      const { reportsDir } = ensureAgentWorkspace(currentAgentId);
      if (!fs.existsSync(reportsDir)) continue;

      const files = fs
        .readdirSync(reportsDir)
        .filter((name) => name.endsWith('__heartbeat-report.json'))
        .sort()
        .reverse();

      for (const file of files) {
        try {
          const fullPath = path.join(reportsDir, file);
          const report = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as HeartbeatReport;
          summaries.push(
            buildHeartbeatSummary(report, {
              jsonPath: toRelativePath(fullPath),
              markdownPath: toRelativePath(
                path.join(reportsDir, file.replace(/\.json$/i, '.md'))
              ),
            })
          );
        } catch {
          continue;
        }
      }
    }

    return summaries
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
      .slice(0, limit);
  }

  getFinalWorkflowReportFilePath(workflowId: string, format: ReportFormat): string | null {
    const workflow = db.getWorkflow(workflowId);
    const relativePath =
      format === 'json'
        ? workflow?.results?.final_report?.json_path
        : workflow?.results?.final_report?.markdown_path;
    if (!relativePath || typeof relativePath !== 'string') return null;
    const filePath = path.resolve(process.cwd(), relativePath);
    return fs.existsSync(filePath) ? filePath : null;
  }

  getDepartmentReportFilePath(
    managerId: string,
    workflowId: string,
    format: ReportFormat
  ): string | null {
    const { reportsDir } = ensureAgentWorkspace(managerId);
    const filename = `${workflowId}__department-report.${format}`;
    const filePath = path.join(reportsDir, filename);
    return fs.existsSync(filePath) ? filePath : null;
  }

  getHeartbeatReportFilePath(agentId: string, reportId: string, format: ReportFormat): string | null {
    const { reportsDir } = ensureAgentWorkspace(agentId);
    const filename = `${reportId}__heartbeat-report.${format}`;
    const filePath = path.join(reportsDir, filename);
    return fs.existsSync(filePath) ? filePath : null;
  }

  buildDepartmentReport(
    workflow: WorkflowRun,
    manager: AgentIdentity,
    summary: string,
    tasks: TaskRow[]
  ): DepartmentReport {
    return {
      kind: 'department_report',
      version: 1,
      workflowId: workflow.id,
      generatedAt: new Date().toISOString(),
      workflow: {
        directive: workflow.directive,
        status: workflow.status,
      },
      manager,
      summary,
      stats: {
        taskCount: tasks.length,
        passedTaskCount: tasks.filter((task) => task.status === 'passed').length,
        averageScore: averageScore(tasks),
      },
      tasks: tasks.map((task) => ({
        id: task.id,
        workerId: task.worker_id,
        description: task.description,
        status: task.status,
        totalScore: task.total_score,
        deliverablePreview: bestDeliverable(task).substring(0, 800),
      })),
    };
  }
}

export const reportStore = new ReportStore();
