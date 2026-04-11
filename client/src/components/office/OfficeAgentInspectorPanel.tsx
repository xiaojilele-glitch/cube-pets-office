import {
  ArrowRight,
  BookOpenText,
  Bot,
  BriefcaseBusiness,
  Download,
  Loader2,
  Search,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { AgentRolePanel } from "@/components/AgentRolePanel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/lib/workflow-store";
import {
  selectHeartbeatReportsForAgent,
  selectHeartbeatStatusForAgent,
  selectOfficeAgentOptions,
  selectPrimaryOfficeAgentId,
  selectWorkflowAgentNode,
  selectWorkflowMissionId,
  selectWorkflowOrganization,
} from "@/lib/workflow-selectors";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function summarizeText(
  value: string | null | undefined,
  fallback: string,
  maxLength = 140
) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function formatTime(locale: string, value: string | null | undefined) {
  if (!value) {
    return t(locale, "暂无", "Not yet");
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatState(locale: string, value: string | null | undefined) {
  if (!value) {
    return t(locale, "未同步", "Not synced");
  }

  const normalized = value.toLowerCase();
  switch (normalized) {
    case "idle":
      return t(locale, "空闲", "Idle");
    case "scheduled":
      return t(locale, "已排程", "Scheduled");
    case "running":
      return t(locale, "运行中", "Running");
    case "error":
      return t(locale, "异常", "Error");
    case "thinking":
      return t(locale, "思考中", "Thinking");
    case "executing":
      return t(locale, "执行中", "Executing");
    case "reviewing":
      return t(locale, "评审中", "Reviewing");
    case "planning":
      return t(locale, "规划中", "Planning");
    case "heartbeat":
      return t(locale, "心跳中", "Heartbeat");
    default:
      return normalized;
  }
}

function toneForState(value: string | null | undefined) {
  const normalized = value?.toLowerCase();
  if (normalized === "running" || normalized === "executing") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (normalized === "error") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (normalized === "scheduled" || normalized === "planning") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-stone-200 bg-white/80 text-stone-600";
}

export function OfficeAgentInspectorPanel({
  className,
}: {
  className?: string;
}) {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const selectedPet = useAppStore(state => state.selectedPet);
  const setSelectedPet = useAppStore(state => state.setSelectedPet);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const currentWorkflowId = useWorkflowStore(state => state.currentWorkflowId);
  const agents = useWorkflowStore(state => state.agents);
  const agentMemoryRecent = useWorkflowStore(state => state.agentMemoryRecent);
  const agentMemorySearchResults = useWorkflowStore(
    state => state.agentMemorySearchResults
  );
  const isMemoryLoading = useWorkflowStore(state => state.isMemoryLoading);
  const memoryError = useWorkflowStore(state => state.memoryError);
  const memoryQuery = useWorkflowStore(state => state.memoryQuery);
  const heartbeatStatuses = useWorkflowStore(state => state.heartbeatStatuses);
  const heartbeatReports = useWorkflowStore(state => state.heartbeatReports);
  const runningHeartbeatAgentId = useWorkflowStore(
    state => state.runningHeartbeatAgentId
  );
  const fetchAgentRecentMemory = useWorkflowStore(
    state => state.fetchAgentRecentMemory
  );
  const searchAgentMemory = useWorkflowStore(state => state.searchAgentMemory);
  const fetchHeartbeatStatuses = useWorkflowStore(
    state => state.fetchHeartbeatStatuses
  );
  const fetchHeartbeatReports = useWorkflowStore(
    state => state.fetchHeartbeatReports
  );
  const runHeartbeat = useWorkflowStore(state => state.runHeartbeat);
  const downloadHeartbeatReport = useWorkflowStore(
    state => state.downloadHeartbeatReport
  );
  const setSelectedMemoryAgent = useWorkflowStore(
    state => state.setSelectedMemoryAgent
  );
  const setMemoryQuery = useWorkflowStore(state => state.setMemoryQuery);
  const detailsById = useTasksStore(state => state.detailsById);
  const [draft, setDraft] = useState("");
  const [, setLocation] = useLocation();

  const organization = useMemo(
    () => selectWorkflowOrganization(currentWorkflow),
    [currentWorkflow]
  );
  const officeAgentOptions = useMemo(
    () =>
      selectOfficeAgentOptions({ workflow: currentWorkflow, agents, locale }),
    [agents, currentWorkflow, locale]
  );
  const activeAgentId = useMemo(
    () =>
      selectPrimaryOfficeAgentId({
        workflow: currentWorkflow,
        agents,
        selectedAgentId: selectedPet,
      }),
    [agents, currentWorkflow, selectedPet]
  );
  const activeAgent =
    officeAgentOptions.find(option => option.agent.id === activeAgentId)
      ?.agent ?? null;
  const activeNode = useMemo(
    () => selectWorkflowAgentNode(currentWorkflow, activeAgentId),
    [activeAgentId, currentWorkflow]
  );
  const heartbeatStatus = useMemo(
    () => selectHeartbeatStatusForAgent(heartbeatStatuses, activeAgentId),
    [activeAgentId, heartbeatStatuses]
  );
  const agentReports = useMemo(
    () => selectHeartbeatReportsForAgent(heartbeatReports, activeAgentId, 4),
    [activeAgentId, heartbeatReports]
  );
  const missionId = useMemo(
    () => selectWorkflowMissionId(currentWorkflow),
    [currentWorkflow]
  );
  const activeTaskTitle = missionId
    ? (detailsById[missionId]?.title ?? null)
    : null;

  useEffect(() => {
    if (!activeAgentId) {
      return;
    }

    setSelectedMemoryAgent(activeAgentId);
    setMemoryQuery("");
    setDraft("");
    void fetchAgentRecentMemory(activeAgentId, currentWorkflowId, 6);
    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(activeAgentId, 6);
  }, [
    activeAgentId,
    currentWorkflowId,
    fetchAgentRecentMemory,
    fetchHeartbeatReports,
    fetchHeartbeatStatuses,
    setMemoryQuery,
    setSelectedMemoryAgent,
  ]);

  useEffect(() => {
    setDraft(memoryQuery);
  }, [memoryQuery]);

  if (!activeAgentId || !activeAgent) {
    return null;
  }

  async function handleSearch() {
    if (!activeAgentId || !draft.trim()) {
      return;
    }

    const query = draft.trim();
    setMemoryQuery(query);
    await searchAgentMemory(activeAgentId, query, 5);
  }

  async function handleRunHeartbeat() {
    if (!activeAgentId) {
      return;
    }

    await runHeartbeat(activeAgentId);
    await fetchHeartbeatReports(activeAgentId, 6);
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col rounded-[28px] border border-stone-200/80 bg-white/88 p-3 text-stone-900 shadow-[0_20px_60px_rgba(112,84,51,0.14)] backdrop-blur",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-500">
            {t(locale, "办公室侧栏", "Office inspector")}
          </div>
          <h3 className="mt-1 truncate text-lg font-semibold text-stone-900">
            {activeAgent.name}
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-stone-600">
              {activeNode?.title || activeAgent.role}
            </span>
            <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-stone-600">
              {activeNode?.departmentLabel || activeAgent.department}
            </span>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                toneForState(heartbeatStatus?.state || activeAgent.status)
              )}
            >
              {formatState(
                locale,
                heartbeatStatus?.state || activeAgent.status
              )}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setSelectedPet(null)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-stone-200/80 bg-white/70 text-stone-500 transition-colors hover:bg-white hover:text-stone-900"
          title={copy.common.close}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-[22px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {t(locale, "当前阶段", "Current stage")}
          </div>
          <div className="mt-1 text-sm font-semibold text-stone-900">
            {currentWorkflow?.current_stage || copy.common.unavailable}
          </div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {summarizeText(
              currentWorkflow?.directive,
              t(locale, "还没有活跃任务。", "No active mission yet."),
              72
            )}
          </div>
        </div>

        <div className="rounded-[22px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {t(locale, "最近报告", "Latest report")}
          </div>
          <div className="mt-1 text-sm font-semibold text-stone-900">
            {formatTime(locale, agentReports[0]?.generatedAt || null)}
          </div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {agentReports[0]?.title ||
              t(
                locale,
                "这个 Agent 还没有产出 heartbeat 报告。",
                "No heartbeat report yet for this agent."
              )}
          </div>
        </div>
      </div>

      <ScrollArea className="mt-3 min-h-0 flex-1">
        <div className="space-y-3 pr-3">
          <section className="rounded-[24px] border border-stone-200/80 bg-[#fffaf4] px-3.5 py-3.5">
            <div className="flex items-center gap-2 text-stone-600">
              <BriefcaseBusiness className="size-4 text-[#c77b51]" />
              <div className="text-sm font-semibold text-stone-900">
                {t(locale, "组织与落点", "Org context")}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {officeAgentOptions.map(option => (
                <button
                  key={option.agent.id}
                  type="button"
                  onClick={() => setSelectedPet(option.agent.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors",
                    option.agent.id === activeAgentId
                      ? "border-[#d07a4f] bg-[#d07a4f] text-white"
                      : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                  )}
                >
                  {option.agent.name}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-[18px] border border-white/80 bg-white/80 px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {t(locale, "组织摘要", "Organization")}
                </div>
                <div className="mt-1 text-sm leading-6 text-stone-700">
                  {organization
                    ? `${organization.departments.length} ${t(locale, "部门", "departments")} / ${organization.nodes.length} ${t(locale, "节点", "nodes")} / ${organization.taskProfile}`
                    : t(
                        locale,
                        "当前没有组织编排结果。",
                        "No organization snapshot yet."
                      )}
                </div>
              </div>
              <div className="rounded-[18px] border border-white/80 bg-white/80 px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {t(locale, "当前 Agent 位置", "Agent placement")}
                </div>
                <div className="mt-1 text-sm leading-6 text-stone-700">
                  {activeNode
                    ? `${activeNode.departmentLabel} / ${activeNode.title}`
                    : t(
                        locale,
                        "还没有挂载到当前组织图。",
                        "This agent is not attached to the current org yet."
                      )}
                </div>
              </div>
            </div>
            {organization?.reasoning ? (
              <div className="mt-3 rounded-[18px] border border-[#eedbc8] bg-white/80 px-3 py-3 text-xs leading-6 text-stone-600">
                {summarizeText(
                  organization.reasoning,
                  copy.common.unavailable,
                  220
                )}
              </div>
            ) : null}
          </section>

          <section className="rounded-[24px] border border-stone-200/80 bg-white/80 px-3.5 py-3.5">
            <div className="flex items-center gap-2 text-stone-600">
              <Bot className="size-4 text-[#5E8B72]" />
              <div className="text-sm font-semibold text-stone-900">
                {t(locale, "角色状态", "Role state")}
              </div>
            </div>
            <div className="mt-3">
              <AgentRolePanel agentId={activeAgentId} />
            </div>
          </section>

          <section className="rounded-[24px] border border-stone-200/80 bg-white/80 px-3.5 py-3.5">
            <div className="flex items-center gap-2 text-stone-600">
              <BookOpenText className="size-4 text-[#4b7aa3]" />
              <div className="text-sm font-semibold text-stone-900">
                {t(locale, "记忆视图", "Memory")}
              </div>
              {isMemoryLoading ? (
                <Loader2 className="ml-auto size-4 animate-spin text-stone-400" />
              ) : null}
            </div>

            <div className="mt-3 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
                <input
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSearch();
                    }
                  }}
                  placeholder={t(
                    locale,
                    "搜索这个 Agent 的经验和记忆",
                    "Search this agent's memory"
                  )}
                  className="w-full rounded-full border border-stone-200 bg-stone-50/90 py-2 pl-9 pr-3 text-sm text-stone-700 outline-none transition-colors focus:border-stone-300"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleSearch()}
                className="inline-flex items-center justify-center rounded-full bg-[#d07a4f] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#bf6c43]"
              >
                {t(locale, "搜索", "Search")}
              </button>
            </div>

            {memoryError ? (
              <div className="mt-3 rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-3 text-xs leading-6 text-rose-700">
                {memoryError.detail || memoryError.message}
              </div>
            ) : null}

            <div className="mt-3 space-y-2">
              {agentMemoryRecent.length > 0 ? (
                agentMemoryRecent
                  .slice()
                  .reverse()
                  .map((entry, index) => (
                    <div
                      key={`${entry.timestamp}-${index}`}
                      className="rounded-[18px] border border-stone-200/70 bg-stone-50/75 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-stone-500">
                          <span className="rounded-full border border-white bg-white px-2 py-0.5">
                            {entry.type}
                          </span>
                          {entry.stage ? (
                            <span className="rounded-full border border-white bg-white px-2 py-0.5">
                              {entry.stage}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-[10px] text-stone-400">
                          {formatTime(locale, entry.timestamp)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-stone-700">
                        {summarizeText(
                          entry.preview || entry.content,
                          copy.common.unavailable,
                          160
                        )}
                      </p>
                    </div>
                  ))
              ) : (
                <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
                  {t(
                    locale,
                    "这个 Agent 还没有可展示的近期记忆。",
                    "No recent memory available for this agent yet."
                  )}
                </div>
              )}
            </div>

            {memoryQuery.trim() && agentMemorySearchResults.length > 0 ? (
              <div className="mt-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                  {t(locale, "历史检索结果", "Search results")}
                </div>
                {agentMemorySearchResults.map(item => (
                  <div
                    key={`${item.workflowId}-${item.createdAt}`}
                    className="rounded-[18px] border border-stone-200/70 bg-[#fff8ef] px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-stone-900">
                        {item.directive}
                      </div>
                      <div className="text-[10px] text-stone-400">
                        {formatTime(locale, item.createdAt)}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      {summarizeText(
                        item.summary,
                        copy.common.unavailable,
                        160
                      )}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-[24px] border border-stone-200/80 bg-white/80 px-3.5 py-3.5">
            <div className="flex items-center gap-2 text-stone-600">
              <Sparkles className="size-4 text-[#875cdb]" />
              <div className="text-sm font-semibold text-stone-900">
                {t(locale, "Heartbeat 报告", "Heartbeat reports")}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                  toneForState(heartbeatStatus?.state)
                )}
              >
                {formatState(locale, heartbeatStatus?.state)}
              </span>
              <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-stone-500">
                {t(locale, "上次成功", "Last success")}:{" "}
                {formatTime(locale, heartbeatStatus?.lastSuccessAt || null)}
              </span>
              <button
                type="button"
                onClick={() => void handleRunHeartbeat()}
                disabled={runningHeartbeatAgentId === activeAgentId}
                className="inline-flex items-center gap-1 rounded-full bg-[#5E8B72] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#4c775f] disabled:opacity-60"
              >
                {runningHeartbeatAgentId === activeAgentId ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                {t(locale, "立即生成", "Run now")}
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {agentReports.length > 0 ? (
                agentReports.map(report => (
                  <div
                    key={report.reportId}
                    className="rounded-[18px] border border-stone-200/70 bg-stone-50/80 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-stone-900">
                          {report.title}
                        </div>
                        <div className="mt-1 text-[10px] text-stone-400">
                          {formatTime(locale, report.generatedAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void downloadHeartbeatReport(
                            report.agentId,
                            report.reportId,
                            "md"
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-stone-600 transition-colors hover:bg-stone-100"
                      >
                        <Download className="size-3" />
                        MD
                      </button>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      {summarizeText(
                        report.summaryPreview,
                        copy.common.unavailable,
                        150
                      )}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
                  {t(
                    locale,
                    "还没有可以展示的报告，点击上面的按钮可以立即生成一份。",
                    "No report is available yet. Use the button above to trigger one."
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </ScrollArea>

      {missionId ? (
        <button
          type="button"
          onClick={() => setLocation(`/tasks/${missionId}`)}
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-[#d07a4f] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#bf6c43]"
        >
          {activeTaskTitle
            ? t(locale, "回到当前任务详情", "Open current task")
            : t(locale, "进入任务页", "Open task hub")}
          <ArrowRight className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setLocation("/tasks")}
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50"
        >
          {t(locale, "进入任务页", "Open task hub")}
          <ArrowRight className="size-4" />
        </button>
      )}
    </div>
  );
}
