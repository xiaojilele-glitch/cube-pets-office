/**
 * Replay Access Control Middleware
 *
 * - Admin role ('admin') can access all replays
 * - Regular users can only access missions they created
 * - Uses header-based auth: x-user-id, x-user-role
 *
 * Requirements: 20.4
 */

import type { Request, Response, NextFunction } from "express";

/**
 * Simple in-memory mapping of missionId → creator userId.
 * In production this would query a database; for now we expose
 * a helper to register ownership and the middleware checks it.
 */
const missionOwners = new Map<string, string>();

export function registerMissionOwner(missionId: string, userId: string): void {
  missionOwners.set(missionId, userId);
}

export function getMissionOwner(missionId: string): string | undefined {
  return missionOwners.get(missionId);
}

/**
 * Express middleware that enforces replay access control.
 *
 * Reads `x-user-id` and `x-user-role` headers.
 * - If role is 'admin', access is granted.
 * - Otherwise, the user must be the mission creator.
 * - If headers are missing, returns 401.
 */
export function replayAccessControl(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = req.headers["x-user-id"] as string | undefined;
  const userRole = req.headers["x-user-role"] as string | undefined;

  if (!userId) {
    res.status(401).json({ error: "Missing x-user-id header" });
    return;
  }

  // Admins can access everything
  if (userRole === "admin") {
    next();
    return;
  }

  // Regular users: check mission ownership
  const missionId = req.params.missionId;
  if (!missionId) {
    next();
    return;
  }

  const owner = missionOwners.get(missionId);
  // If no owner is registered, allow access (mission may not be tracked yet)
  if (owner && owner !== userId) {
    res.status(403).json({
      error: "Access denied: you can only view your own mission replays",
    });
    return;
  }

  next();
}
