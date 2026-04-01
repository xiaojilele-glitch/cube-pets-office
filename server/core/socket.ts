/**
 * Socket.IO manager for real-time workflow, heartbeat, and cost events.
 */
import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import type { AgentEvent } from "../../shared/workflow-runtime.js";
import type { CostSnapshot, CostAlert } from "../../shared/cost.js";

let io: SocketIOServer | null = null;

// ---------------------------------------------------------------------------
// Cost broadcast — 500ms throttle state
// ---------------------------------------------------------------------------

/** Timestamp of the last emitted cost.update */
let lastCostUpdateTime = 0;
/** Pending timer for deferred cost.update */
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

    // Send current cost snapshot to newly connected client (lazy import to avoid circular dep)
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

// ---------------------------------------------------------------------------
// Cost broadcast functions
// ---------------------------------------------------------------------------

/**
 * Broadcast a cost.update event with 500ms throttle.
 * If called within 500ms of the last broadcast, the update is deferred
 * and the latest snapshot will be sent when the interval elapses.
 *
 * @see Requirement 7.1, 7.2
 */
export function emitCostUpdate(snapshot: CostSnapshot): void {
  if (!io) return;

  const now = Date.now();
  const elapsed = now - lastCostUpdateTime;

  if (elapsed >= COST_UPDATE_INTERVAL_MS) {
    // Enough time has passed — broadcast immediately
    lastCostUpdateTime = now;
    if (pendingCostTimer) {
      clearTimeout(pendingCostTimer);
      pendingCostTimer = null;
    }
    io.emit("cost.update", snapshot);
  } else {
    // Too soon — schedule a deferred broadcast with the latest snapshot
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
 * Broadcast a cost.alert event immediately (no throttle).
 *
 * @see Requirement 7.4
 */
export function emitCostAlert(alert: CostAlert): void {
  if (!io) return;
  io.emit("cost.alert", alert);
}
