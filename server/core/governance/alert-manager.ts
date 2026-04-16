/**
 * 告警管理器 (Alert Manager) — 成本治理
 *
 * 根据 MissionBudget 的 alertThresholds 评估告警，执行响应策略，
 * 通过 Socket.IO 和 Webhook 发送通知，管理告警生命周期。
 *
 * 四级默认告警：
 *   WARNING  (50%) → LOG
 *   CAUTION  (75%) → REDUCE_CONCURRENCY
 *   CRITICAL (90%) → DOWNGRADE_MODEL
 *   EXCEEDED (100%) → PAUSE_TASK
 *
 * 自定义阈值覆盖默认阈值。
 *
 * @see Requirements 3.1, 3.2, 3.3, 3.4, 3.6
 */

import { randomUUID } from "node:crypto";

import type {
  AlertThresholdConfig,
  AlertType,
  AlertResponseStrategy,
  BudgetAlert,
  MissionBudget,
} from "../../../shared/cost-governance.js";
import { auditTrail } from "./audit-trail.js";

// ---------------------------------------------------------------------------
// Default thresholds (used when MissionBudget.alertThresholds is empty)
// ---------------------------------------------------------------------------

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholdConfig[] = [
  { percent: 50, responseStrategy: "LOG" },
  { percent: 75, responseStrategy: "REDUCE_CONCURRENCY" },
  { percent: 90, responseStrategy: "DOWNGRADE_MODEL" },
  { percent: 100, responseStrategy: "PAUSE_TASK" },
];

// ---------------------------------------------------------------------------
// Percent → AlertType mapping
// ---------------------------------------------------------------------------

const PERCENT_TO_ALERT_TYPE: { percent: number; type: AlertType }[] = [
  { percent: 50, type: "WARNING" },
  { percent: 75, type: "CAUTION" },
  { percent: 90, type: "CRITICAL" },
  { percent: 100, type: "EXCEEDED" },
];

/**
 * Map a threshold percent to the closest AlertType.
 * Custom thresholds may use non-standard percentages — we pick the closest
 * bucket from the four canonical levels.
 */
function percentToAlertType(percent: number): AlertType {
  // Walk from highest to lowest; first match wins
  for (let i = PERCENT_TO_ALERT_TYPE.length - 1; i >= 0; i--) {
    if (percent >= PERCENT_TO_ALERT_TYPE[i].percent) {
      return PERCENT_TO_ALERT_TYPE[i].type;
    }
  }
  return "WARNING";
}

// ---------------------------------------------------------------------------
// AlertManager
// ---------------------------------------------------------------------------

export class AlertManager {
  /** Active (unresolved) alerts keyed by alertId */
  private activeAlerts = new Map<string, BudgetAlert>();

  /** Track which thresholds already fired per mission to avoid duplicates */
  private firedThresholds = new Map<string, Set<number>>();

  // -------------------------------------------------------------------------
  // evaluate
  // -------------------------------------------------------------------------

  /**
   * Evaluate current cost against the budget's alert thresholds.
   * Returns newly triggered alerts (thresholds that haven't fired yet).
   *
   * Custom thresholds in `budget.alertThresholds` override defaults.
   */
  evaluate(
    missionId: string,
    currentCost: number,
    budget: MissionBudget
  ): BudgetAlert[] {
    const thresholds: AlertThresholdConfig[] =
      budget.alertThresholds.length > 0
        ? budget.alertThresholds
        : DEFAULT_ALERT_THRESHOLDS;

    if (budget.costBudget <= 0) {
      return [];
    }

    const usedPercent = (currentCost / budget.costBudget) * 100;

    // Ensure we have a fired-set for this mission
    if (!this.firedThresholds.has(missionId)) {
      this.firedThresholds.set(missionId, new Set());
    }
    const fired = this.firedThresholds.get(missionId)!;

    const newAlerts: BudgetAlert[] = [];

    // Sort thresholds ascending so we fire lower ones first
    const sorted = [...thresholds].sort((a, b) => a.percent - b.percent);

    for (const th of sorted) {
      if (usedPercent >= th.percent && !fired.has(th.percent)) {
        fired.add(th.percent);

        const alert: BudgetAlert = {
          alertId: randomUUID(),
          missionId,
          alertType: percentToAlertType(th.percent),
          threshold: th.percent,
          currentCost,
          budgetRemaining: Math.max(0, budget.costBudget - currentCost),
          timestamp: Date.now(),
          action: th.responseStrategy,
          resolved: false,
        };

        this.activeAlerts.set(alert.alertId, alert);
        newAlerts.push(alert);

        // Record to audit trail
        auditTrail.record({
          action: "ALERT_TRIGGERED",
          missionId,
          details: {
            alertId: alert.alertId,
            alertType: alert.alertType,
            threshold: th.percent,
            currentCost,
            budgetRemaining: alert.budgetRemaining,
            responseStrategy: th.responseStrategy,
          },
        });
      }
    }

    return newAlerts;
  }

  // -------------------------------------------------------------------------
  // executeResponse
  // -------------------------------------------------------------------------

  /**
   * Execute the response strategy associated with an alert.
   *
   * - LOG: console.warn only
   * - REDUCE_CONCURRENCY / DOWNGRADE_MODEL / PAUSE_TASK: logged for now;
   *   actual orchestration is handled by GovernanceEngine which calls the
   *   respective sub-managers after receiving the alert.
   */
  executeResponse(alert: BudgetAlert): void {
    switch (alert.action) {
      case "LOG":
        console.warn(
          `[AlertManager] WARNING — Mission ${alert.missionId}: cost ${alert.currentCost} reached ${alert.threshold}% of budget`
        );
        break;
      case "REDUCE_CONCURRENCY":
        console.warn(
          `[AlertManager] CAUTION — Mission ${alert.missionId}: reducing concurrency (${alert.threshold}%)`
        );
        break;
      case "DOWNGRADE_MODEL":
        console.warn(
          `[AlertManager] CRITICAL — Mission ${alert.missionId}: triggering model downgrade (${alert.threshold}%)`
        );
        break;
      case "PAUSE_TASK":
        console.warn(
          `[AlertManager] EXCEEDED — Mission ${alert.missionId}: pausing task (${alert.threshold}%)`
        );
        break;
      default:
        console.warn(
          `[AlertManager] Unknown strategy "${alert.action}" for alert ${alert.alertId}`
        );
    }
  }

  // -------------------------------------------------------------------------
  // notify
  // -------------------------------------------------------------------------

  /**
   * Broadcast alert via Socket.IO (immediate, no throttle).
   * Silently skips if Socket.IO is not initialized.
   */
  notify(alert: BudgetAlert): void {
    // Dynamic import to avoid circular dependency and allow silent skip
    import("../socket.js")
      .then(({ getSocketIO }) => {
        const io = getSocketIO();
        if (io) {
          io.emit("cost_governance.alert", alert);
        }
      })
      .catch(() => {
        // Socket module not available — silently skip
      });
  }

  // -------------------------------------------------------------------------
  // getActiveAlerts
  // -------------------------------------------------------------------------

  /**
   * Return all unresolved alerts for a given mission.
   */
  getActiveAlerts(missionId: string): BudgetAlert[] {
    const result: BudgetAlert[] = [];
    this.activeAlerts.forEach(alert => {
      if (alert.missionId === missionId && !alert.resolved) {
        result.push(alert);
      }
    });
    return result;
  }

  // -------------------------------------------------------------------------
  // resolveAlert
  // -------------------------------------------------------------------------

  /**
   * Mark an alert as resolved. No-op if the alert doesn't exist.
   */
  resolveAlert(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolved = true;
    }
  }

  // -------------------------------------------------------------------------
  // helpers (for testing / reset)
  // -------------------------------------------------------------------------

  /** Reset all internal state (useful in tests). */
  _reset(): void {
    this.activeAlerts.clear();
    this.firedThresholds.clear();
  }
}

/** 单例 */
export const alertManager = new AlertManager();
