/**
 * GuestLifecycleManager — Manages the lifecycle of guest agents.
 *
 * Handles cleanup when a guest agent leaves or when a mission completes/fails:
 * - Unregisters the agent from the registry
 * - Recursively deletes the agent's workspace directory
 * - Notifies the frontend via Socket events
 *
 * @see Requirements 5.5, 2.5
 */
import fs from "node:fs";
import path from "node:path";
import { registry } from "./registry.js";
import { getSocketIO } from "./socket.js";

/** Resolve the workspace directory for a given guest agent ID. */
function resolveWorkspacePath(guestId: string): string {
  return path.resolve(process.cwd(), "data/agents", guestId);
}

export class GuestLifecycleManager {
  /**
   * Remove a single guest agent: unregister, delete workspace, notify frontend.
   * @see Requirements 2.5, 5.5
   */
  async leaveOffice(guestId: string): Promise<void> {
    // 1. Unregister from the agent registry
    registry.unregisterGuest(guestId);

    // 2. Recursively delete the workspace directory
    this.cleanupWorkspace(guestId);

    // 3. Notify frontend
    this.notifyFrontend(guestId, "leave");
  }

  /**
   * Called when a mission completes — clean up all guest agents.
   * @see Requirements 5.5
   */
  async onMissionComplete(_workflowId: string): Promise<void> {
    const guests = registry.getGuestAgents();
    for (const guest of guests) {
      await this.leaveOffice(guest.config.id);
    }
  }

  /**
   * Called when a mission fails — clean up all guest agents.
   * @see Requirements 5.5
   */
  async onMissionFailed(_workflowId: string): Promise<void> {
    const guests = registry.getGuestAgents();
    for (const guest of guests) {
      await this.leaveOffice(guest.config.id);
    }
  }

  /**
   * Recursively delete the guest agent's workspace directory.
   * Silently ignores errors (e.g. directory doesn't exist).
   */
  private cleanupWorkspace(guestId: string): void {
    const workspacePath = resolveWorkspacePath(guestId);
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      // Log but don't block other cleanup operations
      console.warn(
        `[GuestLifecycle] Failed to clean workspace for ${guestId}`,
      );
    }
  }

  /**
   * Emit a Socket.IO event to notify the frontend about guest join/leave.
   */
  private notifyFrontend(
    guestId: string,
    event: "join" | "leave",
  ): void {
    const io = getSocketIO();
    if (io) {
      io.emit(event === "join" ? "guest_join" : "guest_leave", { guestId });
    }
  }
}

export const guestLifecycleManager = new GuestLifecycleManager();
