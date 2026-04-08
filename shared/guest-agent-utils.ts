import crypto from "node:crypto";
import type { GuestAgentConfig } from "./organization-schema.js";

/**
 * Generate a guest agent ID in the format "guest_{8-char-hex}".
 */
export function generateGuestId(): string {
  const hex = crypto.randomBytes(4).toString("hex");
  return `guest_${hex}`;
}

/**
 * Check whether an ID follows the guest agent ID pattern.
 */
export function isGuestId(id: string): boolean {
  return /^guest_[0-9a-f]{8}$/.test(id);
}

/**
 * Return a sanitized copy of GuestAgentConfig with apiKey replaced by "***".
 */
export function sanitizeGuestConfig(
  config: GuestAgentConfig,
): GuestAgentConfig {
  return {
    ...config,
    apiKey: config.apiKey != null ? "***" : undefined,
  };
}
