/**
 * HotColdManager — 冷热分层
 *
 * 管理 hot/cold collection，检索命中 cold 时自动提升到 hot。
 *
 * Requirements: 7.3
 */

import type { VectorStoreAdapter } from "../store/vector-store-adapter.js";
import type { MetadataStore } from "../store/metadata-store.js";

export class HotColdManager {
  constructor(
    private readonly vectorStore: VectorStoreAdapter,
    private readonly metadataStore: MetadataStore
  ) {}

  /** 将 chunk 从 hot 归档到 cold（更新 metadata storage_tier） */
  async archive(chunkIds: string[]): Promise<number> {
    let count = 0;
    for (const id of chunkIds) {
      if (this.metadataStore.updateStorageTier(id, "cold")) {
        count++;
      }
    }
    return count;
  }

  /** 将 chunk 从 cold 提升到 hot（检索命中时调用） */
  async promote(chunkIds: string[]): Promise<number> {
    let count = 0;
    for (const id of chunkIds) {
      const row = this.metadataStore.getByChunkId(id);
      if (row && row.storage_tier === "cold") {
        this.metadataStore.updateStorageTier(id, "hot");
        this.metadataStore.updateAccessTime(id);
        count++;
      }
    }
    return count;
  }

  /** 获取指定 tier 的所有 chunk IDs */
  getByTier(tier: "hot" | "cold"): string[] {
    return this.metadataStore.query({ storageTier: tier }).map(r => r.chunk_id);
  }

  /** 获取超过指定天数未访问的 hot chunk IDs */
  getStaleHotChunks(daysThreshold: number): string[] {
    const cutoff = new Date(
      Date.now() - daysThreshold * 24 * 60 * 60 * 1000
    ).toISOString();
    const hotChunks = this.metadataStore.query({ storageTier: "hot" });
    return hotChunks
      .filter(r => r.last_accessed_at < cutoff)
      .map(r => r.chunk_id);
  }

  /** 获取超过指定天数的 cold chunk IDs（待删除） */
  getExpiredColdChunks(daysThreshold: number): string[] {
    const cutoff = new Date(
      Date.now() - daysThreshold * 24 * 60 * 60 * 1000
    ).toISOString();
    const coldChunks = this.metadataStore.query({ storageTier: "cold" });
    return coldChunks.filter(r => r.ingested_at < cutoff).map(r => r.chunk_id);
  }
}
