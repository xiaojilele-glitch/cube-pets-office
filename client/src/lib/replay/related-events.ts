import type { ExecutionEvent } from '../../../../shared/replay/contracts';

/**
 * 关联事件查询
 *
 * 根据 messageId、decisionId、resourceId 查找与给定事件关联的其他事件。
 */

/**
 * 从事件的 eventData 中提取关联 ID。
 */
function extractRelationIds(event: ExecutionEvent): {
  messageId?: string;
  decisionId?: string;
  resourceId?: string;
} {
  const data = event.eventData as Record<string, unknown>;
  return {
    messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
    decisionId: typeof data.decisionId === 'string' ? data.decisionId : undefined,
    resourceId: typeof data.resourceId === 'string' ? data.resourceId : undefined,
  };
}

/**
 * 查找与给定事件关联的所有事件。
 * 关联条件：共享相同的 messageId、decisionId 或 resourceId。
 * 返回结果不包含原始事件本身。
 */
export function findRelatedEvents(
  targetEvent: ExecutionEvent,
  allEvents: ExecutionEvent[],
): ExecutionEvent[] {
  const targetIds = extractRelationIds(targetEvent);

  // If the target event has no relation IDs, return empty
  if (!targetIds.messageId && !targetIds.decisionId && !targetIds.resourceId) {
    return [];
  }

  const related: ExecutionEvent[] = [];

  for (const event of allEvents) {
    // Skip the target event itself
    if (event.eventId === targetEvent.eventId) continue;

    const ids = extractRelationIds(event);

    const matches =
      (targetIds.messageId && ids.messageId === targetIds.messageId) ||
      (targetIds.decisionId && ids.decisionId === targetIds.decisionId) ||
      (targetIds.resourceId && ids.resourceId === targetIds.resourceId);

    if (matches) {
      related.push(event);
    }
  }

  return related;
}
