/**
 * Property 10: IndexedDB 往返一致性
 *
 * Feature: telemetry-dashboard, Property 10: IndexedDB 往返一致性
 *
 * 生成随机 TelemetrySnapshot，验证 IndexedDB 写入后读取等价。
 *
 * **Validates: Requirements 9.2, 9.3**
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";
import type {
  TelemetrySnapshot,
  TelemetryAlert,
  AgentTimingSummary,
  MissionStageTiming,
} from "@shared/telemetry";

// Dynamic imports — reset per test for IndexedDB isolation
let saveTelemetrySnapshot: typeof import("./browser-telemetry-store").saveTelemetrySnapshot;
let loadTelemetrySnapshot: typeof import("./browser-telemetry-store").loadTelemetrySnapshot;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbAlert: fc.Arbitrary<TelemetryAlert> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom("agent_slow" as const, "token_over_budget" as const),
  agentId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  message: fc.string({ minLength: 0, maxLength: 100 }),
  timestamp: fc.nat({ max: 2_000_000_000_000 }),
  resolved: fc.boolean(),
});

const arbAgentTimingSummary: fc.Arbitrary<AgentTimingSummary> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 20 }),
  agentName: fc.string({ minLength: 1, maxLength: 30 }),
  avgDurationMs: fc.double({ min: 0, max: 1e6, noNaN: true }),
  callCount: fc.nat({ max: 10_000 }),
});

const arbMissionStageTiming: fc.Arbitrary<MissionStageTiming> = fc.record({
  stageKey: fc.string({ minLength: 1, maxLength: 20 }),
  stageLabel: fc.string({ minLength: 1, maxLength: 40 }),
  durationMs: fc.double({ min: 0, max: 1e6, noNaN: true }),
});

const arbTelemetrySnapshot: fc.Arbitrary<TelemetrySnapshot> = fc.record({
  totalTokensIn: fc.nat({ max: 1_000_000 }),
  totalTokensOut: fc.nat({ max: 1_000_000 }),
  totalCost: fc.double({ min: 0, max: 10_000, noNaN: true }),
  totalCalls: fc.nat({ max: 100_000 }),
  activeAgentCount: fc.nat({ max: 50 }),
  agentTimings: fc.array(arbAgentTimingSummary, { maxLength: 5 }),
  missionStageTimings: fc.array(arbMissionStageTiming, { maxLength: 5 }),
  alerts: fc.array(arbAlert, { maxLength: 5 }),
  updatedAt: fc.nat({ max: 2_000_000_000_000 }),
});

// ---------------------------------------------------------------------------
// Setup: fresh IndexedDB + module per test
// ---------------------------------------------------------------------------

beforeEach(async () => {
  const FDBFactory = (await import("fake-indexeddb/lib/FDBFactory")).default;
  globalThis.indexedDB = new FDBFactory();
  (globalThis as any).window = globalThis;

  vi.resetModules();

  const mod = await import("./browser-telemetry-store");
  saveTelemetrySnapshot = mod.saveTelemetrySnapshot;
  loadTelemetrySnapshot = mod.loadTelemetrySnapshot;
});

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe("Property 10: IndexedDB 往返一致性", () => {
  // Feature: telemetry-dashboard, Property 10: IndexedDB 往返一致性
  it("save then load should return a deeply equal snapshot", async () => {
    await fc.assert(
      fc.asyncProperty(arbTelemetrySnapshot, async (snapshot) => {
        await saveTelemetrySnapshot(snapshot);
        const loaded = await loadTelemetrySnapshot();
        expect(loaded).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it("load from empty DB should return null", async () => {
    const loaded = await loadTelemetrySnapshot();
    expect(loaded).toBeNull();
  });

  it("last saved snapshot wins on overwrite", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTelemetrySnapshot,
        arbTelemetrySnapshot,
        async (first, second) => {
          await saveTelemetrySnapshot(first);
          await saveTelemetrySnapshot(second);
          const loaded = await loadTelemetrySnapshot();
          expect(loaded).toEqual(second);
        },
      ),
      { numRuns: 50 },
    );
  });
});
