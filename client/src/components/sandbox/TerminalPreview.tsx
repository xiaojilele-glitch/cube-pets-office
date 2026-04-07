/**
 * TerminalPreview — xterm.js based terminal component for sandbox log output.
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.5, 4.6
 */

import { useEffect, useRef, memo } from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { formatLogLine, type LogLine } from "../../lib/sandbox-store";

export interface TerminalPreviewProps {
  logLines: LogLine[];
  isStreaming: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

const SCROLLBACK = 500;

function TerminalPreviewInner({
  logLines,
  isStreaming,
  fullscreen,
  onToggleFullscreen,
}: TerminalPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const writtenCountRef = useRef(0);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      scrollback: SCROLLBACK,
      fontSize: 12,
      fontFamily: "monospace",
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
      },
      convertEol: true,
      disableStdin: true,
    });

    term.open(containerRef.current);
    termRef.current = term;
    writtenCountRef.current = 0;

    return () => {
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Write new log lines
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const start = writtenCountRef.current;
    for (let i = start; i < logLines.length; i++) {
      term.writeln(formatLogLine(logLines[i]));
    }
    writtenCountRef.current = logLines.length;

    // Auto-scroll to bottom
    term.scrollToBottom();
  }, [logLines]);

  // Reset when logLines is cleared (new mission)
  useEffect(() => {
    if (logLines.length === 0 && termRef.current) {
      termRef.current.clear();
      writtenCountRef.current = 0;
    }
  }, [logLines.length === 0]);

  const containerStyle: React.CSSProperties = fullscreen
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "linear-gradient(180deg, #111827, #0f172a)",
        padding: 16,
      }
    : {
        width: "100%",
        height: "100%",
        position: "relative",
        background: "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(30,41,59,0.98))",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(148, 163, 184, 0.18)",
        boxShadow: "0 12px 30px rgba(15, 23, 42, 0.24)",
      };

  return (
    <div style={containerStyle} data-testid="terminal-preview">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          height: 28,
          padding: "0 10px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
          color: "#cbd5e1",
          background: "rgba(15,23,42,0.78)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: "#fb7185" }} />
          <span style={{ width: 8, height: 8, borderRadius: 999, background: "#f59e0b" }} />
          <span style={{ width: 8, height: 8, borderRadius: 999, background: "#34d399" }} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8" }}>
          执行终端
        </span>
      </div>

      {!isStreaming && (
        <div
          data-testid="terminal-idle"
          style={{
            position: "absolute",
            inset: 28,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            fontSize: 13,
            zIndex: 1,
            pointerEvents: "none",
            textAlign: "center",
            gap: 6,
          }}
        >
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>等待执行</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>运行任务后，这里会显示实时日志</span>
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "calc(100% - 28px)" }} />

      <button
        data-testid="terminal-fullscreen-btn"
        onClick={onToggleFullscreen}
        style={{
          position: "absolute",
          top: 4,
          right: 6,
          background: "rgba(51,65,85,0.55)",
          border: "none",
          color: "#e2e8f0",
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 6,
          fontSize: 12,
          zIndex: 2,
        }}
        aria-label={fullscreen ? "退出全屏" : "全屏"}
      >
        {fullscreen ? "✕" : "⛶"}
      </button>
    </div>
  );
}

export const TerminalPreview = memo(TerminalPreviewInner);
