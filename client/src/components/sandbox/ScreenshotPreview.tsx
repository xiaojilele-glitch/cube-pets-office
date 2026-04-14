/**
 * ScreenshotPreview - displays the latest browser screenshot with crossfade.
 *
 * @see Requirements 5.1, 5.2, 5.3, 5.5, 5.6
 */

import { memo } from "react";

import { useI18n } from "@/i18n";

import { formatTimestamp, type ScreenshotFrame } from "../../lib/sandbox-store";

export interface ScreenshotPreviewProps {
  current: ScreenshotFrame | null;
  previous: ScreenshotFrame | null;
  onClickZoom: () => void;
  embedded?: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  showFullscreenButton?: boolean;
  title?: string;
  statusLabel?: string | null;
  contextLabel?: string | null;
  variant?: "default" | "wall";
}

function ScreenshotPreviewInner({
  current,
  previous,
  onClickZoom,
  embedded = false,
  fullscreen = false,
  onToggleFullscreen,
  showFullscreenButton = true,
  title,
  statusLabel = null,
  contextLabel = null,
  variant = "default",
}: ScreenshotPreviewProps) {
  const { locale } = useI18n();
  const wallVariant = variant === "wall";
  const compactFrame = embedded && !fullscreen;
  const headerHeight = compactFrame ? 24 : wallVariant ? 30 : 28;
  const previewTitle =
    title ||
    (locale === "zh-CN"
      ? wallVariant
        ? "浏览器实时画面"
        : "浏览器画面"
      : wallVariant
        ? "Browser Live"
        : "Browser view");
  const zoomLabel = locale === "zh-CN" ? "放大" : "Zoom";
  const emptyTitle = locale === "zh-CN" ? "等待浏览器画面" : "Waiting for browser view";
  const emptyDescription =
    locale === "zh-CN"
      ? "执行含页面步骤后，这里会回传最新截图"
      : "A fresh screenshot will appear here after browser steps run.";
  const ariaLabel =
    locale === "zh-CN" ? "点击放大浏览器截图" : "Open browser screenshot";

  const shellStyle: React.CSSProperties = fullscreen
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background:
          "linear-gradient(180deg, rgba(5,10,18,0.96), rgba(10,18,30,0.98))",
        padding: 16,
      }
    : {
        width: "100%",
        height: "100%",
        position: "relative",
        background: wallVariant
          ? "linear-gradient(180deg, rgba(11,17,27,0.98), rgba(18,27,41,0.99))"
          : compactFrame
            ? "linear-gradient(180deg, rgba(7,10,18,0.96), rgba(18,25,38,0.98))"
            : "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(30,41,59,0.98))",
        borderRadius: compactFrame ? 10 : wallVariant ? 14 : 12,
        overflow: "hidden",
        cursor: "pointer",
        border: wallVariant
          ? "1px solid rgba(86, 104, 128, 0.18)"
          : compactFrame
            ? "1px solid rgba(148, 163, 184, 0.12)"
            : "1px solid rgba(148, 163, 184, 0.18)",
        boxShadow: wallVariant
          ? "inset 0 1px 0 rgba(255,255,255,0.03), 0 8px 24px rgba(4, 10, 18, 0.24)"
          : compactFrame
            ? "inset 0 1px 0 rgba(255,255,255,0.04)"
            : "0 12px 30px rgba(15, 23, 42, 0.24)",
      };

  const showControl = fullscreen || showFullscreenButton;

  const headerRight = (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {statusLabel ? (
        <span
          style={{
            fontSize: compactFrame ? 8 : 9,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: locale === "zh-CN" ? "none" : "uppercase",
            color: "#93c5fd",
          }}
        >
          {statusLabel}
        </span>
      ) : (
        <span style={{ fontSize: compactFrame ? 9 : 10, color: "#e2e8f0" }}>
          {zoomLabel}
        </span>
      )}
      {showControl ? (
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            if (fullscreen) {
              onToggleFullscreen?.();
            } else {
              onClickZoom();
            }
          }}
          style={{
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
          }}
          aria-label={fullscreen ? (locale === "zh-CN" ? "退出全屏" : "Exit fullscreen") : ariaLabel}
        >
          {fullscreen ? "x" : "[ ]"}
        </button>
      ) : null}
    </div>
  );

  if (!current) {
    return (
      <div
        data-testid="screenshot-placeholder"
        style={shellStyle}
        onClick={onClickZoom}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            onClickZoom();
          }
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at top, rgba(96,165,250,0.12), transparent 36%), radial-gradient(circle at bottom, rgba(244,114,182,0.08), transparent 32%)",
          }}
        />
        {wallVariant && !fullscreen ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 4px)",
              opacity: 0.16,
              pointerEvents: "none",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: headerHeight,
            padding: compactFrame ? "0 8px" : "0 10px",
            borderBottom: compactFrame
              ? "1px solid rgba(148, 163, 184, 0.1)"
              : "1px solid rgba(148, 163, 184, 0.14)",
            color: "#cbd5e1",
            background: wallVariant
              ? "rgba(6,12,20,0.84)"
              : compactFrame
                ? "rgba(6,10,18,0.84)"
                : "rgba(15,23,42,0.78)",
          }}
        >
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
          {headerRight}
        </div>

        <div
          style={{
            position: "absolute",
            inset: headerHeight,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: compactFrame ? 4 : 6,
            color: "#94a3b8",
            fontSize: compactFrame ? 12 : 13,
            textAlign: "center",
            padding: "0 10px",
          }}
        >
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{emptyTitle}</span>
          <span style={{ fontSize: compactFrame ? 10 : 11 }}>{emptyDescription}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="screenshot-preview"
      style={shellStyle}
      onClick={onClickZoom}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          onClickZoom();
        }
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: headerHeight,
          padding: compactFrame ? "0 8px" : "0 10px",
          borderBottom: compactFrame
            ? "1px solid rgba(148, 163, 184, 0.1)"
            : "1px solid rgba(148, 163, 184, 0.14)",
          color: "#cbd5e1",
          background: wallVariant
            ? "rgba(6,12,20,0.84)"
            : compactFrame
              ? "rgba(6,10,18,0.84)"
              : "rgba(15,23,42,0.78)",
        }}
      >
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
        {headerRight}
      </div>

      {previous ? (
        <img
          src={`data:image/png;base64,${previous.imageData}`}
          alt="previous screenshot"
          style={{
            position: "absolute",
            inset: headerHeight,
            width: "100%",
            height: `calc(100% - ${headerHeight}px)`,
            objectFit: "contain",
            opacity: 0,
            transition: "opacity 300ms ease-in-out",
          }}
        />
      ) : null}

      <img
        src={`data:image/png;base64,${current.imageData}`}
        alt="browser screenshot"
        style={{
          position: "absolute",
          inset: headerHeight,
          width: "100%",
          height: `calc(100% - ${headerHeight}px)`,
          objectFit: "contain",
          opacity: 1,
          transition: "opacity 300ms ease-in-out",
        }}
      />

      <div
        data-testid="screenshot-timestamp"
        style={{
          position: "absolute",
          bottom: 4,
          right: 4,
          background: "rgba(15,23,42,0.72)",
          color: "#e2e8f0",
          fontSize: compactFrame ? 10 : 11,
          padding: "1px 6px",
          borderRadius: 6,
          fontFamily: "monospace",
          zIndex: 2,
        }}
      >
        {formatTimestamp(current.timestamp)}
      </div>
      {contextLabel ? (
        <div
          style={{
            position: "absolute",
            bottom: 4,
            left: 4,
            maxWidth: "60%",
            background: "rgba(15,23,42,0.72)",
            color: "#cbd5e1",
            fontSize: compactFrame ? 9 : 10,
            padding: "1px 6px",
            borderRadius: 6,
            zIndex: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {contextLabel}
        </div>
      ) : null}
    </div>
  );
}

export const ScreenshotPreview = memo(ScreenshotPreviewInner);
