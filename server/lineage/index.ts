/**
 * 血缘追踪模块入口
 *
 * 组装所有服务并导出单例，提供数据保留定时清理。
 */

export { JsonLineageStorage, getRetentionDays } from "./lineage-store.js";
export type { LineageStorageAdapter } from "./lineage-store.js";
export { LineageCollector } from "./lineage-collector.js";
export type { LineageLogger, LineageCollectorOptions } from "./lineage-collector.js";
export { LineageQueryService } from "./lineage-query.js";
export { LineageAuditService } from "./lineage-audit.js";
export { ChangeDetectionService } from "./change-detection.js";
export { LineageExportService } from "./lineage-export.js";

import type { LineageStorageAdapter } from "./lineage-store.js";
import { getRetentionDays } from "./lineage-store.js";

/**
 * 启动数据保留定时清理。
 * 每 intervalMs 毫秒执行一次 purgeExpired，清理超过保留天数的节点。
 */
export function startRetentionCleanup(
  store: LineageStorageAdapter,
  intervalMs = 3_600_000,
): NodeJS.Timeout {
  const retentionDays = getRetentionDays();
  return setInterval(async () => {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const purged = await store.purgeExpired(cutoff);
    if (purged > 0) {
      console.log(`[Lineage] Purged ${purged} expired nodes (retention: ${retentionDays} days)`);
    }
  }, intervalMs);
}
