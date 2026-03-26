import { useEffect, useMemo, useRef, useState } from "react";
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

import { useAppStore } from "@/lib/store";
import {
  useWorkflowStore,
  type AgentMemoryEntry,
  type AgentMemorySummary,
  type HeartbeatReportInfo,
  type HeartbeatStatusInfo,
  type PanelView,
  type StageInfo,
  type TaskInfo,
} from "@/lib/workflow-store";

const DEPARTMENT_NAMES: Record<string, string> = {
  game: "游戏部",
  ai: "AI 部",
  life: "生活部",
  meta: "元部门",
};

const DEPARTMENT_ICONS: Record<string, string> = {
  game: "GM",
  ai: "AI",
  life: "LF",
  meta: "MT",
};

const AGENT_STATUS_COLORS: Record<string, string> = {
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
  idle: "空闲",
  thinking: "思考中",
  heartbeat: "心跳中",
  executing: "执行中",
  reviewing: "评审中",
  planning: "规划中",
  analyzing: "分析中",
  auditing: "审计中",
  revising: "修订中",
  verifying: "验证中",
  summarizing: "汇总中",
  evaluating: "评估中",
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  running: "运行中",
  completed: "已完成",
  completed_with_errors: "完成但有异常",
  failed: "失败",
};

function getTaskStatusLabel(status: string): string {
  return (
    {
      assigned: "已分配",
      executing: "执行中",
      submitted: "已提交",
      reviewed: "已评审",
      audited: "已审计",
      revising: "修订中",
      verified: "待三修",
      passed: "已通过",
      failed: "失败",
    }[status] || status
  );
}

function getMemoryTypeLabel(type: AgentMemoryEntry["type"]): string {
  return (
    {
      message: "消息",
      llm_prompt: "提示词",
      llm_response: "模型响应",
      workflow_summary: "工作流总结",
    }[type] || type
  );
}

function getMemoryDirectionLabel(
  direction?: AgentMemoryEntry["direction"]
): string {
  return direction === "inbound"
    ? "收到"
    : direction === "outbound"
      ? "发出"
      : "";
}

function getWorkflowStatusClass(status: string): string {
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

function getHeartbeatStateLabel(state: HeartbeatStatusInfo["state"]): string {
  return (
    {
      idle: "空闲",
      scheduled: "已计划",
      running: "进行中",
      error: "异常",
    }[state] || state
  );
}

function getHeartbeatStateClass(state: HeartbeatStatusInfo["state"]): string {
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

function formatTime(value: string | null | undefined): string {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN");
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
  const currentIdx = stages.findIndex(stage => stage.id === currentStage);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {stages.map((stage, idx) => {
        let stageStatus: "done" | "active" | "pending" = "pending";
        if (status === "completed" || status === "completed_with_errors")
          stageStatus = "done";
        else if (idx < currentIdx) stageStatus = "done";
        else if (idx === currentIdx) stageStatus = "active";

        return (
          <div key={stage.id} className="flex shrink-0 items-center">
            <div
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-all ${
                stageStatus === "done"
                  ? "bg-emerald-100 text-emerald-700"
                  : stageStatus === "active"
                    ? "bg-blue-100 text-blue-700 animate-pulse"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {stageStatus === "done" && <CheckCircle2 className="h-3 w-3" />}
              {stageStatus === "active" && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {stageStatus === "pending" && <Circle className="h-3 w-3" />}
              <span>{stage.label}</span>
            </div>
            {idx < stages.length - 1 && (
              <ChevronRight
                className={`mx-0.5 h-3 w-3 shrink-0 ${
                  stageStatus === "done" ? "text-emerald-400" : "text-gray-300"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DirectiveView() {
  const { submitDirective, isSubmitting } = useWorkflowStore();
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const setRuntimeMode = useAppStore((state) => state.setRuntimeMode);
  const [directive, setDirective] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isFrontendMode = runtimeMode === "frontend";

  const examples = [
    "本周聚焦用户增长，请各部门制定具体行动方案。",
    "分析竞品最新动态，并制定我们的应对策略。",
    "优化核心产品体验，提升用户留存与复访。",
    "策划一次跨部门协作的新活动，兼顾传播与转化。",
  ];

  const handleSubmit = async () => {
    if (!directive.trim() || isSubmitting) return;

    if (isFrontendMode) {
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
          发布战略指令
        </h3>
        <p className="mt-0.5 text-[10px] text-[#8B7355]">
          输入一条指令，系统会由 CEO 自动拆解，并分发给相关部门执行。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isFrontendMode && (
          <div className="mb-4 rounded-xl border border-[#E8DDD0] bg-gradient-to-br from-[#FFF7EC] to-[#F7EDE2] p-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-white/80 p-2 text-[#D4845A]">
                <Monitor className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-[#3A2A1A]">纯前端模式说明</p>
                <p className="mt-1 text-[10px] leading-5 text-[#6B5A4A]">
                  当前默认入口优先浏览器本地体验，不会直接连服务端工作流。你可以先逛 3D
                  场景、点选角色、体验本地聊天；当你准备执行真实指令时，再切到高级模式。
                </p>
                <button
                  onClick={() => void setRuntimeMode("advanced")}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-[#D4845A] px-3 py-2 text-[10px] font-semibold text-white transition-colors hover:bg-[#C9774E]"
                >
                  <Server className="h-3.5 w-3.5" />
                  切到高级模式后执行真实工作流
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-4">
          <p className="mb-2 text-[10px] font-medium text-[#8B7355]">
            示例指令
          </p>
          <div className="space-y-1.5">
            {examples.map(example => (
              <button
                key={example}
                onClick={() => setDirective(example)}
                className="w-full rounded-xl border border-transparent bg-[#F8F4F0] px-3 py-2 text-left text-xs text-[#5A4A3A] transition-colors hover:border-[#E8DDD0] hover:bg-[#F0E8E0]"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-[#E8DDD0] bg-gradient-to-br from-[#F8F4F0] to-[#F0E8E0] p-3">
          <p className="mb-2 text-[10px] font-bold text-[#3A2A1A]">
            十阶段工作流
          </p>
          <div className="grid grid-cols-2 gap-1 text-[9px] text-[#5A4A3A]">
            {[
              ["1. 方向下发", "CEO 判断需要哪些部门参与"],
              ["2. 任务规划", "经理拆解任务并指派成员"],
              ["3. 执行任务", "Worker 产出第一版结果"],
              ["4. 评审打分", "经理按四维标准打分"],
              ["5. 元审计", "检查角色边界与内容质量"],
              ["6. 修订改进", "低分结果进入修订回合"],
              ["7. 验证确认", "经理确认问题是否解决"],
              ["8. 部门汇总", "经理向 CEO 汇总成果"],
              ["9. CEO 反馈", "给出整体复盘与建议"],
              ["10. 自动进化", "根据弱项更新 SOUL.md"],
            ].map(([step, desc]) => (
              <div key={step} className="flex items-start gap-1">
                <span className="font-medium text-[#D4845A]">{step}</span>
                <span>{desc}</span>
              </div>
            ))}
          </div>
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
          placeholder="输入战略指令..."
          rows={3}
          className="w-full resize-none rounded-xl border border-[#F0E8E0] bg-[#F8F4F0] px-3 py-2 text-sm text-[#3A2A1A] placeholder-[#C4B5A0] transition-all focus:border-[#D4845A]/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4845A]/20"
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={!directive.trim() || isSubmitting}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4845A] to-[#E4946A] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:from-[#C07050] hover:to-[#D0845A] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>正在启动工作流...</span>
            </>
          ) : isFrontendMode ? (
            <>
              <Server className="h-4 w-4" />
              <span>切换到高级模式</span>
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              <span>发布指令</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function OrgTreeView() {
  const { agents, agentStatuses, setActiveView, setSelectedMemoryAgent } =
    useWorkflowStore();
  const ceo = agents.find(agent => agent.role === "ceo");
  const managers = agents.filter(agent => agent.role === "manager");

  const openMemory = (agentId: string) => {
    setSelectedMemoryAgent(agentId);
    setActiveView("memory");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <Network className="h-4 w-4 text-indigo-500" />
          组织结构
        </h3>
        <p className="mt-0.5 text-[10px] text-[#8B7355]">
          点击任意 Agent，可直接查看它的近期记忆和历史经验。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {ceo && (
          <div className="mb-4">
            <button
              onClick={() => openMemory(ceo.id)}
              className="flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-2 text-left transition-colors hover:from-amber-100 hover:to-orange-100"
            >
              <div
                className={`h-2 w-2 rounded-full ${
                  AGENT_STATUS_COLORS[agentStatuses[ceo.id] || "idle"]
                }`}
              />
              <span className="text-sm font-bold text-amber-800">
                {ceo.name}
              </span>
              <span className="ml-auto text-[9px] text-amber-600">
                {STATUS_LABELS[agentStatuses[ceo.id] || "idle"] || "空闲"}
              </span>
            </button>
          </div>
        )}

        {managers.map(manager => {
          const workers = agents.filter(
            agent => agent.managerId === manager.id && agent.role === "worker"
          );

          return (
            <div key={manager.id} className="mb-3">
              <button
                onClick={() => openMemory(manager.id)}
                className="flex w-full items-center gap-2 rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] px-3 py-2 text-left transition-colors hover:bg-[#F0E8E0]"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white text-[10px] font-bold text-[#8B7355]">
                  {DEPARTMENT_ICONS[manager.department] || "DP"}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#3A2A1A]">
                      {DEPARTMENT_NAMES[manager.department] ||
                        manager.department}
                    </span>
                    <div
                      className={`h-1.5 w-1.5 rounded-full ${
                        AGENT_STATUS_COLORS[agentStatuses[manager.id] || "idle"]
                      }`}
                    />
                  </div>
                  <span className="text-[9px] text-[#8B7355]">
                    {manager.name}
                  </span>
                </div>
                <span className="text-[9px] text-[#8B7355]">
                  {STATUS_LABELS[agentStatuses[manager.id] || "idle"] || "空闲"}
                </span>
              </button>

              <div className="ml-4 mt-1 space-y-1">
                {workers.map(worker => (
                  <button
                    key={worker.id}
                    onClick={() => openMemory(worker.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-[#F8F4F0]"
                  >
                    <div
                      className={`h-1.5 w-1.5 rounded-full ${
                        AGENT_STATUS_COLORS[agentStatuses[worker.id] || "idle"]
                      }`}
                    />
                    <span className="text-[11px] text-[#5A4A3A]">
                      {worker.name}
                    </span>
                    <span className="ml-auto text-[9px] text-[#B0A090]">
                      {agentStatuses[worker.id] !== "idle"
                        ? STATUS_LABELS[agentStatuses[worker.id]] ||
                          agentStatuses[worker.id]
                        : "查看记忆"}
                    </span>
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
  const {
    currentWorkflow,
    tasks,
    stages,
    messages,
    fetchWorkflowDetail,
    currentWorkflowId,
  } = useWorkflowStore();

  useEffect(() => {
    if (!currentWorkflowId || currentWorkflow?.status !== "running") return;
    const timer = setInterval(() => {
      void fetchWorkflowDetail(currentWorkflowId);
    }, 3000);
    return () => clearInterval(timer);
  }, [currentWorkflowId, currentWorkflow?.status, fetchWorkflowDetail]);

  if (!currentWorkflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <BarChart3 className="mb-3 h-10 w-10 text-[#C4B5A0]" />
        <p className="text-sm font-medium text-[#5A4A3A]">暂无活跃工作流</p>
        <p className="mt-1 text-[10px] text-[#8B7355]">
          发布一条战略指令后，这里会显示实时执行进度。
        </p>
      </div>
    );
  }

  const tasksByDept = new Map<string, TaskInfo[]>();
  for (const task of tasks) {
    const list = tasksByDept.get(task.department) || [];
    list.push(task);
    tasksByDept.set(task.department, list);
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "assigned":
        return <Clock className="h-3 w-3 text-gray-400" />;
      case "executing":
        return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />;
      case "submitted":
        return <CheckCircle2 className="h-3 w-3 text-blue-500" />;
      case "reviewed":
        return <Star className="h-3 w-3 text-purple-500" />;
      case "audited":
        return <Shield className="h-3 w-3 text-orange-500" />;
      case "revising":
        return <Loader2 className="h-3 w-3 animate-spin text-orange-500" />;
      case "passed":
        return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
      case "failed":
        return <AlertCircle className="h-3 w-3 text-red-500" />;
      default:
        return <Circle className="h-3 w-3 text-gray-300" />;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            工作流进度
          </h3>
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${getWorkflowStatusClass(
              currentWorkflow.status
            )}`}
          >
            {WORKFLOW_STATUS_LABELS[currentWorkflow.status] ||
              currentWorkflow.status}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[10px] text-[#8B7355]">
          {currentWorkflow.directive}
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <StageProgressBar
          stages={stages}
          currentStage={currentWorkflow.current_stage}
          status={currentWorkflow.status}
        />

        {currentWorkflow.status === "failed" && (
          <div className="rounded-xl border border-red-200 bg-gradient-to-br from-red-50 to-orange-50 p-3">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-red-800">
              <AlertCircle className="h-3.5 w-3.5" />
              工作流执行失败
            </h4>
            <div className="whitespace-pre-wrap text-[10px] leading-5 text-red-700">
              {currentWorkflow.results?.last_error ||
                "出现了未知错误，请查看服务端日志。"}
            </div>
          </div>
        )}

        {Array.from(tasksByDept.entries()).map(([dept, deptTasks]) => (
          <div
            key={dept}
            className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-bold text-[#3A2A1A]">
                {DEPARTMENT_NAMES[dept] || dept}
              </span>
              <span className="text-[9px] text-[#8B7355]">
                {deptTasks.filter(task => task.status === "passed").length}/
                {deptTasks.length} 完成
              </span>
              {/*
                {"Advanced mode only"}
                  ? "纯前端模式"
                  : connected
                    ? "高级模式已连接"
                    : "高级模式未连接"}
              */}
            </div>
            <div className="space-y-1.5">
              {deptTasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-start gap-2 rounded-lg bg-white/60 px-2.5 py-2"
                >
                  {statusIcon(task.status)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-[#3A2A1A]">
                        {task.worker_id}
                      </span>
                      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[8px] text-[#7C6A59]">
                        {getTaskStatusLabel(task.status)}
                      </span>
                      {task.total_score !== null && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            task.total_score >= 16
                              ? "bg-emerald-100 text-emerald-700"
                              : task.total_score >= 10
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                          }`}
                        >
                          {task.total_score}/20
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[9px] text-[#8B7355]">
                      {task.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {(currentWorkflow.status === "completed" ||
          currentWorkflow.status === "completed_with_errors") &&
          currentWorkflow.results?.ceo_feedback && (
            <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-3">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                工作流已完成
              </h4>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px] text-emerald-700">
                {currentWorkflow.results.ceo_feedback}
              </div>
            </div>
          )}

        {(currentWorkflow.status === "completed" ||
          currentWorkflow.status === "completed_with_errors") &&
          currentWorkflow.results?.final_report?.overview && (
            <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-3">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-blue-800">
                <BookOpenText className="h-3.5 w-3.5" />
                最终报告已生成
              </h4>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-blue-800">
                <div className="rounded-lg bg-white/70 px-2 py-1.5">
                  任务数：
                  {currentWorkflow.results.final_report.overview.task_count ??
                    "--"}
                </div>
                <div className="rounded-lg bg-white/70 px-2 py-1.5">
                  部门数：
                  {currentWorkflow.results.final_report.overview
                    .department_count ?? "--"}
                </div>
                <div className="rounded-lg bg-white/70 px-2 py-1.5">
                  通过数：
                  {currentWorkflow.results.final_report.overview
                    .passed_task_count ?? "--"}
                </div>
                <div className="rounded-lg bg-white/70 px-2 py-1.5">
                  平均分：
                  {typeof currentWorkflow.results.final_report.overview
                    .average_score === "number"
                    ? currentWorkflow.results.final_report.overview.average_score.toFixed(
                        1
                      )
                    : "--"}
                </div>
              </div>
              <div className="mt-2 space-y-1 text-[9px] text-blue-700">
                <p className="font-medium text-blue-800">下载目录</p>
                <p className="break-all">
                  JSON：{currentWorkflow.results.final_report.json_path}
                </p>
                <p className="break-all">
                  Markdown：{currentWorkflow.results.final_report.markdown_path}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={`/api/workflows/${currentWorkflow.id}/report/download?format=json`}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-100"
                >
                  <Download className="h-3 w-3" />
                  下载 JSON
                </a>
                <a
                  href={`/api/workflows/${currentWorkflow.id}/report/download?format=md`}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-100"
                >
                  <Download className="h-3 w-3" />
                  下载 Markdown
                </a>
              </div>
              {Array.isArray(currentWorkflow.results?.department_reports) &&
                currentWorkflow.results.department_reports.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] font-bold text-blue-800">
                      部门报告
                    </p>
                    {currentWorkflow.results.department_reports.map(
                      (item: any) => (
                        <div
                          key={`${item.manager_id}-${item.department}`}
                          className="rounded-lg bg-white/70 p-2 text-[9px] text-blue-800"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                {item.department} · {item.manager_name}
                              </p>
                              <p className="mt-0.5 text-blue-700">
                                任务数：{item.task_count ?? "--"} · 平均分：
                                {typeof item.average_score === "number"
                                  ? item.average_score.toFixed(1)
                                  : "--"}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-1.5">
                              <a
                                href={`/api/workflows/${currentWorkflow.id}/report/department/${item.manager_id}/download?format=json`}
                                className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-[9px] font-medium text-blue-700 transition-colors hover:bg-blue-200"
                              >
                                <Download className="h-3 w-3" />
                                JSON
                              </a>
                              <a
                                href={`/api/workflows/${currentWorkflow.id}/report/department/${item.manager_id}/download?format=md`}
                                className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-[9px] font-medium text-blue-700 transition-colors hover:bg-blue-200"
                              >
                                <Download className="h-3 w-3" />
                                MD
                              </a>
                            </div>
                          </div>
                          <p className="mt-1 break-all text-blue-700">
                            目录：{item.report_markdown_path}
                          </p>
                        </div>
                      )
                    )}
                  </div>
                )}
            </div>
          )}

        {messages.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[10px] font-bold text-[#8B7355]">
              最近消息
            </h4>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {messages
                .slice(-10)
                .reverse()
                .map(msg => (
                  <div
                    key={msg.id}
                    className="rounded-lg bg-white/40 px-2 py-1.5 text-[9px] text-[#5A4A3A]"
                  >
                    <span className="font-medium text-[#D4845A]">
                      {msg.from_agent}
                    </span>
                    <span className="text-[#B0A090]"> → </span>
                    <span className="font-medium text-[#3A7A5A]">
                      {msg.to_agent}
                    </span>
                    <span className="text-[#B0A090]"> [{msg.stage}]</span>
                    <p className="mt-0.5 line-clamp-2 text-[#8B7355]">
                      {msg.content.substring(0, 100)}...
                    </p>
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
  const scoredTasks = tasks.filter(task => task.total_score !== null);

  if (scoredTasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Star className="mb-3 h-10 w-10 text-[#C4B5A0]" />
        <p className="text-sm font-medium text-[#5A4A3A]">暂无评审数据</p>
        <p className="mt-1 text-[10px] text-[#8B7355]">
          进入评审阶段后，这里会展示每项任务的得分。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <Star className="h-4 w-4 text-amber-500" />
          评审得分
        </h3>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {scoredTasks.map(task => (
          <div
            key={task.id}
            className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3 shadow-sm"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-[#3A2A1A]">
                {task.worker_id}
              </span>
              <span
                className={`text-sm font-bold ${
                  (task.total_score || 0) >= 16
                    ? "text-emerald-600"
                    : (task.total_score || 0) >= 10
                      ? "text-amber-600"
                      : "text-red-600"
                }`}
              >
                {task.total_score}/20
              </span>
            </div>

            <div className="mb-2 space-y-1.5">
              {[
                {
                  label: "准确性",
                  score: task.score_accuracy,
                  color: "bg-blue-500",
                },
                {
                  label: "完整性",
                  score: task.score_completeness,
                  color: "bg-green-500",
                },
                {
                  label: "可执行性",
                  score: task.score_actionability,
                  color: "bg-purple-500",
                },
                {
                  label: "格式",
                  score: task.score_format,
                  color: "bg-orange-500",
                },
              ].map(({ label, score, color }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-12 text-[9px] text-[#8B7355]">
                    {label}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full rounded-full ${color}`}
                      style={{ width: `${((score || 0) / 5) * 100}%` }}
                    />
                  </div>
                  <span className="w-5 text-right text-[9px] font-medium text-[#5A4A3A]">
                    {score || 0}
                  </span>
                </div>
              ))}
            </div>

            {task.manager_feedback && (
              <div className="mt-2 rounded-lg bg-[#F8F4F0] p-2 text-[9px] text-[#8B7355]">
                <span className="font-medium">反馈：</span>
                {task.manager_feedback.substring(0, 200)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MemoryResultCard({ item }: { item: AgentMemorySummary }) {
  return (
    <div className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3 shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[9px] font-medium text-[#7A6147]">
          {item.status}
        </span>
        <span className="text-[9px] text-[#B0A090]">
          {formatTime(item.createdAt)}
        </span>
      </div>
      <p className="text-[10px] font-semibold text-[#3A2A1A]">
        {item.directive}
      </p>
      <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-[9px] leading-5 text-[#6B5A4A]">
        {item.summary}
      </p>
      {item.keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.keywords.slice(0, 6).map(keyword => (
            <span
              key={keyword}
              className="rounded-full bg-amber-50 px-2 py-0.5 text-[8px] text-amber-700"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryView() {
  const {
    agents,
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

  const sortedAgents = useMemo(
    () =>
      [...agents].sort((a, b) => {
        if (a.role === b.role) return a.name.localeCompare(b.name);
        const rank: Record<"ceo" | "manager" | "worker", number> = {
          ceo: 0,
          manager: 1,
          worker: 2,
        };
        return rank[a.role] - rank[b.role];
      }),
    [agents]
  );

  const selectedAgent =
    sortedAgents.find(agent => agent.id === selectedMemoryAgentId) ||
    sortedAgents.find(agent => agent.role === "ceo") ||
    null;

  useEffect(() => {
    if (!selectedMemoryAgentId && selectedAgent) {
      setSelectedMemoryAgent(selectedAgent.id);
    }
  }, [selectedMemoryAgentId, selectedAgent, setSelectedMemoryAgent]);

  useEffect(() => {
    if (!selectedAgent) return;
    void fetchAgentRecentMemory(selectedAgent.id, currentWorkflowId, 12);
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
          Agent 记忆
        </h3>
        <p className="mt-0.5 text-[10px] text-[#8B7355]">
          查看某个智能体的近期会话记忆，并搜索它的历史工作流经验。
        </p>
      </div>

      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {sortedAgents.map(agent => (
            <button
              key={agent.id}
              onClick={() => setSelectedMemoryAgent(agent.id)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
                selectedAgent?.id === agent.id
                  ? "bg-[#D4845A] text-white shadow-sm"
                  : "bg-[#F8F4F0] text-[#6B5A4A] hover:bg-[#F0E8E0]"
              }`}
            >
              {agent.name}
            </button>
          ))}
        </div>

        {selectedAgent && (
          <div className="rounded-xl bg-[#F8F4F0] px-3 py-2 text-[10px] text-[#6B5A4A]">
            <span className="font-semibold text-[#3A2A1A]">
              {selectedAgent.name}
            </span>
            <span className="mx-1">·</span>
            <span>
              {DEPARTMENT_NAMES[selectedAgent.department] ||
                selectedAgent.department}
            </span>
            <span className="mx-1">·</span>
            <span>{selectedAgent.role}</span>
            {currentWorkflowId && (
              <>
                <span className="mx-1">·</span>
                <span>已附带当前工作流上下文</span>
              </>
            )}
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
            placeholder="搜索这个 Agent 的历史经验..."
            className="flex-1 rounded-xl border border-[#F0E8E0] bg-white px-3 py-2 text-xs text-[#3A2A1A] placeholder-[#B8A896] focus:border-[#D4845A]/50 focus:outline-none focus:ring-2 focus:ring-[#D4845A]/20"
          />
          <button
            onClick={() => void handleSearch()}
            disabled={!selectedAgent || !localQuery.trim() || isMemoryLoading}
            className="flex items-center gap-1 rounded-xl bg-[#F0E8E0] px-3 py-2 text-xs font-medium text-[#5B4837] transition-colors hover:bg-[#E8DDD0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isMemoryLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            搜索
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-[10px] font-bold text-[#8B7355]">近期记忆</h4>
            {isMemoryLoading && (
              <span className="flex items-center gap-1 text-[9px] text-[#B0A090]">
                <Loader2 className="h-3 w-3 animate-spin" />
                加载中
              </span>
            )}
          </div>

          {agentMemoryRecent.length === 0 ? (
            <div className="rounded-xl bg-[#F8F4F0] px-3 py-4 text-center text-[10px] text-[#8B7355]">
              {selectedAgent
                ? "这个 Agent 还没有近期记忆记录。"
                : "先选择一个 Agent。"}
            </div>
          ) : (
            <div className="space-y-2">
              {agentMemoryRecent
                .slice()
                .reverse()
                .map((entry, index) => (
                  <div
                    key={`${entry.timestamp}-${index}`}
                    className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[8px] text-[#6B5A4A]">
                          {getMemoryTypeLabel(entry.type)}
                        </span>
                        {entry.direction && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[8px] text-blue-700">
                            {getMemoryDirectionLabel(entry.direction)}
                          </span>
                        )}
                        {entry.stage && (
                          <span className="text-[8px] text-[#B0A090]">
                            {entry.stage}
                          </span>
                        )}
                      </div>
                      <span className="text-[8px] text-[#B0A090]">
                        {formatTime(entry.timestamp)}
                      </span>
                    </div>
                    {entry.otherAgentId && (
                      <p className="mb-1 text-[8px] text-[#A2896F]">
                        关联对象：{entry.otherAgentId}
                      </p>
                    )}
                    <p className="line-clamp-4 whitespace-pre-wrap text-[9px] leading-5 text-[#5D4C3B]">
                      {entry.preview || entry.content}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-1.5 text-[10px] font-bold text-[#8B7355]">
            历史经验搜索
          </h4>
          {agentMemorySearchResults.length === 0 ? (
            <div className="rounded-xl bg-[#F8F4F0] px-3 py-4 text-center text-[10px] text-[#8B7355]">
              输入关键词后，可以查看这个 Agent 过去完成过的相关工作流摘要。
            </div>
          ) : (
            <div className="space-y-2">
              {agentMemorySearchResults.map(item => (
                <MemoryResultCard
                  key={`${item.workflowId}-${item.createdAt}`}
                  item={item}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HeartbeatReportCard({ item }: { item: HeartbeatReportInfo }) {
  return (
    <div className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[#3A2A1A]">
            {item.title}
          </p>
          <p className="mt-0.5 text-[9px] text-[#8B7355]">
            {item.agentName} · {item.department} ·{" "}
            {formatTime(item.generatedAt)}
          </p>
        </div>
        <span className="rounded-full bg-[#F0E8E0] px-2 py-0.5 text-[8px] font-medium text-[#6B5A4A]">
          {item.trigger}
        </span>
      </div>

      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[9px] leading-5 text-[#5D4C3B]">
        {item.summaryPreview}
      </p>

      <div className="mt-2 flex flex-wrap gap-1">
        {item.keywords.slice(0, 6).map(keyword => (
          <span
            key={`${item.reportId}-${keyword}`}
            className="rounded-full bg-cyan-50 px-2 py-0.5 text-[8px] text-cyan-700"
          >
            {keyword}
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <a
          href={`/api/reports/heartbeat/${item.agentId}/${item.reportId}/download?format=json`}
          className="inline-flex items-center gap-1 rounded-lg bg-[#F0E8E0] px-2.5 py-1 text-[9px] font-medium text-[#5B4837] transition-colors hover:bg-[#E8DDD0]"
        >
          <Download className="h-3 w-3" />
          JSON
        </a>
        <a
          href={`/api/reports/heartbeat/${item.agentId}/${item.reportId}/download?format=md`}
          className="inline-flex items-center gap-1 rounded-lg bg-[#F0E8E0] px-2.5 py-1 text-[9px] font-medium text-[#5B4837] transition-colors hover:bg-[#E8DDD0]"
        >
          <Download className="h-3 w-3" />
          MD
        </a>
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
  } = useWorkflowStore();

  useEffect(() => {
    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(undefined, 12);
  }, [fetchHeartbeatStatuses, fetchHeartbeatReports]);

  const enabledCount = heartbeatStatuses.filter(item => item.enabled).length;
  const runningCount = heartbeatStatuses.filter(
    item => item.state === "running"
  ).length;
  const latestReportAt = heartbeatReports[0]?.generatedAt || null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <Search className="h-4 w-4 text-cyan-500" />
          心跳报告
        </h3>
        <p className="mt-0.5 text-[10px] text-[#8B7355]">
          展示 agent 的定时 heartbeat 状态、最近一次自主总结，以及手动触发入口。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] px-3 py-2">
            <p className="text-[9px] text-[#8B7355]">已启用</p>
            <p className="mt-1 text-sm font-bold text-[#3A2A1A]">
              {enabledCount}
            </p>
          </div>
          <div className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] px-3 py-2">
            <p className="text-[9px] text-[#8B7355]">运行中</p>
            <p className="mt-1 text-sm font-bold text-[#3A2A1A]">
              {runningCount}
            </p>
          </div>
          <div className="rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] px-3 py-2">
            <p className="text-[9px] text-[#8B7355]">最新报告</p>
            <p className="mt-1 text-[10px] font-semibold text-[#3A2A1A]">
              {latestReportAt ? formatTime(latestReportAt) : "--"}
            </p>
          </div>
        </div>

        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-[10px] font-bold text-[#8B7355]">
              Agent 心跳状态
            </h4>
            {isHeartbeatLoading && (
              <span className="flex items-center gap-1 text-[9px] text-[#B0A090]">
                <Loader2 className="h-3 w-3 animate-spin" />
                加载中
              </span>
            )}
          </div>

          {heartbeatStatuses.length === 0 ? (
            <div className="rounded-xl bg-[#F8F4F0] px-3 py-4 text-center text-[10px] text-[#8B7355]">
              暂无 heartbeat 状态数据。
            </div>
          ) : (
            <div className="space-y-2">
              {heartbeatStatuses.map(item => (
                <div
                  key={item.agentId}
                  className="rounded-xl border border-[#E8DDD0] bg-white/80 p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-semibold text-[#3A2A1A]">
                          {item.agentName}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[8px] font-medium ${getHeartbeatStateClass(
                            item.state
                          )}`}
                        >
                          {getHeartbeatStateLabel(item.state)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[9px] text-[#8B7355]">
                        {item.department} · 每 {item.intervalMinutes} 分钟 ·{" "}
                        {item.reportCount} 份报告
                      </p>
                    </div>
                    <button
                      onClick={() => void runHeartbeat(item.agentId)}
                      disabled={
                        !item.enabled ||
                        runningHeartbeatAgentId === item.agentId
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-cyan-100 px-2.5 py-1.5 text-[9px] font-medium text-cyan-700 transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {runningHeartbeatAgentId === item.agentId ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          运行中
                        </>
                      ) : (
                        <>
                          <Zap className="h-3 w-3" />
                          立即触发
                        </>
                      )}
                    </button>
                  </div>

                  <div className="mt-2 rounded-lg bg-[#F8F4F0] px-2.5 py-2 text-[9px] text-[#6B5A4A]">
                    <p>关注点：{item.focus}</p>
                    <p className="mt-1">
                      关键词：
                      {item.keywords.length > 0
                        ? item.keywords.join(" / ")
                        : "未配置"}
                    </p>
                    <p className="mt-1">
                      上次成功：
                      {item.lastSuccessAt
                        ? formatTime(item.lastSuccessAt)
                        : "--"}
                    </p>
                    <p className="mt-1">
                      下次计划：
                      {item.nextRunAt ? formatTime(item.nextRunAt) : "--"}
                    </p>
                    {item.lastReportTitle && (
                      <p className="mt-1">最近报告：{item.lastReportTitle}</p>
                    )}
                    {item.lastError && (
                      <p className="mt-1 text-red-600">
                        错误：{item.lastError}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-1.5 text-[10px] font-bold text-[#8B7355]">
            最近报告
          </h4>
          {heartbeatReports.length === 0 ? (
            <div className="rounded-xl bg-[#F8F4F0] px-3 py-4 text-center text-[10px] text-[#8B7355]">
              还没有生成 heartbeat 报告。
            </div>
          ) : (
            <div className="space-y-2">
              {heartbeatReports.map(item => (
                <HeartbeatReportCard
                  key={`${item.agentId}-${item.reportId}`}
                  item={item}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryView() {
  const { workflows, setCurrentWorkflow, setActiveView, fetchWorkflows } =
    useWorkflowStore();

  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#F0E8E0] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#3A2A1A]">
          <History className="h-4 w-4 text-[#8B7355]" />
          历史工作流
        </h3>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {workflows.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs text-[#8B7355]">暂无历史记录</p>
          </div>
        ) : (
          workflows.map(workflow => (
            <button
              key={workflow.id}
              onClick={() => {
                setCurrentWorkflow(workflow.id);
                setActiveView("workflow");
              }}
              className="w-full rounded-xl border border-[#E8DDD0] bg-[#F8F4F0] p-3 text-left transition-colors hover:bg-[#F0E8E0]"
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${getWorkflowStatusClass(
                    workflow.status
                  )}`}
                >
                  {WORKFLOW_STATUS_LABELS[workflow.status] || workflow.status}
                </span>
                <span className="text-[9px] text-[#B0A090]">
                  {formatTime(workflow.created_at)}
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-[#3A2A1A]">
                {workflow.directive}
              </p>
              {workflow.current_stage && (
                <p className="mt-1 text-[9px] text-[#8B7355]">
                  当前阶段：{workflow.current_stage}
                </p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function WorkflowPanel() {
  const runtimeMode = useAppStore((state) => state.runtimeMode);
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
    initSocket();
    void fetchAgents();
    void fetchStages();
    void fetchWorkflows();
    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(undefined, 12);
  }, [
    initSocket,
    fetchAgents,
    fetchStages,
    fetchWorkflows,
    fetchHeartbeatStatuses,
    fetchHeartbeatReports,
    runtimeMode,
  ]);

  if (!isWorkflowPanelOpen) return null;

  const views: Array<{ id: PanelView; icon: typeof Zap; label: string }> = [
    { id: "directive", icon: Zap, label: "指令" },
    { id: "org", icon: Network, label: "组织" },
    { id: "workflow", icon: BarChart3, label: "进度" },
    { id: "review", icon: Star, label: "评审" },
    { id: "memory", icon: BookOpenText, label: "记忆" },
    { id: "reports", icon: Search, label: "报告" },
    { id: "history", icon: History, label: "历史" },
  ];

  return (
    <div
      className="fixed bottom-6 right-5 z-[55] flex h-[560px] w-[400px] flex-col rounded-3xl border border-white/60 bg-white/92 shadow-[0_12px_48px_rgba(0,0,0,0.15)] backdrop-blur-2xl animate-in slide-in-from-bottom-4 fade-in duration-300"
      style={{ pointerEvents: "auto" }}
    >
      <div className="flex items-center justify-between border-b border-[#F0E8E0] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#D4845A] to-[#E4946A] shadow-sm">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#3A2A1A]">多智能体编排</h3>
            <div className="flex items-center gap-1.5">
              <div
                className={`h-1.5 w-1.5 rounded-full ${
                  isFrontendMode
                    ? "bg-amber-400"
                    : connected
                      ? "bg-emerald-500"
                      : "bg-red-400"
                }`}
              />
              <span className="text-[9px] text-[#8B7355]">
                {connected ? "已连接" : "未连接"}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={toggleWorkflowPanel}
          className="rounded-xl p-2 transition-colors hover:bg-[#F0E8E0]"
        >
          <X className="h-4 w-4 text-[#8B7355]" />
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-[#F0E8E0] px-3 py-2">
        {views.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-all ${
              activeView === id
                ? "bg-[#D4845A] text-white shadow-sm"
                : "text-[#8B7355] hover:bg-[#F0E8E0]"
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
            当前是默认纯前端入口：可浏览组织、查看示意阶段和体验本地聊天。
            真实工作流、heartbeat 报告和服务端模型调用仍保留在高级模式里，现有服务端实现没有删除。
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
