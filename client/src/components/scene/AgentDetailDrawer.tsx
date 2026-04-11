import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Brain,
  Clock3,
  FileText,
  HeartPulse,
  Layers3,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useLocation } from "wouter";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useViewportTier } from "@/hooks/useViewportTier";
import { useAppStore } from "@/lib/store";
import { useReputationStore } from "@/lib/reputation-store";
import { useRoleStore } from "@/lib/role-store";
import type { AgentMemoryEntry } from "@/lib/runtime/types";
import {
  buildAgentDetailSnapshot,
  selectWorkflowForAgent,
} from "@/lib/scene-agent-detail";
import { useTasksStore } from "@/lib/tasks-store";
import { useWorkflowStore } from "@/lib/workflow-store";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function InfoCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-[24px] border border-[#E7D9C8] bg-white/92 p-4 shadow-[0_12px_35px_rgba(101,73,44,0.08)]">
      <div className="flex items-center gap-2 text-[#8F745C]">
        <span className="flex size-8 items-center justify-center rounded-2xl bg-[#F6EEE4] text-[#A07249]">
          {icon}
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
          {label}
        </p>
      </div>
      <p className="mt-3 text-sm font-semibold text-[#3F2F22]">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs leading-5 text-[#8B735C]">{hint}</p>
      ) : null}
    </div>
  );
}

function DrawerSection({
  icon,
  title,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-[#E7D9C8] bg-[linear-gradient(180deg,#fffdf9,#f8efe5)] p-4 shadow-[0_12px_35px_rgba(101,73,44,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#8F745C]">
          <span className="flex size-8 items-center justify-center rounded-2xl bg-[#F6EEE4] text-[#A07249]">
            {icon}
          </span>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]">
            {title}
          </h3>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MemoryList({
  locale,
  entries,
}: {
  locale: string;
  entries: ReturnType<typeof buildAgentDetailSnapshot>["memoryEntries"];
}) {
  return (
    <div className="space-y-3">
      {entries.map((entry, index) => (
        <div
          key={`${entry.timestamp}-${entry.type}-${index}`}
          className="rounded-[22px] border border-[#EADFD1] bg-white/88 px-4 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-full bg-[#F6EEE4] px-2.5 py-1 text-[10px] font-semibold text-[#8A6D54]">
              {entry.stage || entry.type}
            </span>
            <span className="text-[10px] text-[#A08873]">
              {new Intl.DateTimeFormat(locale, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(entry.timestamp))}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium leading-6 text-[#453427]">
            {entry.preview}
          </p>
        </div>
      ))}
    </div>
  );
}

export function AgentDetailDrawer({
  agentId,
  open,
  onOpenChange,
}: {
  agentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isMobile } = useViewportTier();
  const locale = useAppStore(state => state.locale);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const workflows = useWorkflowStore(state => state.workflows);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const workflowTasks = useWorkflowStore(state => state.tasks);
  const workflowAgents = useWorkflowStore(state => state.agents);
  const agentStatuses = useWorkflowStore(state => state.agentStatuses);
  const heartbeatStatuses = useWorkflowStore(state => state.heartbeatStatuses);
  const heartbeatReports = useWorkflowStore(state => state.heartbeatReports);
  const fetchWorkflowDetail = useWorkflowStore(state => state.fetchWorkflowDetail);
  const fetchHeartbeatStatuses = useWorkflowStore(
    state => state.fetchHeartbeatStatuses
  );
  const fetchHeartbeatReports = useWorkflowStore(
    state => state.fetchHeartbeatReports
  );
  const fetchAgentRecentMemory = useWorkflowStore(
    state => state.fetchAgentRecentMemory
  );
  const openWorkflowPanel = useWorkflowStore(state => state.openWorkflowPanel);
  const setActiveView = useWorkflowStore(state => state.setActiveView);
  const missionTasks = useTasksStore(state => state.tasks);
  const missionDetailsById = useTasksStore(state => state.detailsById);
  const selectTask = useTasksStore(state => state.selectTask);
  const [memoryEntries, setMemoryEntries] = useState<AgentMemoryEntry[]>([]);
  const [memoryOwnerId, setMemoryOwnerId] = useState<string | null>(null);
  const roleInfo = useRoleStore(state =>
    agentId ? state.agentRoles.get(agentId) || null : null
  );
  const reputationProfile = useReputationStore(state =>
    agentId ? state.profiles[agentId] || null : null
  );
  const fetchReputation = useReputationStore(state => state.fetchReputation);
  const setSelectedMemoryAgent = useWorkflowStore(
    state => state.setSelectedMemoryAgent
  );
  const [, setLocation] = useLocation();

  const candidateWorkflow = useMemo(() => {
    if (!agentId) return null;
    return selectWorkflowForAgent({
      agentId,
      currentWorkflow,
      workflows,
    });
  }, [agentId, currentWorkflow, workflows]);

  const snapshot = useMemo(() => {
    if (!agentId) return null;
    return buildAgentDetailSnapshot({
      agentId,
      locale,
      runtimeMode,
      agents: workflowAgents,
      agentStatuses,
      currentWorkflow,
      workflows,
      workflowTasks,
      missionTasks,
      missionDetailsById,
      heartbeatStatuses,
      heartbeatReports,
      recentMemory: memoryOwnerId === agentId ? memoryEntries : [],
      roleInfo,
      reputationProfile,
    });
  }, [
    agentId,
    locale,
    runtimeMode,
    workflowAgents,
    agentStatuses,
    currentWorkflow,
    workflows,
    workflowTasks,
    missionTasks,
    missionDetailsById,
    heartbeatStatuses,
    heartbeatReports,
    memoryEntries,
    memoryOwnerId,
    roleInfo,
    reputationProfile,
    open,
  ]);

  useEffect(() => {
    if (!open || !agentId) return;

    let cancelled = false;
    setMemoryOwnerId(null);
    setMemoryEntries([]);

    if (candidateWorkflow && currentWorkflow?.id !== candidateWorkflow.id) {
      void fetchWorkflowDetail(candidateWorkflow.id);
    }

    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(undefined, 24);
    void (async () => {
      await fetchAgentRecentMemory(agentId, candidateWorkflow?.id, 6);
      if (cancelled) return;
      setMemoryOwnerId(agentId);
      setMemoryEntries(useWorkflowStore.getState().agentMemoryRecent);
    })();

    if (runtimeMode === "advanced") {
      void fetchReputation(agentId);
    }

    return () => {
      cancelled = true;
    };
  }, [
    open,
    agentId,
    candidateWorkflow,
    currentWorkflow,
    fetchAgentRecentMemory,
    fetchHeartbeatReports,
    fetchHeartbeatStatuses,
    fetchReputation,
    fetchWorkflowDetail,
    runtimeMode,
  ]);

  if (!snapshot) return null;

  const handleTaskOpen = () => {
    if (snapshot.workFocus.missionId) {
      selectTask(snapshot.workFocus.missionId);
      setLocation(`/tasks/${snapshot.workFocus.missionId}`);
      onOpenChange(false);
      return;
    }

    setLocation("/tasks");
    onOpenChange(false);
  };

  const handleMemoryOpen = () => {
    setSelectedMemoryAgent(snapshot.id);
    setActiveView("memory");
    openWorkflowPanel();
  };

  const handleReportsOpen = () => {
    setActiveView("reports");
    openWorkflowPanel();
  };

  const handleWorkflowOpen = () => {
    setActiveView("workflow");
    openWorkflowPanel();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      direction={isMobile ? "bottom" : "right"}
    >
      <DrawerContent className="overflow-hidden border-[#DECDBA] bg-[linear-gradient(180deg,#fdf8f1,#f4eadf)] data-[vaul-drawer-direction=bottom]:max-h-[86vh] data-[vaul-drawer-direction=right]:w-[min(29rem,100vw)] data-[vaul-drawer-direction=right]:sm:max-w-[29rem]">
        <DrawerHeader className="border-b border-[#E5D7C7] bg-[linear-gradient(180deg,rgba(255,251,245,0.98),rgba(247,238,229,0.92))] px-5 pb-4 pt-5 text-left">
          <DrawerTitle className="flex items-center gap-3 text-left text-[#3F2F22]">
            <span className="flex size-12 items-center justify-center rounded-[20px] bg-[#F3E4D4] text-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
              {snapshot.emoji}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-semibold">
                {snapshot.name}
              </span>
              <span className="mt-1 block text-sm font-medium text-[#8A7058]">
                {snapshot.title}
              </span>
            </span>
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            {t(
              locale,
              "Agent 详情侧栏，包含状态、任务、记忆和报告摘要。",
              "Agent detail drawer with status, task, memory, and report summary."
            )}
          </DrawerDescription>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-medium text-[#5D4A3A]">
              {snapshot.roleLabel}
            </span>
            <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-medium text-[#5D4A3A]">
              {snapshot.departmentLabel}
            </span>
            <span className="rounded-full bg-[#E9F4F0] px-3 py-1 text-xs font-semibold text-[#3C765F]">
              {snapshot.statusLabel}
            </span>
            {snapshot.currentRoleName ? (
              <span className="rounded-full bg-[#FCEECE] px-3 py-1 text-xs font-semibold text-[#9C6B35]">
                {snapshot.currentRoleName}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <InfoCard
              icon={<Brain className="size-4" />}
              label={t(locale, "模型", "Model")}
              value={snapshot.modelLabel}
              hint={
                snapshot.currentRoleLoadedAt
                  ? t(
                      locale,
                      `当前角色载入于 ${snapshot.currentRoleLoadedAt}`,
                      `Role loaded at ${snapshot.currentRoleLoadedAt}`
                    )
                  : null
              }
            />
            <InfoCard
              icon={<Sparkles className="size-4" />}
              label={t(locale, "待命文案", "Idle prompt")}
              value={snapshot.idleHint}
            />
          </div>

          {snapshot.runtimeHint ? (
            <div className="mt-4 rounded-[22px] border border-[#D8E6F2] bg-[#EFF6FB] px-4 py-3 text-xs leading-6 text-[#45657A]">
              {snapshot.runtimeHint}
            </div>
          ) : null}
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-4">
            <DrawerSection
              icon={<HeartPulse className="size-4" />}
              title={t(locale, "状态与健康", "Status and health")}
            >
              <div className="grid grid-cols-2 gap-3">
                <InfoCard
                  icon={<Clock3 className="size-4" />}
                  label={t(locale, "Heartbeat", "Heartbeat")}
                  value={snapshot.heartbeat.stateLabel}
                  hint={
                    snapshot.heartbeat.focus ||
                    snapshot.heartbeat.emptyLabel ||
                    snapshot.heartbeat.nextRunAt
                  }
                />
                <InfoCard
                  icon={<ShieldCheck className="size-4" />}
                  label={t(locale, "信誉", "Reputation")}
                  value={
                    snapshot.reputation.score !== null
                      ? `${snapshot.reputation.grade || "B"} · ${snapshot.reputation.score}`
                      : t(locale, "暂不可用", "Unavailable")
                  }
                  hint={
                    snapshot.reputation.trustTier ||
                    snapshot.reputation.emptyLabel
                  }
                />
              </div>
            </DrawerSection>

            <DrawerSection
              icon={<Layers3 className="size-4" />}
              title={t(locale, "当前任务", "Current focus")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full border-[#DBC8B5] bg-white/90 text-[#5C493A] hover:bg-[#FFF8F0]"
                  onClick={handleTaskOpen}
                >
                  {t(locale, "进入任务页", "Open tasks")}
                </Button>
              }
            >
              <div className="rounded-[24px] border border-[#EADFD1] bg-white/88 p-4">
                <p className="text-sm font-semibold text-[#403022]">
                  {snapshot.workFocus.title}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#705C49]">
                  {snapshot.workFocus.summary}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {snapshot.workFocus.stageLabel ? (
                    <span className="rounded-full bg-[#F7ECDD] px-3 py-1 text-xs font-medium text-[#8B6948]">
                      {snapshot.workFocus.stageLabel}
                    </span>
                  ) : null}
                  {snapshot.workFocus.statusLabel ? (
                    <span className="rounded-full bg-[#F0F5FA] px-3 py-1 text-xs font-medium text-[#4F6C84]">
                      {snapshot.workFocus.statusLabel}
                    </span>
                  ) : null}
                  {snapshot.workFocus.managerName ? (
                    <span className="rounded-full bg-[#F7F1EB] px-3 py-1 text-xs font-medium text-[#7C6551]">
                      {t(locale, "负责人", "Manager")}:{" "}
                      {snapshot.workFocus.managerName}
                    </span>
                  ) : null}
                </div>
              </div>
            </DrawerSection>

            <DrawerSection
              icon={<Radar className="size-4" />}
              title={t(locale, "近期记忆", "Recent memory")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full border-[#DBC8B5] bg-white/90 text-[#5C493A] hover:bg-[#FFF8F0]"
                  onClick={handleMemoryOpen}
                >
                  {t(locale, "打开 Memory", "Open Memory")}
                </Button>
              }
            >
              {snapshot.memoryEmpty ? (
                <EmptyHintBlock
                  tone="info"
                  icon={<Sparkles className="size-5" />}
                  title={snapshot.memoryEmpty.title}
                  description={snapshot.memoryEmpty.description}
                  hint={snapshot.memoryEmpty.hint || undefined}
                />
              ) : (
                <MemoryList locale={locale} entries={snapshot.memoryEntries} />
              )}
            </DrawerSection>

            <DrawerSection
              icon={<FileText className="size-4" />}
              title={t(locale, "报告摘要", "Report summary")}
              action={
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full border-[#DBC8B5] bg-white/90 text-[#5C493A] hover:bg-[#FFF8F0]"
                    onClick={handleReportsOpen}
                  >
                    {t(locale, "打开 Reports", "Open Reports")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full border-[#DBC8B5] bg-white/90 text-[#5C493A] hover:bg-[#FFF8F0]"
                    onClick={handleWorkflowOpen}
                  >
                    {t(locale, "工作流面板", "Workflow")}
                  </Button>
                </div>
              }
            >
              {snapshot.reportEmpty ? (
                <EmptyHintBlock
                  tone="neutral"
                  icon={<FileText className="size-5" />}
                  title={snapshot.reportEmpty.title}
                  description={snapshot.reportEmpty.description}
                  hint={snapshot.reportEmpty.hint || undefined}
                />
              ) : snapshot.latestReport ? (
                <div className="rounded-[24px] border border-[#EADFD1] bg-white/88 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#403022]">
                        {snapshot.latestReport.title}
                      </p>
                      <p className="mt-1 text-xs text-[#9B816A]">
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(snapshot.latestReport.generatedAt))}
                      </p>
                    </div>
                    <span className="rounded-full bg-[#F6EEE4] px-3 py-1 text-xs font-semibold text-[#8B6C53]">
                      {snapshot.reportCount}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[#705C49]">
                    {snapshot.latestReport.summaryPreview}
                  </p>
                  {snapshot.latestReport.keywords.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {snapshot.latestReport.keywords.slice(0, 4).map(keyword => (
                        <span
                          key={keyword}
                          className="rounded-full bg-[#F0F5FA] px-3 py-1 text-xs font-medium text-[#4F6C84]"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DrawerSection>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
