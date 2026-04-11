import { ArrowRight, FolderKanban, Layers3 } from "lucide-react";
import { useLocation } from "wouter";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function CommandCenterPage(
  props: { className?: string } & Record<string, unknown>
) {
  const { className } = props;
  const [, setLocation] = useLocation();

  return (
    <div
      className={cn(
        "min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.1),transparent_26%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.1),transparent_22%),linear-gradient(180deg,#fffdf8,#f3ecdf)] text-stone-900",
        className
      )}
    >
      <div className="mx-auto flex min-h-screen max-w-[1120px] items-center px-4 py-6 md:px-6">
        <div className="w-full rounded-[32px] border border-stone-200/80 bg-white/82 p-6 shadow-[0_24px_70px_rgba(112,84,51,0.12)] backdrop-blur md:p-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-stone-500">
            Compatibility Entry
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">
            Command Center has moved into Tasks
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-600">
            Command entry, plan summary, task list, execution progress, and
            operator intervention now live together in `/tasks`. This page stays
            as a compatibility entry so older links can transition safely.
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-[24px] border border-stone-200/80 bg-stone-50/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                <FolderKanban className="size-4 text-amber-600" />
                New Primary Path
              </div>
              <div className="mt-2 text-sm leading-6 text-stone-600">
                Issue commands directly on the first screen of Tasks, then
                continue observation and intervention in the same queue and
                detail layout.
              </div>
            </div>

            <div className="rounded-[24px] border border-stone-200/80 bg-stone-50/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                <Layers3 className="size-4 text-sky-600" />
                Migration Note
              </div>
              <div className="mt-2 text-sm leading-6 text-stone-600">
                If you arrived here from older navigation or a bookmark, jump to
                `/tasks` to continue the main flow without losing the task
                context.
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              type="button"
              className="rounded-full bg-[#d07a4f] text-white hover:bg-[#c26d42]"
              onClick={() => setLocation("/tasks")}
            >
              <ArrowRight className="size-4" />
              Open Task Hub
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-stone-200 bg-white/80"
              onClick={() => setLocation("/tasks?new=1")}
            >
              Create Mission
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
