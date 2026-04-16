import type { StrategicCommand } from "@shared/nl-command/contracts";

/**
 * Historical command list with clone-to-new-command support.
 *
 * @see Requirements 19.1, 19.2
 */
export interface HistoryPanelProps {
  commands: StrategicCommand[];
  onClone?: (command: StrategicCommand) => void;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  failed: "#dc2626",
  cancelled: "#94a3b8",
  executing: "#3b82f6",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function HistoryPanel({ commands, onClone }: HistoryPanelProps) {
  if (commands.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-stone-400">
        No command history.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {commands.map(cmd => (
        <li
          key={cmd.commandId}
          className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-stone-800">
              {cmd.commandText}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-stone-400">
              <span>{formatDate(cmd.timestamp)}</span>
              <span
                className="font-medium"
                style={{ color: STATUS_COLORS[cmd.status] ?? "#94a3b8" }}
              >
                {cmd.status}
              </span>
              <span>{cmd.priority}</span>
            </div>
          </div>
          {onClone && (
            <button
              onClick={() => onClone(cmd)}
              className="ml-2 shrink-0 rounded-md bg-stone-100 px-2.5 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-200"
            >
              Clone
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
