import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";

import { TaskDetailView } from "@/components/tasks/TaskDetailView";
import { Button } from "@/components/ui/button";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";

export default function TaskDetailPage({
  taskId = null,
  onBack,
  className,
}: {
  taskId?: string | null;
  onBack?: () => void;
  className?: string;
}) {
  const ensureReady = useTasksStore(state => state.ensureReady);
  const selectTask = useTasksStore(state => state.selectTask);
  const setDecisionNote = useTasksStore(state => state.setDecisionNote);
  const launchDecision = useTasksStore(state => state.launchDecision);
  const detailsById = useTasksStore(state => state.detailsById);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const decisionNotes = useTasksStore(state => state.decisionNotes);
  const loading = useTasksStore(state => state.loading);
  const [launchingPresetId, setLaunchingPresetId] = useState<string | null>(
    null
  );

  useEffect(() => {
    void ensureReady();
  }, [ensureReady]);

  useEffect(() => {
    if (taskId) {
      selectTask(taskId);
    }
  }, [selectTask, taskId]);

  const activeTaskId = taskId || selectedTaskId;
  const detail = activeTaskId ? detailsById[activeTaskId] || null : null;
  const decisionNote = activeTaskId ? decisionNotes[activeTaskId] || "" : "";

  async function handleLaunchDecision(presetId: string) {
    if (!activeTaskId) return;
    setLaunchingPresetId(presetId);
    try {
      await launchDecision(activeTaskId, presetId);
    } finally {
      setLaunchingPresetId(null);
    }
  }

  return (
    <div
      className={cn(
        "min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.1),transparent_26%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.1),transparent_22%),linear-gradient(180deg,#fffdf8,#f3ecdf)] px-4 py-4 md:px-6",
        className
      )}
    >
      <div className="mx-auto max-w-[1580px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-stone-200/80 bg-white/80 px-5 py-4 shadow-[0_20px_60px_rgba(112,84,51,0.08)] backdrop-blur">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">
              Mission Detail
            </div>
            <div className="mt-1 text-sm text-stone-600">
              Standalone detail shell for Worktree F route integration.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loading && !detail ? (
              <LoaderCircle className="size-4 animate-spin text-stone-500" />
            ) : null}
            {onBack ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-stone-200 bg-white/80"
                onClick={onBack}
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>
            ) : null}
          </div>
        </div>

        <TaskDetailView
          detail={detail}
          decisionNote={decisionNote}
          onDecisionNoteChange={value => {
            if (!activeTaskId) return;
            setDecisionNote(activeTaskId, value);
          }}
          onLaunchDecision={handleLaunchDecision}
          launchingPresetId={launchingPresetId}
        />
      </div>
    </div>
  );
}
