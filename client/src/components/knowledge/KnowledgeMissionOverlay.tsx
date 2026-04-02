/**
 * 知识子图浮动面板 — MissionIsland 3D 场景集成
 *
 * 轻量包装组件，当 Agent 执行图查询时在 TelemetryOverlay 中
 * 展示查询涉及的知识子图。内部复用 KnowledgeGraphPanel 进行可视化。
 *
 * Props:
 *   visible  — 是否显示面板
 *   nodes    — 子图实体列表
 *   edges    — 子图关系列表
 *   onClose  — 关闭回调
 *   className — 额外 CSS 类名
 *
 * Requirements: 9.4
 */

import type { Entity, Relation } from "@shared/knowledge/types";
import KnowledgeGraphPanel from "./KnowledgeGraphPanel";

export interface KnowledgeMissionOverlayProps {
  visible: boolean;
  nodes: Entity[];
  edges: Relation[];
  onClose: () => void;
  className?: string;
}

export default function KnowledgeMissionOverlay({
  visible,
  nodes,
  edges,
  onClose,
  className = "",
}: KnowledgeMissionOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className={`knowledge-mission-overlay ${className}`}
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        width: 420,
        height: 320,
        background: "rgba(15, 23, 42, 0.92)",
        borderRadius: 12,
        border: "1px solid rgba(148, 163, 184, 0.25)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 50,
      }}
      role="dialog"
      aria-label="Knowledge subgraph overlay"
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>
          Knowledge Subgraph
        </span>
        <button
          onClick={onClose}
          aria-label="Close knowledge overlay"
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          ✕
        </button>
      </div>

      {/* Graph */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <KnowledgeGraphPanel nodes={nodes} edges={edges} />
      </div>
    </div>
  );
}
