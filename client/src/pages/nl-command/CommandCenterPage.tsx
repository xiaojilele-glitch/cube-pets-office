import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";

import { CommandInput } from "@/components/nl-command/CommandInput";
import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { Button } from "@/components/ui/button";
import { useNLCommandStore } from "@/lib/nl-command-store";
import { cn } from "@/lib/utils";

/**
 * NL Command Center main page.
 *
 * Four-zone layout:
 *  1. Command input area (top)
 *  2. Plan display area (left)
 *  3. Real-time monitoring area (right)
 *  4. Decision support area (bottom)
 *
 * Supports full-screen mode and multi-panel layout.
 *
 * @see Requirements 18.1, 18.6
 */
export default function CommandCenterPage({
  className,
}: {
  className?: string;
}) {
  const [fullscreen, setFullscreen] = useState(false);

  const loading = useNLCommandStore(s => s.loading);
  const error = useNLCommandStore(s => s.error);
  const currentCommand = useNLCommandStore(s => s.currentCommand);
  const currentDialog = useNLCommandStore(s => s.currentDialog);
  const currentPlan = useNLCommandStore(s => s.currentPlan);
  const alerts = useNLCommandStore(s => s.alerts);
  const dashboard = useNLCommandStore(s => s.dashboard);
  const commands = useNLCommandStore(s => s.commands);
  const clearError = useNLCommandStore(s => s.clearError);
  const submitCommand = useNLCommandStore(s => s.submitCommand);
  const submitClarification = useNLCommandStore(s => s.submitClarification);
  const loadDashboard = useNLCommandStore(s => s.loadDashboard);
  const loadCommands = useNLCommandStore(s => s.loadCommands);

  useEffect(() => {
    void loadDashboard();
    void loadCommands();
  }, [loadDashboard, loadCommands]);

  const toggleFullscreen = useCallback(() => setFullscreen(f => !f), []);

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

  return (
    <div
      className={cn(
        "flex flex-col bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.08),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.08),transparent_22%),linear-gradient(180deg,#fafbff,#f0f1f8)] text-stone-900",
        fullscreen
          ? "fixed inset-0 z-50"
          : "min-h-screen pb-28 pt-[calc(env(safe-area-inset-top)+96px)] md:pb-36 md:pt-0",
        className
      )}
    >
      <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col px-3 py-3 md:px-5 md:py-4">
        {/* Header */}
        <header className="shrink-0 rounded-2xl border border-stone-200/80 bg-white/75 px-4 py-3 shadow-sm backdrop-blur md:px-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-stone-500">
                NL Command Center
              </div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-stone-900 md:text-2xl">
                Strategic Command Center
              </h1>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-stone-200 bg-white/80"
                onClick={() => {
                  void loadDashboard();
                  void loadCommands();
                }}
              >
                <RefreshCw className="size-4" />
                Refresh
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-stone-200 bg-white/80"
                onClick={toggleFullscreen}
              >
                {fullscreen ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
                {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </Button>
            </div>
          </div>
        </header>

        {/* Error banner */}
        {error && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-2 text-sm text-rose-800">
            <span>{error}</span>
            <button
              type="button"
              className="ml-3 text-rose-600 underline"
              onClick={clearError}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Zone 1: Command Input */}
        <section className="mt-3 shrink-0 rounded-2xl border border-stone-200/80 bg-white/78 p-4 shadow-sm backdrop-blur">
          <CommandInput
            onSubmit={handleSubmitCommand}
            loading={loading}
            commandHistory={commands.map(c => c.commandText)}
          />
          {currentDialog && currentDialog.status === "active" && (
            <div className="mt-3">
              <ClarificationPanel
                dialog={currentDialog}
                onAnswer={handleClarificationAnswer}
              />
            </div>
          )}
        </section>

        {/* Multi-panel layout: Plan | Monitoring | Decision Support */}
        <div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
          {/* Zone 2: Plan Display */}
          <section className="flex flex-col rounded-2xl border border-stone-200/80 bg-white/78 p-4 shadow-sm backdrop-blur">
            <h2 className="mb-3 text-sm font-semibold text-stone-700">
              Execution Plan
            </h2>
            {currentPlan ? (
              <div className="flex-1 space-y-2 overflow-auto text-sm text-stone-600">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {currentPlan.status}
                  </span>
                  <span className="text-xs text-stone-400">
                    Plan {currentPlan.planId}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Missions:</span>{" "}
                  {currentPlan.missions.length}
                </div>
                <div>
                  <span className="font-medium">Tasks:</span>{" "}
                  {currentPlan.tasks.length}
                </div>
                {currentPlan.timeline && (
                  <div>
                    <span className="font-medium">Timeline:</span>{" "}
                    {currentPlan.timeline.startDate} →{" "}
                    {currentPlan.timeline.endDate}
                  </div>
                )}
                {currentPlan.costBudget && (
                  <div>
                    <span className="font-medium">Budget:</span>{" "}
                    {currentPlan.costBudget.totalBudget}{" "}
                    {currentPlan.costBudget.currency}
                  </div>
                )}
                {currentPlan.riskAssessment && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Risk:</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        currentPlan.riskAssessment.overallRiskLevel ===
                          "critical"
                          ? "bg-red-100 text-red-700"
                          : currentPlan.riskAssessment.overallRiskLevel ===
                              "high"
                            ? "bg-orange-100 text-orange-700"
                            : currentPlan.riskAssessment.overallRiskLevel ===
                                "medium"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-green-100 text-green-700"
                      )}
                    >
                      {currentPlan.riskAssessment.overallRiskLevel}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-stone-400">
                No execution plan yet. Submit a command to generate one.
              </div>
            )}
          </section>

          {/* Zone 3: Real-time Monitoring */}
          <section className="flex flex-col rounded-2xl border border-stone-200/80 bg-white/78 p-4 shadow-sm backdrop-blur">
            <h2 className="mb-3 text-sm font-semibold text-stone-700">
              Real-time Monitoring
            </h2>
            {dashboard ? (
              <div className="flex-1 space-y-3 overflow-auto text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-stone-100 bg-stone-50/60 p-3">
                    <div className="text-xs text-stone-400">
                      Active Commands
                    </div>
                    <div className="mt-1 text-lg font-semibold text-stone-800">
                      {dashboard.activeCommands}
                    </div>
                  </div>
                  <div className="rounded-xl border border-stone-100 bg-stone-50/60 p-3">
                    <div className="text-xs text-stone-400">Total Missions</div>
                    <div className="mt-1 text-lg font-semibold text-stone-800">
                      {dashboard.totalMissions}
                    </div>
                  </div>
                </div>
                {alerts.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-xs font-medium text-stone-500">
                      Recent Alerts
                    </h3>
                    <ul className="space-y-1">
                      {alerts.slice(0, 5).map(alert => (
                        <li
                          key={alert.alertId}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-xs",
                            alert.priority === "critical"
                              ? "border-red-200 bg-red-50 text-red-700"
                              : alert.priority === "warning"
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-blue-200 bg-blue-50 text-blue-700"
                          )}
                        >
                          <span className="font-medium">[{alert.type}]</span>{" "}
                          {alert.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-stone-400">
                {loading
                  ? "Loading dashboard..."
                  : "No monitoring data available."}
              </div>
            )}
          </section>
        </div>

        {/* Zone 4: Decision Support */}
        <section className="mt-3 shrink-0 rounded-2xl border border-stone-200/80 bg-white/78 p-4 shadow-sm backdrop-blur">
          <h2 className="mb-2 text-sm font-semibold text-stone-700">
            Decision Support
          </h2>
          {currentPlan?.riskAssessment ? (
            <div className="space-y-2 text-sm text-stone-600">
              <div>
                <span className="font-medium">Identified Risks:</span>{" "}
                {currentPlan.riskAssessment.risks.length}
              </div>
              <ul className="space-y-1">
                {currentPlan.riskAssessment.risks.slice(0, 3).map(risk => (
                  <li
                    key={risk.id}
                    className="rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2 text-xs"
                  >
                    <span className="font-medium">{risk.description}</span>
                    <span className="ml-2 text-stone-400">
                      Level: {risk.level} | Mitigation: {risk.mitigation}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-sm text-stone-400">
              Decision support data will appear once an execution plan is
              generated.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
