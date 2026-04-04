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
        background: "#1a1a2e",
        padding: 16,
      }
    : {
        width: "100%",
        height: "100%",
        position: "relative",
        background: "#1a1a2e",
        borderRadius: 4,
        overflow: "hidden",
      };

  return (
    <div style={containerStyle} data-testid="terminal-preview">
      {!isStreaming && (
        <div
          data-testid="terminal-idle"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#666",
            fontSize: 14,
            zIndex: 1,
            pointerEvents: "none",
          }}
        >
          等待执行...
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      <button
        data-testid="terminal-fullscreen-btn"
        onClick={onToggleFullscreen}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          background: "rgba(255,255,255,0.1)",
          border: "none",
          color: "#ccc",
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 3,
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
