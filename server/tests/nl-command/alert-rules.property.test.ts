// Feature: nl-command-center, Property 12: alert rule evaluation correctness
// **Validates: Requirements 10.3, 10.4**

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AlertCondition, AlertRule, AlertPriority, AlertType } from '../../../shared/nl-command/contracts.js';
import { AuditTrail } from '../../core/nl-command/audit-trail.js';
import { AlertEngine, type AlertContext } from '../../core/nl-command/alert-engine.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_AUDIT_PATH = resolve(__test_dirname, '../../../data/__test_alert_rules_prop__/nl-audit.json');

function cleanup() {
  const dir = dirname(TEST_AUDIT_PATH);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// --- Reference oracle: determines if a value satisfies the operator condition ---

function shouldTrigger(value: number, operator: AlertCondition['operator'], threshold: number): boolean {
  switch (operator) {
    case 'gt':  return value > threshold;
    case 'lt':  return value < threshold;
    case 'eq':  return value === threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    default:    return false;
  }
}

// --- Generators ---

const operatorArb = fc.constantFrom<AlertCondition['operator']>('gt', 'lt', 'eq', 'gte', 'lte');
const alertTypeArb = fc.constantFrom<AlertType>('TASK_DELAYED', 'COST_EXCEEDED', 'RISK_ESCALATED', 'ERROR_OCCURRED', 'APPROVAL_REQUIRED');
const priorityArb = fc.constantFrom<AlertPriority>('critical', 'warning', 'info');
const metricNameArb = fc.stringMatching(/^[a-z_]{3,12}$/);

/** Generate a rule + metric value pair for evaluation. Each call uses a unique entityId to avoid dedup. */
const ruleAndValueArb = fc.record({
  operator: operatorArb,
  threshold: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  metricValue: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  metricName: metricNameArb,
  alertType: alertTypeArb,
  priority: priorityArb,
});

// --- Tests ---

describe('Property 12: alert rule evaluation correctness', () => {
  let auditTrail: AuditTrail;

  beforeEach(() => {
    cleanup();
    auditTrail = new AuditTrail(TEST_AUDIT_PATH);
  });

  afterEach(() => { cleanup(); });

  it('SHALL trigger an alert if and only if the metric value satisfies the operator condition', async () => {
    let counter = 0;
    await fc.assert(
      fc.asyncProperty(ruleAndValueArb, async ({ operator, threshold, metricValue, metricName, alertType, priority }) => {
        // Fresh engine per iteration to avoid dedup interference
        const engine = new AlertEngine({ auditTrail });
        const ruleId = `rule-${++counter}`;
        const entityId = `entity-${counter}`;

        const rule: AlertRule = {
          ruleId,
          type: alertType,
          condition: { metric: metricName, operator, threshold },
          priority,
          enabled: true,
        };
        engine.registerRule(rule);

        const context: AlertContext = {
          metrics: { [metricName]: metricValue },
          entityId,
          entityType: 'task',
        };

        const alerts = await engine.evaluate(context);
        const expected = shouldTrigger(metricValue, operator, threshold);

        if (expected) {
          expect(alerts).toHaveLength(1);
          expect(alerts[0].type).toBe(alertType);
          expect(alerts[0].priority).toBe(priority);
        } else {
          expect(alerts).toHaveLength(0);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('triggered alert SHALL have the priority specified in the rule', async () => {
    let counter = 0;
    await fc.assert(
      fc.asyncProperty(
        priorityArb,
        operatorArb,
        fc.double({ min: 0, max: 1e4, noNaN: true, noDefaultInfinity: true }),
        async (priority, operator, threshold) => {
          const engine = new AlertEngine({ auditTrail });
          const ruleId = `rule-pri-${++counter}`;
          const entityId = `entity-pri-${counter}`;

          // Pick a metric value that is guaranteed to trigger
          const metricValue = operator === 'gt' ? threshold + 1
            : operator === 'lt' ? threshold - 1
            : operator === 'eq' ? threshold
            : operator === 'gte' ? threshold
            : /* lte */ threshold;

          const rule: AlertRule = {
            ruleId,
            type: 'COST_EXCEEDED',
            condition: { metric: 'test_metric', operator, threshold },
            priority,
            enabled: true,
          };
          engine.registerRule(rule);

          const alerts = await engine.evaluate({
            metrics: { test_metric: metricValue },
            entityId,
            entityType: 'plan',
          });

          expect(alerts).toHaveLength(1);
          expect(alerts[0].priority).toBe(priority);
        },
      ),
      { numRuns: 20 },
    );
  });
});
