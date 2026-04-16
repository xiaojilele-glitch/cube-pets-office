/**
 * TimestampProvider — 可信时间源
 *
 * 为审计链提供双时间戳（system + trusted + skew）：
 * - now()：返回系统时间 + 可信时间 + 偏差
 * - estimateNtpOffset()：NTP 偏移估算（开发环境 offset=0）
 * - verifyTimestamp()：检查系统时间与可信时间偏差 < 1 秒
 * - 时间倒退检测和告警
 */

import type { AuditLogEntry } from "../../shared/audit/contracts.js";

// ─── TimestampProvider 类 ──────────────────────────────────────────────────

export class TimestampProvider {
  private lastSystemTime: number = 0;
  private ntpOffset: number = 0;
  private onTimeRegression?: (current: number, last: number) => void;

  // ─── 4.1 now() ─────────────────────────────────────────────────────────

  /**
   * 返回双时间戳：
   * - system: 系统时间 (Date.now())
   * - trusted: 可信时间 (system + ntpOffset)
   * - skew: 偏差 |system - trusted|
   *
   * 同时进行时间倒退检测。
   */
  now(): { system: number; trusted: number; skew: number } {
    const system = Date.now();
    const trusted = system + this.ntpOffset;
    const skew = Math.abs(system - trusted);

    // 4.4 时间倒退检测
    if (this.lastSystemTime > 0 && system < this.lastSystemTime) {
      console.warn(
        `[TimestampProvider] Time regression detected: current=${system}, last=${this.lastSystemTime}, delta=${this.lastSystemTime - system}ms`
      );
      if (this.onTimeRegression) {
        this.onTimeRegression(system, this.lastSystemTime);
      }
    }

    this.lastSystemTime = system;

    return { system, trusted, skew };
  }

  // ─── 4.2 NTP 偏移估算（开发环境） ──────────────────────────────────────

  /**
   * 开发环境下的 NTP 偏移估算。
   * 简单实现：使用 Date.now() 作为基线，offset = 0。
   * 生产环境可集成 RFC 3161 TSA 服务。
   */
  estimateNtpOffset(): void {
    // 开发环境：偏移为 0（系统时间即可信时间）
    this.ntpOffset = 0;
  }

  // ─── 4.3 verifyTimestamp() ──────────────────────────────────────────────

  /**
   * 验证审计日志条目的时间戳偏差是否在允许范围内（< 1 秒）。
   * - 如果 trusted 未定义，返回 true（可信时间戳是可选的）
   * - 检查 |system - trusted| < 1000ms
   */
  verifyTimestamp(entry: AuditLogEntry): boolean {
    if (entry.timestamp.trusted === undefined) {
      return true;
    }
    return Math.abs(entry.timestamp.system - entry.timestamp.trusted) < 1000;
  }

  // ─── 4.4 时间倒退检测 handler ──────────────────────────────────────────

  /**
   * 设置时间倒退回调。当检测到系统时间倒退时触发。
   */
  setTimeRegressionHandler(
    handler: (current: number, last: number) => void
  ): void {
    this.onTimeRegression = handler;
  }

  // ─── 内部工具 ──────────────────────────────────────────────────────────

  /** 获取当前 NTP 偏移量（用于测试） */
  getNtpOffset(): number {
    return this.ntpOffset;
  }

  /** 重置内部状态（用于测试） */
  reset(): void {
    this.lastSystemTime = 0;
    this.ntpOffset = 0;
    this.onTimeRegression = undefined;
  }
}

// ─── 导出单例 ──────────────────────────────────────────────────────────────

export const timestampProvider = new TimestampProvider();
