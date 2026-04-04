/**
 * ExecutorTerminalPanel — lightweight terminal panel for the Mission detail
 * Execution tab. Listens to the sandbox store for real-time log lines
 * streamed via Socket.IO (job.log_stream events) and renders them with
 * stdout/stderr distinction.
 *
 * Unlike the 3D SandboxMonitor (which uses xterm.js), this panel uses a
 * simple scrollable <pre> to avoid heavy dependencies in the detail view.
 *
 * @see Requirements 5.4
 */

import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";

import { useSandboxStore, type LogLine } from "@/lib/sandbox-store";
import { cn } from "@/lib/utils";

export interface ExecutorTerminalPanelProps {
  missionId: string;
}

const MAX_VISIBLE_LINES = 200;

function formatLine(line: LogLine): { text: string; isError: boolean } {
  return {
    text: line.data,
    isError: line.stream === "stderr",
  };
}

export function ExecutorTerminalPanel({ missionId }: ExecutorTerminalPanelProps) {
  const logLines = useSandboxStore((s) => s.logLines);
  const activeMissionId = useSandboxStore((s) => s.activeMissionId);
  const isStreaming = useSandboxStore((s) => s.isStreaming);
  const setActiveMission = useSandboxStore((s) => s.setActiveMission);
  const scrollRef = useRef<HTMLPreElement>(null);

  // Activate this mission in the sandbox store so it receives log events
  useEffect(() => {
    if (missionId && activeMissionId !== missionId) {
      setActiveMission(missionId);
    }
  }, [missionId, activeMissionId, setActiveMission]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logLines.length]);

  const visibleLines = logLines.slice(-MAX_VISIBLE_LINES);
  const hasLines = visibleLines.length > 0;

  return (
    <div
      className="rounded-[20px] border border-stone-200/80 bg-[#1a1a2e] overflow-hidden"
      data-testid="executor-terminal-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-700/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-stone-400" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Execution Log
          </span>
        </div>
        {isStreaming && (
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
            Live
          </span>
        )}
      </div>

      {/* Log output */}
      <pre
        ref={scrollRef}
        className="h-[200px] overflow-auto px-3 py-2 font-mono text-xs leading-5"
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
                  isError ? "text-rose-400" : "text-stone-300",
                )}
              >
                {text}
              </div>
            );
          })
        ) : (
          <div className="flex h-full items-center justify-center text-stone-500">
            等待执行日志...
          </div>
        )}
      </pre>
    </div>
  );
}
