/**
 * Property tests for CredentialScrubber module.
 *
 * Feature: ai-enabled-sandbox
 * - Property 5: 凭证清洗完整性
 * - Property 7: Artifact 文件凭证清洗
 */
import { describe, expect, it, afterEach } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CredentialScrubber } from "../credential-scrubber.js";

const REDACTED = "[REDACTED]";

/* ─── Arbitraries ─── */

const ALPHA_NUM_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
const SAFE_CHARS = "abcdefghijklmnopqrstuvwxyz 0123456789,.!?:;-()".split("");

/** Alphanumeric string of given length range */
const arbAlphaNum = (min: number, max: number) =>
  fc
    .array(fc.constantFrom(...ALPHA_NUM_CHARS), { minLength: min, maxLength: max })
    .map((a) => a.join(""));

/** Generate an OpenAI-style key: sk-<20+ alphanumeric chars> */
const arbSkKey = arbAlphaNum(20, 60).map((s) => `sk-${s}`);

/** Generate a custom-format key: clp_<20+ alphanumeric chars> */
const arbClpKey = arbAlphaNum(20, 60).map((s) => `clp_${s}`);

/** Generate a random injected secret (arbitrary non-empty string, no newlines) */
const arbSecret = fc
  .string({ minLength: 9, maxLength: 80 })
  .filter((s) => s.trim().length > 0 && !s.includes("\n") && !s.includes("\r"));

/** Non-credential text that won't accidentally match key patterns */
const arbSafeText = fc
  .array(fc.constantFrom(...SAFE_CHARS), { minLength: 0, maxLength: 100 })
  .map((a) => a.join(""))
  .filter((s) => !s.includes("sk-") && !s.includes("clp_"));

/* ─── Property 5: 凭证清洗完整性 ─── */

describe("Property 5: 凭证清洗完整性", () => {
  /**
   * **Validates: Requirements 6.1, 6.2, 6.3**
   *
   * For any string containing injected API Key values, or matching
   * sk-[a-zA-Z0-9]{20,} pattern, or matching clp_[a-zA-Z0-9]{20,} pattern,
   * scrubLine should replace matched parts with "[REDACTED]" without
   * modifying non-credential text.
   */

  it("scrubs injected secret values from lines", () => {
    fc.assert(
      fc.property(arbSecret, arbSafeText, arbSafeText, (secret, prefix, suffix) => {
        const scrubber = new CredentialScrubber([secret]);
        const line = `${prefix}${secret}${suffix}`;
        const result = scrubber.scrubLine(line);

        // The original secret must not appear in the result
        expect(result).not.toContain(secret);
        // [REDACTED] must appear
        expect(result).toContain(REDACTED);
      }),
      { numRuns: 100 },
    );
  });

  it("scrubs OpenAI-format keys (sk-...) from lines", () => {
    fc.assert(
      fc.property(arbSkKey, arbSafeText, arbSafeText, (key, prefix, suffix) => {
        const scrubber = new CredentialScrubber([]);
        const line = `${prefix}${key}${suffix}`;
        const result = scrubber.scrubLine(line);

        expect(result).not.toContain(key);
        expect(result).toContain(REDACTED);
      }),
      { numRuns: 100 },
    );
  });

  it("scrubs custom-format keys (clp_...) from lines", () => {
    fc.assert(
      fc.property(arbClpKey, arbSafeText, arbSafeText, (key, prefix, suffix) => {
        const scrubber = new CredentialScrubber([]);
        const line = `${prefix}${key}${suffix}`;
        const result = scrubber.scrubLine(line);

        expect(result).not.toContain(key);
        expect(result).toContain(REDACTED);
      }),
      { numRuns: 100 },
    );
  });

  it("does not modify lines that contain no credentials", () => {
    fc.assert(
      fc.property(arbSafeText, (text) => {
        const scrubber = new CredentialScrubber(["my-super-secret-key-12345"]);
        const result = scrubber.scrubLine(text);

        // Safe text should pass through unchanged
        expect(result).toBe(text);
      }),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 7: Artifact 文件凭证清洗 ─── */

describe("Property 7: Artifact 文件凭证清洗", () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any text file content containing an injected API Key,
   * after scrubFile processing, the file content should not
   * contain the original API Key string.
   */

  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrubber-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    tmpDirs.length = 0;
  });

  it("scrubFile removes injected API keys from file content", () => {
    fc.assert(
      fc.property(
        arbSecret,
        arbSafeText,
        arbSafeText,
        (secret, prefix, suffix) => {
          const dir = makeTmpDir();
          const filePath = path.join(dir, "artifact.txt");
          const content = `${prefix}${secret}${suffix}`;
          fs.writeFileSync(filePath, content, "utf-8");

          const scrubber = new CredentialScrubber([secret]);
          const result = scrubber.scrubFile(filePath);

          expect(result.scrubbed).toBe(true);
          expect(result.replacements).toBeGreaterThanOrEqual(1);

          // File content must no longer contain the secret
          const after = fs.readFileSync(filePath, "utf-8");
          expect(after).not.toContain(secret);
          expect(after).toContain(REDACTED);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("scrubFile leaves clean files unchanged", () => {
    fc.assert(
      fc.property(arbSafeText, (text) => {
        const dir = makeTmpDir();
        const filePath = path.join(dir, "clean.txt");
        fs.writeFileSync(filePath, text, "utf-8");

        const scrubber = new CredentialScrubber(["my-super-secret-key-12345"]);
        const result = scrubber.scrubFile(filePath);

        expect(result.scrubbed).toBe(false);
        expect(result.replacements).toBe(0);

        // Content should be unchanged
        const after = fs.readFileSync(filePath, "utf-8");
        expect(after).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it("scrubFile handles multi-line files with keys on different lines", () => {
    fc.assert(
      fc.property(
        arbSecret,
        arbSafeText,
        arbSafeText,
        (secret, line1, line2) => {
          const dir = makeTmpDir();
          const filePath = path.join(dir, "multi.txt");
          const content = `${line1}\n${secret}\n${line2}\n${secret}`;
          fs.writeFileSync(filePath, content, "utf-8");

          const scrubber = new CredentialScrubber([secret]);
          scrubber.scrubFile(filePath);

          const after = fs.readFileSync(filePath, "utf-8");
          expect(after).not.toContain(secret);
        },
      ),
      { numRuns: 100 },
    );
  });
});
