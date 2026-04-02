/**
 * Collaboration Replay System — Replay Store Interface
 *
 * 定义 ReplayStoreInterface 抽象接口，
 * 服务端（ServerReplayStore）和前端（BrowserReplayStore）均实现此接口。
 */

import type { ExecutionEvent, EventQuery, ExecutionTimeline } from './contracts';

export interface ReplayStoreInterface {
  /** 追加事件（增量写入） */
  appendEvents(missionId: string, events: ExecutionEvent[]): Promise<void>;

  /** 按条件查询事件 */
  queryEvents(query: EventQuery): Promise<ExecutionEvent[]>;

  /** 获取时间轴概要 */
  getTimeline(missionId: string): Promise<ExecutionTimeline>;

  /** 导出事件流 */
  exportEvents(missionId: string, format: 'json' | 'csv'): Promise<string>;

  /** 验证数据完整性 */
  verifyIntegrity(missionId: string): Promise<boolean>;

  /** 压缩存储 */
  compact(missionId: string): Promise<void>;

  /** 清理过期数据，返回被清理的记录数 */
  cleanup(olderThanDays: number): Promise<number>;
}
