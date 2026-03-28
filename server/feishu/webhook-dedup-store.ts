import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface SerializedWebhookDedupFile {
  version: 1;
  entries: Array<{ key: string; expiresAt: number }>;
}

export interface FeishuWebhookDedupStore {
  has(key: string, now?: number): boolean;
  remember(key: string, expiresAt: number, now?: number): void;
}

export class InMemoryFeishuWebhookDedupStore implements FeishuWebhookDedupStore {
  protected readonly entries = new Map<string, number>();

  has(key: string, now = Date.now()): boolean {
    this.cleanup(now);
    const expiresAt = this.entries.get(key);
    return typeof expiresAt === "number" && expiresAt > now;
  }

  remember(key: string, expiresAt: number, now = Date.now()): void {
    this.cleanup(now);
    this.entries.set(key, expiresAt);
  }

  protected cleanup(now: number): boolean {
    let changed = false;
    for (const [key, expiresAt] of Array.from(this.entries.entries())) {
      if (expiresAt <= now) {
        this.entries.delete(key);
        changed = true;
      }
    }
    return changed;
  }
}

export class FileFeishuWebhookDedupStore extends InMemoryFeishuWebhookDedupStore {
  constructor(
    private readonly filePath: string,
    private readonly maxEntries = 4_096
  ) {
    super();
    this.load();
  }

  override has(key: string, now = Date.now()): boolean {
    const changed = this.cleanup(now);
    if (changed) this.save();
    return super.has(key, now);
  }

  override remember(key: string, expiresAt: number, now = Date.now()): void {
    super.remember(key, expiresAt, now);
    this.trim();
    this.save();
  }

  private trim(): void {
    const sorted = Array.from(this.entries.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, this.maxEntries);
    this.entries.clear();
    for (const [key, expiresAt] of sorted) {
      this.entries.set(key, expiresAt);
    }
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as SerializedWebhookDedupFile;
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      const now = Date.now();
      for (const entry of entries) {
        if (!entry || typeof entry.key !== "string" || typeof entry.expiresAt !== "number") {
          continue;
        }
        if (entry.expiresAt > now) {
          this.entries.set(entry.key, entry.expiresAt);
        }
      }
    } catch {
      // Ignore malformed state and start fresh.
    }
  }

  private save(): void {
    const data: SerializedWebhookDedupFile = {
      version: 1,
      entries: Array.from(this.entries.entries()).map(([key, expiresAt]) => ({
        key,
        expiresAt,
      })),
    };

    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}
