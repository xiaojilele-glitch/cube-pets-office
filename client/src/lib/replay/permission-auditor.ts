import type {
  ExecutionEvent,
  ResourceAccessEventData,
} from '../../../../shared/replay/contracts';

/* ─── Local Types ─── */

/** A permission-related event extracted from the event stream. */
export interface PermissionEvent {
  eventId: string;
  agentId: string;
  timestamp: number;
  resourceId: string;
  requested: string;
  actual: string;
  rule: string;
  passed: boolean;
}

/** Violation statistics across the event stream. */
export interface ViolationStats {
  totalViolations: number;
  byType: Record<string, number>;
  byAgent: Record<string, number>;
}

/** A permission change event. */
export interface PermissionChange {
  eventId: string;
  agentId: string;
  timestamp: number;
  resourceId: string;
  previousPermission: string;
  newPermission: string;
}

/**
 * PermissionAuditor — 权限审计
 *
 * 从事件流中提取权限相关事件，统计违规情况，
 * 追踪权限变更历史。
 */
export class PermissionAuditor {
  /**
   * 提取权限相关事件。
   * 筛选 eventData 中包含 permissionCheck 字段的 RESOURCE_ACCESSED 事件。
   */
  getPermissionEvents(events: ExecutionEvent[]): PermissionEvent[] {
    const result: PermissionEvent[] = [];

    for (const event of events) {
      const data = event.eventData as Partial<ResourceAccessEventData>;
      if (!data.permissionCheck) continue;

      const pc = data.permissionCheck;
      result.push({
        eventId: event.eventId,
        agentId: data.agentId ?? event.sourceAgent,
        timestamp: event.timestamp,
        resourceId: data.resourceId ?? '',
        requested: pc.requested,
        actual: pc.actual,
        rule: pc.rule,
        passed: pc.passed,
      });
    }

    return result;
  }

  /**
   * 统计违规次数、类型分布、Agent 分布。
   * 违规 = permissionCheck.passed === false
   */
  getViolationStats(events: ExecutionEvent[]): ViolationStats {
    const permEvents = this.getPermissionEvents(events);
    const violations = permEvents.filter((pe) => !pe.passed);

    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};

    for (const v of violations) {
      // Group by requested permission type
      byType[v.requested] = (byType[v.requested] ?? 0) + 1;
      // Group by agent
      byAgent[v.agentId] = (byAgent[v.agentId] ?? 0) + 1;
    }

    return {
      totalViolations: violations.length,
      byType,
      byAgent,
    };
  }

  /**
   * 追踪权限变更事件。
   * 检测同一 agent + resource 组合中 actual 权限发生变化的情况。
   */
  getPermissionChanges(events: ExecutionEvent[]): PermissionChange[] {
    const permEvents = this.getPermissionEvents(events);
    // Sort by timestamp
    const sorted = [...permEvents].sort((a, b) => a.timestamp - b.timestamp);

    const changes: PermissionChange[] = [];
    // Track last known permission per agent+resource
    const lastPermission = new Map<string, string>();

    for (const pe of sorted) {
      const key = `${pe.agentId}:${pe.resourceId}`;
      const prev = lastPermission.get(key);

      if (prev !== undefined && prev !== pe.actual) {
        changes.push({
          eventId: pe.eventId,
          agentId: pe.agentId,
          timestamp: pe.timestamp,
          resourceId: pe.resourceId,
          previousPermission: prev,
          newPermission: pe.actual,
        });
      }

      lastPermission.set(key, pe.actual);
    }

    return changes;
  }
}
