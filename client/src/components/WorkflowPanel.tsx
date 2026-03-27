
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  BookOpenText,
  Brain,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Download,
  History,
  Loader2,
  Monitor,
  Network,
  Search,
  Send,
  Server,
  Shield,
  Star,
  X,
  Zap,
} from "lucide-react";

import { CAN_USE_ADVANCED_RUNTIME } from "@/lib/deploy-target";
import { useAppStore } from "@/lib/store";
import {
  useWorkflowStore,
  type AgentInfo,
  type AgentMemoryEntry,
  type AgentMemorySummary,
  type HeartbeatReportInfo,
  type HeartbeatStatusInfo,
  type PanelView,
  type StageInfo,
  type TaskInfo,
  type WorkflowInfo,
  type WorkflowOrganizationNode,
  type WorkflowOrganizationSnapshot,
} from "@/lib/workflow-store";

const DEPARTMENT_LABELS: Record<string, string> = {
  game: "Game",
  ai: "AI",
  life: "Life",
  meta: "Meta",
  general: "General",
};

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-300",
  thinking: "bg-yellow-400 animate-pulse",
  heartbeat: "bg-cyan-500 animate-pulse",
  executing: "bg-blue-500 animate-pulse",
  reviewing: "bg-purple-500 animate-pulse",
  planning: "bg-indigo-500 animate-pulse",
  analyzing: "bg-amber-500 animate-pulse",
  auditing: "bg-red-400 animate-pulse",
  revising: "bg-orange-500 animate-pulse",
  verifying: "bg-teal-500 animate-pulse",
  summarizing: "bg-cyan-500 animate-pulse",
  evaluating: "bg-pink-500 animate-pulse",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  thinking: "Thinking",
  heartbeat: "Heartbeat",
  executing: "Executing",
  reviewing: "Reviewing",
  planning: "Planning",
  analyzing: "Analyzing",
  auditing: "Auditing",
  revising: "Revising",
  verifying: "Verifying",
  summarizing: "Summarizing",
  evaluating: "Evaluating",
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  completed_with_errors: "Completed with warnings",
  failed: "Failed",
};

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN") : "--";
}

function getWorkflowOrganization(
  workflow: WorkflowInfo | null | undefined
): WorkflowOrganizationSnapshot | null {
  const organization = workflow?.results?.organization;
  if (!organization || typeof organization !== "object") return null;
  return Array.isArray((organization as WorkflowOrganizationSnapshot).nodes)
    ? (organization as WorkflowOrganizationSnapshot)
    : null;
}

function getNodeMap(organization: WorkflowOrganizationSnapshot | null) {
  return new Map(organization?.nodes.map(node => [node.agentId, node]) || []);
}

function getNodeName(
  agentId: string,
  nodeMap: Map<string, WorkflowOrganizationNode>
) {
  return nodeMap.get(agentId)?.name || agentId;
}

function getDepartmentLabel(department: string) {
  return DEPARTMENT_LABELS[department] || department;
}

function getWorkflowStatusClass(status: string) {
  switch (status) {
    case "running":
      return "bg-blue-100 text-blue-700";
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "completed_with_errors":
      return "bg-amber-100 text-amber-700";
    case "failed":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function getHeartbeatStateClass(state: HeartbeatStatusInfo["state"]) {
  switch (state) {
    case "running":
      return "bg-cyan-100 text-cyan-700";
    case "scheduled":
      return "bg-blue-100 text-blue-700";
    case "error":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function getHeartbeatStateLabel(state: HeartbeatStatusInfo["state"]) {
  return (
    {
      idle: "Idle",
      scheduled: "Scheduled",
      running: "Running",
      error: "Error",
    }[state] || state
  );
}

function getTaskStatusLabel(status: string) {
  return (
    {
      assigned: "Assigned",
      executing: "Executing",
      submitted: "Submitted",
      reviewed: "Reviewed",
      audited: "Audited",
      revising: "Revising",
      verified: "Verified",
      passed: "Passed",
      failed: "Failed",
    }[status] || status
  );
}

function getMemoryTypeLabel(type: AgentMemoryEntry["type"]) {
  return (
    {
      message: "Message",
      llm_prompt: "Prompt",
      llm_response: "Response",
      workflow_summary: "Workflow summary",
    }[type] || type
  );
}

function StageProgressBar({
  stages,
  currentStage,
  status,
}: {
  stages: StageInfo[];
  currentStage: string | null;
  status: string;
}) {
  const currentIndex = stages.findIndex(stage => stage.id === currentStage);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {stages.map((stage, index) => {
        const state =
          status === "completed" || status === "completed_with_errors"
            ? "done"
            : index < currentIndex
              ? "done"
              : index === currentIndex
                ? "active"
                : "pending";

        return (
          <div key={stage.id} className="flex shrink-0 items-center">
            <div
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium ${
                state === "done"
                  ? "bg-emerald-100 text-emerald-700"
                  : state === "active"
                    ? "bg-blue-100 text-blue-700 animate-pulse"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {state === "done" && <CheckCircle2 className="h-3 w-3" />}
              {state === "active" && <Loader2 className="h-3 w-3 animate-spin" />}
              {state === "pending" && <Circle className="h-3 w-3" />}
              <span>{stage.label}</span>
            </div>
            {index < stages.length - 1 && (
              <ChevronRight className="mx-0.5 h-3 w-3 text-gray-300" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Circle className="mb-3 h-10 w-10 text-[#C4B5A0]" />
      <p className="text-sm font-medium text-[#5A4A3A]">{title}</p>
      <p className="mt-1 text-[10px] text-[#8B7355]">{description}</p>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[8px] font-medium text-[#6B5A4A]">
      {children}
    </span>
  );
}
function DirectiveView() {
  const { submitDirective, isSubmitting } = useWorkflowStore();
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const [directive, setDirective] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isFrontendMode = runtimeMode === "frontend";
  const canUpgrade = isFrontendMode && CAN_USE_ADVANCED_RUNTIME;

  const examples = [
    "Design a go-to-market plan for the next growth milestone.",
    "Analyze competitors and propose the best response.",
    "Improve onboarding and retention for core users.",
    "Plan a cross-functional experiment with explicit owners.",
  ];

  const handleSubmit = async () => {
    if (!directive.trim() || isSubmitting) return;
    if (canUpgrade) {
      await setRuntimeMode("advanced");
      inputRef.current?.focus();
      return;
    }
    await submitDirective(directive.trim());
    setDirective("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <Zap className="h-4 w-4 text-amber-500" />
          Submit Directive
        </h3>
        <p className="mt-0.5 text-[10px] text-[#8B7355]">
          Start a workflow and let the server generate a task-specific
          organization, skills, and MCP bindings.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {isFrontendMode && (
          <div className="rounded-xl border border-[#E8DDD0] bg-gradient-to-br from-[#FFF7EC] to-[#F7EDE2] p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-white/80 p-2 text-[#D4845A]">
                {canUpgrade ? <Monitor className="h-4 w-4" /> : <Server className="h-4 w-4" />}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold text-[#3A2A1A]">
                  {canUpgrade ? "Frontend-only mode" : "Static demo mode"}
                </p>
                <p className="text-[10px] leading-5 text-[#6B5A4A]">
                  {canUpgrade
                    ? "Switch to advanced mode to run the live server workflow."
                    : "This deployment does not connect to the server runtime."}
                </p>
                {canUpgrade && (
                  <button
                    onClick={() => void setRuntimeMode("advanced")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#D4845A] px-3 py-2 text-[10px] font-semibold text-white hover:bg-[#C9774E]"
                  >
                    <Server className="h-3.5 w-3.5" />
                    Switch to advanced mode
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {examples.map(example => (
            <button
              key={example}
              onClick={() => setDirective(example)}
              className="w-full rounded-xl border border-transparent bg-[#F8F4F0] px-3 py-2 text-left text-xs text-[#5A4A3A] hover:border-[#E8DDD0] hover:bg-[#F0E8E0]"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[#F0E8E0] p-4">
        <textarea
          ref={inputRef}
          value={directive}
          onChange={event => setDirective(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit();
            }
          }}
          rows={3}
          placeholder="Describe the task you want the organization to solve..."
          className="w-full resize-none rounded-xl border border-[#F0E8E0] bg-[#F8F4F0] px-3 py-2 text-sm text-[#3A2A1A] placeholder-[#C4B5A0] focus:border-[#D4845A]/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4845A]/20"
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={!directive.trim() || isSubmitting}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4845A] to-[#E4946A] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : canUpgrade ? <Server className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          <span>{isSubmitting ? "Starting workflow..." : canUpgrade ? "Switch mode" : "Submit directive"}</span>
        </button>
      </div>
    </div>
  );
}

function OrgTreeView() {
  const { currentWorkflow, agentStatuses, setActiveView, setSelectedMemoryAgent } =
    useWorkflowStore();
  const organization = getWorkflowOrganization(currentWorkflow);
  const rootNode = organization?.nodes.find(node => node.id === organization.rootNodeId) || null;

  const openMemory = (agentId: string) => {
    setSelectedMemoryAgent(agentId);
    setActiveView("memory");
  };

  if (!organization || !rootNode) {
    return <EmptyState title="No organization yet" description="Submit a directive to generate a dynamic org chart." />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <Network className="h-4 w-4 text-indigo-500" />
          Dynamic Organization
        </h3>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>{organization.source}</Pill>
            <Pill>{organization.taskProfile}</Pill>
            <Pill>{formatTime(organization.generatedAt)}</Pill>
          </div>
          <p className="mt-2 text-[10px] leading-5 text-indigo-800">{organization.reasoning}</p>
          {currentWorkflow?.results?.organization_debug?.logPath && (
            <p className="mt-2 break-all text-[9px] text-indigo-700">
              Replay log: {currentWorkflow.results.organization_debug.logPath}
            </p>
          )}
        </div>

        <button
          onClick={() => openMemory(rootNode.agentId)}
          className="w-full rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-3 text-left"
        >
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${STATUS_COLORS[agentStatuses[rootNode.agentId] || "idle"]}`} />
            <span className="text-sm font-bold text-amber-900">{rootNode.name}</span>
            <span className="ml-auto text-[9px] text-amber-700">
              {STATUS_LABELS[agentStatuses[rootNode.agentId] || "idle"] || "Idle"}
            </span>
          </div>
          <p className="mt-2 text-[10px] text-amber-800">{rootNode.responsibility}</p>
        </button>

        {organization.departments.map(department => {
          const manager = organization.nodes.find(node => node.id === department.managerNodeId);
          const workers = organization.nodes.filter(node => node.parentId === department.managerNodeId);

          return (
            <div key={department.id} className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-[#3A2A1A]">{department.label}</span>
                <Pill>{department.strategy}</Pill>
                <Pill>x{department.maxConcurrency}</Pill>
              </div>

              {manager && (
                <button
                  onClick={() => openMemory(manager.agentId)}
                  className="w-full rounded-lg bg-white/80 p-3 text-left"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-[#3A2A1A]">{manager.name}</span>
                    <Pill>{manager.title}</Pill>
                    <Pill>{manager.execution.strategy}</Pill>
                  </div>
                  <p className="mt-1 text-[9px] text-[#8B7355]">{manager.responsibility}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {manager.skills.map(skill => <Pill key={skill.id}>Skill: {skill.name}</Pill>)}
                    {manager.mcp.map(binding => <Pill key={binding.id}>MCP: {binding.name}</Pill>)}
                  </div>
                </button>
              )}

              <div className="mt-2 space-y-2 pl-4">
                {workers.map(worker => (
                  <button
                    key={worker.id}
                    onClick={() => openMemory(worker.agentId)}
                    className="w-full rounded-lg bg-white/70 p-2.5 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-[#3A2A1A]">{worker.name}</span>
                      <Pill>{worker.title}</Pill>
                      <Pill>{worker.execution.mode}</Pill>
                    </div>
                    <p className="mt-1 text-[9px] text-[#8B7355]">{worker.responsibility}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {worker.skills.map(skill => <Pill key={skill.id}>Skill: {skill.name}</Pill>)}
                      {worker.mcp.map(binding => <Pill key={binding.id}>MCP: {binding.name}</Pill>)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function WorkflowProgressView() {
  const { currentWorkflow, tasks, stages, messages, downloadWorkflowReport, downloadDepartmentReport } =
    useWorkflowStore();

  if (!currentWorkflow) {
    return <EmptyState title="No active workflow" description="Execution progress will appear here after you submit a directive." />;
  }

  const organization = getWorkflowOrganization(currentWorkflow);
  const nodeMap = useMemo(() => getNodeMap(organization), [organization]);
  const tasksByDepartment = useMemo(() => {
    const map = new Map<string, TaskInfo[]>();
    for (const task of tasks) {
      const group = map.get(task.department) || [];
      group.push(task);
      map.set(task.department, group);
    }
    return map;
  }, [tasks]);

  const statusIcon = (status: string) =>
    ({
      assigned: <Clock className="h-3 w-3 text-gray-400" />,
      executing: <Loader2 className="h-3 w-3 animate-spin text-blue-500" />,
      submitted: <CheckCircle2 className="h-3 w-3 text-blue-500" />,
      reviewed: <Star className="h-3 w-3 text-purple-500" />,
      audited: <Shield className="h-3 w-3 text-orange-500" />,
      revising: <Loader2 className="h-3 w-3 animate-spin text-orange-500" />,
      passed: <CheckCircle2 className="h-3 w-3 text-emerald-500" />,
      failed: <AlertCircle className="h-3 w-3 text-red-500" />,
    }[status] || <Circle className="h-3 w-3 text-gray-300" />);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            Workflow Progress
          </h3>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${getWorkflowStatusClass(currentWorkflow.status)}`}>
            {WORKFLOW_STATUS_LABELS[currentWorkflow.status] || currentWorkflow.status}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[10px] text-[#8B7355]">{currentWorkflow.directive}</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <StageProgressBar stages={stages} currentStage={currentWorkflow.current_stage} status={currentWorkflow.status} />

        {organization && (
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-slate-50 p-3 text-[10px] text-indigo-900">
            <div className="flex flex-wrap gap-2">
              <Pill>{organization.source}</Pill>
              <Pill>{organization.taskProfile}</Pill>
              <Pill>{organization.nodes.length} nodes</Pill>
              <Pill>{organization.departments.length} departments</Pill>
            </div>
            <p className="mt-2 leading-5 text-indigo-800">{organization.reasoning}</p>
          </div>
        )}

        {currentWorkflow.status === "failed" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700">
            {currentWorkflow.results?.last_error || "Unknown workflow error"}
          </div>
        )}

        {Array.from(tasksByDepartment.entries()).map(([department, departmentTasks]) => (
          <div key={department} className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-bold text-[#3A2A1A]">{getDepartmentLabel(department)}</span>
              <span className="text-[9px] text-[#8B7355]">
                {departmentTasks.filter(task => task.status === "passed").length}/{departmentTasks.length} passed
              </span>
            </div>
            <div className="space-y-1.5">
              {departmentTasks.map(task => (
                <div key={task.id} className="flex items-start gap-2 rounded-lg bg-white/70 px-2.5 py-2">
                  {statusIcon(task.status)}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-[#3A2A1A]">{getNodeName(task.worker_id, nodeMap)}</span>
                      <Pill>{getTaskStatusLabel(task.status)}</Pill>
                      {task.total_score !== null && <Pill>{task.total_score}/20</Pill>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[9px] text-[#8B7355]">{task.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {(currentWorkflow.status === "completed" || currentWorkflow.status === "completed_with_errors") &&
          currentWorkflow.results?.final_report?.overview && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[10px] text-blue-800">
              <p className="font-bold">Final report</p>
              <p className="mt-1">Tasks: {currentWorkflow.results.final_report.overview.task_count ?? "--"}</p>
              <p>Departments: {currentWorkflow.results.final_report.overview.department_count ?? "--"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void downloadWorkflowReport(currentWorkflow.id, "json")}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-medium text-blue-700"
                >
                  <Download className="h-3 w-3" />
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => void downloadWorkflowReport(currentWorkflow.id, "md")}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-medium text-blue-700"
                >
                  <Download className="h-3 w-3" />
                  Markdown
                </button>
                {Array.isArray(currentWorkflow.results?.department_reports) &&
                  currentWorkflow.results.department_reports.map((item: any) => (
                    <button
                      key={`${item.manager_id}-${item.department}`}
                      type="button"
                      onClick={() => void downloadDepartmentReport(currentWorkflow.id, item.manager_id, "md")}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-100 px-2.5 py-1.5 text-[10px] font-medium text-blue-700"
                    >
                      <Download className="h-3 w-3" />
                      {item.department_label || item.department}
                    </button>
                  ))}
              </div>
            </div>
          )}

        {messages.length > 0 && (
          <div className="rounded-xl border border-[#E8DDD0] bg-white/70 p-3">
            <p className="mb-2 text-[10px] font-bold text-[#8B7355]">Recent messages</p>
            <div className="space-y-1">
              {messages.slice(-8).reverse().map(message => (
                <div key={message.id} className="rounded-lg bg-[#F8F4F0] px-2 py-1.5 text-[9px] text-[#5A4A3A]">
                  <span className="font-medium text-[#D4845A]">{getNodeName(message.from_agent, nodeMap)}</span>
                  <span className="text-[#B0A090]"> to </span>
                  <span className="font-medium text-[#3A7A5A]">{getNodeName(message.to_agent, nodeMap)}</span>
                  <span className="text-[#B0A090]"> [{message.stage}]</span>
                  <p className="mt-0.5 line-clamp-2 text-[#8B7355]">{message.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewView() {
  const { tasks } = useWorkflowStore();
  const reviewed = tasks.filter(task => task.total_score !== null);

  if (reviewed.length === 0) {
    return <EmptyState title="No review data" description="Review scores will appear here after the workflow reaches scoring stages." />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <Star className="h-4 w-4 text-amber-500" />
          Review Scores
        </h3>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {reviewed.map(task => (
          <div key={task.id} className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#3A2A1A]">{task.worker_id}</span>
              <span className="text-sm font-bold text-[#3A2A1A]">{task.total_score}/20</span>
            </div>
            {task.manager_feedback && (
              <p className="mt-2 text-[9px] text-[#8B7355]">{task.manager_feedback}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
function MemoryResultCard({ item }: { item: AgentMemorySummary }) {
  return (
    <div className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <Pill>{item.status}</Pill>
        <span className="text-[9px] text-[#B0A090]">{formatTime(item.createdAt)}</span>
      </div>
      <p className="mt-1 text-[10px] font-semibold text-[#3A2A1A]">{item.directive}</p>
      <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-[9px] leading-5 text-[#6B5A4A]">{item.summary}</p>
    </div>
  );
}

function MemoryView() {
  const {
    agents,
    currentWorkflow,
    currentWorkflowId,
    selectedMemoryAgentId,
    setSelectedMemoryAgent,
    agentMemoryRecent,
    agentMemorySearchResults,
    fetchAgentRecentMemory,
    searchAgentMemory,
    isMemoryLoading,
    memoryQuery,
    setMemoryQuery,
  } = useWorkflowStore();

  const [localQuery, setLocalQuery] = useState(memoryQuery);
  const organization = getWorkflowOrganization(currentWorkflow);
  const nodeMap = useMemo(() => getNodeMap(organization), [organization]);
  const organizationIds = useMemo(() => new Set(organization?.nodes.map(node => node.agentId) || []), [organization]);
  const sortedAgents = useMemo(() => {
    const filtered = organization ? agents.filter(agent => organizationIds.has(agent.id)) : agents;
    const rank: Record<AgentInfo["role"], number> = { ceo: 0, manager: 1, worker: 2 };
    return [...filtered].sort((a, b) => (rank[a.role] - rank[b.role]) || a.name.localeCompare(b.name));
  }, [agents, organization, organizationIds]);

  const selectedAgent =
    sortedAgents.find(agent => agent.id === selectedMemoryAgentId) ||
    (organization?.rootAgentId ? sortedAgents.find(agent => agent.id === organization.rootAgentId) : null) ||
    sortedAgents[0] ||
    null;

  useEffect(() => {
    if (!selectedMemoryAgentId && selectedAgent) {
      setSelectedMemoryAgent(selectedAgent.id);
    }
  }, [selectedMemoryAgentId, selectedAgent, setSelectedMemoryAgent]);

  useEffect(() => {
    if (selectedAgent) void fetchAgentRecentMemory(selectedAgent.id, currentWorkflowId, 12);
  }, [selectedAgent, currentWorkflowId, fetchAgentRecentMemory]);

  useEffect(() => {
    setLocalQuery(memoryQuery);
  }, [memoryQuery]);

  const handleSearch = async () => {
    if (!selectedAgent || !localQuery.trim()) return;
    setMemoryQuery(localQuery.trim());
    await searchAgentMemory(selectedAgent.id, localQuery.trim(), 6);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <BookOpenText className="h-4 w-4 text-violet-500" />
          Agent Memory
        </h3>
      </div>

      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {sortedAgents.map(agent => (
            <button
              key={agent.id}
              onClick={() => setSelectedMemoryAgent(agent.id)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                selectedAgent?.id === agent.id ? "bg-[#D4845A] text-white" : "bg-[#F8F4F0] text-[#6B5A4A]"
              }`}
            >
              {agent.name}
            </button>
          ))}
        </div>

        {selectedAgent && (
          <div className="rounded-xl bg-[#F8F4F0] px-3 py-2 text-[10px] text-[#6B5A4A]">
            {selectedAgent.name} / {nodeMap.get(selectedAgent.id)?.title || selectedAgent.role} / {nodeMap.get(selectedAgent.id)?.departmentLabel || selectedAgent.department}
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <input
            value={localQuery}
            onChange={event => setLocalQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSearch();
              }
            }}
            placeholder="Search this agent's historical memory..."
            className="flex-1 rounded-xl border border-[#F0E8E0] bg-white px-3 py-2 text-xs text-[#3A2A1A] focus:border-[#D4845A]/50 focus:outline-none focus:ring-2 focus:ring-[#D4845A]/20"
          />
          <button
            onClick={() => void handleSearch()}
            disabled={!selectedAgent || !localQuery.trim() || isMemoryLoading}
            className="flex items-center gap-1 rounded-xl bg-[#F0E8E0] px-3 py-2 text-xs font-medium text-[#5B4837] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isMemoryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-[10px] font-bold text-[#8B7355]">Recent memory</h4>
            {isMemoryLoading && <Loader2 className="h-3 w-3 animate-spin text-[#B0A090]" />}
          </div>
          {agentMemoryRecent.length === 0 ? (
            <div className="rounded-xl bg-[#F8F4F0] px-3 py-4 text-center text-[10px] text-[#8B7355]">
              No recent memory entries.
            </div>
          ) : (
            <div className="space-y-2">
              {agentMemoryRecent.slice().reverse().map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Pill>{getMemoryTypeLabel(entry.type)}</Pill>
                      {entry.direction && <Pill>{entry.direction}</Pill>}
                      {entry.stage && <Pill>{entry.stage}</Pill>}
                    </div>
                    <span className="text-[8px] text-[#B0A090]">{formatTime(entry.timestamp)}</span>
                  </div>
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[9px] leading-5 text-[#5D4C3B]">
                    {entry.preview || entry.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-1.5 text-[10px] font-bold text-[#8B7355]">Historical search</h4>
          {agentMemorySearchResults.length === 0 ? (
            <div className="rounded-xl bg-[#F8F4F0] px-3 py-4 text-center text-[10px] text-[#8B7355]">
              Search results will appear here.
            </div>
          ) : (
            <div className="space-y-2">
              {agentMemorySearchResults.map(item => (
                <MemoryResultCard key={`${item.workflowId}-${item.createdAt}`} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function ReportsView() {
  const {
    heartbeatStatuses,
    heartbeatReports,
    fetchHeartbeatStatuses,
    fetchHeartbeatReports,
    runHeartbeat,
    runningHeartbeatAgentId,
    isHeartbeatLoading,
    downloadHeartbeatReport,
  } = useWorkflowStore();

  useEffect(() => {
    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(undefined, 12);
  }, [fetchHeartbeatStatuses, fetchHeartbeatReports]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <Search className="h-4 w-4 text-cyan-500" />
          Heartbeat Reports
        </h3>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] p-3 text-[10px] text-[#6B5A4A]">
          Enabled: {heartbeatStatuses.filter(item => item.enabled).length} / Running: {heartbeatStatuses.filter(item => item.state === "running").length}
          {isHeartbeatLoading && <span className="ml-2">Loading...</span>}
        </div>

        {heartbeatStatuses.map(item => (
          <div key={item.agentId} className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-[#3A2A1A]">{item.agentName}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[8px] font-medium ${getHeartbeatStateClass(item.state)}`}>
                    {getHeartbeatStateLabel(item.state)}
                  </span>
                </div>
                <p className="mt-0.5 text-[9px] text-[#8B7355]">
                  {item.department} / every {item.intervalMinutes} min / {item.reportCount} reports
                </p>
              </div>
              <button
                onClick={() => void runHeartbeat(item.agentId)}
                disabled={!item.enabled || runningHeartbeatAgentId === item.agentId}
                className="inline-flex items-center gap-1 rounded-lg bg-cyan-100 px-2.5 py-1.5 text-[9px] font-medium text-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {runningHeartbeatAgentId === item.agentId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                {runningHeartbeatAgentId === item.agentId ? "Running" : "Run now"}
              </button>
            </div>
            <p className="mt-2 text-[9px] text-[#6B5A4A]">Focus: {item.focus}</p>
          </div>
        ))}

        {heartbeatReports.map((item: HeartbeatReportInfo) => (
          <div key={`${item.agentId}-${item.reportId}`} className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-[#3A2A1A]">{item.title}</p>
              <Pill>{item.trigger}</Pill>
            </div>
            <p className="mt-1 text-[9px] text-[#8B7355]">
              {item.agentName} / {item.department} / {formatTime(item.generatedAt)}
            </p>
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[9px] leading-5 text-[#5D4C3B]">{item.summaryPreview}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadHeartbeatReport(item.agentId, item.reportId, "json")}
                className="inline-flex items-center gap-1 rounded-lg bg-[#F0E8E0] px-2.5 py-1 text-[9px] font-medium text-[#5B4837]"
              >
                <Download className="h-3 w-3" />
                JSON
              </button>
              <button
                type="button"
                onClick={() => void downloadHeartbeatReport(item.agentId, item.reportId, "md")}
                className="inline-flex items-center gap-1 rounded-lg bg-[#F0E8E0] px-2.5 py-1 text-[9px] font-medium text-[#5B4837]"
              >
                <Download className="h-3 w-3" />
                MD
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryView() {
  const { workflows, setCurrentWorkflow, setActiveView, fetchWorkflows } = useWorkflowStore();

  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <History className="h-4 w-4 text-[#8B7355]" />
          Workflow History
        </h3>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {workflows.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#8B7355]">No workflow history yet.</div>
        ) : (
          workflows.map(workflow => (
            <button
              key={workflow.id}
              onClick={() => {
                setCurrentWorkflow(workflow.id);
                setActiveView("workflow");
              }}
              className="w-full rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] p-3 text-left"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${getWorkflowStatusClass(workflow.status)}`}>
                  {WORKFLOW_STATUS_LABELS[workflow.status] || workflow.status}
                </span>
                <span className="text-[9px] text-[#B0A090]">{formatTime(workflow.created_at)}</span>
              </div>
              <p className="line-clamp-2 text-xs text-[#3A2A1A]">{workflow.directive}</p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function WorkflowPanel() {
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const {
    isWorkflowPanelOpen,
    toggleWorkflowPanel,
    activeView,
    setActiveView,
    initSocket,
    fetchAgents,
    fetchStages,
    fetchWorkflows,
    fetchHeartbeatStatuses,
    fetchHeartbeatReports,
    connected,
  } = useWorkflowStore();
  const isFrontendMode = runtimeMode === "frontend";

  useEffect(() => {
    void initSocket();
    void fetchAgents();
    void fetchStages();
    void fetchWorkflows();
    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(undefined, 12);
  }, [initSocket, fetchAgents, fetchStages, fetchWorkflows, fetchHeartbeatStatuses, fetchHeartbeatReports, runtimeMode]);

  if (!isWorkflowPanelOpen) return null;

  const views: Array<{ id: PanelView; icon: typeof Zap; label: string }> = [
    { id: "directive", icon: Zap, label: "Directive" },
    { id: "org", icon: Network, label: "Org" },
    { id: "workflow", icon: BarChart3, label: "Progress" },
    { id: "review", icon: Star, label: "Review" },
    { id: "memory", icon: BookOpenText, label: "Memory" },
    { id: "reports", icon: Search, label: "Reports" },
    { id: "history", icon: History, label: "History" },
  ];

  return (
    <div
      className="fixed bottom-6 right-5 z-[55] flex h-[560px] w-[400px] flex-col rounded-3xl border border-white/60 bg-white/92 shadow-[0_12px_48px_rgba(0,0,0,0.15)] backdrop-blur-2xl"
      style={{ pointerEvents: "auto" }}
    >
      <div className="flex items-center justify-between border-b border-[#F0E8E0] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#D4845A] to-[#E4946A]">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#3A2A1A]">Multi-Agent Workflow</h3>
            <span className="text-[9px] text-[#8B7355]">
              {isFrontendMode ? "Frontend-only mode" : connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <button onClick={toggleWorkflowPanel} className="rounded-xl p-2 hover:bg-[#F0E8E0]">
          <X className="h-4 w-4 text-[#8B7355]" />
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-[#F0E8E0] px-3 py-2">
        {views.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium ${
              activeView === id ? "bg-[#D4845A] text-white" : "text-[#8B7355] hover:bg-[#F0E8E0]"
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {isFrontendMode && (
        <div className="border-b border-[#F0E8E0] bg-[#FFF7EC] px-4 py-2.5">
          <p className="text-[10px] leading-5 text-[#6B5A4A]">
            Dynamic workflow execution and heartbeat reports are available in advanced mode.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {activeView === "directive" && <DirectiveView />}
        {activeView === "org" && <OrgTreeView />}
        {activeView === "workflow" && <WorkflowProgressView />}
        {activeView === "review" && <ReviewView />}
        {activeView === "memory" && <MemoryView />}
        {activeView === "reports" && <ReportsView />}
        {activeView === "history" && <HistoryView />}
      </div>
    </div>
  );
}

