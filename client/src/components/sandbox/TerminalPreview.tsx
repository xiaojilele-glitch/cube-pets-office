/**
 * TerminalPreview - xterm.js based terminal component for sandbox log output.
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.5, 4.6
 */

import { memo, useEffect, useRef } from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

import { useI18n } from "@/i18n";

import { formatLogLine, type LogLine } from "../../lib/sandbox-store";

export interface TerminalPreviewProps {
  logLines: LogLine[];
  isStreaming: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  embedded?: boolean;
}

const SCROLLBACK = 500;

function TerminalPreviewInner({
  logLines,
  isStreaming,
  fullscreen,
  onToggleFullscreen,
  embedded = false,
}: TerminalPreviewProps) {
  const { locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const writtenCountRef = useRef(0);
  const compactFrame = embedded && !fullscreen;
  const headerHeight = compactFrame ? 24 : 28;

  const previewTitle = locale === "zh-CN" ? "执行终端" : "Execution terminal";
  const idleTitle = locale === "zh-CN" ? "等待执行" : "Waiting for run";
  const idleDescription =
    locale === "zh-CN"
      ? "任务开始后，这里会持续写入实时日志"
      : "Live logs will stream here once the run starts.";
  const fullscreenLabel =
    locale === "zh-CN"
      ? fullscreen
        ? "退出全屏"
        : "切换全屏"
      : fullscreen
        ? "Exit fullscreen"
        : "Toggle fullscreen";

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      scrollback: SCROLLBACK,
      fontSize: compactFrame ? 11 : 12,
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
  }, [compactFrame]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const start = writtenCountRef.current;
    for (let i = start; i < logLines.length; i += 1) {
      term.writeln(formatLogLine(logLines[i]));
    }
    writtenCountRef.current = logLines.length;
    term.scrollToBottom();
  }, [logLines]);

  useEffect(() => {
    if (logLines.length === 0 && termRef.current) {
      termRef.current.clear();
      writtenCountRef.current = 0;
    }
  }, [logLines.length]);

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
        background: compactFrame
          ? "linear-gradient(180deg, rgba(7,10,18,0.96), rgba(18,25,38,0.98))"
          : "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(30,41,59,0.98))",
        borderRadius: compactFrame ? 10 : 12,
        overflow: "hidden",
        border: compactFrame
          ? "1px solid rgba(148, 163, 184, 0.12)"
          : "1px solid rgba(148, 163, 184, 0.18)",
        boxShadow: compactFrame
          ? "inset 0 1px 0 rgba(255,255,255,0.04)"
          : "0 12px 30px rgba(15, 23, 42, 0.24)",
      };

  return (
    <div style={containerStyle} data-testid="terminal-preview">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          height: headerHeight,
          padding: compactFrame ? "0 8px" : "0 10px",
          borderBottom: compactFrame
            ? "1px solid rgba(148, 163, 184, 0.1)"
            : "1px solid rgba(148, 163, 184, 0.14)",
          color: "#cbd5e1",
          background: compactFrame
            ? "rgba(6,10,18,0.84)"
            : "rgba(15,23,42,0.78)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{ width: 8, height: 8, borderRadius: 999, background: "#fb7185" }}
          />
          <span
            style={{ width: 8, height: 8, borderRadius: 999, background: "#f59e0b" }}
          />
          <span
            style={{ width: 8, height: 8, borderRadius: 999, background: "#34d399" }}
          />
        </div>
        <span
          style={{
            fontSize: compactFrame ? 9 : 10,
            fontWeight: 600,
            letterSpacing: compactFrame ? "0.08em" : "0.12em",
            textTransform: locale === "zh-CN" ? "none" : "uppercase",
            color: "#94a3b8",
          }}
        >
          {previewTitle}
        </span>
      </div>

      {!isStreaming && (
        <div
          data-testid="terminal-idle"
          style={{
            position: "absolute",
            inset: headerHeight,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            fontSize: compactFrame ? 12 : 13,
            zIndex: 1,
            pointerEvents: "none",
            textAlign: "center",
            gap: compactFrame ? 4 : 6,
            padding: "0 10px",
          }}
        >
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{idleTitle}</span>
          <span style={{ fontSize: compactFrame ? 10 : 11, color: "#94a3b8" }}>
            {idleDescription}
          </span>
        </div>
      )}

      <div
        ref={containerRef}
        style={{ width: "100%", height: `calc(100% - ${headerHeight}px)` }}
      />

      <button
        data-testid="terminal-fullscreen-btn"
        onClick={onToggleFullscreen}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          background: compactFrame
            ? "rgba(30,41,59,0.56)"
            : "rgba(51,65,85,0.55)",
          border: compactFrame
            ? "1px solid rgba(148, 163, 184, 0.14)"
            : "none",
          color: "#e2e8f0",
          cursor: "pointer",
          padding: compactFrame ? "1px 6px" : "2px 6px",
          borderRadius: 6,
          fontSize: compactFrame ? 10 : 12,
          lineHeight: 1.2,
          zIndex: 2,
        }}
        aria-label={fullscreenLabel}
      >
        {fullscreen ? "x" : "[ ]"}
      </button>
    </div>
  );
}

export const TerminalPreview = memo(TerminalPreviewInner);
