/**
 * 服务端日志中继 — SandboxRelay
 *
 * 为每个 Mission 维护一个内存滚动日志缓冲区（最多 200 行 FIFO），
 * 供后加入的客户端通过 `mission_log_history` 事件获取历史日志。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogBufferEntry {
  missionId: string;
  jobId: string;
  stepIndex: number;
  stream: "stdout" | "stderr";
  data: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 每个 Mission 保留的最大日志行数 */
const MAX_LINES_PER_MISSION = 200;

// ---------------------------------------------------------------------------
// SandboxRelay
// ---------------------------------------------------------------------------

export class SandboxRelay {
  private readonly logBuffers = new Map<string, LogBufferEntry[]>();
  private readonly maxLinesPerMission = MAX_LINES_PER_MISSION;

  /**
   * 追加一条日志到对应 Mission 的滚动缓冲区。
   * 当缓冲区已满时，移除最旧的条目（FIFO）。
   */
  appendLog(entry: LogBufferEntry): void {
    let buffer = this.logBuffers.get(entry.missionId);
    if (!buffer) {
      buffer = [];
      this.logBuffers.set(entry.missionId, buffer);
    }
    buffer.push(entry);
    if (buffer.length > this.maxLinesPerMission) {
      buffer.shift();
    }
  }

  /**
   * 返回指定 Mission 的缓冲日志行（按追加顺序）。
   * 如果 Mission 不存在，返回空数组。
   */
  getLogHistory(missionId: string): LogBufferEntry[] {
    return this.logBuffers.get(missionId) ?? [];
  }

  /**
   * 清理指定 Mission 的缓冲区。
   */
  clearMission(missionId: string): void {
    this.logBuffers.delete(missionId);
  }
}
