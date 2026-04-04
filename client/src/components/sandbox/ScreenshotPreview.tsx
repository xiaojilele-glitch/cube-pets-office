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
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1a2e",
          color: "#666",
          fontSize: 14,
          borderRadius: 4,
        }}
      >
        暂无浏览器预览
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
        background: "#1a1a2e",
        borderRadius: 4,
        overflow: "hidden",
        cursor: "pointer",
      }}
      onClick={onClickZoom}
      role="button"
      tabIndex={0}
      aria-label="点击放大截图"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClickZoom();
      }}
    >
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
          background: "rgba(0,0,0,0.6)",
          color: "#ccc",
          fontSize: 11,
          padding: "1px 6px",
          borderRadius: 3,
          fontFamily: "monospace",
        }}
      >
        {formatTimestamp(current.timestamp)}
      </div>
    </div>
  );
}

export const ScreenshotPreview = memo(ScreenshotPreviewInner);
