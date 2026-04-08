/**
 * 血缘追踪 Socket 事件常量与载荷类型
 */

import type { DataLineageNode, ChangeAlert } from "./contracts.js";

// ─── Socket 事件名 ─────────────────────────────────────────────────────────

export const LINEAGE_SOCKET_EVENTS = {
  nodeCreated: "lineage:node_created",
  alertTriggered: "lineage:alert_triggered",
} as const;

// ─── 载荷接口 ──────────────────────────────────────────────────────────────

export interface LineageNodeCreatedPayload {
  node: DataLineageNode;
  issuedAt: number;
}

export interface LineageAlertTriggeredPayload {
  alert: ChangeAlert;
  issuedAt: number;
}
