/**
 * Socket.IO manager for real-time workflow and heartbeat events.
 */
import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import type { AgentEvent } from "../../shared/workflow-runtime.js";
import type { TelemetrySnapshot } from "../../shared/telemetry.js";
import { telemetryStore } from "./telemetry-store.js";

let io: SocketIOServer | null = null;

// ---------------------------------------------------------------------------
// Telemetry broadcast throttle state
// ---------------------------------------------------------------------------
let telemetryThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTelemetrySnapshot: TelemetrySnapshot | null = null;

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
 * 广播遥测快照更新，500ms 节流。
 * 首次调用立即发送，后续在 500ms 窗口内合并为一次发送。
 */
export function emitTelemetryUpdate(snapshot: TelemetrySnapshot): void {
  if (!io) return;

  pendingTelemetrySnapshot = snapshot;

  if (!telemetryThrottleTimer) {
    // Send immediately on first call
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
