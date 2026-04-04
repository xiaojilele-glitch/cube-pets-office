/**
 * Credential Scrubber — scans text, files, and directories for leaked
 * API keys and replaces them with "[REDACTED]".
 *
 * Scrubbing rules (applied in order):
 * 1. Exact match against any injected secret value
 * 2. Pattern match: sk-[a-zA-Z0-9]{20,}  (OpenAI format)
 * 3. Pattern match: clp_[a-zA-Z0-9]{20,} (custom format)
 */

import fs from "node:fs";
import path from "node:path";

const REDACTED = "[REDACTED]";

/** Regex patterns for well-known API key formats */
const KEY_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /clp_[a-zA-Z0-9]{20,}/g,
];

/** Simple heuristic: treat file as text if it doesn't contain null bytes in first 512 bytes */
function isTextFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export class CredentialScrubber {
  private readonly secrets: string[];

  constructor(secrets: string[]) {
    // Only keep non-empty secrets for matching
    this.secrets = secrets.filter((s) => s.length > 0);
  }

  /** Scrub a single line of text, replacing credential matches with [REDACTED]. */
  scrubLine(line: string): string {
    let result = line;

    // 1. Exact-match injected secrets (longest first to avoid partial replacement issues)
    const sorted = [...this.secrets].sort((a, b) => b.length - a.length);
    for (const secret of sorted) {
      if (result.includes(secret)) {
        result = result.split(secret).join(REDACTED);
      }
    }

    // 2. Pattern-match well-known key formats
    for (const pattern of KEY_PATTERNS) {
      // Reset lastIndex since we reuse the regex with /g flag
      pattern.lastIndex = 0;
      result = result.replace(pattern, REDACTED);
    }

    return result;
  }

  /** Read a file, scrub each line, overwrite if any replacements were made. */
  scrubFile(filePath: string): { scrubbed: boolean; replacements: number } {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    let replacements = 0;

    const scrubbed = lines.map((line) => {
      const cleaned = this.scrubLine(line);
      if (cleaned !== line) {
        // Count each changed line as one replacement (conservative count)
        replacements += 1;
      }
      return cleaned;
    });

    if (replacements > 0) {
      fs.writeFileSync(filePath, scrubbed.join("\n"), "utf-8");
    }

    return { scrubbed: replacements > 0, replacements };
  }

  /** Traverse all text files in a directory and scrub each one. */
  scrubDirectory(dirPath: string): {
    totalReplacements: number;
    filesProcessed: number;
  } {
    let totalReplacements = 0;
    let filesProcessed = 0;

    const walk = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && isTextFile(fullPath)) {
          const { replacements } = this.scrubFile(fullPath);
          totalReplacements += replacements;
          filesProcessed += 1;
        }
      }
    };

    walk(dirPath);
    return { totalReplacements, filesProcessed };
  }
}
