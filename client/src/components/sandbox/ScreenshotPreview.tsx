/**
 * ScreenshotPreview — displays the latest browser screenshot with crossfade.
 *
 * @see Requirements 5.1, 5.2, 5.3, 5.5, 5.6
 */

import { memo } from "react";
import { formatTimestamp, type ScreenshotFrame } from "../../lib/sandbox-store";

export interface ScreenshotPreviewProps {
  current: ScreenshotFrame | null;
  previous: ScreenshotFrame | null;
  onClickZoom: () => void;
}

function ScreenshotPreviewInner({
  current,
  previous,
  onClickZoom,
}: ScreenshotPreviewProps) {
  if (!current) {
    return (
      <div
        data-testid="screenshot-placeholder"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          background: "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(30,41,59,0.98))",
          color: "#94a3b8",
          fontSize: 13,
          borderRadius: 12,
          border: "1px solid rgba(148, 163, 184, 0.18)",
          boxShadow: "0 12px 30px rgba(15, 23, 42, 0.24)",
        }}
      >
        <span style={{ fontWeight: 600, color: "#e2e8f0" }}>暂无浏览器预览</span>
        <span style={{ fontSize: 11 }}>执行带页面的任务后，这里会显示截图</span>
      </div>
    );
  }

  return (
    <div
      data-testid="screenshot-preview"
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(30,41,59,0.98))",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        border: "1px solid rgba(148, 163, 184, 0.18)",
        boxShadow: "0 12px 30px rgba(15, 23, 42, 0.24)",
      }}
      onClick={onClickZoom}
      role="button"
      tabIndex={0}
      aria-label="点击放大截图"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClickZoom();
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
          height: 28,
          padding: "0 10px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
          color: "#cbd5e1",
          background: "rgba(15,23,42,0.78)",
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8" }}>
          浏览器预览
        </span>
        <span style={{ fontSize: 10, color: "#e2e8f0" }}>点击放大</span>
      </div>

      {/* Previous frame (fading out) */}
      {previous && (
        <img
          src={`data:image/png;base64,${previous.imageData}`}
          alt="previous screenshot"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: 0,
            transition: "opacity 300ms ease-in-out",
          }}
        />
      )}

      {/* Current frame (fading in) */}
      <img
        src={`data:image/png;base64,${current.imageData}`}
        alt="browser screenshot"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          opacity: 1,
          transition: "opacity 300ms ease-in-out",
        }}
      />

      {/* Timestamp overlay */}
      <div
        data-testid="screenshot-timestamp"
        style={{
          position: "absolute",
          bottom: 4,
          right: 4,
          background: "rgba(15,23,42,0.72)",
          color: "#e2e8f0",
          fontSize: 11,
          padding: "1px 6px",
          borderRadius: 6,
          fontFamily: "monospace",
          zIndex: 2,
        }}
      >
        {formatTimestamp(current.timestamp)}
      </div>
    </div>
  );
}

export const ScreenshotPreview = memo(ScreenshotPreviewInner);
