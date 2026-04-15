/**
 * Socket.IO manager for real-time workflow, heartbeat, telemetry, and cost events.
 */
import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import type { AgentEvent } from "../../shared/workflow-runtime.js";
import type { TelemetrySnapshot } from "../../shared/telemetry.js";
import type { CostSnapshot, CostAlert } from "../../shared/cost.js";
import type { DimensionDeltas } from "../../shared/reputation.js";
import { telemetryStore } from "./telemetry-store.js";
import { NLCommandSocketEmitter } from "./nl-command/socket-emitter.js";
import type { EmitFn } from "./nl-command/socket-emitter.js";
import type { SandboxRelay } from "./sandbox-relay.js";
import { SANDBOX_SOCKET_EVENTS } from "../../shared/mission/socket.js";

let io: SocketIOServer | null = null;

// ---------------------------------------------------------------------------
// Telemetry broadcast throttle state
// ---------------------------------------------------------------------------
let telemetryThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTelemetrySnapshot: TelemetrySnapshot | null = null;

// ---------------------------------------------------------------------------
// Cost broadcast — 500ms throttle state
// ---------------------------------------------------------------------------
let lastCostUpdateTime = 0;
let pendingCostTimer: ReturnType<typeof setTimeout> | null = null;
const COST_UPDATE_INTERVAL_MS = 500;

export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", socket => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Send current telemetry snapshot to new client
    socket.emit("telemetry.update", telemetryStore.getSnapshot());

    // Send current cost snapshot to newly connected client
    import("./cost-tracker.js").then(({ costTracker }) => {
      socket.emit("cost.update", costTracker.getSnapshot());
    }).catch(() => {
      // cost-tracker not available yet — skip
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  console.log("[Socket] Socket.IO initialized");
  return io;
}

export function getSocketIO(): SocketIOServer | null {
  return io;
}

export function emitEvent(event: AgentEvent): void {
  if (io) {
    io.emit("agent_event", event);
  }
}

/**
 * Broadcast telemetry snapshot update, 500ms throttle.
 */
export function emitTelemetryUpdate(snapshot: TelemetrySnapshot): void {
  if (!io) return;

  pendingTelemetrySnapshot = snapshot;

  if (!telemetryThrottleTimer) {
    io.emit("telemetry.update", snapshot);
    pendingTelemetrySnapshot = null;

    telemetryThrottleTimer = setTimeout(() => {
      telemetryThrottleTimer = null;
      if (pendingTelemetrySnapshot) {
        io!.emit("telemetry.update", pendingTelemetrySnapshot);
        pendingTelemetrySnapshot = null;
      }
    }, 500);
  }
}

/**
 * Broadcast cost.update with 500ms throttle.
 */
export function emitCostUpdate(snapshot: CostSnapshot): void {
  if (!io) return;

  const now = Date.now();
  const elapsed = now - lastCostUpdateTime;

  if (elapsed >= COST_UPDATE_INTERVAL_MS) {
    lastCostUpdateTime = now;
    if (pendingCostTimer) {
      clearTimeout(pendingCostTimer);
      pendingCostTimer = null;
    }
    io.emit("cost.update", snapshot);
  } else {
    if (pendingCostTimer) {
      clearTimeout(pendingCostTimer);
    }
    pendingCostTimer = setTimeout(() => {
      pendingCostTimer = null;
      lastCostUpdateTime = Date.now();
      if (io) {
        io.emit("cost.update", snapshot);
      }
    }, COST_UPDATE_INTERVAL_MS - elapsed);
  }
}

/**
 * Broadcast cost.alert immediately (no throttle).
 */
export function emitCostAlert(alert: CostAlert): void {
  if (!io) return;
  io.emit("cost.alert", alert);
}

/**
 * Create an NLCommandSocketEmitter wired to the global Socket.IO instance.
 * Returns null if Socket.IO has not been initialized yet.
 */
export function createNLCommandEmitter(): NLCommandSocketEmitter | null {
  if (!io) return null;
  const emitFn: EmitFn = (event, payload) => io!.emit(event, payload);
  return new NLCommandSocketEmitter(emitFn);
}

/**
 * Broadcast reputation.changed event.
 */
export function emitReputationChanged(payload: {
  agentId: string;
  oldScore: number;
  newScore: number;
  grade: string;
  dimensionDeltas: DimensionDeltas;
}): void {
  if (!io) return;
  io.emit('reputation.changed', payload);
}

/**
 * Broadcast reputation.trustTierChanged event.
 */
export function emitTrustTierChanged(payload: {
  agentId: string;
  oldTier: string;
  newTier: string;
  reason: string;
}): void {
  if (!io) return;
  io.emit('reputation.trustTierChanged', payload);
}

/**
 * Register sandbox-relay socket handlers.
 * Adds `request_log_history` listener so clients can fetch buffered logs.
 */
export function registerSandboxRelay(relay: SandboxRelay): void {
  if (!io) return;

  io.on("connection", (socket) => {
    socket.on("request_log_history", (payload: { missionId?: string }) => {
      const missionId = payload?.missionId;
      if (!missionId || typeof missionId !== "string") return;

      const lines = relay.getLogHistory(missionId);
      socket.emit(SANDBOX_SOCKET_EVENTS.missionLogHistory, { missionId, lines });
    });
  });
}

