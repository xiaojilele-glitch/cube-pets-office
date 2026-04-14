/// <reference lib="webworker" />

import {
  createSeedAgents,
  createSeedHeartbeatStatuses,
  getManagerForDepartment,
  getWorkersForManager,
  STAGES,
} from "./local-runtime-data";
import {
  buildWorkflowDirectiveContext,
  buildWorkflowInputSignature,
  normalizeWorkflowAttachments,
  type WorkflowInputAttachment,
} from "@shared/workflow-input";
import type {
  AgentInfo,
  HeartbeatReportInfo,
  HeartbeatStatusInfo,
  MessageInfo,
  RuntimeDownloadPayload,
  RuntimeStateSnapshot,
  TaskInfo,
  WorkflowInfo,
} from "./types";

const scope = self as DedicatedWorkerGlobalScope;

type WorkerRequestType =
  | "init"
  | "get_snapshot"
  | "get_agents"
  | "get_stages"
  | "list_workflows"
  | "get_workflow_detail"
  | "get_agent_recent_memory"
  | "search_agent_memory"
  | "get_heartbeat_statuses"
  | "get_heartbeat_reports"
  | "run_heartbeat"
  | "submit_directive"
  | "download_workflow_report"
  | "download_heartbeat_report";

interface WorkerRequest {
  requestId: string;
  type: WorkerRequestType;
  payload?: any;
}

let state = createDefaultState();

function createDefaultState(): RuntimeStateSnapshot {
  const agents = createSeedAgents();
  const agentStatuses = Object.fromEntries(agents.map(agent => [agent.id, "idle"]));

  return {
    agents,
    workflows: [],
    tasks: [],
    messages: [],
    agentStatuses,
    memoryEntriesByAgent: Object.fromEntries(agents.map(agent => [agent.id, []])),
    memorySummariesByAgent: Object.fromEntries(agents.map(agent => [agent.id, []])),
    heartbeatStatuses: createSeedHeartbeatStatuses(agents),
    heartbeatReports: [],
    stages: STAGES,
    nextTaskId: 1,
    nextMessageId: 1,
  };
}

function respond(requestId: string, payload?: any, error?: string) {
  scope.postMessage({ type: "response", requestId, payload, error });
}

function emit(event: any) {
  scope.postMessage({ type: "runtime_event", event });
  persist();
}

function persist() {
  scope.postMessage({ type: "persist_state", snapshot: state });
}

function now() {
  return new Date().toISOString();
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `wf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDirective(directive: string) {
  return directive.trim().replace(/\s+/g, " ");
}

function getWorkflowInputAttachments(workflow: WorkflowInfo) {
  return normalizeWorkflowAttachments(workflow.results?.input?.attachments);
}

function getWorkflowInputSignature(workflow: WorkflowInfo) {
  const signature = workflow.results?.input?.signature;
  return typeof signature === "string" && signature
    ? signature
    : buildWorkflowInputSignature(workflow.directive, getWorkflowInputAttachments(workflow));
}

function getWorkflowDirectiveContext(workflow: WorkflowInfo) {
  const context = workflow.results?.input?.directiveContext;
  return typeof context === "string" && context.trim() ? context : workflow.directive;
}

function inferDepartments(directive: string) {
  const value = directive.toLowerCase();
  const departments = new Set<string>();

  if (/(game|feature|event|retention|玩法|活动|游戏|体验)/i.test(value)) {
    departments.add("game");
  }
  if (/(ai|model|prompt|agent|eval|算法|模型|数据|推理)/i.test(value)) {
    departments.add("ai");
  }
  if (/(content|community|brand|ops|用户|内容|社区|运营|品牌)/i.test(value)) {
    departments.add("life");
  }

  if (departments.size === 0) {
    departments.add("game");
    departments.add("ai");
    departments.add("life");
  }

  return Array.from(departments);
}

function bestDeliverable(task: TaskInfo) {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || "";
}

function syncAgentStatuses() {
  state.agents = state.agents.map(agent => ({
    ...agent,
    status: (state.agentStatuses[agent.id] || "idle") as AgentInfo["status"],
  }));
}

function setAgentStatus(agentId: string, action: string, workflowId?: string) {
  state.agentStatuses[agentId] = action;
  syncAgentStatuses();
  emit({ type: "agent_active", agentId, action, workflowId });
}

function addMemoryEntry(agentId: string, entry: any) {
  const list = state.memoryEntriesByAgent[agentId] || [];
  state.memoryEntriesByAgent[agentId] = [...list, entry].slice(-80);
}

function addMemorySummary(agentId: string, workflow: WorkflowInfo, summary: string) {
  const list = state.memorySummariesByAgent[agentId] || [];
  const keywords = workflow.directive
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(Boolean)
    .slice(0, 8);

  state.memorySummariesByAgent[agentId] = [
    {
      workflowId: workflow.id,
      createdAt: now(),
      directive: workflow.directive,
      status: workflow.status,
      role: state.agents.find(agent => agent.id === agentId)?.role || "worker",
      stage: workflow.current_stage,
      summary,
      keywords,
    },
    ...list,
  ].slice(0, 40);
}

function createMessage(
  workflowId: string,
  fromAgent: string,
  toAgent: string,
  stage: string,
  content: string,
  metadata: any = {}
) {
  const message: MessageInfo = {
    id: state.nextMessageId++,
    workflow_id: workflowId,
    from_agent: fromAgent,
    to_agent: toAgent,
    stage,
    content,
    metadata,
    created_at: now(),
  };
  state.messages.push(message);

  addMemoryEntry(fromAgent, {
    timestamp: message.created_at,
    workflowId,
    stage,
    type: "message",
    direction: "outbound",
    otherAgentId: toAgent,
    preview: content.slice(0, 240),
    content,
    metadata,
  });
  addMemoryEntry(toAgent, {
    timestamp: message.created_at,
    workflowId,
    stage,
    type: "message",
    direction: "inbound",
    otherAgentId: fromAgent,
    preview: content.slice(0, 240),
    content,
    metadata,
  });

  emit({ type: "message_sent", workflowId, messageId: message.id });
  return message;
}

function updateWorkflow(id: string, updates: Partial<WorkflowInfo>) {
  state.workflows = state.workflows.map(workflow =>
    workflow.id === id ? { ...workflow, ...updates } : workflow
  );
}

function updateTask(id: number, updates: Partial<TaskInfo>) {
  state.tasks = state.tasks.map(task =>
    task.id === id ? { ...task, ...updates } : task
  );
}

function getWorkflow(id: string) {
  return state.workflows.find(workflow => workflow.id === id) || null;
}

function getWorkflowDetail(id: string) {
  const workflow = getWorkflow(id);
  return {
    workflow,
    tasks: state.tasks.filter(task => task.workflow_id === id),
    messages: state.messages.filter(message => message.workflow_id === id),
    report: workflow?.results?.final_report ?? null,
  };
}

function getDepartmentSummary(workflowId: string, department: string) {
  const tasks = state.tasks.filter(
    task => task.workflow_id === workflowId && task.department === department
  );
  const completed = tasks.filter(task => task.status === "passed").length;
  return `${department.toUpperCase()} delivered ${completed}/${tasks.length} tasks with clear next steps.`;
}

function buildWorkflowReport(workflow: WorkflowInfo) {
  const tasks = state.tasks.filter(task => task.workflow_id === workflow.id);
  const attachments = getWorkflowInputAttachments(workflow);
  const departmentReports = (workflow.results?.department_reports || []).map(
    (item: any) => ({
      manager_id: item.manager_id,
      manager_name: item.manager_name,
      department: item.department,
      summary: item.summary,
      task_count: item.task_count,
      average_score: item.average_score,
      report_json_path: item.report_json_path,
      report_markdown_path: item.report_markdown_path,
    })
  );
  const passedTasks = tasks.filter(task => task.status === "passed").length;
  const scoredTasks = tasks.filter(task => typeof task.total_score === "number");
  const averageScore =
    scoredTasks.length > 0
      ? scoredTasks.reduce((sum, task) => sum + (task.total_score || 0), 0) /
        scoredTasks.length
      : null;

  return {
    kind: "final_workflow_report",
    version: 1,
    workflowId: workflow.id,
    generatedAt: now(),
    workflow: {
      directive: workflow.directive,
      status: workflow.status,
      currentStage: workflow.current_stage,
      startedAt: workflow.started_at,
      completedAt: workflow.completed_at,
      departmentsInvolved: workflow.departments_involved,
      attachments,
    },
    stats: {
      messageCount: state.messages.filter(message => message.workflow_id === workflow.id).length,
      taskCount: tasks.length,
      passedTaskCount: passedTasks,
      revisedTaskCount: tasks.filter(task => task.version > 1).length,
      averageScore,
    },
    departmentReports,
    ceoFeedback: workflow.results?.ceo_feedback || "",
    keyIssues: tasks
      .filter(task => (task.total_score || 0) < 16)
      .map(task => `${task.worker_id} needs refinement on task ${task.id}.`)
      .slice(0, 10),
    tasks: tasks.map(task => ({
      id: task.id,
      department: task.department,
      workerId: task.worker_id,
      managerId: task.manager_id,
      status: task.status,
      totalScore: task.total_score,
      description: task.description,
      deliverablePreview: bestDeliverable(task).slice(0, 400),
    })),
  };
}

function toMarkdown(value: any, depth = 1): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map(item => `- ${typeof item === "object" ? "\n" + indent(toMarkdown(item, depth + 1)) : String(item)}`)
      .join("\n");
  }
  return Object.entries(value)
    .map(([key, item]) => `${"#".repeat(Math.min(depth + 1, 6))} ${key}\n${toMarkdown(item, depth + 1)}`)
    .join("\n\n");
}

function indent(value: string) {
  return value
    .split("\n")
    .map(line => `  ${line}`)
    .join("\n");
}

function downloadPayload(
  filename: string,
  format: "json" | "md",
  value: any
): RuntimeDownloadPayload {
  return format === "json"
    ? {
        filename,
        mimeType: "application/json",
        content: JSON.stringify(value, null, 2),
      }
    : {
        filename: filename.replace(/\.json$/i, ".md"),
        mimeType: "text/markdown",
        content: toMarkdown(value),
      };
}

function restoreState(snapshot: RuntimeStateSnapshot | null | undefined) {
  const fresh = createDefaultState();
  if (!snapshot) {
    state = fresh;
    persist();
    return;
  }

  state = {
    ...fresh,
    ...snapshot,
    agents: Array.isArray(snapshot.agents) && snapshot.agents.length > 0 ? snapshot.agents : fresh.agents,
    workflows: Array.isArray(snapshot.workflows) ? snapshot.workflows : fresh.workflows,
    tasks: Array.isArray(snapshot.tasks) ? snapshot.tasks : fresh.tasks,
    messages: Array.isArray(snapshot.messages) ? snapshot.messages : fresh.messages,
    stages: Array.isArray(snapshot.stages) && snapshot.stages.length > 0 ? snapshot.stages : fresh.stages,
    heartbeatStatuses: Array.isArray(snapshot.heartbeatStatuses)
      ? snapshot.heartbeatStatuses
      : fresh.heartbeatStatuses,
    heartbeatReports: Array.isArray(snapshot.heartbeatReports)
      ? snapshot.heartbeatReports
      : fresh.heartbeatReports,
    memoryEntriesByAgent: snapshot.memoryEntriesByAgent || fresh.memoryEntriesByAgent,
    memorySummariesByAgent:
      snapshot.memorySummariesByAgent || fresh.memorySummariesByAgent,
    agentStatuses: snapshot.agentStatuses || fresh.agentStatuses,
    nextTaskId: Number(snapshot.nextTaskId) || fresh.nextTaskId,
    nextMessageId: Number(snapshot.nextMessageId) || fresh.nextMessageId,
  };
  syncAgentStatuses();
  persist();
}

function createTask(
  workflow: WorkflowInfo,
  worker: AgentInfo,
  manager: AgentInfo,
  description: string
) {
  const task: TaskInfo = {
    id: state.nextTaskId++,
    workflow_id: workflow.id,
    worker_id: worker.id,
    manager_id: manager.id,
    department: worker.department,
    description,
    deliverable: null,
    deliverable_v2: null,
    deliverable_v3: null,
    score_accuracy: null,
    score_completeness: null,
    score_actionability: null,
    score_format: null,
    total_score: null,
    manager_feedback: null,
    meta_audit_feedback: null,
    version: 1,
    status: "assigned",
  };
  state.tasks.push(task);
  emit({
    type: "task_update",
    workflowId: workflow.id,
    taskId: task.id,
    workerId: task.worker_id,
    status: task.status,
  });
  return task;
}

function setStage(workflowId: string, stage: string) {
  updateWorkflow(workflowId, { current_stage: stage, status: "running" });
  emit({ type: "stage_change", workflowId, stage });
}

function scoreTask(task: TaskInfo) {
  const base = 11 + (task.id % 8);
  const accuracy = Math.min(5, Math.max(2, Math.round(base / 4)));
  const completeness = Math.min(5, Math.max(2, Math.round((base + 1) / 4)));
  const actionability = Math.min(5, Math.max(2, Math.round((base + 2) / 4)));
  const format = Math.min(5, Math.max(2, Math.round((base + 3) / 4)));
  const total = accuracy + completeness + actionability + format;
  return { accuracy, completeness, actionability, format, total };
}

async function executeWorkflow(workflowId: string) {
  const workflow = getWorkflow(workflowId);
  if (!workflow) return;
  const directiveContext = getWorkflowDirectiveContext(workflow);

  updateWorkflow(workflowId, { status: "running", started_at: now() });

  try {
    setStage(workflowId, "direction");
    setAgentStatus("ceo", "analyzing", workflowId);
    await delay(500);

    const directions = workflow.departments_involved.map(department => {
      const manager = getManagerForDepartment(department, state.agents);
      const text = `Focus ${department} on the directive: ${directiveContext}`;
      if (manager) {
        createMessage(workflowId, "ceo", manager.id, "direction", text);
      }
      return { department, manager };
    });

    setAgentStatus("ceo", "idle", workflowId);

    setStage(workflowId, "planning");
    for (const item of directions) {
      if (!item.manager) continue;
      setAgentStatus(item.manager.id, "planning", workflowId);
      await delay(250);
      const workers = getWorkersForManager(item.manager.id, state.agents).slice(0, 2);
      const createdTasks = workers.map((worker, index) =>
        createTask(
          workflow,
          worker,
          item.manager!,
          `${worker.name} prepares ${item.department} output ${index + 1} for "${directiveContext}".`
        )
      );
      for (const task of createdTasks) {
        createMessage(
          workflowId,
          item.manager.id,
          task.worker_id,
          "planning",
          `Task ${task.id}: ${task.description}`
        );
      }
      setAgentStatus(item.manager.id, "idle", workflowId);
    }

    setStage(workflowId, "execution");
    for (const task of state.tasks.filter(item => item.workflow_id === workflowId)) {
      setAgentStatus(task.worker_id, "executing", workflowId);
      updateTask(task.id, { status: "executing" });
      emit({
        type: "task_update",
        workflowId,
        taskId: task.id,
        workerId: task.worker_id,
        status: "executing",
      });
      await delay(300);
      const deliverable = `${task.worker_id} produced a concrete plan for "${directiveContext}" with next steps, owners, and checkpoints.`;
      updateTask(task.id, { status: "submitted", deliverable });
      createMessage(workflowId, task.worker_id, task.manager_id, "execution", deliverable);
      emit({
        type: "task_update",
        workflowId,
        taskId: task.id,
        workerId: task.worker_id,
        status: "submitted",
      });
      setAgentStatus(task.worker_id, "idle", workflowId);
    }

    setStage(workflowId, "review");
    for (const task of state.tasks.filter(item => item.workflow_id === workflowId)) {
      setAgentStatus(task.manager_id, "reviewing", workflowId);
      await delay(220);
      const score = scoreTask(task);
      updateTask(task.id, {
        status: "reviewed",
        score_accuracy: score.accuracy,
        score_completeness: score.completeness,
        score_actionability: score.actionability,
        score_format: score.format,
        total_score: score.total,
        manager_feedback:
          score.total >= 16
            ? "Strong structure and actionable output."
            : "Good draft, but sharpen the prioritization and clarity.",
      });
      emit({
        type: "score_assigned",
        workflowId,
        taskId: task.id,
        workerId: task.worker_id,
        score: score.total,
      });
      setAgentStatus(task.manager_id, "idle", workflowId);
    }

    setStage(workflowId, "meta_audit");
    setAgentStatus("warden", "auditing", workflowId);
    setAgentStatus("prism", "auditing", workflowId);
    await delay(350);
    for (const task of state.tasks.filter(item => item.workflow_id === workflowId)) {
      updateTask(task.id, {
        status: "audited",
        meta_audit_feedback:
          "Meta audit: keep ownership explicit and remove vague wording.",
      });
    }
    setAgentStatus("warden", "idle", workflowId);
    setAgentStatus("prism", "idle", workflowId);

    setStage(workflowId, "revision");
    for (const task of state.tasks.filter(item => item.workflow_id === workflowId)) {
      if ((task.total_score || 0) >= 16) {
        updateTask(task.id, { status: "passed" });
        emit({
          type: "task_update",
          workflowId,
          taskId: task.id,
          workerId: task.worker_id,
          status: "passed",
        });
        continue;
      }

      setAgentStatus(task.worker_id, "revising", workflowId);
      updateTask(task.id, { status: "revising" });
      emit({
        type: "task_update",
        workflowId,
        taskId: task.id,
        workerId: task.worker_id,
        status: "revising",
      });
      await delay(250);
      updateTask(task.id, {
        status: "submitted",
        version: 2,
        deliverable_v2: `${bestDeliverable(task)} Revised with clearer sequencing and stronger scope control.`,
      });
      setAgentStatus(task.worker_id, "idle", workflowId);
    }

    setStage(workflowId, "verify");
    for (const task of state.tasks.filter(item => item.workflow_id === workflowId)) {
      if (task.version < 2) continue;
      setAgentStatus(task.manager_id, "verifying", workflowId);
      await delay(220);
      updateTask(task.id, { status: "passed" });
      emit({
        type: "task_update",
        workflowId,
        taskId: task.id,
        workerId: task.worker_id,
        status: "passed",
      });
      setAgentStatus(task.manager_id, "idle", workflowId);
    }

    setStage(workflowId, "summary");
    const departmentReports = workflow.departments_involved.map(department => {
      const manager = getManagerForDepartment(department, state.agents);
      const summary = getDepartmentSummary(workflowId, department);
      if (manager) {
        setAgentStatus(manager.id, "summarizing", workflowId);
        createMessage(workflowId, manager.id, "ceo", "summary", summary);
        setAgentStatus(manager.id, "idle", workflowId);
      }
      const departmentTasks = state.tasks.filter(
        task => task.workflow_id === workflowId && task.department === department
      );
      const averageScore =
        departmentTasks.length > 0
          ? departmentTasks.reduce((sum, task) => sum + (task.total_score || 0), 0) /
            departmentTasks.length
          : null;

      return {
        manager_id: manager?.id || department,
        manager_name: manager?.name || department,
        department,
        summary,
        task_count: departmentTasks.length,
        average_score: averageScore,
        report_json_path: `browser://reports/${workflowId}/${department}.json`,
        report_markdown_path: `browser://reports/${workflowId}/${department}.md`,
      };
    });

    updateWorkflow(workflowId, {
      results: {
        ...(getWorkflow(workflowId)?.results || {}),
        department_reports: departmentReports,
        summaries: departmentReports.map(item => item.summary).join("\n\n"),
      },
    });

    setStage(workflowId, "feedback");
    setAgentStatus("ceo", "evaluating", workflowId);
    await delay(320);
    updateWorkflow(workflowId, {
      results: {
        ...(getWorkflow(workflowId)?.results || {}),
        ceo_feedback:
          "The browser runtime completed the loop. Strongest areas were delivery clarity and visible coordination. Next step: add richer agent memory and real provider hooks.",
      },
    });
    setAgentStatus("ceo", "idle", workflowId);

    setStage(workflowId, "evolution");
    await delay(220);
    const finishedWorkflow = getWorkflow(workflowId);
    if (!finishedWorkflow) return;

    const finalReport = buildWorkflowReport(finishedWorkflow);
    updateWorkflow(workflowId, {
      status: "completed",
      completed_at: now(),
      results: {
        ...(finishedWorkflow.results || {}),
        evolution: {
          note: "Browser runtime captured workflow signals for later refinement.",
        },
        final_report: {
          generated_at: finalReport.generatedAt,
          json_path: `browser://reports/${workflowId}/final.json`,
          markdown_path: `browser://reports/${workflowId}/final.md`,
          overview: {
            department_count: finalReport.departmentReports.length,
            task_count: finalReport.stats.taskCount,
            passed_task_count: finalReport.stats.passedTaskCount,
            average_score: finalReport.stats.averageScore,
            message_count: finalReport.stats.messageCount,
          },
        },
      },
    });

    const completedWorkflow = getWorkflow(workflowId);
    if (completedWorkflow) {
      const involvedAgentIds = new Set<string>([
        "ceo",
        ...state.tasks
          .filter(task => task.workflow_id === workflowId)
          .flatMap(task => [task.worker_id, task.manager_id]),
      ]);
      for (const agentId of Array.from(involvedAgentIds)) {
        addMemorySummary(
          agentId,
          completedWorkflow,
          `Workflow ${workflowId} completed for "${completedWorkflow.directive}".`
        );
      }
    }

    emit({
      type: "workflow_complete",
      workflowId,
      status: "completed",
      summary: "Local browser runtime completed the workflow.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Local runtime workflow failed.";
    updateWorkflow(workflowId, {
      status: "failed",
      completed_at: now(),
      results: {
        ...(getWorkflow(workflowId)?.results || {}),
        last_error: message,
      },
    });
    emit({ type: "workflow_error", workflowId, error: message });
  }
}

async function runHeartbeat(agentId: string) {
  const status = state.heartbeatStatuses.find(item => item.agentId === agentId);
  const agent = state.agents.find(item => item.id === agentId);
  if (!status || !agent) {
    throw new Error("Heartbeat target not found.");
  }

  const runningStatus: HeartbeatStatusInfo = {
    ...status,
    state: "running",
    lastRunAt: now(),
    lastError: null,
  };
  state.heartbeatStatuses = state.heartbeatStatuses.map(item =>
    item.agentId === agentId ? runningStatus : item
  );
  setAgentStatus(agentId, "heartbeat");
  emit({ type: "heartbeat_status", status: runningStatus });

  await delay(350);

  const report: HeartbeatReportInfo = {
    reportId: uuid(),
    generatedAt: now(),
    trigger: "manual",
    agentId,
    agentName: agent.name,
    department: agent.department,
    title: `${agent.name} heartbeat report`,
    summaryPreview: `${agent.name} scanned ${status.keywords.join(", ")} and prepared a short trend note for the browser runtime.`,
    keywords: status.keywords,
    searchResultCount: status.keywords.length + 2,
    jsonPath: `browser://heartbeat/${agentId}/${Date.now()}.json`,
    markdownPath: `browser://heartbeat/${agentId}/${Date.now()}.md`,
  };

  state.heartbeatReports = [report, ...state.heartbeatReports].slice(0, 40);

  const nextStatus: HeartbeatStatusInfo = {
    ...runningStatus,
    state: "scheduled",
    lastSuccessAt: report.generatedAt,
    lastReportAt: report.generatedAt,
    lastReportId: report.reportId,
    lastReportTitle: report.title,
    reportCount: status.reportCount + 1,
  };
  state.heartbeatStatuses = state.heartbeatStatuses.map(item =>
    item.agentId === agentId ? nextStatus : item
  );

  setAgentStatus(agentId, "idle");
  emit({ type: "heartbeat_status", status: nextStatus });
  emit({ type: "heartbeat_report_saved", report });

  return report;
}

scope.onmessage = async event => {
  const message = event.data as WorkerRequest;

  try {
    switch (message.type) {
      case "init":
        restoreState(message.payload?.snapshot);
        respond(message.requestId, { ok: true });
        return;
      case "get_snapshot":
        respond(message.requestId, state);
        return;
      case "get_agents":
        respond(message.requestId, { agents: state.agents });
        return;
      case "get_stages":
        respond(message.requestId, { stages: state.stages });
        return;
      case "list_workflows":
        respond(message.requestId, {
          workflows: [...state.workflows].sort((a, b) =>
            b.created_at.localeCompare(a.created_at)
          ),
        });
        return;
      case "get_workflow_detail":
        respond(message.requestId, getWorkflowDetail(message.payload.id));
        return;
      case "get_agent_recent_memory": {
        const entries = state.memoryEntriesByAgent[message.payload.agentId] || [];
        const filtered = message.payload.workflowId
          ? entries.filter(entry => entry.workflowId === message.payload.workflowId)
          : entries;
        respond(message.requestId, {
          entries: filtered.slice(-(message.payload.limit || 10)),
        });
        return;
      }
      case "search_agent_memory": {
        const query = String(message.payload.query || "")
          .toLowerCase()
          .trim();
        const summaries = state.memorySummariesByAgent[message.payload.agentId] || [];
        const results =
          !query
            ? summaries
            : summaries.filter(summary => {
                const haystack = `${summary.directive} ${summary.summary} ${summary.keywords.join(" ")}`.toLowerCase();
                return haystack.includes(query);
              });
        respond(message.requestId, {
          memories: results.slice(0, message.payload.topK || 5),
        });
        return;
      }
      case "get_heartbeat_statuses":
        respond(message.requestId, { statuses: state.heartbeatStatuses });
        return;
      case "get_heartbeat_reports": {
        const reports = message.payload?.agentId
          ? state.heartbeatReports.filter(
              report => report.agentId === message.payload.agentId
            )
          : state.heartbeatReports;
        respond(message.requestId, {
          reports: reports.slice(0, message.payload?.limit || 12),
        });
        return;
      }
      case "run_heartbeat": {
        const report = await runHeartbeat(message.payload.agentId);
        respond(message.requestId, { report });
        return;
      }
      case "submit_directive": {
        const directive = normalizeDirective(String(message.payload.directive || ""));
        const attachments = normalizeWorkflowAttachments(message.payload.attachments);
        if (!directive) {
          throw new Error("Directive is required.");
        }
        const directiveContext = buildWorkflowDirectiveContext(directive, attachments);
        const inputSignature = buildWorkflowInputSignature(directive, attachments);

        const existing = state.workflows.find(
          workflow =>
            workflow.status === "running" &&
            getWorkflowInputSignature(workflow) === inputSignature
        );
        if (existing) {
          respond(message.requestId, {
            workflowId: existing.id,
            missionId: existing.missionId ?? null,
            status: existing.status,
            deduped: true,
          });
          return;
        }

        const workflow: WorkflowInfo = {
          id: uuid(),
          missionId: null,
          directive,
          status: "pending",
          current_stage: null,
          departments_involved: inferDepartments(directiveContext),
          started_at: null,
          completed_at: null,
          results: {
            input: {
              attachments,
              directiveContext,
              signature: inputSignature,
            },
          },
          created_at: now(),
        };
        state.workflows = [workflow, ...state.workflows];
        persist();
        respond(message.requestId, {
          workflowId: workflow.id,
          missionId: null,
          status: "running",
          deduped: false,
        });
        void executeWorkflow(workflow.id);
        return;
      }
      case "download_workflow_report": {
        const workflow = getWorkflow(message.payload.workflowId);
        if (!workflow) {
          throw new Error("Workflow not found.");
        }

        if (message.payload.managerId) {
          const report = (workflow.results?.department_reports || []).find(
            (item: any) => item.manager_id === message.payload.managerId
          );
          if (!report) {
            throw new Error("Department report not found.");
          }
          respond(
            message.requestId,
            downloadPayload(
              `${workflow.id}-${message.payload.managerId}.json`,
              message.payload.format,
              report
            )
          );
          return;
        }

        respond(
          message.requestId,
          downloadPayload(
            `${workflow.id}-final.json`,
            message.payload.format,
            buildWorkflowReport(workflow)
          )
        );
        return;
      }
      case "download_heartbeat_report": {
        const report = state.heartbeatReports.find(
          item =>
            item.agentId === message.payload.agentId &&
            item.reportId === message.payload.reportId
        );
        if (!report) {
          throw new Error("Heartbeat report not found.");
        }
        respond(
          message.requestId,
          downloadPayload(
            `${message.payload.agentId}-${message.payload.reportId}.json`,
            message.payload.format,
            report
          )
        );
        return;
      }
      default:
        throw new Error(`Unsupported worker command: ${message.type}`);
    }
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Worker request failed.";
    respond(message.requestId, undefined, messageText);
  }
};
