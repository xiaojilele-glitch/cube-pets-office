/**
 * WeightTuner — 权重调优和告警
 *
 * 监控 utilizationRate 趋势，连续低于阈值时发出 RETRIEVAL_GAP_DETECTED 告警。
 *
 * Requirements: 6.3
 */

import type { FeedbackCollector } from "./feedback-collector.js";

export interface WeightTunerOptions {
  /** utilizationRate 低于此值视为"低利用率"，默认 0.3 */
  lowUtilizationThreshold?: number;
  /** 连续低利用率次数达到此值时触发告警，默认 5 */
  consecutiveThreshold?: number;
}

export type AlertHandler = (alert: RetrievalGapAlert) => void;

export interface RetrievalGapAlert {
  type: "RETRIEVAL_GAP_DETECTED";
  consecutiveCount: number;
  avgUtilizationRate: number;
  timestamp: string;
}

export class WeightTuner {
  private readonly lowThreshold: number;
  private readonly consecutiveThreshold: number;
  private alertHandlers: AlertHandler[] = [];

  constructor(options?: WeightTunerOptions) {
    this.lowThreshold = options?.lowUtilizationThreshold ?? 0.3;
    this.consecutiveThreshold = options?.consecutiveThreshold ?? 5;
  }

  /** 注册告警处理器 */
  onAlert(handler: AlertHandler): void {
    this.alertHandlers.push(handler);
  }

  /**
   * 检查最近的 utilizationRate 趋势。
   * 如果连续 N 次低于阈值，触发 RETRIEVAL_GAP_DETECTED 告警。
   * 返回是否触发了告警。
   */
  check(feedbackCollector: FeedbackCollector): boolean {
    const rates = feedbackCollector.recentUtilizationRates(
      this.consecutiveThreshold
    );

    if (rates.length < this.consecutiveThreshold) return false;

    const allLow = rates.every(r => r < this.lowThreshold);
    if (!allLow) return false;

    const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
    const alert: RetrievalGapAlert = {
      type: "RETRIEVAL_GAP_DETECTED",
      consecutiveCount: rates.length,
      avgUtilizationRate: avg,
      timestamp: new Date().toISOString(),
    };

    for (const handler of this.alertHandlers) {
      try {
        handler(alert);
      } catch {
        /* ignore handler errors */
      }
    }

    return true;
  }
}
