import {
  ArrowRight,
  BookOpenText,
  Brain,
  BriefcaseBusiness,
  Database,
  History,
  Network,
  Search,
  Sparkles,
  Star,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";

import { SessionHistoryTab } from "@/components/SessionHistoryTab";
import { useViewportTier } from "@/hooks/useViewportTier";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { type PanelView, useWorkflowStore } from "@/lib/workflow-store";
import {
  selectWorkflowLegacyDestination,
  selectWorkflowMissionDetail,
  selectWorkflowOrganization,
} from "@/lib/workflow-selectors";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function summarizeText(
  value: string | null | undefined,
  fallback: string,
  maxLength = 120
) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function targetSummary(locale: string, view: PanelView) {
  switch (view) {
    case "directive":
      return {
        title: t(locale, "任务页命令区", "Task hub command area"),
        description: t(
          locale,
          "新指令现在以任务主线为中心收口，不再以弹窗 tab 为主入口。",
          "Directives now live in the task flow instead of a standalone modal tab."
        ),
      };
    case "workflow":
      return {
        title: t(locale, "任务详情执行区", "Task execution detail"),
        description: t(
          locale,
          "执行阶段、角色摘要和关键事件已经迁入任务详情页。",
          "Execution progress, role summaries, and events now live in task detail."
        ),
      };
    case "review":
      return {
        title: t(locale, "任务详情评审区", "Task review detail"),
        description: t(
          locale,
          "交付、主管反馈和审计反馈已经放回任务详情上下文。",
          "Deliverables and review feedback now stay inside the task context."
        ),
      };
    case "history":
      return {
        title: t(locale, "任务列表与历史视图", "Task list and history"),
        description: t(
          locale,
          "历史工作流通过任务列表筛选与当前任务详情承接。",
          "Workflow history is now handled by task list filtering and task detail."
        ),
      };
    case "org":
      return {
        title: t(locale, "办公室 Agent 信息层", "Office agent layer"),
        description: t(
          locale,
          "组织编排结果已经回到办公室场景，点击 Agent 就能看到对应位置。",
          "Organization context has moved back into the office scene. Click an agent to inspect it."
        ),
      };
    case "memory":
      return {
        title: t(locale, "办公室记忆侧栏", "Office memory sidebar"),
        description: t(
          locale,
          "近期记忆和经验检索已经迁到办公室右侧的 Agent 检查面板。",
          "Recent memory and historical recall now live in the office-side inspector."
        ),
      };
    case "reports":
      return {
        title: t(locale, "办公室报告侧栏", "Office report sidebar"),
        description: t(
          locale,
          "Heartbeat 状态与报告摘要已经跟随 Agent 回到办公室侧栏。",
          "Heartbeat status and report summaries now follow the agent back to the office."
        ),
      };
    case "sessions":
      return {
        title: t(locale, "兼容历史入口", "Compatibility history"),
        description: t(
          locale,
          "本地恢复快照仍保留在这里，作为迁移期间的兼容入口。",
          "Local recovery snapshots remain here as a compatibility entry during migration."
        ),
      };
    default:
      return {
        title: t(locale, "任务中台", "Task hub"),
        description: t(
          locale,
          "内容已经迁移到新的页面。",
          "This content moved to a new surface."
        ),
      };
  }
}

export function WorkflowPanelCompatibility({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const selectedPet = useAppStore(state => state.selectedPet);
  const setSelectedPet = useAppStore(state => state.setSelectedPet);
  const { isMobile, isTablet } = useViewportTier();
  const isWorkflowPanelOpen = useWorkflowStore(
    state => state.isWorkflowPanelOpen
  );
  const toggleWorkflowPanel = useWorkflowStore(
    state => state.toggleWorkflowPanel
  );
  const activeView = useWorkflowStore(state => state.activeView);
  const setActiveView = useWorkflowStore(state => state.setActiveView);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const agents = useWorkflowStore(state => state.agents);
  const detailsById = useTasksStore(state => state.detailsById);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const [, setLocation] = useLocation();

  const shellClass = isMobile
    ? "left-2 right-2 bottom-[calc(env(safe-area-inset-bottom)+8px)] top-[calc(env(safe-area-inset-top)+96px)] rounded-[30px]"
    : isTablet
      ? "left-1/2 top-[6svh] h-[88svh] max-h-[860px] w-[min(94vw,980px)] -translate-x-1/2 rounded-[32px]"
      : "left-1/2 top-[5svh] h-[88svh] max-h-[860px] w-[min(92vw,980px)] -translate-x-1/2 rounded-[34px]";
  const tabs: Array<{ id: PanelView; icon: typeof Zap; label: string }> = [
    { id: "directive", icon: Zap, label: copy.workflow.tabs.directive },
    { id: "org", icon: Network, label: copy.workflow.tabs.org },
    { id: "workflow", icon: Workflow, label: copy.workflow.tabs.workflow },
    { id: "review", icon: Star, label: copy.workflow.tabs.review },
    { id: "memory", icon: BookOpenText, label: copy.workflow.tabs.memory },
    { id: "reports", icon: Search, label: copy.workflow.tabs.reports },
    { id: "history", icon: History, label: copy.workflow.tabs.history },
    { id: "sessions", icon: Database, label: copy.workflow.tabs.sessions },
  ];

  const destination = useMemo(
    () =>
      selectWorkflowLegacyDestination(activeView, {
        workflow: currentWorkflow,
        detailsById,
        agents,
        selectedTaskId,
        selectedAgentId: selectedPet,
      }),
    [
      activeView,
      agents,
      currentWorkflow,
      detailsById,
      selectedPet,
      selectedTaskId,
    ]
  );
  const missionDetail = useMemo(
    () => selectWorkflowMissionDetail(currentWorkflow, detailsById),
    [currentWorkflow, detailsById]
  );
  const organization = useMemo(
    () => selectWorkflowOrganization(currentWorkflow),
    [currentWorkflow]
  );
  const summary = targetSummary(locale, activeView);

  if (!isWorkflowPanelOpen && !embedded) {
    return null;
  }

  function closePanel() {
    if (!embedded) {
      toggleWorkflowPanel();
    }
  }

  function openDestination() {
    if (destination.kind === "legacy") {
      return;
    }

    if (destination.kind === "office" && destination.agentId) {
      setSelectedPet(destination.agentId);
    }

    if (destination.href) {
      setLocation(destination.href);
    }

    closePanel();
  }

  return (
    <>
      {!embedded && !isMobile ? (
        <div
          className="fixed inset-0 z-[69] bg-[radial-gradient(circle_at_top,rgba(242,232,219,0.18),rgba(60,44,28,0.08)_42%,rgba(28,18,10,0.22)_100%)] backdrop-blur-[10px]"
          style={{ pointerEvents: "auto" }}
          onClick={closePanel}
        />
      ) : null}

      <div
        className={cn(
          embedded
            ? "workflow-studio flex h-full flex-col overflow-hidden"
            : `workflow-studio fixed z-[71] flex flex-col studio-shell animate-in slide-in-from-bottom-4 fade-in duration-300 ${shellClass}`
        )}
        style={embedded ? undefined : { pointerEvents: "auto" }}
      >
        {!embedded ? (
          <div className="flex items-center justify-between border-b border-[rgba(151,120,90,0.14)] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#C98257] to-[#E2AF85] shadow-sm">
                <Brain className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#3A2A1A]">
                  {copy.workflow.title}
                </h3>
                <div className="mt-0.5 text-[10px] text-[#8B7355]">
                  {runtimeMode === "advanced"
                    ? t(
                        locale,
                        "旧 tab 已进入迁移兼容模式",
                        "Legacy tabs are now in compatibility mode"
                      )
                    : t(
                        locale,
                        "浏览器预览下保留迁移说明与历史入口",
                        "Browser preview keeps the migration guide and legacy history"
                      )}
                </div>
              </div>
            </div>
            <button
              onClick={closePanel}
              className="rounded-2xl px-3 py-2 text-sm font-medium text-[#7D6856] transition-colors hover:bg-white/45 hover:text-[#4A3727]"
              title={copy.common.close}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="border-b border-[rgba(151,120,90,0.14)] px-4 py-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {tabs.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setActiveView(id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold ${
                  activeView === id
                    ? "bg-[#C98257] text-white shadow-sm"
                    : "bg-white/35 text-[#7D6856] hover:bg-white/52 hover:text-[#4A3727]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeView === "sessions" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <SessionHistoryTab />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-4">
              <section className="rounded-[28px] border border-stone-200/80 bg-white/82 px-4 py-4 shadow-[0_18px_55px_rgba(112,84,51,0.08)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                  {t(locale, "迁移落点", "Migration target")}
                </div>
                <h4 className="mt-2 text-xl font-semibold text-stone-900">
                  {summary.title}
                </h4>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  {summary.description}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-stone-200 bg-stone-50/80 px-3 py-1 text-[11px] font-semibold text-stone-600">
                    {destination.kind === "office"
                      ? t(locale, "办公室场景", "Office scene")
                      : destination.kind === "task-detail"
                        ? t(locale, "任务详情页", "Task detail")
                        : destination.kind === "tasks"
                          ? t(locale, "任务中台", "Task hub")
                          : t(locale, "兼容历史", "Legacy history")}
                  </span>
                  {missionDetail?.title ? (
                    <span className="rounded-full border border-stone-200 bg-stone-50/80 px-3 py-1 text-[11px] font-semibold text-stone-600">
                      {summarizeText(
                        missionDetail.title,
                        copy.common.unavailable,
                        42
                      )}
                    </span>
                  ) : null}
                  {organization ? (
                    <span className="rounded-full border border-stone-200 bg-stone-50/80 px-3 py-1 text-[11px] font-semibold text-stone-600">
                      {organization.departments.length}{" "}
                      {t(locale, "部门", "departments")} /{" "}
                      {organization.nodes.length} {t(locale, "节点", "nodes")}
                    </span>
                  ) : null}
                </div>

                {destination.kind !== "legacy" ? (
                  <button
                    type="button"
                    onClick={openDestination}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#d07a4f] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#bf6c43]"
                  >
                    {destination.kind === "office"
                      ? t(locale, "去办公室查看", "Open in office")
                      : destination.kind === "task-detail"
                        ? t(locale, "打开任务详情", "Open task detail")
                        : t(locale, "前往任务中台", "Open task hub")}
                    <ArrowRight className="size-4" />
                  </button>
                ) : null}
              </section>

              <section className="rounded-[28px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_18px_55px_rgba(112,84,51,0.06)]">
                <div className="flex items-center gap-2 text-stone-600">
                  <BriefcaseBusiness className="size-4 text-[#5E8B72]" />
                  <div className="text-sm font-semibold text-stone-900">
                    {t(locale, "兼容说明", "Compatibility note")}
                  </div>
                </div>
                <div className="mt-3 space-y-3 text-sm leading-6 text-stone-600">
                  <p>
                    {t(
                      locale,
                      "这个面板不再承接“大而全”的工作流浏览职责，而是保留为迁移期说明层。旧 tab 仍然可点，但优先负责把你带到新的自然场景。",
                      "This panel no longer owns the all-in-one workflow experience. During migration it mainly guides you into the new natural surfaces."
                    )}
                  </p>
                  <p>
                    {t(
                      locale,
                      "任务相关内容回到任务页，Agent 相关内容回到办公室侧栏，会话快照暂时保留在兼容历史入口中。",
                      "Task content returns to the task hub, agent content returns to the office sidebar, and session snapshots remain in the legacy history entry for now."
                    )}
                  </p>
                </div>
              </section>

              {missionDetail ? (
                <section className="rounded-[28px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_18px_55px_rgba(112,84,51,0.06)]">
                  <div className="flex items-center gap-2 text-stone-600">
                    <Workflow className="size-4 text-[#c77b51]" />
                    <div className="text-sm font-semibold text-stone-900">
                      {t(locale, "当前任务承接面", "Current task landing")}
                    </div>
                  </div>
                  <div className="mt-3 rounded-[22px] border border-stone-200/70 bg-stone-50/80 px-3.5 py-3.5">
                    <div className="text-sm font-semibold text-stone-900">
                      {missionDetail.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-stone-500">
                      {missionDetail.currentStageLabel ||
                        t(
                          locale,
                          "当前还没有阶段标签。",
                          "No current stage label yet."
                        )}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      {summarizeText(
                        missionDetail.summary || missionDetail.sourceText,
                        copy.common.unavailable,
                        180
                      )}
                    </p>
                  </div>
                </section>
              ) : null}

              {organization ? (
                <section className="rounded-[28px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_18px_55px_rgba(112,84,51,0.06)]">
                  <div className="flex items-center gap-2 text-stone-600">
                    <Network className="size-4 text-[#4b7aa3]" />
                    <div className="text-sm font-semibold text-stone-900">
                      {t(locale, "办公室落点预览", "Office landing preview")}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-stone-200/70 bg-stone-50/80 px-3.5 py-3.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                        {t(locale, "组织摘要", "Organization")}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-stone-700">
                        {organization.departments.length}{" "}
                        {t(locale, "部门", "departments")} /{" "}
                        {organization.nodes.length} {t(locale, "节点", "nodes")}{" "}
                        / {organization.taskProfile}
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-stone-200/70 bg-stone-50/80 px-3.5 py-3.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                        {t(locale, "推荐 Agent", "Suggested agent")}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-stone-700">
                        {destination.agentId ||
                          t(
                            locale,
                            "先回办公室点击一个 Agent。",
                            "Return to the office and pick an agent."
                          )}
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-stone-600">
                    {summarizeText(
                      organization.reasoning,
                      copy.common.unavailable,
                      220
                    )}
                  </p>
                </section>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
