import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { useI18n } from "@/i18n";
import { useSandboxStore, type LogLine } from "@/lib/sandbox-store";
import { cn } from "@/lib/utils";

export interface ExecutorTerminalPanelProps {
  missionId: string;
  missionStatus?: string;
  executorStatus?: string;
}

const MAX_VISIBLE_LINES = 200;

function formatLine(line: LogLine): { text: string; isError: boolean } {
  return {
    text: line.data,
    isError: line.stream === "stderr",
  };
}

function isExecutorUnavailable(status?: string): boolean {
  const normalized = status?.toLowerCase() ?? "";
  return (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("unreach") ||
    normalized.includes("disconnect")
  );
}

export function ExecutorTerminalPanel({
  missionId,
  missionStatus,
  executorStatus,
}: ExecutorTerminalPanelProps) {
  const { copy } = useI18n();
  const logLines = useSandboxStore(s => s.logLines);
  const activeMissionId = useSandboxStore(s => s.activeMissionId);
  const isStreaming = useSandboxStore(s => s.isStreaming);
  const setActiveMission = useSandboxStore(s => s.setActiveMission);
  const requestLogHistory = useSandboxStore(s => s.requestLogHistory);
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!missionId) {
      return;
    }

    if (activeMissionId !== missionId) {
      setActiveMission(missionId);
      return;
    }

    requestLogHistory(missionId);
  }, [missionId, activeMissionId, requestLogHistory, setActiveMission]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logLines.length]);

  const visibleLines = logLines.slice(-MAX_VISIBLE_LINES);
  const hasLines = visibleLines.length > 0;
  const unavailable = isExecutorUnavailable(executorStatus);
  const emptyDescription =
    unavailable || missionStatus === "failed"
      ? copy.tasks.executor.unavailableLogsDescription
      : copy.tasks.executor.emptyLogsDescription;
  const emptyTone =
    missionStatus === "queued" || missionStatus === "waiting"
      ? "neutral"
      : unavailable
        ? "warning"
        : "info";

  return (
    <div
      className="overflow-hidden rounded-[20px] border border-stone-200/80 bg-[#1a1a2e]"
      data-testid="executor-terminal-panel"
    >
      <div className="flex items-center justify-between border-b border-stone-700/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-stone-400" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            {copy.tasks.executor.terminalTitle}
          </span>
        </div>
        {isStreaming ? (
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
            {copy.tasks.executor.terminalLive}
          </span>
        ) : null}
      </div>

      <pre
        ref={scrollRef}
        className={cn(
          "h-[200px] overflow-auto px-3 py-2 font-mono text-xs leading-5",
          !hasLines && "flex items-center"
        )}
        data-testid="executor-terminal-output"
      >
        {hasLines ? (
          visibleLines.map((line, idx) => {
            const { text, isError } = formatLine(line);
            return (
              <div
                key={idx}
                className={cn(
                  "whitespace-pre-wrap break-all",
                  isError ? "text-rose-400" : "text-stone-300"
                )}
              >
                {text}
              </div>
            );
          })
        ) : (
          <EmptyHintBlock
            icon={<Terminal className="size-4" />}
            title={copy.tasks.executor.emptyLogsTitle}
            description={emptyDescription}
            actionLabel={copy.tasks.executor.retryLogs}
            onAction={() => requestLogHistory(missionId)}
            tone={emptyTone}
            className="w-full border-stone-700/60 bg-stone-950/25 text-left"
          />
        )}
      </pre>
    </div>
  );
}
