import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";

import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { CommandInput } from "@/components/nl-command/CommandInput";
import { Button } from "@/components/ui/button";
import {
  WorkspacePageShell,
  WorkspacePanel,
} from "@/components/workspace/WorkspacePageShell";
import { useI18n } from "@/i18n";
import { useNLCommandStore } from "@/lib/nl-command-store";
import { cn } from "@/lib/utils";

function riskTone(level: string) {
  switch (level) {
    case "critical":
    case "high":
      return "danger";
    case "medium":
      return "warning";
    default:
      return "success";
  }
}

function localizeRiskLabel(locale: string, level: string) {
  if (locale !== "zh-CN") return level;
  switch (level) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    case "critical":
      return "极高";
    default:
      return level;
  }
}

export default function CommandCenterPage({
  className,
}: {
  className?: string;
}) {
  const { locale } = useI18n();
  const [fullscreen, setFullscreen] = useState(false);
  const isZh = locale === "zh-CN";
  const text = {
    refresh: isZh ? "刷新" : "Refresh",
    exitFullscreen: isZh ? "退出全屏" : "Exit Fullscreen",
    fullscreen: isZh ? "全屏" : "Fullscreen",
    eyebrow: isZh ? "自然语言指挥中心" : "NL Command Center",
    title: isZh ? "战略指挥中心" : "Strategic Command Center",
    description: isZh
      ? "让兼容路由在视觉上和新的工作台外壳保持一致，同时保留它原有的规划、监控和决策支持布局。"
      : "Keep the compatibility route visually aligned with the new workspace shell while preserving its planning, monitoring, and decision-support layout.",
    dismiss: isZh ? "收起" : "Dismiss",
    executionPlan: isZh ? "执行计划" : "Execution Plan",
    executionPlanDescription: isZh
      ? "集中查看当前 mission、时间线、预算和整体风险态势。"
      : "Current missions, timeline, budget, and overall risk posture.",
    missions: isZh ? "任务组" : "Missions",
    tasks: isZh ? "任务" : "Tasks",
    timeline: isZh ? "时间线" : "Timeline",
    timelineRange: (start: string, end: string) =>
      isZh ? `${start} 至 ${end}` : `${start} to ${end}`,
    budget: isZh ? "预算" : "Budget",
    risk: isZh ? "风险" : "Risk",
    identifiedRisks: (count: number) =>
      isZh ? `已识别 ${count} 条风险` : `${count} identified risk items`,
    noPlan: isZh
      ? "还没有执行计划。先提交一条指令来生成计划。"
      : "No execution plan yet. Submit a command to generate one.",
    monitoring: isZh ? "实时监控" : "Real-time Monitoring",
    monitoringDescription: isZh
      ? "查看活跃指令负载、任务体量和最近的运行告警。"
      : "Active command load, mission volume, and the latest operational alerts.",
    activeCommands: isZh ? "活跃指令" : "Active Commands",
    totalMissions: isZh ? "任务总数" : "Total Missions",
    recentAlerts: isZh ? "最近告警" : "Recent Alerts",
    loadingDashboard: isZh ? "正在加载看板..." : "Loading dashboard...",
    noMonitoring: isZh ? "暂无监控数据。" : "No monitoring data available.",
    decisionSupport: isZh ? "决策支持" : "Decision Support",
    decisionSupportDescription: isZh
      ? "快速查看最可能影响当前执行计划的关键风险。"
      : "Quick access to the risks most likely to affect the current execution plan.",
    activeRisks: (count: number) =>
      isZh ? `${count} 条活跃风险` : `${count} active risks`,
    mitigation: isZh ? "缓解措施" : "Mitigation",
    noDecisionSupport: isZh
      ? "生成执行计划后，这里会出现决策支持数据。"
      : "Decision support data will appear once an execution plan is generated.",
  };

  const loading = useNLCommandStore(state => state.loading);
  const error = useNLCommandStore(state => state.error);
  const currentCommand = useNLCommandStore(state => state.currentCommand);
  const currentDialog = useNLCommandStore(state => state.currentDialog);
  const currentPlan = useNLCommandStore(state => state.currentPlan);
  const alerts = useNLCommandStore(state => state.alerts);
  const dashboard = useNLCommandStore(state => state.dashboard);
  const commands = useNLCommandStore(state => state.commands);
  const clearError = useNLCommandStore(state => state.clearError);
  const submitCommand = useNLCommandStore(state => state.submitCommand);
  const submitClarification = useNLCommandStore(
    state => state.submitClarification
  );
  const loadDashboard = useNLCommandStore(state => state.loadDashboard);
  const loadCommands = useNLCommandStore(state => state.loadCommands);

  useEffect(() => {
    void loadDashboard();
    void loadCommands();
  }, [loadCommands, loadDashboard]);

  const handleRefresh = useCallback(() => {
    void loadDashboard();
    void loadCommands();
  }, [loadCommands, loadDashboard]);

  const handleSubmitCommand = useCallback(
    async (text: string) => {
      await submitCommand({
        commandText: text,
        userId: "current-user",
        priority: "medium",
      });
    },
    [submitCommand]
  );

  const handleClarificationAnswer = useCallback(
    async (questionId: string, text: string, selectedOptions?: string[]) => {
      if (!currentCommand) return;

      await submitClarification(currentCommand.commandId, {
        answer: {
          questionId,
          text,
          selectedOptions,
          timestamp: Date.now(),
        },
      });
    },
    [currentCommand, submitClarification]
  );

  const actions = (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="workspace-control rounded-full px-4 text-sm font-semibold"
        onClick={handleRefresh}
      >
        <RefreshCw className="size-4" />
        {text.refresh}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="workspace-control rounded-full px-4 text-sm font-semibold"
        onClick={() => setFullscreen(current => !current)}
      >
        {fullscreen ? (
          <Minimize2 className="size-4" />
        ) : (
          <Maximize2 className="size-4" />
        )}
        {fullscreen ? text.exitFullscreen : text.fullscreen}
      </Button>
    </>
  );

  return (
    <WorkspacePageShell
      eyebrow={text.eyebrow}
      title={text.title}
      description={text.description}
      actions={actions}
      className={cn(
        fullscreen && "fixed inset-0 z-50 overflow-y-auto !pb-6 !pt-4 md:!pt-6",
        className
      )}
    >
      {error ? (
        <WorkspacePanel className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[rgba(180,93,77,0.2)] bg-[rgba(180,93,77,0.1)] px-4 py-3 text-sm text-[var(--workspace-danger)]">
            <span>{error}</span>
            <button
              type="button"
              className="font-semibold underline underline-offset-4"
              onClick={clearError}
            >
              {text.dismiss}
            </button>
          </div>
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel strong className="p-4 md:p-5">
        <CommandInput
          onSubmit={handleSubmitCommand}
          loading={loading}
          commandHistory={commands.map(command => command.commandText)}
        />

        {currentDialog?.status === "active" ? (
          <div className="mt-4">
            <ClarificationPanel
              dialog={currentDialog}
              onAnswer={handleClarificationAnswer}
            />
          </div>
        ) : null}
      </WorkspacePanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkspacePanel className="flex min-h-[320px] flex-col p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                {text.executionPlan}
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--workspace-text-muted)]">
                {text.executionPlanDescription}
              </p>
            </div>
            {currentPlan ? (
              <span
                className="workspace-badge text-[11px] font-semibold"
                data-tone={riskTone(currentPlan.status)}
              >
                {localizeRiskLabel(locale, currentPlan.status)}
              </span>
            ) : null}
          </div>

          {currentPlan ? (
            <div className="mt-4 flex-1 space-y-3 overflow-auto text-sm text-[var(--workspace-text-muted)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    {text.missions}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--workspace-text-strong)]">
                    {currentPlan.missions.length}
                  </div>
                </div>
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    {text.tasks}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--workspace-text-strong)]">
                    {currentPlan.tasks.length}
                  </div>
                </div>
              </div>

              {currentPlan.timeline ? (
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    {text.timeline}
                  </div>
                  <div className="mt-2 text-sm font-medium text-[var(--workspace-text)]">
                    {text.timelineRange(
                      currentPlan.timeline.startDate,
                      currentPlan.timeline.endDate
                    )}
                  </div>
                </div>
              ) : null}

              {currentPlan.costBudget ? (
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    {text.budget}
                  </div>
                  <div className="mt-2 text-sm font-medium text-[var(--workspace-text)]">
                    {currentPlan.costBudget.totalBudget}{" "}
                    {currentPlan.costBudget.currency}
                  </div>
                </div>
              ) : null}

              {currentPlan.riskAssessment ? (
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                      {text.risk}
                    </div>
                    <span
                      className="workspace-badge text-[11px] font-semibold"
                      data-tone={riskTone(
                        currentPlan.riskAssessment.overallRiskLevel
                      )}
                    >
                      {localizeRiskLabel(
                        locale,
                        currentPlan.riskAssessment.overallRiskLevel
                      )}
                    </span>
                  </div>
                  <div className="mt-3 text-sm text-[var(--workspace-text-muted)]">
                    {text.identifiedRisks(
                      currentPlan.riskAssessment.risks.length
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--workspace-text-subtle)]">
              {text.noPlan}
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel className="flex min-h-[320px] flex-col p-5">
          <div>
            <h2 className="text-sm font-semibold text-[var(--workspace-text-strong)]">
              {text.monitoring}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--workspace-text-muted)]">
              {text.monitoringDescription}
            </p>
          </div>

          {dashboard ? (
            <div className="mt-4 flex-1 space-y-4 overflow-auto text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    {text.activeCommands}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--workspace-text-strong)]">
                    {dashboard.activeCommands}
                  </div>
                </div>
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    {text.totalMissions}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--workspace-text-strong)]">
                    {dashboard.totalMissions}
                  </div>
                </div>
              </div>

              {alerts.length > 0 ? (
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    {text.recentAlerts}
                  </div>
                  <ul className="mt-3 space-y-2">
                    {alerts.slice(0, 5).map(alert => (
                      <li
                        key={alert.alertId}
                        className="rounded-[18px] border border-[var(--workspace-panel-border)] bg-white/44 px-4 py-3 text-xs leading-6 text-[var(--workspace-text)]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">[{alert.type}]</span>
                          <span
                            className="workspace-badge text-[10px] font-semibold"
                            data-tone={riskTone(alert.priority)}
                          >
                            {localizeRiskLabel(locale, alert.priority)}
                          </span>
                        </div>
                        <div className="mt-1 text-[var(--workspace-text-muted)]">
                          {alert.message}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--workspace-text-subtle)]">
              {loading ? text.loadingDashboard : text.noMonitoring}
            </div>
          )}
        </WorkspacePanel>
      </div>

      <WorkspacePanel className="p-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--workspace-text-strong)]">
            {text.decisionSupport}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--workspace-text-muted)]">
            {text.decisionSupportDescription}
          </p>
        </div>

        {currentPlan?.riskAssessment ? (
          <div className="mt-4 space-y-3 text-sm text-[var(--workspace-text-muted)]">
            <div
              className="workspace-badge text-[11px] font-semibold"
              data-tone="warning"
            >
              {text.activeRisks(currentPlan.riskAssessment.risks.length)}
            </div>
            <ul className="space-y-2">
              {currentPlan.riskAssessment.risks.slice(0, 3).map(risk => (
                <li
                  key={risk.id}
                  className="rounded-[18px] border border-[var(--workspace-panel-border)] bg-white/44 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-semibold text-[var(--workspace-text)]">
                      {risk.description}
                    </span>
                    <span
                      className="workspace-badge text-[10px] font-semibold"
                      data-tone={riskTone(risk.level)}
                    >
                      {localizeRiskLabel(locale, risk.level)}
                    </span>
                  </div>
                  <div className="mt-2 text-xs leading-6 text-[var(--workspace-text-muted)]">
                    {text.mitigation}: {risk.mitigation}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-4 text-sm text-[var(--workspace-text-subtle)]">
            {text.noDecisionSupport}
          </div>
        )}
      </WorkspacePanel>
    </WorkspacePageShell>
  );
}
