/**
 * 告警引擎 (Alert Engine)
 *
 * 负责检测异常并发送通知。支持 5 种告警类型、自定义规则、
 * 同类告警 5 分钟去重，以及通过回调模式推送（用于 Socket.IO 集成）。
 *
 * @see Requirements 10.1, 10.2, 10.3, 10.4, 10.5
 */

import type {
  Alert,
  AlertCondition,
  AlertRule,
  AlertType,
  AlertPriority,
  AuditEntry,
} from '../../../shared/nl-command/contracts.js';
import type { AuditTrail } from './audit-trail.js';

/** Context passed to evaluate() containing current metric values and entity info. */
export interface AlertContext {
  metrics: Record<string, number>;
  entityId: string;
  entityType: 'command' | 'mission' | 'task' | 'plan';
}

/** Callback signature for alert notifications (e.g. Socket.IO push). */
export type OnAlertCallback = (alert: Alert) => void | Promise<void>;

export interface AlertEngineOptions {
  auditTrail: AuditTrail;
  onAlert?: OnAlertCallback;
}

/** Dedup window in milliseconds (5 minutes). */
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Evaluate whether a metric value satisfies an operator condition against a threshold.
 */
function evaluateCondition(value: number, condition: AlertCondition): boolean {
  switch (condition.operator) {
    case 'gt':
      return value > condition.threshold;
    case 'lt':
      return value < condition.threshold;
    case 'eq':
      return value === condition.threshold;
    case 'gte':
      return value >= condition.threshold;
    case 'lte':
      return value <= condition.threshold;
    default:
      return false;
  }
}

export class AlertEngine {
  private rules = new Map<string, AlertRule>();
  private readonly auditTrail: AuditTrail;
  private onAlert: OnAlertCallback | undefined;

  /**
   * Tracks recent alerts for deduplication.
   * Key: `${alertType}::${entityId}`, Value: triggeredAt timestamp.
   */
  private recentAlerts = new Map<string, number>();

  constructor(options: AlertEngineOptions) {
    this.auditTrail = options.auditTrail;
    this.onAlert = options.onAlert;
  }

  /** Register (or replace) an alert rule. */
  registerRule(rule: AlertRule): void {
    this.rules.set(rule.ruleId, rule);
  }

  /** Remove a rule by ID. */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /** Get a registered rule by ID. */
  getRule(ruleId: string): AlertRule | undefined {
    return this.rules.get(ruleId);
  }

  /** Get all registered rules. */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /** Replace the onAlert callback. */
  setOnAlert(cb: OnAlertCallback | undefined): void {
    this.onAlert = cb;
  }

  /**
   * Evaluate all enabled rules against the given context.
   * Returns the list of newly triggered alerts (after dedup).
   *
   * @see Requirements 10.3, 10.4
   */
  async evaluate(context: AlertContext): Promise<Alert[]> {
    const now = Date.now();
    const triggered: Alert[] = [];

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      const metricValue = context.metrics[rule.condition.metric];
      if (metricValue === undefined) continue;

      if (!evaluateCondition(metricValue, rule.condition)) continue;

      // Dedup: skip if same type + same entityId within DEDUP_WINDOW_MS
      const dedupKey = `${rule.type}::${context.entityId}`;
      const lastTriggered = this.recentAlerts.get(dedupKey);
      if (lastTriggered !== undefined && now - lastTriggered < DEDUP_WINDOW_MS) {
        continue;
      }

      const alert: Alert = {
        alertId: `alert-${now}-${Math.random().toString(36).slice(2, 8)}`,
        type: rule.type,
        priority: rule.priority,
        message: buildAlertMessage(rule, metricValue),
        entityId: context.entityId,
        entityType: context.entityType,
        triggeredAt: now,
        acknowledged: false,
        metadata: {
          ruleId: rule.ruleId,
          metric: rule.condition.metric,
          metricValue,
          threshold: rule.condition.threshold,
          operator: rule.condition.operator,
        },
      };

      // Record dedup timestamp
      this.recentAlerts.set(dedupKey, now);

      triggered.push(alert);

      // Audit trail
      await this.recordAudit(alert);

      // Notify via callback
      await this.notify(alert);
    }

    return triggered;
  }

  /**
   * Send an alert notification via the onAlert callback.
   * @see Requirement 10.2
   */
  async notify(alert: Alert): Promise<void> {
    if (this.onAlert) {
      await this.onAlert(alert);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async recordAudit(alert: Alert): Promise<void> {
    const entry: AuditEntry = {
      entryId: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operationType: 'alert_triggered',
      operator: 'system',
      content: `Alert ${alert.type} triggered for ${alert.entityType} ${alert.entityId}: ${alert.message}`,
      timestamp: alert.triggeredAt,
      result: 'success',
      entityId: alert.entityId,
      entityType: alert.entityType,
      metadata: {
        alertId: alert.alertId,
        alertType: alert.type,
        priority: alert.priority,
      },
    };
    await this.auditTrail.record(entry);
  }
}

function buildAlertMessage(rule: AlertRule, metricValue: number): string {
  const opLabels: Record<AlertCondition['operator'], string> = {
    gt: '>',
    lt: '<',
    eq: '==',
    gte: '>=',
    lte: '<=',
  };
  const op = opLabels[rule.condition.operator];
  const unit = rule.condition.unit ? ` ${rule.condition.unit}` : '';
  return `${rule.condition.metric} (${metricValue}${unit}) ${op} threshold (${rule.condition.threshold}${unit})`;
}
