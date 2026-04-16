/**
 * Collaboration Replay System — Sensitive Data Protection
 *
 * AES-256-GCM 对称加密 + 正则脱敏工具。
 *
 * Requirements: 2.4, 5.5
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/* ─── Types ─── */

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
}

/* ─── Encryption ─── */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const KEY_LENGTH = 32; // 256-bit key

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns base64-encoded ciphertext, iv, and auth tag.
 */
export function encryptMessage(
  plaintext: string,
  key: Buffer
): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Decrypt an AES-256-GCM encrypted payload back to plaintext.
 */
export function decryptMessage(
  encrypted: EncryptedPayload,
  key: Buffer
): string {
  const iv = Buffer.from(encrypted.iv, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Generate a cryptographically secure 256-bit encryption key.
 */
export function generateEncryptionKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/* ─── Data Masking ─── */

/**
 * Masking patterns — order matters: more specific patterns first.
 * Each entry: [regex, replacement string].
 */
const MASKING_PATTERNS: Array<[RegExp, string | ((match: string) => string)]> =
  [
    // Passwords: password=xxx, pwd=xxx, passwd=xxx (in query strings, JSON, etc.)
    [/(?<=(password|passwd|pwd)["']?\s*[=:]\s*["']?)[^\s"',}&]+/gi, "***"],

    // Bearer tokens
    [/(?<=Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g, "***"],

    // API keys: api_key=xxx, apikey=xxx, api-key=xxx, token=xxx, secret=xxx
    [
      /(?<=(api[_-]?key|apikey|token|secret|access[_-]?key)\s*[=:]\s*["']?)[^\s"',}&]+/gi,
      "***",
    ],

    // Credit card numbers (13-19 digits, optionally separated by spaces or dashes)
    [
      /\b(?:\d[ -]*?){13,19}\b/g,
      (match: string) => {
        const digits = match.replace(/[\s-]/g, "");
        if (digits.length < 13 || digits.length > 19) return match;
        return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
      },
    ],

    // Email addresses
    [
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      (match: string) => {
        const [local, domain] = match.split("@");
        const maskedLocal =
          local.length <= 2
            ? "*".repeat(local.length)
            : `${local[0]}***${local[local.length - 1]}`;
        return `${maskedLocal}@${domain}`;
      },
    ],

    // Chinese phone numbers: 1xx-xxxx-xxxx or 1xxxxxxxxxx
    [
      /\b1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}\b/g,
      (match: string) => {
        const digits = match.replace(/[\s-]/g, "");
        return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
      },
    ],

    // International phone numbers: +xx-xxx-xxx-xxxx or similar
    [
      /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g,
      (match: string) => {
        const digits = match.replace(/[\s-+]/g, "");
        return `+${digits.slice(0, 2)}****${digits.slice(-4)}`;
      },
    ],
  ];

/**
 * Mask sensitive data in text using regex pattern matching.
 * Replaces passwords, emails, phone numbers, credit cards, and API keys/tokens.
 */
export function maskSensitiveData(text: string): string {
  let result = text;
  for (const [pattern, replacement] of MASKING_PATTERNS) {
    if (typeof replacement === "string") {
      result = result.replace(pattern, replacement);
    } else {
      result = result.replace(pattern, replacement);
    }
  }
  return result;
}
