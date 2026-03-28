import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { FeishuBridgeConfig } from "./bridge.js";

export const FEISHU_RELAY_TIMESTAMP_HEADER = "x-openclaw-timestamp";
export const FEISHU_RELAY_NONCE_HEADER = "x-openclaw-nonce";
export const FEISHU_RELAY_SIGNATURE_HEADER = "x-openclaw-signature";

interface RelayAuthHeaders {
  [FEISHU_RELAY_TIMESTAMP_HEADER]: string;
  [FEISHU_RELAY_NONCE_HEADER]: string;
  [FEISHU_RELAY_SIGNATURE_HEADER]: string;
}

interface BuildRelayAuthHeadersInput {
  secret: string;
  method: string;
  path: string;
  body: unknown;
  timestamp?: number;
  nonce?: string;
}

function normalizeJson(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => (item === undefined ? null : normalizeJson(item)));
  }
  if (typeof value === "object" && value) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)])
    );
  }
  return null;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function createSignature(
  secret: string,
  method: string,
  path: string,
  body: unknown,
  timestamp: string,
  nonce: string
): string {
  const payload = [method.toUpperCase(), path, timestamp, nonce, stableSerialize(body)].join(
    "\n"
  );
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function readHeader(headers: Request["headers"], key: string): string | undefined {
  const raw = headers[key];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0].trim() : undefined;
  return undefined;
}

function parseTimestamp(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const numeric = Number.parseInt(raw, 10);
  if (!Number.isFinite(numeric)) return null;
  return raw.length <= 10 ? numeric * 1_000 : numeric;
}

function parseSignature(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const normalized = raw.startsWith("sha256=") ? raw.slice("sha256=".length) : raw;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return null;
  return Buffer.from(normalized.toLowerCase(), "hex");
}

export function buildFeishuRelayAuthHeaders(
  input: BuildRelayAuthHeadersInput
): RelayAuthHeaders {
  const timestampSeconds = input.timestamp ?? Math.floor(Date.now() / 1_000);
  const timestamp = String(timestampSeconds);
  const nonce = input.nonce?.trim() || randomUUID();
  const signature = createSignature(
    input.secret,
    input.method,
    input.path,
    input.body,
    timestamp,
    nonce
  );
  return {
    [FEISHU_RELAY_TIMESTAMP_HEADER]: timestamp,
    [FEISHU_RELAY_NONCE_HEADER]: nonce,
    [FEISHU_RELAY_SIGNATURE_HEADER]: `sha256=${signature}`,
  };
}

export function createFeishuRelayAuth(config: FeishuBridgeConfig) {
  const secret = config.relaySecret?.trim();
  const maxSkewMs = Math.max(1, config.relayMaxSkewSeconds ?? 300) * 1_000;
  const nonceTtlMs = Math.max(
    maxSkewMs,
    Math.max(1, config.relayNonceTtlSeconds ?? config.relayMaxSkewSeconds ?? 300) * 1_000
  );
  const seenNonces = new Map<string, number>();

  function cleanup(now: number): void {
    for (const [key, expiresAt] of Array.from(seenNonces.entries())) {
      if (expiresAt <= now) {
        seenNonces.delete(key);
      }
    }
  }

  function verifyRequest(request: Request, response: Response, path: string): boolean {
    if (!secret) return true;

    const now = Date.now();
    cleanup(now);

    const timestampHeader = readHeader(request.headers, FEISHU_RELAY_TIMESTAMP_HEADER);
    const nonceHeader = readHeader(request.headers, FEISHU_RELAY_NONCE_HEADER);
    const signatureHeader = readHeader(request.headers, FEISHU_RELAY_SIGNATURE_HEADER);

    if (!timestampHeader || !nonceHeader || !signatureHeader) {
      response.status(401).json({ ok: false, error: "Missing relay auth headers" });
      return false;
    }

    const timestampMs = parseTimestamp(timestampHeader);
    if (timestampMs === null || Math.abs(now - timestampMs) > maxSkewMs) {
      response
        .status(401)
        .json({ ok: false, error: "Relay request timestamp is invalid or expired" });
      return false;
    }

    const nonce = nonceHeader.trim();
    if (!nonce) {
      response.status(401).json({ ok: false, error: "Relay request nonce is required" });
      return false;
    }

    const nonceKey = `${path}:${timestampHeader}:${nonce}`;
    if (seenNonces.has(nonceKey)) {
      response.status(409).json({ ok: false, error: "Relay request replay detected" });
      return false;
    }

    const expected = Buffer.from(
      createSignature(secret, request.method, path, request.body, timestampHeader, nonce),
      "hex"
    );
    const actual = parseSignature(signatureHeader);
    if (!actual || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      response.status(401).json({ ok: false, error: "Relay request signature mismatch" });
      return false;
    }

    seenNonces.set(nonceKey, now + nonceTtlMs);
    return true;
  }

  return {
    isEnabled: Boolean(secret),
    verifyRequest,
  };
}
