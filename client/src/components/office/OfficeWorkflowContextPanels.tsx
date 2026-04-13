import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Download,
  FileClock,
  HeartPulse,
  Layers3,
  Loader2,
  Paperclip,
  Search,
  Sparkles,
} from "lucide-react";
import { normalizeWorkflowAttachments } from "@shared/workflow-input";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";
import type { MissionTaskDetail } from "@/lib/tasks-store";
import {
  selectHeartbeatReportsForAgent,
  selectHeartbeatStatusForAgent,
  selectOfficeAgentOptions,
  selectPrimaryOfficeAgentId,
  selectWorkflowOrganization,
} from "@/lib/workflow-selectors";
import { cn } from "@/lib/utils";
import { useWorkflowStore, type WorkflowInfo } from "@/lib/workflow-store";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatDate(locale: string, value: string | null | undefined) {
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

function summarizeText(
  value: string | null | undefined,
  fallback: string,
  maxLength = 180
) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function workflowStatusTone(status: WorkflowInfo["status"]) {
  switch (status) {
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "completed_with_errors":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-stone-200 bg-stone-50 text-stone-600";
  }
}

function heartbeatTone(state: string | null | undefined) {
  switch (state) {
    case "running":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "scheduled":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-stone-200 bg-stone-50 text-stone-600";
  }
}

function workflowStatusLabel(locale: string, status: WorkflowInfo["status"]) {
  switch (status) {
    case "running":
      return t(locale, "执行中", "Running");
    case "completed":
      return t(locale, "已完成", "Completed");
    case "completed_with_errors":
      return t(locale, "完成但有问题", "Completed with issues");
    case "failed":
      return t(locale, "失败", "Failed");
    default:
      return t(locale, "准备中", "Pending");
  }
}

function OfficeTabEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-stone-300/80 bg-white/62 px-8 py-10 text-center">
      <div className="max-w-md">
        <div className="text-lg font-semibold text-stone-900">{title}</div>
        <div className="mt-2 text-sm leading-6 text-stone-500">
          {description}
        </div>
      </div>
    </div>
  );
}

function ContextCard({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_14px_36px_rgba(99,73,45,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-stone-700">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-stone-100 text-[#b06f46]">
            {icon}
          </span>
          <div className="text-sm font-semibold text-stone-900">{title}</div>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StageBar({
  locale,
  currentStage,
}: {
  locale: string;
  currentStage: string | null;
}) {
  const stages = useWorkflowStore(state => state.stages);
  const activeIndex = stages.findIndex(stage => stage.id === currentStage);

  if (stages.length === 0) {
    return (
      <div className="text-sm text-stone-500">
        {currentStage || t(locale, "暂无阶段", "No stage yet")}
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {stages.map((stage, index) => {
        const done = activeIndex >= 0 && index < activeIndex;
        const active = stage.id === currentStage;

        return (
          <span
            key={stage.id}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold",
              active
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-stone-200 bg-stone-50 text-stone-500"
            )}
          >
            {stage.label}
          </span>
        );
      })}
    </div>
  );
}

export function OfficeWorkflowFlowPanel({
  workflow,
  missionDetail,
  onOpenTask,
}: {
  workflow: WorkflowInfo | null;
  missionDetail: MissionTaskDetail | null;
  onOpenTask: (taskId: string) => void;
}) {
  const { locale } = useI18n();
  const workflowTasks = useWorkflowStore(state => state.tasks);
  const downloadWorkflowReport = useWorkflowStore(
    state => state.downloadWorkflowReport
  );
  const downloadDepartmentReport = useWorkflowStore(
    state => state.downloadDepartmentReport
  );

  const organization = useMemo(
    () => selectWorkflowOrganization(workflow),
    [workflow]
  );
  const attachments = useMemo(
    () => normalizeWorkflowAttachments(workflow?.results?.input?.attachments),
    [workflow]
  );
  const groupedTasks = useMemo(() => {
    return Object.entries(
      workflowTasks.reduce<Record<string, typeof workflowTasks>>(
        (acc, task) => {
          (acc[task.department] ||= []).push(task);
          return acc;
        },
        {}
      )
    );
  }, [workflowTasks]);
  const nodesByDepartment = useMemo(() => {
    const nodes = organization?.nodes ?? [];

    return Object.entries(
      nodes.reduce<Record<string, typeof nodes>>((acc, node) => {
        (acc[node.departmentLabel] ||= []).push(node);
        return acc;
      }, {})
    );
  }, [organization]);

  if (!workflow) {
    return (
      <OfficeTabEmptyState
        title={t(locale, "还没有团队流上下文", "No workflow context yet")}
        description={t(
          locale,
          "快速任务会直接进入 mission，高级发起成功后这里会显示 stage、组织摘要、附件和产物。",
          "Mission launches land directly in the task flow. After an advanced launch succeeds, this tab shows stages, organization context, attachments, and artifacts."
        )}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="space-y-3">
        <ContextCard
          title={t(locale, "团队流概览", "Team flow overview")}
          icon={<Layers3 className="size-4" />}
          action={
            workflow.missionId ? (
              <Button
                type="button"
                variant="outline"
                className="workspace-control rounded-full"
                onClick={() => onOpenTask(workflow.missionId!)}
              >
                {t(locale, "打开任务", "Open task")}
                <ArrowRight className="size-4" />
              </Button>
            ) : null
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-stone-900">
                {workflow.directive}
              </div>
              <div className="mt-2 text-sm leading-6 text-stone-600">
                {summarizeText(
                  organization?.reasoning,
                  t(
                    locale,
                    "团队已经建立，后续执行上下文会持续同步到这里。",
                    "The team is prepared and the workflow context will continue syncing here."
                  )
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                  workflowStatusTone(workflow.status)
                )}
              >
                {workflowStatusLabel(locale, workflow.status)}
              </span>
              <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[10px] font-semibold text-stone-500">
                {formatDate(locale, workflow.created_at)}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 lg:grid-cols-3">
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "当前阶段", "Current stage")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {workflow.current_stage || t(locale, "准备中", "Pending")}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "输入附件", "Input attachments")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {attachments.length}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "产物摘要", "Artifact summary")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {missionDetail?.artifacts.length || 0}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <StageBar locale={locale} currentStage={workflow.current_stage} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="workspace-control rounded-full"
              onClick={() => void downloadWorkflowReport(workflow.id, "md")}
            >
              <Download className="size-4" />
              {t(locale, "导出总报告", "Export workflow report")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="workspace-control rounded-full"
              onClick={() => void downloadWorkflowReport(workflow.id, "json")}
            >
              <Download className="size-4" />
              JSON
            </Button>
          </div>
        </ContextCard>

        <ContextCard
          title={t(locale, "组织与角色摘要", "Organization and role summary")}
          icon={<BriefcaseBusiness className="size-4" />}
        >
          {organization ? (
            <div className="space-y-3">
              <div className="grid gap-2 lg:grid-cols-3">
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3 text-sm text-stone-700">
                  {organization.departments.length}{" "}
                  {t(locale, "个部门", "departments")}
                </div>
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3 text-sm text-stone-700">
                  {organization.nodes.length} {t(locale, "个节点", "nodes")}
                </div>
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3 text-sm text-stone-700">
                  {organization.taskProfile}
                </div>
              </div>

              {nodesByDepartment.map(([department, nodes]) => (
                <div
                  key={department}
                  className="rounded-[20px] border border-stone-200/80 bg-white/80 px-3.5 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-stone-900">
                      {department}
                    </div>
                    {workflowTasks.find(task => task.department === department)
                      ?.manager_id ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="workspace-control rounded-full"
                        onClick={() =>
                          void downloadDepartmentReport(
                            workflow.id,
                            workflowTasks.find(
                              task => task.department === department
                            )!.manager_id,
                            "md"
                          )
                        }
                      >
                        <Download className="size-4" />
                        {t(locale, "部门报告", "Department report")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 xl:grid-cols-2">
                    {nodes.map(node => (
                      <div
                        key={node.id}
                        className="rounded-[18px] border border-stone-200/80 bg-stone-50/85 px-3 py-3"
                      >
                        <div className="text-sm font-semibold text-stone-900">
                          {node.name} · {node.title}
                        </div>
                        <div className="mt-1 text-xs leading-6 text-stone-500">
                          {summarizeText(
                            node.responsibility,
                            t(locale, "暂无角色说明", "No responsibility yet"),
                            120
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm leading-6 text-stone-500">
              {t(
                locale,
                "当前 workflow 还没有组织摘要，后续生成后会在这里展示。",
                "This workflow does not have an organization summary yet."
              )}
            </div>
          )}
        </ContextCard>

        <div className="grid gap-3 xl:grid-cols-2">
          <ContextCard
            title={t(locale, "输入附件", "Input attachments")}
            icon={<Paperclip className="size-4" />}
          >
            {attachments.length > 0 ? (
              <div className="space-y-2">
                {attachments.map(attachment => (
                  <div
                    key={attachment.id}
                    className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3"
                  >
                    <div className="text-sm font-semibold text-stone-900">
                      {attachment.name}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-stone-500">
                      {summarizeText(
                        attachment.excerpt,
                        t(locale, "暂无摘要", "No excerpt"),
                        120
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm leading-6 text-stone-500">
                {t(
                  locale,
                  "这个 workflow 没有输入附件。",
                  "This workflow does not include input attachments."
                )}
              </div>
            )}
          </ContextCard>

          <ContextCard
            title={t(locale, "任务与产物摘要", "Task and artifact summary")}
            icon={<Sparkles className="size-4" />}
          >
            <div className="space-y-3">
              {groupedTasks.length > 0 ? (
                groupedTasks.map(([department, items]) => (
                  <div
                    key={department}
                    className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3"
                  >
                    <div className="text-sm font-semibold text-stone-900">
                      {department}
                    </div>
                    <div className="mt-2 space-y-2">
                      {items.slice(0, 3).map(item => (
                        <div
                          key={item.id}
                          className="text-xs leading-6 text-stone-600"
                        >
                          #{item.id} · {item.description}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm leading-6 text-stone-500">
                  {t(
                    locale,
                    "还没有同步到可展示的工作项。",
                    "No work items are available yet."
                  )}
                </div>
              )}

              <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                <div className="text-sm font-semibold text-stone-900">
                  {t(locale, "产物汇总", "Artifacts")}
                </div>
                <div className="mt-1 text-xs leading-6 text-stone-500">
                  {missionDetail?.artifacts.length
                    ? missionDetail.artifacts
                        .slice(0, 4)
                        .map(artifact => artifact.title)
                        .join(" / ")
                    : t(
                        locale,
                        "当前还没有 mission 产物。",
                        "No mission artifacts yet."
                      )}
                </div>
              </div>
            </div>
          </ContextCard>
        </div>
      </div>
    </div>
  );
}

export function OfficeMemoryReportsPanel({
  workflow,
}: {
  workflow: WorkflowInfo | null;
}) {
  const { locale, copy } = useI18n();
  const selectedPet = useAppStore(state => state.selectedPet);
  const setSelectedPet = useAppStore(state => state.setSelectedPet);
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
  const [draft, setDraft] = useState("");

  const officeAgentOptions = useMemo(
    () => selectOfficeAgentOptions({ workflow, agents, locale }),
    [agents, locale, workflow]
  );
  const activeAgentId = useMemo(
    () =>
      selectPrimaryOfficeAgentId({
        workflow,
        agents,
        selectedAgentId: selectedPet,
      }),
    [agents, selectedPet, workflow]
  );
  const activeAgent =
    officeAgentOptions.find(option => option.agent.id === activeAgentId)
      ?.agent ?? null;
  const heartbeatStatus = useMemo(
    () => selectHeartbeatStatusForAgent(heartbeatStatuses, activeAgentId),
    [activeAgentId, heartbeatStatuses]
  );
  const agentReports = useMemo(
    () => selectHeartbeatReportsForAgent(heartbeatReports, activeAgentId, 6),
    [activeAgentId, heartbeatReports]
  );

  useEffect(() => {
    if (!activeAgentId) {
      return;
    }

    setSelectedMemoryAgent(activeAgentId);
    setMemoryQuery("");
    setDraft("");
    void fetchAgentRecentMemory(activeAgentId, workflow?.id, 6);
    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(activeAgentId, 6);
  }, [
    activeAgentId,
    fetchAgentRecentMemory,
    fetchHeartbeatReports,
    fetchHeartbeatStatuses,
    setMemoryQuery,
    setSelectedMemoryAgent,
    workflow?.id,
  ]);

  useEffect(() => {
    setDraft(memoryQuery);
  }, [memoryQuery]);

  if (!activeAgentId || !activeAgent) {
    return (
      <OfficeTabEmptyState
        title={t(locale, "还没有可查看的 Agent", "No agent is available yet")}
        description={t(
          locale,
          "点击场景中的 Agent，或等待 workflow 建立组织后，这里会展示记忆和 heartbeat 报告。",
          "Click an agent in the scene or wait for the workflow to establish the team to see memory and heartbeat reports here."
        )}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="space-y-3">
        <ContextCard
          title={t(locale, "记忆与报告焦点", "Memory and report focus")}
          icon={<HeartPulse className="size-4" />}
        >
          <div className="flex flex-wrap gap-2">
            {officeAgentOptions.map(option => (
              <button
                key={option.agent.id}
                type="button"
                onClick={() => setSelectedPet(option.agent.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  option.agent.id === activeAgentId
                    ? "border-[#d07a4f] bg-[#d07a4f] text-white"
                    : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                )}
              >
                {option.agent.name}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-2 lg:grid-cols-3">
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "当前 Agent", "Active agent")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {activeAgent.name}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                Heartbeat
              </div>
              <div
                className={cn(
                  "mt-1 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                  heartbeatTone(heartbeatStatus?.state)
                )}
              >
                {heartbeatStatus?.state || t(locale, "未同步", "Not synced")}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "最近成功", "Last success")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {formatDate(locale, heartbeatStatus?.lastSuccessAt || null)}
              </div>
            </div>
          </div>
        </ContextCard>

        <ContextCard
          title={t(locale, "记忆检索", "Memory search")}
          icon={<Search className="size-4" />}
          action={
            <Button
              type="button"
              className="rounded-full bg-[#d07a4f] text-white hover:bg-[#bf6c43]"
              onClick={() => {
                const query = draft.trim();
                if (!query) return;
                setMemoryQuery(query);
                void searchAgentMemory(activeAgentId, query, 5);
              }}
            >
              <Search className="size-4" />
              {t(locale, "搜索", "Search")}
            </Button>
          }
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
            <input
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const query = draft.trim();
                  if (!query) return;
                  setMemoryQuery(query);
                  void searchAgentMemory(activeAgentId, query, 5);
                }
              }}
              placeholder={t(
                locale,
                "搜索这个 Agent 的记忆、经验和最近判断",
                "Search this agent's memory, experience, and recent reasoning"
              )}
              className="w-full rounded-full border border-stone-200 bg-stone-50/90 py-3 pl-10 pr-4 text-sm text-stone-700 outline-none transition-colors focus:border-stone-300"
            />
          </div>

          {memoryError ? (
            <div className="mt-3 rounded-[18px] border border-rose-200/80 bg-rose-50 px-3 py-3 text-sm leading-6 text-rose-700">
              {memoryError.detail || memoryError.message}
            </div>
          ) : null}

          <div className="mt-3 space-y-2">
            {(memoryQuery.trim()
              ? agentMemorySearchResults
              : agentMemoryRecent
            ).map((entry, index) => (
              <div
                key={`${"workflowId" in entry ? entry.workflowId : ""}-${index}`}
                className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3"
              >
                {"directive" in entry ? (
                  <>
                    <div className="text-sm font-semibold text-stone-900">
                      {entry.directive}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-stone-500">
                      {summarizeText(
                        entry.summary,
                        copy.common.unavailable,
                        140
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-stone-900">
                        {entry.stage || entry.type}
                      </div>
                      {isMemoryLoading ? (
                        <Loader2 className="size-4 animate-spin text-stone-400" />
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-stone-500">
                      {summarizeText(
                        entry.preview || entry.content,
                        copy.common.unavailable,
                        160
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {!isMemoryLoading &&
            (memoryQuery.trim()
              ? agentMemorySearchResults.length === 0
              : agentMemoryRecent.length === 0) ? (
              <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
                {t(
                  locale,
                  "这个 Agent 暂时没有可展示的记忆记录。",
                  "This agent does not have memory records to show yet."
                )}
              </div>
            ) : null}
          </div>
        </ContextCard>

        <ContextCard
          title={t(locale, "Heartbeat 报告", "Heartbeat reports")}
          icon={<Sparkles className="size-4" />}
          action={
            <Button
              type="button"
              className="rounded-full bg-[#5E8B72] text-white hover:bg-[#4c775f]"
              disabled={runningHeartbeatAgentId === activeAgentId}
              onClick={() => void runHeartbeat(activeAgentId)}
            >
              {runningHeartbeatAgentId === activeAgentId ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <HeartPulse className="size-4" />
              )}
              {t(locale, "立即生成", "Run now")}
            </Button>
          }
        >
          <div className="space-y-2">
            {agentReports.length > 0 ? (
              agentReports.map(report => (
                <div
                  key={report.reportId}
                  className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-stone-900">
                        {report.title}
                      </div>
                      <div className="mt-1 text-xs text-stone-400">
                        {formatDate(locale, report.generatedAt)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="workspace-control rounded-full"
                      onClick={() =>
                        void downloadHeartbeatReport(
                          report.agentId,
                          report.reportId,
                          "md"
                        )
                      }
                    >
                      <Download className="size-4" />
                      MD
                    </Button>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-stone-600">
                    {summarizeText(
                      report.summaryPreview,
                      copy.common.unavailable,
                      150
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
                {t(
                  locale,
                  "还没有 heartbeat 报告，点击上方按钮可以立即生成。",
                  "No heartbeat report is available yet. Use the button above to generate one."
                )}
              </div>
            )}
          </div>
        </ContextCard>
      </div>
    </div>
  );
}

export function OfficeWorkflowHistoryPanel({
  activeWorkflowId,
  onSelectWorkflow,
}: {
  activeWorkflowId: string | null;
  onSelectWorkflow: (workflowId: string) => void;
}) {
  const { locale } = useI18n();
  const workflows = useWorkflowStore(state => state.workflows);
  const workflowsError = useWorkflowStore(state => state.workflowsError);
  const fetchWorkflows = useWorkflowStore(state => state.fetchWorkflows);

  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  if (workflows.length === 0 && !workflowsError) {
    return (
      <OfficeTabEmptyState
        title={t(locale, "还没有历史记录", "No workflow history yet")}
        description={t(
          locale,
          "历史 tab 会保留 workflow 连续性摘要，后续也可以继续兼容旧的 session 视图。",
          "The history tab keeps workflow continuity visible and stays compatible with the legacy session view."
        )}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="space-y-3">
        <ContextCard
          title={t(locale, "历史与兼容摘要", "History and compatibility")}
          icon={<FileClock className="size-4" />}
        >
          <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3 text-sm leading-6 text-stone-600">
            {t(
              locale,
              "办公室驾驶舱负责当前运行态与高频上下文，/tasks 仍保留全屏深链，旧 workflow panel 继续承担兼容入口与 session 历史。",
              "The office cockpit owns the active runtime and high-frequency context, while /tasks stays as the fullscreen deep-link page and the legacy workflow panel remains the compatibility entry for session history."
            )}
          </div>
        </ContextCard>

        {workflowsError ? (
          <ContextCard
            title={t(locale, "历史加载失败", "History load failed")}
            icon={<Bot className="size-4" />}
          >
            <div className="text-sm leading-6 text-rose-700">
              {workflowsError.detail || workflowsError.message}
            </div>
          </ContextCard>
        ) : null}

        <ContextCard
          title={t(locale, "最近 workflow", "Recent workflows")}
          icon={<Layers3 className="size-4" />}
          action={
            <Button
              type="button"
              variant="outline"
              className="workspace-control rounded-full"
              onClick={() => void fetchWorkflows()}
            >
              {t(locale, "刷新", "Refresh")}
            </Button>
          }
        >
          <div className="space-y-2">
            {workflows.map(workflow => (
              <button
                key={workflow.id}
                type="button"
                onClick={() => onSelectWorkflow(workflow.id)}
                className={cn(
                  "w-full rounded-[20px] border px-3.5 py-3 text-left transition-colors",
                  workflow.id === activeWorkflowId
                    ? "border-[#d07a4f]/40 bg-[linear-gradient(180deg,rgba(255,248,234,0.98),rgba(255,241,220,0.94))]"
                    : "border-stone-200/80 bg-stone-50/70 hover:bg-stone-50"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-semibold text-stone-900">
                      {workflow.directive}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-stone-500">
                      {workflow.missionId
                        ? `${t(locale, "Mission", "Mission")}: ${workflow.missionId}`
                        : t(
                            locale,
                            "等待 mission 关联",
                            "Waiting for mission link"
                          )}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                        workflowStatusTone(workflow.status)
                      )}
                    >
                      {workflowStatusLabel(locale, workflow.status)}
                    </span>
                    <div className="mt-1 text-[10px] text-stone-400">
                      {formatDate(locale, workflow.created_at)}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ContextCard>
      </div>
    </div>
  );
}
