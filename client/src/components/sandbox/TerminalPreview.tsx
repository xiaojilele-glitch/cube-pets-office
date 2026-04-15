/**
 * TerminalPreview - xterm.js based terminal component for sandbox log output.
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
  onActivate?: () => void;
  showFullscreenButton?: boolean;
  title?: string;
  statusLabel?: string | null;
  variant?: "default" | "wall";
  headerMode?: "default" | "hidden";
}

const SCROLLBACK = 500;

function getWallStatusColor(isStreaming: boolean, statusLabel: string | null) {
  if (isStreaming) {
    return "#34d399";
  }
  if (statusLabel?.toLowerCase().includes("alert")) {
    return "#f87171";
  }
  return "#94a3b8";
}

function TerminalPreviewInner({
  logLines,
  isStreaming,
  fullscreen,
  onToggleFullscreen,
  embedded = false,
  onActivate,
  showFullscreenButton = true,
  title,
  statusLabel = null,
  variant = "default",
  headerMode = "default",
}: TerminalPreviewProps) {
  const { locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const writtenCountRef = useRef(0);
  const wallVariant = variant === "wall";
  const compactFrame = embedded && !fullscreen;
  const headerHidden = headerMode === "hidden" && !fullscreen;
  const headerHeight = headerHidden ? 0 : compactFrame ? 28 : wallVariant ? 28 : 28;
  const showCenteredIdleState =
    !isStreaming && wallVariant && headerHidden && !fullscreen;
  const framelessWallPane = wallVariant && headerHidden && !fullscreen;

  const previewTitle =
    title ||
    (locale === "zh-CN"
      ? wallVariant
        ? "执行流"
        : "执行终端"
      : wallVariant
        ? "Execution Feed"
        : "Execution terminal");
  const idleTitle = locale === "zh-CN" ? "等待执行" : "Waiting for run";
  const idleDescription =
    locale === "zh-CN"
      ? "任务开始后，这里会持续写入实时日志。"
      : "Live logs will stream here once the run starts.";
  const fullscreenLabel =
    locale === "zh-CN"
      ? fullscreen
        ? "退出聚焦"
        : "聚焦执行流"
      : fullscreen
        ? "Close focus"
        : "Focus execution feed";
  const wallStatusColor = getWallStatusColor(isStreaming, statusLabel);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      scrollback: SCROLLBACK,
      fontSize: wallVariant ? 11 : compactFrame ? 11 : 12,
      fontFamily:
        "'IBM Plex Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      theme: {
        background: wallVariant ? "#07111a" : "#1a1a2e",
        foreground: "#d7e1ee",
        cursor: "#e2e8f0",
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
  }, [compactFrame, wallVariant]);

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
        background:
          "linear-gradient(180deg, rgba(4,8,14,0.98), rgba(9,14,21,0.99))",
        padding: 16,
      }
    : {
        width: "100%",
        height: "100%",
        position: "relative",
        background: framelessWallPane
          ? "transparent"
          : wallVariant
            ? "linear-gradient(180deg, rgba(7,12,18,0.98), rgba(11,18,28,0.99))"
            : compactFrame
              ? "linear-gradient(180deg, rgba(7,10,18,0.96), rgba(18,25,38,0.98))"
              : "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(30,41,59,0.98))",
        borderRadius: framelessWallPane ? 12 : compactFrame ? 12 : wallVariant ? 14 : 12,
        overflow: "hidden",
        border: framelessWallPane
          ? "none"
          : wallVariant
            ? "1px solid rgba(71,85,105,0.28)"
            : compactFrame
              ? "1px solid rgba(148, 163, 184, 0.12)"
              : "1px solid rgba(148, 163, 184, 0.18)",
        boxShadow: framelessWallPane
          ? "none"
          : wallVariant
            ? "inset 0 1px 0 rgba(255,255,255,0.02)"
            : compactFrame
              ? "inset 0 1px 0 rgba(255,255,255,0.04)"
              : "0 12px 30px rgba(15, 23, 42, 0.24)",
        cursor: onActivate && !fullscreen ? "pointer" : "default",
      };

  const showControl = fullscreen || showFullscreenButton;

  return (
    <div
      style={containerStyle}
      data-testid="terminal-preview"
      onClick={!fullscreen ? onActivate : undefined}
      role={!fullscreen && onActivate ? "button" : undefined}
      tabIndex={!fullscreen && onActivate ? 0 : undefined}
      onKeyDown={
        !fullscreen && onActivate
          ? event => {
              if (event.key === "Enter" || event.key === " ") {
                onActivate();
              }
            }
          : undefined
      }
    >
      {wallVariant && !fullscreen ? (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(180deg, rgba(255,255,255,0.018) 0px, rgba(255,255,255,0.018) 1px, transparent 1px, transparent 4px)",
              opacity: 0.16,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(52,211,153,0.02), transparent 22%)",
              pointerEvents: "none",
            }}
          />
        </>
      ) : null}

      {headerHidden ? null : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            height: headerHeight,
            padding: compactFrame ? "0 10px" : wallVariant ? "0 10px" : "0 12px",
            borderBottom: wallVariant
              ? "1px solid rgba(71,85,105,0.2)"
              : compactFrame
                ? "1px solid rgba(148, 163, 184, 0.1)"
                : "1px solid rgba(148, 163, 184, 0.14)",
            color: "#cbd5e1",
            background: wallVariant
              ? "linear-gradient(180deg, rgba(6,10,16,0.94), rgba(8,13,20,0.92))"
              : compactFrame
                ? "rgba(6,10,18,0.84)"
                : "rgba(15,23,42,0.78)",
          }}
        >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {wallVariant ? (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: wallStatusColor,
                boxShadow: `0 0 12px ${wallStatusColor}`,
                flexShrink: 0,
              }}
            />
          ) : (
            <>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: "#fb7185",
                }}
              />
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: "#f59e0b",
                }}
              />
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: "#34d399",
                }}
              />
            </>
          )}
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: compactFrame ? 9 : wallVariant ? 9 : 10,
              fontWeight: 700,
              letterSpacing: wallVariant
                ? "0.1em"
                : compactFrame
                  ? "0.08em"
                  : "0.12em",
              textTransform: locale === "zh-CN" ? "none" : "uppercase",
              color: wallVariant ? "#dbe6f3" : "#94a3b8",
            }}
          >
            {previewTitle}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          {statusLabel ? (
            <span
              style={{
                fontSize: compactFrame ? 8 : wallVariant ? 8 : 9,
                fontWeight: 700,
                letterSpacing: wallVariant ? "0.06em" : "0.08em",
                textTransform: locale === "zh-CN" ? "none" : "uppercase",
                color: wallVariant
                  ? wallStatusColor
                  : isStreaming
                    ? "#86efac"
                    : "#fbbf24",
              }}
            >
              {statusLabel}
            </span>
          ) : null}
          {showControl ? (
            <button
              data-testid="terminal-fullscreen-btn"
              onClick={event => {
                event.stopPropagation();
                onToggleFullscreen();
              }}
              style={{
                background: wallVariant
                  ? "rgba(30,41,59,0.64)"
                  : compactFrame
                    ? "rgba(30,41,59,0.56)"
                    : "rgba(51,65,85,0.55)",
                border: "1px solid rgba(148, 163, 184, 0.16)",
                color: "#e2e8f0",
                cursor: "pointer",
                padding: compactFrame ? "2px 8px" : wallVariant ? "2px 7px" : "3px 9px",
                borderRadius: 999,
                fontSize: compactFrame ? 10 : wallVariant ? 10 : 12,
                lineHeight: 1.2,
              }}
              aria-label={fullscreenLabel}
            >
              {fullscreen ? "x" : "[ ]"}
            </button>
          ) : null}
        </div>
        </div>
      )}

      {!isStreaming && !showCenteredIdleState && (
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
            padding: "0 14px",
          }}
        >
          <span style={{ fontWeight: 700, color: "#e2e8f0" }}>{idleTitle}</span>
          <span style={{ fontSize: compactFrame ? 10 : 11, color: "#94a3b8" }}>
            {idleDescription}
          </span>
        </div>
      )}

      {showCenteredIdleState ? (
        <div
          data-testid="terminal-idle"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 18px",
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              transform: "translateY(-10px)",
              textAlign: "center",
              color: "#94a3b8",
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: 15,
                lineHeight: 1.2,
                color: "#e2e8f0",
              }}
            >
              {idleTitle}
            </span>
            <span
              style={{
                maxWidth: "82%",
                fontSize: 11,
                lineHeight: 1.5,
                color: "#94a3b8",
              }}
            >
              {idleDescription}
            </span>
          </div>
        </div>
      ) : null}

      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: `calc(100% - ${headerHeight}px)`,
          visibility: showCenteredIdleState ? "hidden" : "visible",
        }}
      />
    </div>
  );
}

export const TerminalPreview = memo(TerminalPreviewInner);
