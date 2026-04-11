import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";

import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { CommandInput } from "@/components/nl-command/CommandInput";
import { Button } from "@/components/ui/button";
import {
  WorkspacePageShell,
  WorkspacePanel,
} from "@/components/workspace/WorkspacePageShell";
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

export default function CommandCenterPage({
  className,
}: {
  className?: string;
}) {
  const [fullscreen, setFullscreen] = useState(false);

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
        Refresh
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
        {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
      </Button>
    </>
  );

  return (
    <WorkspacePageShell
      eyebrow="NL Command Center"
      title="Strategic Command Center"
      description="Keep the compatibility route visually aligned with the new workspace shell while preserving its planning, monitoring, and decision-support layout."
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
              Dismiss
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
                Execution Plan
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--workspace-text-muted)]">
                Current missions, timeline, budget, and overall risk posture.
              </p>
            </div>
            {currentPlan ? (
              <span
                className="workspace-badge text-[11px] font-semibold"
                data-tone={riskTone(currentPlan.status)}
              >
                {currentPlan.status}
              </span>
            ) : null}
          </div>

          {currentPlan ? (
            <div className="mt-4 flex-1 space-y-3 overflow-auto text-sm text-[var(--workspace-text-muted)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    Missions
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--workspace-text-strong)]">
                    {currentPlan.missions.length}
                  </div>
                </div>
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    Tasks
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--workspace-text-strong)]">
                    {currentPlan.tasks.length}
                  </div>
                </div>
              </div>

              {currentPlan.timeline ? (
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    Timeline
                  </div>
                  <div className="mt-2 text-sm font-medium text-[var(--workspace-text)]">
                    {currentPlan.timeline.startDate} to{" "}
                    {currentPlan.timeline.endDate}
                  </div>
                </div>
              ) : null}

              {currentPlan.costBudget ? (
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    Budget
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
                      Risk
                    </div>
                    <span
                      className="workspace-badge text-[11px] font-semibold"
                      data-tone={riskTone(
                        currentPlan.riskAssessment.overallRiskLevel
                      )}
                    >
                      {currentPlan.riskAssessment.overallRiskLevel}
                    </span>
                  </div>
                  <div className="mt-3 text-sm text-[var(--workspace-text-muted)]">
                    {currentPlan.riskAssessment.risks.length} identified risk
                    items
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--workspace-text-subtle)]">
              No execution plan yet. Submit a command to generate one.
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel className="flex min-h-[320px] flex-col p-5">
          <div>
            <h2 className="text-sm font-semibold text-[var(--workspace-text-strong)]">
              Real-time Monitoring
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--workspace-text-muted)]">
              Active command load, mission volume, and the latest operational
              alerts.
            </p>
          </div>

          {dashboard ? (
            <div className="mt-4 flex-1 space-y-4 overflow-auto text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    Active Commands
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--workspace-text-strong)]">
                    {dashboard.activeCommands}
                  </div>
                </div>
                <div className="rounded-[20px] border border-[var(--workspace-panel-border)] bg-white/44 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    Total Missions
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--workspace-text-strong)]">
                    {dashboard.totalMissions}
                  </div>
                </div>
              </div>

              {alerts.length > 0 ? (
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--workspace-text-subtle)]">
                    Recent Alerts
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
                            {alert.priority}
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
              {loading
                ? "Loading dashboard..."
                : "No monitoring data available."}
            </div>
          )}
        </WorkspacePanel>
      </div>

      <WorkspacePanel className="p-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--workspace-text-strong)]">
            Decision Support
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--workspace-text-muted)]">
            Quick access to the risks most likely to affect the current
            execution plan.
          </p>
        </div>

        {currentPlan?.riskAssessment ? (
          <div className="mt-4 space-y-3 text-sm text-[var(--workspace-text-muted)]">
            <div
              className="workspace-badge text-[11px] font-semibold"
              data-tone="warning"
            >
              {currentPlan.riskAssessment.risks.length} active risks
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
                      {risk.level}
                    </span>
                  </div>
                  <div className="mt-2 text-xs leading-6 text-[var(--workspace-text-muted)]">
                    Mitigation: {risk.mitigation}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-4 text-sm text-[var(--workspace-text-subtle)]">
            Decision support data will appear once an execution plan is
            generated.
          </div>
        )}
      </WorkspacePanel>
    </WorkspacePageShell>
  );
}
