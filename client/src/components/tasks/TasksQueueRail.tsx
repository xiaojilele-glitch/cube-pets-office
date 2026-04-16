import { useEffect, useRef } from "react";
import { FolderKanban, LoaderCircle, Search } from "lucide-react";

import { RetryInlineNotice } from "@/components/tasks/RetryInlineNotice";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
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
        "workspace-panel flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-white/30 bg-[linear-gradient(180deg,rgba(255,252,248,0.35),rgba(246,238,229,0.25))] backdrop-blur-md transition-all hover:bg-[linear-gradient(180deg,rgba(255,252,248,0.58),rgba(246,238,229,0.48))]",
        className
      )}
    >
      <div
        className={cn(
          "shrink-0 border-b border-stone-200/80",
          isCompact ? "px-2.5 py-2.5" : "px-3 py-3"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              {copy.tasks.listPage.queueTitle}
            </div>
            <div
              className={cn(
                "mt-0.5 font-semibold text-[var(--workspace-text-strong)]",
                isCompact ? "text-[11px]" : "text-[12px]"
              )}
            >
              {copy.tasks.listPage.visibleCount(tasks.length, totalCount)}
            </div>
          </div>
          {loading && !ready ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-stone-500" />
          ) : null}
        </div>

        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
          <Input
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder={copy.tasks.listPage.searchPlaceholder}
            className={cn(
              "workspace-control rounded-full border-none pl-8",
              isCompact ? "h-8 text-[11px]" : "h-9 text-xs"
            )}
          />
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2"
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        <div
          className={cn(isCompact ? "space-y-1.5 pt-1.5" : "space-y-2 pt-2.5")}
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
            <div className="flex flex-col items-center justify-center p-4 text-center text-stone-500">
              <FolderKanban className="size-5 mb-2 opacity-50" />
              <div className="text-xs font-medium">
                {copy.tasks.listPage.emptyTitle}
              </div>
            </div>
          ) : null}

          <TooltipProvider delayDuration={300}>
            {tasks.map(task => {
              const active = task.id === activeTaskId;
              const summary = localizeTaskHubBriefText(
                task.summary || task.sourceText,
                locale
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
                    "w-full overflow-hidden border text-left transition-all flex flex-col gap-1.5",
                    isCompact
                      ? "rounded-[10px] px-2.5 py-1.5"
                      : "rounded-[12px] px-2.5 py-1.75",
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
                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                    <span
                      className={cn(
                        "shrink-0 workspace-status !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold",
                        missionStatusTone(task.status)
                      )}
                    >
                      {missionStatusLabel(task.status, locale)}
                    </span>
                    <span
                      className={cn(
                        "max-w-[56px] shrink-0 truncate text-right font-data font-medium text-[var(--workspace-text-subtle)]",
                        isCompact ? "text-[8px]" : "text-[9px]"
                      )}
                    >
                      {formatTaskRelative(task.updatedAt, locale)}
                    </span>
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "w-full overflow-hidden text-ellipsis whitespace-nowrap block text-left font-semibold text-[var(--workspace-text-strong)]",
                          isCompact ? "text-[10px]" : "text-[11px]"
                        )}
                      >
                        {task.title}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      align="start"
                      className="max-w-[260px] text-xs z-[100] ml-2 break-words"
                    >
                      {task.title}
                    </TooltipContent>
                  </Tooltip>

                  {!isCompact ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "w-full overflow-hidden text-ellipsis whitespace-nowrap block text-left font-medium text-[var(--workspace-text-muted)]",
                            "text-[10px]"
                          )}
                        >
                          {summary}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        align="start"
                        className="max-w-[260px] text-xs z-[100] ml-2 break-words"
                      >
                        {summary}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}

                  {isCompact ? (
                    <div className="flex w-full items-center gap-1.5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200/80">
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
                      <span className="shrink-0 text-[8px] font-semibold text-stone-600">
                        {task.progress}%
                      </span>
                    </div>
                  ) : null}

                  {!isCompact ? (
                    <div className="flex w-full flex-wrap gap-1">
                      <span
                        className={workspaceStatusClass(
                          "neutral",
                          "!gap-0.5 !px-1 !py-0.5 !text-[8px] font-medium"
                        )}
                      >
                        {copy.tasks.listPage.tasksCount(task.taskCount)}
                      </span>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </TooltipProvider>
        </div>
      </div>
    </aside>
  );
}
