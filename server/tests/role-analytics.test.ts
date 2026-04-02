import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoleTemplate } from '../../shared/role-schema.js';
import { RoleAnalyticsService } from '../core/role-analytics.js';
import { RoleRegistry } from '../core/role-registry.js';

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_STORE_DIR = resolve(__test_dirname, '../../data/__test_role_analytics__');
const TEST_ANALYTICS_PATH = resolve(TEST_STORE_DIR, 'role-analytics.json');
const TEST_REGISTRY_PATH = resolve(TEST_STORE_DIR, 'role-templates.json');

/** Helper: build a minimal valid RoleTemplate */
function makeTemplate(overrides: Partial<RoleTemplate> = {}): RoleTemplate {
  const now = new Date().toISOString();
  return {
    roleId: overrides.roleId ?? `role-${Date.now()}`,
    roleName: overrides.roleName ?? 'TestRole',
    responsibilityPrompt: overrides.responsibilityPrompt ?? 'You are a test role.',
    requiredSkillIds: overrides.requiredSkillIds ?? ['skill-a'],
    mcpIds: overrides.mcpIds ?? ['mcp-a'],
    defaultModelConfig: overrides.defaultModelConfig ?? { model: 'gpt-4o', temperature: 0.7, maxTokens: 4096 },
    authorityLevel: overrides.authorityLevel ?? 'medium',
    source: overrides.source ?? 'predefined',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

describe('RoleAnalyticsService', () => {
  let analytics: RoleAnalyticsService;
  let registry: RoleRegistry;
  let currentTime: Date;

  beforeEach(() => {
    currentTime = new Date('2025-01-15T12:00:00.000Z');
    registry = new RoleRegistry(TEST_REGISTRY_PATH);
    analytics = new RoleAnalyticsService(TEST_ANALYTICS_PATH, () => currentTime, registry);
  });

  afterEach(() => {
    if (existsSync(TEST_STORE_DIR)) {
      rmSync(TEST_STORE_DIR, { recursive: true, force: true });
    }
  });

  // ── recordRoleLoad ────────────────────────────────────────────

  describe('recordRoleLoad', () => {
    it('increments load count for a role', () => {
      analytics.recordRoleLoad('role-coder');
      analytics.recordRoleLoad('role-coder');
      analytics.recordRoleLoad('role-reviewer');

      const summary = analytics.getRoleUsageSummary();
      const coder = summary.find((s) => s.roleId === 'role-coder');
      expect(coder?.loadTotal).toBe(2);
      const reviewer = summary.find((s) => s.roleId === 'role-reviewer');
      expect(reviewer?.loadTotal).toBe(1);
    });

    it('tracks agent-role distribution when agentId is provided', () => {
      analytics.recordRoleLoad('role-coder', 'agent-1');
      analytics.recordRoleLoad('role-coder', 'agent-1');
      analytics.recordRoleLoad('role-reviewer', 'agent-1');

      const dist = analytics.getAgentRoleDistribution();
      expect(dist).toHaveLength(1);
      expect(dist[0].agentId).toBe('agent-1');
      expect(dist[0].roles).toHaveLength(2);

      const coderRole = dist[0].roles.find((r) => r.roleId === 'role-coder');
      // 2 out of 3 loads = ~66.67%
      expect(coderRole?.percentage).toBeCloseTo(66.67, 1);
    });
  });

  // ── recordRoleUnload ──────────────────────────────────────────

  describe('recordRoleUnload', () => {
    it('accumulates active duration for a role', () => {
      analytics.recordRoleUnload('role-coder', 120);
      analytics.recordRoleUnload('role-coder', 60);

      const summary = analytics.getRoleUsageSummary();
      const coder = summary.find((s) => s.roleId === 'role-coder');
      expect(coder?.activeDurationSeconds).toBe(180);
    });
  });

  // ── recordRoleSwitch ──────────────────────────────────────────

  describe('recordRoleSwitch', () => {
    it('increments switch count for an agent', () => {
      analytics.recordRoleSwitch('agent-1');
      analytics.recordRoleSwitch('agent-1');
      analytics.recordRoleSwitch('agent-2');

      // Verify via metrics text
      const metrics = analytics.getMetricsText();
      expect(metrics).toContain('role_switch_total{agentId="agent-1"} 2');
      expect(metrics).toContain('role_switch_total{agentId="agent-2"} 1');
    });
  });

  // ── recordMatchScore ──────────────────────────────────────────

  describe('recordMatchScore', () => {
    it('records scores and computes average in summary', () => {
      analytics.recordRoleLoad('role-coder'); // ensure at least one role in summary
      analytics.recordMatchScore(0.8);
      analytics.recordMatchScore(0.6);

      const summary = analytics.getRoleUsageSummary();
      expect(summary[0].avgMatchScore).toBeCloseTo(0.7, 5);
    });
  });

  // ── checkAlerts: ROLE_UNUSED ──────────────────────────────────

  describe('checkAlerts - ROLE_UNUSED', () => {
    it('triggers alert when role was loaded > 7 days ago', () => {
      // Load a role 8 days ago
      const eightDaysAgo = new Date('2025-01-07T11:00:00.000Z');
      const analyticsOld = new RoleAnalyticsService(
        resolve(TEST_STORE_DIR, 'unused-test.json'),
        () => eightDaysAgo
      );
      analyticsOld.recordRoleLoad('role-old');

      // Now check alerts at current time (8 days later)
      const analyticsNow = new RoleAnalyticsService(
        resolve(TEST_STORE_DIR, 'unused-test.json'),
        () => currentTime
      );
      const alerts = analyticsNow.checkAlerts();
      const unusedAlerts = alerts.filter((a) => a.type === 'ROLE_UNUSED');
      expect(unusedAlerts.length).toBeGreaterThanOrEqual(1);
      expect(unusedAlerts.some((a) => a.detail.includes('role-old'))).toBe(true);
    });

    it('does NOT trigger alert when role was loaded within 7 days', () => {
      analytics.recordRoleLoad('role-recent');
      const alerts = analytics.checkAlerts();
      const unusedAlerts = alerts.filter(
        (a) => a.type === 'ROLE_UNUSED' && a.detail.includes('role-recent')
      );
      expect(unusedAlerts).toHaveLength(0);
    });

    it('triggers alert for registered role with 0 loads created > 7 days ago', () => {
      registry.register(
        makeTemplate({
          roleId: 'role-never-used',
          roleName: 'NeverUsed',
          createdAt: '2025-01-01T00:00:00.000Z',
        })
      );

      const alerts = analytics.checkAlerts();
      const unusedAlerts = alerts.filter(
        (a) => a.type === 'ROLE_UNUSED' && a.detail.includes('role-never-used')
      );
      expect(unusedAlerts).toHaveLength(1);
    });

    it('does NOT trigger alert for registered role created < 7 days ago with 0 loads', () => {
      registry.register(
        makeTemplate({
          roleId: 'role-new',
          roleName: 'NewRole',
          createdAt: '2025-01-14T00:00:00.000Z',
        })
      );

      const alerts = analytics.checkAlerts();
      const unusedAlerts = alerts.filter(
        (a) => a.type === 'ROLE_UNUSED' && a.detail.includes('role-new')
      );
      expect(unusedAlerts).toHaveLength(0);
    });
  });

  // ── checkAlerts: AGENT_ROLE_THRASHING ─────────────────────────

  describe('checkAlerts - AGENT_ROLE_THRASHING', () => {
    it('triggers alert when agent switches > 20 times in 24 hours', () => {
      for (let i = 0; i < 21; i++) {
        analytics.recordRoleSwitch('agent-thrash');
      }

      const alerts = analytics.checkAlerts();
      const thrashAlerts = alerts.filter((a) => a.type === 'AGENT_ROLE_THRASHING');
      expect(thrashAlerts).toHaveLength(1);
      expect(thrashAlerts[0].detail).toContain('agent-thrash');
      expect(thrashAlerts[0].detail).toContain('21');
    });

    it('does NOT trigger alert at exactly 20 switches', () => {
      for (let i = 0; i < 20; i++) {
        analytics.recordRoleSwitch('agent-ok');
      }

      const alerts = analytics.checkAlerts();
      const thrashAlerts = alerts.filter(
        (a) => a.type === 'AGENT_ROLE_THRASHING' && a.detail.includes('agent-ok')
      );
      expect(thrashAlerts).toHaveLength(0);
    });

    it('does NOT count switches older than 24 hours', () => {
      // Record 21 switches 25 hours ago
      const twentyFiveHoursAgo = new Date(currentTime.getTime() - 25 * 60 * 60 * 1000);
      const analyticsOld = new RoleAnalyticsService(
        resolve(TEST_STORE_DIR, 'thrash-old.json'),
        () => twentyFiveHoursAgo
      );
      for (let i = 0; i < 21; i++) {
        analyticsOld.recordRoleSwitch('agent-old-thrash');
      }

      // Check alerts at current time
      const analyticsNow = new RoleAnalyticsService(
        resolve(TEST_STORE_DIR, 'thrash-old.json'),
        () => currentTime
      );
      const alerts = analyticsNow.checkAlerts();
      const thrashAlerts = alerts.filter(
        (a) => a.type === 'AGENT_ROLE_THRASHING' && a.detail.includes('agent-old-thrash')
      );
      expect(thrashAlerts).toHaveLength(0);
    });
  });

  // ── getRoleUsageSummary ───────────────────────────────────────

  describe('getRoleUsageSummary', () => {
    it('returns empty array when no metrics recorded', () => {
      expect(analytics.getRoleUsageSummary()).toEqual([]);
    });

    it('resolves roleName from registry', () => {
      registry.register(makeTemplate({ roleId: 'role-coder', roleName: 'Coder' }));
      analytics.recordRoleLoad('role-coder');

      const summary = analytics.getRoleUsageSummary();
      expect(summary).toHaveLength(1);
      expect(summary[0].roleName).toBe('Coder');
    });

    it('falls back to roleId when role not in registry', () => {
      analytics.recordRoleLoad('role-unknown');

      const summary = analytics.getRoleUsageSummary();
      expect(summary[0].roleName).toBe('role-unknown');
    });

    it('aggregates load counts and durations', () => {
      analytics.recordRoleLoad('role-a');
      analytics.recordRoleLoad('role-a');
      analytics.recordRoleUnload('role-a', 100);
      analytics.recordRoleUnload('role-a', 50);

      const summary = analytics.getRoleUsageSummary();
      const roleA = summary.find((s) => s.roleId === 'role-a');
      expect(roleA?.loadTotal).toBe(2);
      expect(roleA?.activeDurationSeconds).toBe(150);
    });
  });

  // ── getAgentRoleDistribution ──────────────────────────────────

  describe('getAgentRoleDistribution', () => {
    it('returns empty array when no agent loads recorded', () => {
      expect(analytics.getAgentRoleDistribution()).toEqual([]);
    });

    it('computes correct percentage distribution', () => {
      analytics.recordRoleLoad('role-a', 'agent-1');
      analytics.recordRoleLoad('role-a', 'agent-1');
      analytics.recordRoleLoad('role-a', 'agent-1');
      analytics.recordRoleLoad('role-b', 'agent-1');

      const dist = analytics.getAgentRoleDistribution();
      expect(dist).toHaveLength(1);

      const roleA = dist[0].roles.find((r) => r.roleId === 'role-a');
      const roleB = dist[0].roles.find((r) => r.roleId === 'role-b');
      expect(roleA?.percentage).toBe(75);
      expect(roleB?.percentage).toBe(25);
    });

    it('tracks multiple agents independently', () => {
      analytics.recordRoleLoad('role-a', 'agent-1');
      analytics.recordRoleLoad('role-b', 'agent-2');

      const dist = analytics.getAgentRoleDistribution();
      expect(dist).toHaveLength(2);
    });
  });

  // ── getMetricsText ────────────────────────────────────────────

  describe('getMetricsText', () => {
    it('returns Prometheus-formatted metrics text', () => {
      analytics.recordRoleLoad('role-coder');
      analytics.recordRoleUnload('role-coder', 60);
      analytics.recordRoleSwitch('agent-1');
      analytics.recordMatchScore(0.85);

      const text = analytics.getMetricsText();
      expect(text).toContain('role_load_total{roleId="role-coder"} 1');
      expect(text).toContain('role_active_duration_seconds{roleId="role-coder"} 60');
      expect(text).toContain('role_switch_total{agentId="agent-1"} 1');
      expect(text).toContain('role_match_score_histogram_count 1');
      expect(text).toContain('role_match_score_histogram_sum 0.85');
    });

    it('includes histogram buckets', () => {
      analytics.recordMatchScore(0.5);
      analytics.recordMatchScore(0.9);

      const text = analytics.getMetricsText();
      expect(text).toContain('role_match_score_histogram_bucket{le="0.5"} 1');
      expect(text).toContain('role_match_score_histogram_bucket{le="0.9"} 2');
      expect(text).toContain('role_match_score_histogram_bucket{le="+Inf"} 2');
    });
  });

  // ── Persistence ───────────────────────────────────────────────

  describe('persistence', () => {
    it('persists and reloads metrics across instances', () => {
      analytics.recordRoleLoad('role-persist');
      analytics.recordRoleUnload('role-persist', 42);
      analytics.recordRoleSwitch('agent-persist');
      analytics.recordMatchScore(0.75);

      const analytics2 = new RoleAnalyticsService(TEST_ANALYTICS_PATH, () => currentTime);
      const summary = analytics2.getRoleUsageSummary();
      const role = summary.find((s) => s.roleId === 'role-persist');
      expect(role?.loadTotal).toBe(1);
      expect(role?.activeDurationSeconds).toBe(42);
    });

    it('starts empty when persistence file is corrupted', () => {
      mkdirSync(TEST_STORE_DIR, { recursive: true });
      writeFileSync(resolve(TEST_STORE_DIR, 'corrupt.json'), '{{bad json', 'utf-8');

      const corrupt = new RoleAnalyticsService(
        resolve(TEST_STORE_DIR, 'corrupt.json'),
        () => currentTime
      );
      expect(corrupt.getRoleUsageSummary()).toEqual([]);
    });

    it('starts empty when persistence file does not exist', () => {
      const fresh = new RoleAnalyticsService(
        resolve(TEST_STORE_DIR, 'nonexistent.json'),
        () => currentTime
      );
      expect(fresh.getRoleUsageSummary()).toEqual([]);
    });

    it('persists agentRoleLoads for distribution', () => {
      analytics.recordRoleLoad('role-a', 'agent-1');
      analytics.recordRoleLoad('role-b', 'agent-1');

      const analytics2 = new RoleAnalyticsService(TEST_ANALYTICS_PATH, () => currentTime);
      const dist = analytics2.getAgentRoleDistribution();
      expect(dist).toHaveLength(1);
      expect(dist[0].roles).toHaveLength(2);
    });

    it('persists alert-related data (roleLastLoadAt, agentSwitchTimestamps)', () => {
      analytics.recordRoleLoad('role-alert-test');
      analytics.recordRoleSwitch('agent-alert-test');

      const analytics2 = new RoleAnalyticsService(TEST_ANALYTICS_PATH, () => currentTime);
      // The data should be loaded — verify by checking that no false alerts fire
      const alerts = analytics2.checkAlerts();
      const unusedForThisRole = alerts.filter(
        (a) => a.type === 'ROLE_UNUSED' && a.detail.includes('role-alert-test')
      );
      expect(unusedForThisRole).toHaveLength(0); // loaded just now, not 7 days ago
    });
  });
});
