// Feature: dynamic-role-system, Property 16: ROLE_UNUSED 告警触发
/**
 * Property 16: ROLE_UNUSED 告警触发
 *
 * 对于任意角色，当其连续 7 天 role_load_total 为 0 时，
 * RoleAnalyticsService 应触发 ROLE_UNUSED 告警。
 *
 * **Validates: Requirements 7.3**
 */

import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  RoleTemplate,
  AuthorityLevel,
  RoleSource,
} from "../../shared/role-schema.js";
import { RoleRegistry } from "../core/role-registry.js";
import { RoleAnalyticsService } from "../core/role-analytics.ts";

const __test_dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = resolve(
  __test_dirname,
  "../../data/__test_role_analytics_prop__"
);
const TEST_REGISTRY_PATH = resolve(TEST_DIR, "role-templates.json");
const TEST_ANALYTICS_PATH = resolve(TEST_DIR, "role-analytics.json");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ── Arbitraries ──────────────────────────────────────────────────

const arbRoleId: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,29}$/)
  .filter(s => s.length >= 2);

const arbRoleName: fc.Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 20,
});

const arbAuthorityLevel: fc.Arbitrary<AuthorityLevel> = fc.constantFrom(
  "high",
  "medium",
  "low"
);
const arbRoleSource: fc.Arbitrary<RoleSource> = fc.constantFrom(
  "predefined",
  "generated"
);

function makeTemplate(
  overrides: Partial<RoleTemplate> & { roleId: string }
): RoleTemplate {
  const now = new Date().toISOString();
  return {
    roleName: overrides.roleName ?? overrides.roleId,
    responsibilityPrompt: "test prompt",
    requiredSkillIds: [],
    mcpIds: [],
    defaultModelConfig: { model: "gpt-4o", temperature: 0.7, maxTokens: 4096 },
    authorityLevel: "medium",
    source: "predefined",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Helper to clean up test persistence */
function cleanup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ── Property Tests ───────────────────────────────────────────────

describe("RoleAnalyticsService Property 16: ROLE_UNUSED 告警触发", () => {
  afterEach(cleanup);

  // **Validates: Requirements 7.3**
  // For any role registered > 7 days ago that has never been loaded,
  // checkAlerts() should include a ROLE_UNUSED alert for that role.
  it("triggers ROLE_UNUSED alert for roles never loaded and created > 7 days ago", () => {
    fc.assert(
      fc.property(
        arbRoleId,
        arbRoleName,
        arbAuthorityLevel,
        arbRoleSource,
        // Extra days beyond 7 (1..30) to ensure we're well past the threshold
        fc.integer({ min: 1, max: 30 }),
        (roleId, roleName, authorityLevel, source, extraDays) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);

          // "now" is a fixed point in time
          const now = new Date("2025-06-15T12:00:00.000Z");
          const nowMs = now.getTime();

          // Role was created more than 7 days ago
          const createdAt = new Date(
            nowMs - SEVEN_DAYS_MS - extraDays * 24 * 60 * 60 * 1000
          );

          const template = makeTemplate({
            roleId,
            roleName,
            authorityLevel,
            source,
            createdAt: createdAt.toISOString(),
            updatedAt: createdAt.toISOString(),
          });

          registry.register(template);

          // Create analytics service with controlled "now" — no loads recorded
          const service = new RoleAnalyticsService(
            TEST_ANALYTICS_PATH,
            () => now,
            registry
          );

          const alerts = service.checkAlerts();
          const unusedAlerts = alerts.filter(
            a => a.type === "ROLE_UNUSED" && a.detail.includes(roleId)
          );

          expect(unusedAlerts.length).toBeGreaterThanOrEqual(1);
          expect(unusedAlerts[0].type).toBe("ROLE_UNUSED");
          expect(unusedAlerts[0].detail).toContain(roleId);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.3**
  // For any role whose last load was > 7 days ago, checkAlerts() should
  // include a ROLE_UNUSED alert for that role.
  it("triggers ROLE_UNUSED alert for roles with last load > 7 days ago", () => {
    fc.assert(
      fc.property(
        arbRoleId,
        arbRoleName,
        // Days since last load beyond the 7-day threshold (1..30)
        fc.integer({ min: 1, max: 30 }),
        (roleId, roleName, extraDays) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);

          const now = new Date("2025-06-15T12:00:00.000Z");
          const nowMs = now.getTime();

          // Role was created 30 days ago
          const createdAt = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
          const template = makeTemplate({
            roleId,
            roleName,
            createdAt: createdAt.toISOString(),
            updatedAt: createdAt.toISOString(),
          });
          registry.register(template);

          // Simulate a load that happened more than 7 days ago
          const lastLoadTime = new Date(
            nowMs - SEVEN_DAYS_MS - extraDays * 24 * 60 * 60 * 1000
          );
          let currentTime = lastLoadTime;

          const service = new RoleAnalyticsService(
            TEST_ANALYTICS_PATH,
            () => currentTime,
            registry
          );

          // Record a load at the past time
          service.recordRoleLoad(roleId);

          // Now advance time to "now" for alert checking
          currentTime = now;

          const alerts = service.checkAlerts();
          const unusedAlerts = alerts.filter(
            a => a.type === "ROLE_UNUSED" && a.detail.includes(roleId)
          );

          expect(unusedAlerts.length).toBeGreaterThanOrEqual(1);
          expect(unusedAlerts[0].type).toBe("ROLE_UNUSED");
          expect(unusedAlerts[0].detail).toContain(roleId);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.3**
  // For any role loaded within the last 7 days, checkAlerts() should NOT
  // include a ROLE_UNUSED alert for that role.
  it("does NOT trigger ROLE_UNUSED alert for roles loaded within the last 7 days", () => {
    fc.assert(
      fc.property(
        arbRoleId,
        arbRoleName,
        // Hours since last load (0..167, i.e. less than 7 days = 168 hours)
        fc.integer({ min: 0, max: 166 }),
        (roleId, roleName, hoursSinceLoad) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);

          const now = new Date("2025-06-15T12:00:00.000Z");
          const nowMs = now.getTime();

          const createdAt = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
          const template = makeTemplate({
            roleId,
            roleName,
            createdAt: createdAt.toISOString(),
            updatedAt: createdAt.toISOString(),
          });
          registry.register(template);

          // Load happened within the last 7 days
          const lastLoadTime = new Date(
            nowMs - hoursSinceLoad * 60 * 60 * 1000
          );
          let currentTime = lastLoadTime;

          const service = new RoleAnalyticsService(
            TEST_ANALYTICS_PATH,
            () => currentTime,
            registry
          );

          service.recordRoleLoad(roleId);

          // Advance to "now"
          currentTime = now;

          const alerts = service.checkAlerts();
          const unusedAlerts = alerts.filter(
            a => a.type === "ROLE_UNUSED" && a.detail.includes(roleId)
          );

          expect(unusedAlerts.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.3**
  // For any role created within the last 7 days that has never been loaded,
  // checkAlerts() should NOT trigger ROLE_UNUSED (not enough time has passed).
  it("does NOT trigger ROLE_UNUSED alert for roles created within the last 7 days with no loads", () => {
    fc.assert(
      fc.property(
        arbRoleId,
        arbRoleName,
        // Hours since creation (0..166, less than 7 days)
        fc.integer({ min: 0, max: 166 }),
        (roleId, roleName, hoursSinceCreation) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);

          const now = new Date("2025-06-15T12:00:00.000Z");
          const nowMs = now.getTime();

          const createdAt = new Date(
            nowMs - hoursSinceCreation * 60 * 60 * 1000
          );
          const template = makeTemplate({
            roleId,
            roleName,
            createdAt: createdAt.toISOString(),
            updatedAt: createdAt.toISOString(),
          });
          registry.register(template);

          // No loads recorded
          const service = new RoleAnalyticsService(
            TEST_ANALYTICS_PATH,
            () => now,
            registry
          );

          const alerts = service.checkAlerts();
          const unusedAlerts = alerts.filter(
            a => a.type === "ROLE_UNUSED" && a.detail.includes(roleId)
          );

          expect(unusedAlerts.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.3**
  // Boundary test: exactly at the 7-day mark (not exceeding), no alert should fire.
  // The implementation uses strict > comparison (now - lastLoad > SEVEN_DAYS_MS).
  it("does NOT trigger ROLE_UNUSED alert at exactly the 7-day boundary", () => {
    fc.assert(
      fc.property(arbRoleId, arbRoleName, (roleId, roleName) => {
        cleanup();

        const registry = new RoleRegistry(TEST_REGISTRY_PATH);

        const now = new Date("2025-06-15T12:00:00.000Z");
        const nowMs = now.getTime();

        const createdAt = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
        const template = makeTemplate({
          roleId,
          roleName,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        });
        registry.register(template);

        // Load happened exactly 7 days ago
        const exactlySevenDaysAgo = new Date(nowMs - SEVEN_DAYS_MS);
        let currentTime = exactlySevenDaysAgo;

        const service = new RoleAnalyticsService(
          TEST_ANALYTICS_PATH,
          () => currentTime,
          registry
        );

        service.recordRoleLoad(roleId);

        // Advance to "now"
        currentTime = now;

        const alerts = service.checkAlerts();
        const unusedAlerts = alerts.filter(
          a => a.type === "ROLE_UNUSED" && a.detail.includes(roleId)
        );

        // Exactly 7 days → not > 7 days, so no alert
        expect(unusedAlerts.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: dynamic-role-system, Property 17: AGENT_ROLE_THRASHING 告警触发
/**
 * Property 17: AGENT_ROLE_THRASHING 告警触发
 *
 * 对于任意 Agent，当其在 24 小时内 role_switch_total 超过 20 时，
 * RoleAnalyticsService 应触发 AGENT_ROLE_THRASHING 告警。
 *
 * **Validates: Requirements 7.4**
 */

describe("RoleAnalyticsService Property 17: AGENT_ROLE_THRASHING 告警触发", () => {
  afterEach(cleanup);

  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  const arbAgentId: fc.Arbitrary<string> = fc
    .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
    .filter(s => s.length >= 2);

  // **Validates: Requirements 7.4**
  // For any Agent with more than 20 role switches within 24 hours,
  // checkAlerts() should include an AGENT_ROLE_THRASHING alert.
  it("triggers AGENT_ROLE_THRASHING alert when switch count exceeds 20 in 24 hours", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        // Number of switches: 21..50 (always above threshold)
        fc.integer({ min: 21, max: 50 }),
        (agentId, switchCount) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);
          const now = new Date("2025-06-15T12:00:00.000Z");
          const nowMs = now.getTime();

          // Distribute switches randomly within the last 24 hours
          let currentTime = now;
          const service = new RoleAnalyticsService(
            TEST_ANALYTICS_PATH,
            () => currentTime,
            registry
          );

          for (let i = 0; i < switchCount; i++) {
            // Each switch happens within the last 24 hours
            const offsetMs = Math.floor(
              (i / switchCount) * (TWENTY_FOUR_HOURS_MS - 1000)
            );
            currentTime = new Date(
              nowMs - TWENTY_FOUR_HOURS_MS + 1000 + offsetMs
            );
            service.recordRoleSwitch(agentId);
          }

          // Check alerts at "now"
          currentTime = now;
          const alerts = service.checkAlerts();
          const thrashingAlerts = alerts.filter(
            a => a.type === "AGENT_ROLE_THRASHING" && a.detail.includes(agentId)
          );

          expect(thrashingAlerts.length).toBe(1);
          expect(thrashingAlerts[0].type).toBe("AGENT_ROLE_THRASHING");
          expect(thrashingAlerts[0].detail).toContain(agentId);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.4**
  // For any Agent with 20 or fewer switches within 24 hours,
  // checkAlerts() should NOT include an AGENT_ROLE_THRASHING alert.
  it("does NOT trigger AGENT_ROLE_THRASHING alert when switch count is 20 or fewer", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        // Number of switches: 1..20 (at or below threshold)
        fc.integer({ min: 1, max: 20 }),
        (agentId, switchCount) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);
          const now = new Date("2025-06-15T12:00:00.000Z");
          const nowMs = now.getTime();

          let currentTime = now;
          const service = new RoleAnalyticsService(
            TEST_ANALYTICS_PATH,
            () => currentTime,
            registry
          );

          for (let i = 0; i < switchCount; i++) {
            // Each switch happens within the last 24 hours
            const offsetMs = Math.floor(
              (i / switchCount) * (TWENTY_FOUR_HOURS_MS - 1000)
            );
            currentTime = new Date(
              nowMs - TWENTY_FOUR_HOURS_MS + 1000 + offsetMs
            );
            service.recordRoleSwitch(agentId);
          }

          // Check alerts at "now"
          currentTime = now;
          const alerts = service.checkAlerts();
          const thrashingAlerts = alerts.filter(
            a => a.type === "AGENT_ROLE_THRASHING" && a.detail.includes(agentId)
          );

          expect(thrashingAlerts.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.4**
  // Switches older than 24 hours should not count toward the thrashing threshold.
  it("does NOT count switches older than 24 hours toward thrashing threshold", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        // Total switches: 21..40 but all placed BEFORE the 24-hour window
        fc.integer({ min: 21, max: 40 }),
        (agentId, switchCount) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);
          const now = new Date("2025-06-15T12:00:00.000Z");
          const nowMs = now.getTime();

          let currentTime = now;
          const service = new RoleAnalyticsService(
            TEST_ANALYTICS_PATH,
            () => currentTime,
            registry
          );

          // All switches happened more than 24 hours ago
          for (let i = 0; i < switchCount; i++) {
            const offsetMs = (i + 1) * 60 * 1000; // spread across minutes
            currentTime = new Date(nowMs - TWENTY_FOUR_HOURS_MS - offsetMs);
            service.recordRoleSwitch(agentId);
          }

          // Check alerts at "now"
          currentTime = now;
          const alerts = service.checkAlerts();
          const thrashingAlerts = alerts.filter(
            a => a.type === "AGENT_ROLE_THRASHING" && a.detail.includes(agentId)
          );

          expect(thrashingAlerts.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.4**
  // Boundary: exactly 20 switches within 24 hours should NOT trigger the alert
  // (threshold is strictly > 20).
  it("does NOT trigger AGENT_ROLE_THRASHING at exactly 20 switches (boundary)", () => {
    fc.assert(
      fc.property(arbAgentId, agentId => {
        cleanup();

        const registry = new RoleRegistry(TEST_REGISTRY_PATH);
        const now = new Date("2025-06-15T12:00:00.000Z");
        const nowMs = now.getTime();

        let currentTime = now;
        const service = new RoleAnalyticsService(
          TEST_ANALYTICS_PATH,
          () => currentTime,
          registry
        );

        // Exactly 20 switches within the last 24 hours
        for (let i = 0; i < 20; i++) {
          const offsetMs = Math.floor((i / 20) * (TWENTY_FOUR_HOURS_MS - 1000));
          currentTime = new Date(
            nowMs - TWENTY_FOUR_HOURS_MS + 1000 + offsetMs
          );
          service.recordRoleSwitch(agentId);
        }

        // Check alerts at "now"
        currentTime = now;
        const alerts = service.checkAlerts();
        const thrashingAlerts = alerts.filter(
          a => a.type === "AGENT_ROLE_THRASHING" && a.detail.includes(agentId)
        );

        expect(thrashingAlerts.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 7.4**
  // Mixed scenario: some switches within 24h, some outside. Only recent ones count.
  it("only counts switches within the 24-hour window for thrashing detection", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        // Recent switches (within 24h): 21..30
        fc.integer({ min: 21, max: 30 }),
        // Old switches (outside 24h): 1..20
        fc.integer({ min: 1, max: 20 }),
        (agentId, recentCount, oldCount) => {
          cleanup();

          const registry = new RoleRegistry(TEST_REGISTRY_PATH);
          const now = new Date("2025-06-15T12:00:00.000Z");
          const nowMs = now.getTime();

          let currentTime = now;
          const service = new RoleAnalyticsService(
            TEST_ANALYTICS_PATH,
            () => currentTime,
            registry
          );

          // Record old switches (outside 24h window)
          for (let i = 0; i < oldCount; i++) {
            currentTime = new Date(
              nowMs - TWENTY_FOUR_HOURS_MS - (i + 1) * 60 * 1000
            );
            service.recordRoleSwitch(agentId);
          }

          // Record recent switches (within 24h window)
          for (let i = 0; i < recentCount; i++) {
            const offsetMs = Math.floor(
              (i / recentCount) * (TWENTY_FOUR_HOURS_MS - 1000)
            );
            currentTime = new Date(
              nowMs - TWENTY_FOUR_HOURS_MS + 1000 + offsetMs
            );
            service.recordRoleSwitch(agentId);
          }

          // Check alerts at "now"
          currentTime = now;
          const alerts = service.checkAlerts();
          const thrashingAlerts = alerts.filter(
            a => a.type === "AGENT_ROLE_THRASHING" && a.detail.includes(agentId)
          );

          // Should trigger because recentCount > 20
          expect(thrashingAlerts.length).toBe(1);
          expect(thrashingAlerts[0].detail).toContain(agentId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
