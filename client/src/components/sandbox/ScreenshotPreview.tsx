/**
 * ScreenshotPreview - displays the latest browser screenshot with crossfade.
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
  headerMode?: "default" | "hidden";
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
  headerMode = "default",
}: ScreenshotPreviewProps) {
  const { locale } = useI18n();
  const wallVariant = variant === "wall";
  const compactFrame = embedded && !fullscreen;
  const headerHidden = headerMode === "hidden" && !fullscreen;
  const headerHeight = headerHidden
    ? 0
    : compactFrame
      ? 28
      : wallVariant
        ? 28
        : 28;
  const showCenteredPlaceholder =
    !current && wallVariant && headerHidden && !fullscreen;
  const framelessWallPane = wallVariant && headerHidden && !fullscreen;
  const previewTitle =
    title ||
    (locale === "zh-CN"
      ? wallVariant
        ? "浏览器回传"
        : "浏览器画面"
      : wallVariant
        ? "Browser Live"
        : "Browser view");
  const zoomLabel = locale === "zh-CN" ? "放大" : "Zoom";
  const emptyTitle =
    locale === "zh-CN" ? "等待浏览器画面" : "Waiting for browser view";
  const emptyDescription =
    locale === "zh-CN"
      ? "浏览器步骤开始后，这里会回传最新截图。"
      : "A fresh screenshot will appear here after browser steps run.";
  const ariaLabel =
    locale === "zh-CN" ? "打开浏览器画面" : "Open browser screenshot";
  const wallStatusColor = current ? "#60a5fa" : "#94a3b8";

  const shellStyle: React.CSSProperties = fullscreen
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
        borderRadius: framelessWallPane
          ? 12
          : compactFrame
            ? 12
            : wallVariant
              ? 14
              : 12,
        overflow: "hidden",
        cursor: "pointer",
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
      };

  const showControl = fullscreen || showFullscreenButton;

  const headerRight = (
    <div
      style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}
    >
      {statusLabel ? (
        <span
          style={{
            fontSize: compactFrame ? 8 : wallVariant ? 8 : 9,
            fontWeight: 700,
            letterSpacing: wallVariant ? "0.06em" : "0.08em",
            textTransform: locale === "zh-CN" ? "none" : "uppercase",
            color: wallVariant ? wallStatusColor : "#93c5fd",
          }}
        >
          {statusLabel}
        </span>
      ) : !wallVariant ? (
        <span style={{ fontSize: compactFrame ? 9 : 10, color: "#e2e8f0" }}>
          {zoomLabel}
        </span>
      ) : null}
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
            background: wallVariant
              ? "rgba(30,41,59,0.64)"
              : compactFrame
                ? "rgba(30,41,59,0.56)"
                : "rgba(51,65,85,0.55)",
            border: "1px solid rgba(148, 163, 184, 0.16)",
            color: "#e2e8f0",
            cursor: "pointer",
            padding: compactFrame
              ? "2px 8px"
              : wallVariant
                ? "2px 7px"
                : "3px 9px",
            borderRadius: 999,
            fontSize: compactFrame ? 10 : wallVariant ? 10 : 12,
            lineHeight: 1.2,
          }}
          aria-label={
            fullscreen
              ? locale === "zh-CN"
                ? "退出聚焦"
                : "Close focus"
              : ariaLabel
          }
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
              "radial-gradient(circle at top, rgba(96,165,250,0.12), transparent 34%), radial-gradient(circle at bottom, rgba(14,165,233,0.08), transparent 28%)",
          }}
        />
        {wallVariant && !fullscreen ? (
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
        ) : null}
        {headerHidden ? null : (
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
              padding: compactFrame
                ? "0 10px"
                : wallVariant
                  ? "0 10px"
                  : "0 12px",
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
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
              ) : null}
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
            {headerRight}
          </div>
        )}

        <div
          style={{
            position: "absolute",
            inset: showCenteredPlaceholder ? 0 : headerHeight,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: showCenteredPlaceholder ? 6 : compactFrame ? 4 : 6,
            color: "#94a3b8",
            fontSize: showCenteredPlaceholder ? 13 : compactFrame ? 12 : 13,
            textAlign: "center",
            padding: showCenteredPlaceholder ? "0 18px" : "0 14px",
            zIndex: showCenteredPlaceholder ? 3 : undefined,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: showCenteredPlaceholder ? 6 : compactFrame ? 4 : 6,
              width: "100%",
              transform: showCenteredPlaceholder
                ? "translateY(-10px)"
                : undefined,
            }}
          >
            <span style={{ fontWeight: 700, color: "#e2e8f0" }}>
              {emptyTitle}
            </span>
            <span
              style={{
                maxWidth: showCenteredPlaceholder ? "82%" : undefined,
                fontSize: showCenteredPlaceholder ? 11 : compactFrame ? 10 : 11,
                lineHeight: showCenteredPlaceholder ? 1.5 : undefined,
              }}
            >
              {emptyDescription}
            </span>
          </div>
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
      {headerHidden ? null : (
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
            padding: compactFrame
              ? "0 10px"
              : wallVariant
                ? "0 10px"
                : "0 12px",
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
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
            ) : null}
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
          {headerRight}
        </div>
      )}

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
          bottom: 8,
          right: 8,
          background: "rgba(7,12,18,0.74)",
          color: "#e2e8f0",
          fontSize: compactFrame ? 10 : 11,
          padding: "2px 8px",
          borderRadius: 999,
          fontFamily: "monospace",
          zIndex: 2,
          border: "1px solid rgba(148,163,184,0.14)",
        }}
      >
        {formatTimestamp(current.timestamp)}
      </div>
      {contextLabel ? (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            maxWidth: "58%",
            background: "rgba(7,12,18,0.74)",
            color: "#cbd5e1",
            fontSize: compactFrame ? 9 : 10,
            padding: "2px 8px",
            borderRadius: 999,
            zIndex: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            border: "1px solid rgba(148,163,184,0.14)",
          }}
        >
          {contextLabel}
        </div>
      ) : null}
    </div>
  );
}

export const ScreenshotPreview = memo(ScreenshotPreviewInner);
