import { useEffect, useRef } from "react";
import { FolderKanban, LoaderCircle, Search } from "lucide-react";

import { RetryInlineNotice } from "@/components/tasks/RetryInlineNotice";
import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { workspaceStatusClass } from "@/components/workspace/workspace-tone";
import { useI18n } from "@/i18n";
import type { MissionTaskSummary } from "@/lib/tasks-store";
import { localizeTaskHubBriefText } from "@/lib/task-hub-copy";
import { cn } from "@/lib/utils";

import {
  compactText,
  formatTaskRelative,
  missionOperatorStateLabel,
  missionOperatorStateTone,
  missionStatusLabel,
  missionStatusTone,
} from "./task-helpers";

export function TasksQueueRail({
  tasks,
  totalCount,
  activeTaskId,
  highlightedTaskId,
  loading,
  ready,
  error,
  search,
  onSearchChange,
  onSelectTask,
  onRefresh,
  density = "regular",
  className,
}: {
  tasks: MissionTaskSummary[];
  totalCount: number;
  activeTaskId: string | null;
  highlightedTaskId?: string | null;
  loading: boolean;
  ready: boolean;
  error: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelectTask: (taskId: string) => void;
  onRefresh: () => void;
  density?: "regular" | "compact";
  className?: string;
}) {
  const { locale, copy } = useI18n();
  const taskButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const isCompact = density === "compact";

  useEffect(() => {
    if (!highlightedTaskId) {
      return;
    }

    const button = taskButtonRefs.current.get(highlightedTaskId);
    if (button) {
      button.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightedTaskId, tasks]);

  return (
    <aside
      className={cn(
        "workspace-panel workspace-panel-strong flex min-h-0 flex-col overflow-hidden rounded-[30px]",
        className
      )}
    >
      <div
        className={cn(
          "shrink-0 border-b border-stone-200/80",
          isCompact ? "px-3.5 py-3.5" : "px-4 py-4"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
              {copy.tasks.listPage.queueTitle}
            </div>
            <div
              className={cn(
                "mt-1 font-semibold text-[var(--workspace-text-strong)]",
                isCompact ? "text-[13px]" : "text-sm"
              )}
            >
              {copy.tasks.listPage.visibleCount(tasks.length, totalCount)}
            </div>
          </div>
          {loading && !ready ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-stone-500" />
          ) : null}
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder={copy.tasks.listPage.searchPlaceholder}
            className={cn(
              "workspace-control rounded-full border-none pl-10",
              isCompact ? "h-10 text-sm" : "h-11"
            )}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn(
            "px-3",
            isCompact ? "space-y-2 py-2.5" : "space-y-2.5 py-3"
          )}
        >
          {error ? (
            <RetryInlineNotice
              title={copy.chat.errorTitle}
              description={error}
              actionLabel={copy.tasks.listPage.refresh}
              onRetry={onRefresh}
            />
          ) : null}

          {!error && tasks.length === 0 && !loading ? (
            <EmptyHintBlock
              icon={<FolderKanban className="size-5" />}
              title={copy.tasks.listPage.emptyTitle}
              description={copy.tasks.listPage.emptyDescription}
              hint={copy.tasks.listPage.searchPlaceholder}
              tone="info"
            />
          ) : null}

          {tasks.map(task => {
            const active = task.id === activeTaskId;
            const summary = compactText(
              localizeTaskHubBriefText(task.summary || task.sourceText, locale),
              isCompact ? 74 : 108
            );

            return (
              <button
                key={task.id}
                type="button"
                ref={node => {
                  if (node) {
                    taskButtonRefs.current.set(task.id, node);
                    return;
                  }

                  taskButtonRefs.current.delete(task.id);
                }}
                className={cn(
                  "w-full border text-left transition-all",
                  isCompact
                    ? "rounded-[18px] px-3 py-2.5"
                    : "rounded-[24px] px-3.5 py-3",
                  active
                    ? isCompact
                      ? "border-[rgba(201,130,87,0.34)] bg-[rgba(255,247,234,0.95)] shadow-[0_10px_24px_rgba(164,113,29,0.1)]"
                      : "border-[rgba(201,130,87,0.34)] bg-[linear-gradient(180deg,rgba(255,248,234,0.98),rgba(255,241,220,0.94))] shadow-[0_16px_40px_rgba(164,113,29,0.14)]"
                    : "border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.58)] hover:border-[rgba(151,120,90,0.3)] hover:bg-[rgba(255,255,255,0.76)]",
                  task.id === highlightedTaskId &&
                    "ring-2 ring-amber-300 ring-offset-2 ring-offset-[#fff7eb]"
                )}
                onClick={() => onSelectTask(task.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5">
                      <span
                        className={cn(
                          "workspace-status px-2.5 py-1 text-[10px] font-semibold",
                          missionStatusTone(task.status)
                        )}
                      >
                        {missionStatusLabel(task.status, locale)}
                      </span>
                      {task.operatorState !== "active" ? (
                        <span
                          className={cn(
                            "workspace-status px-2.5 py-1 text-[10px] font-semibold",
                            missionOperatorStateTone(task.operatorState)
                          )}
                        >
                          {missionOperatorStateLabel(
                            task.operatorState,
                            locale
                          )}
                        </span>
                      ) : null}
                      {task.hasWarnings ? (
                        <span
                          className={workspaceStatusClass(
                            "warning",
                            "px-2.5 py-1 text-[10px] font-semibold"
                          )}
                        >
                          {copy.tasks.listPage.warnings}
                        </span>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        "mt-2 line-clamp-2 font-semibold leading-5 text-stone-900",
                        isCompact ? "text-[13px]" : "text-sm"
                      )}
                    >
                      {task.title}
                    </div>
                  </div>
                  {!isCompact ? (
                    <div className="shrink-0 text-right">
                      <div
                        className={cn(
                          "font-semibold text-stone-700",
                          isCompact ? "text-[13px]" : "text-sm"
                        )}
                      >
                        {task.progress}%
                      </div>
                      <div className="mt-1 text-[11px] text-stone-500">
                        {formatTaskRelative(task.updatedAt, locale)}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div
                  className={cn(
                    "text-stone-500",
                    isCompact ? "mt-1.5 text-[11px] leading-5" : "mt-2 text-xs leading-5"
                  )}
                >
                  {compactText(
                    task.currentStageLabel || copy.tasks.listPage.noStage,
                    isCompact ? 28 : 34
                  )}
                  {task.waitingFor
                    ? ` / ${compactText(task.waitingFor, isCompact ? 18 : 28)}`
                    : ""}
                </div>

                {isCompact ? (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200/80">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width]",
                          task.hasWarnings
                            ? "bg-[linear-gradient(90deg,#d39b50,#c98257)]"
                            : active
                              ? "bg-[linear-gradient(90deg,#c98257,#b86f45)]"
                              : "bg-[linear-gradient(90deg,#7ea38d,#5e8b72)]"
                        )}
                        style={{ width: `${Math.max(4, task.progress)}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-semibold text-stone-600">
                      {task.progress}%
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 text-[13px] leading-5 text-stone-600">
                    {summary || copy.tasks.detailView.noDetail}
                  </div>
                )}

                <div
                  className={cn(
                    "mt-2.5 flex flex-wrap gap-1.5 text-[11px] text-stone-500",
                    isCompact && "items-center"
                  )}
                >
                  <span
                    className={workspaceStatusClass(
                      "neutral",
                      "px-2 py-1 text-[10px] font-medium"
                    )}
                  >
                    {copy.tasks.listPage.tasksCount(task.taskCount)}
                  </span>
                  {!isCompact ? (
                    <>
                      <span
                        className={workspaceStatusClass(
                          "neutral",
                          "px-2 py-1 text-[10px] font-medium"
                        )}
                      >
                        {copy.tasks.listPage.messagesCount(task.messageCount)}
                      </span>
                      <span
                        className={workspaceStatusClass(
                          "neutral",
                          "px-2 py-1 text-[10px] font-medium"
                        )}
                      >
                        {copy.tasks.listPage.attachmentsCount(
                          task.attachmentCount
                        )}
                      </span>
                    </>
                  ) : null}
                  {task.attempt > 1 ? (
                    <span
                      className={workspaceStatusClass(
                        "neutral",
                        "px-2 py-1 text-[10px] font-medium"
                      )}
                    >
                      {copy.tasks.listPage.attemptCount(task.attempt)}
                    </span>
                  ) : null}
                  {isCompact ? (
                    <span className="ml-auto text-[10px] text-stone-400">
                      {formatTaskRelative(task.updatedAt, locale)}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}
