import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type {
  AgentTimingSummary,
  MissionStageTiming,
  TelemetryAlert,
  TelemetrySnapshot,
} from "@shared/telemetry";

let saveTelemetrySnapshot: typeof import("./browser-telemetry-store").saveTelemetrySnapshot;
let loadTelemetrySnapshot: typeof import("./browser-telemetry-store").loadTelemetrySnapshot;

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

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

beforeEach(async () => {
  const FDBFactory = (await import("fake-indexeddb/lib/FDBFactory")).default;
  const localStorage = createLocalStorageMock();

  globalThis.indexedDB = new FDBFactory();
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: {
      indexedDB: globalThis.indexedDB,
      localStorage,
    },
    configurable: true,
    writable: true,
  });

  vi.resetModules();

  const mod = await import("./browser-telemetry-store");
  saveTelemetrySnapshot = mod.saveTelemetrySnapshot;
  loadTelemetrySnapshot = mod.loadTelemetrySnapshot;
});

describe("browser-telemetry-store", () => {
  it("save then load should return a deeply equal snapshot", async () => {
    await fc.assert(
      fc.asyncProperty(arbTelemetrySnapshot, async (snapshot) => {
        await saveTelemetrySnapshot(snapshot);
        const loaded = await loadTelemetrySnapshot();
        expect(loaded).toEqual(snapshot);
      }),
      { numRuns: 100 }
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
        }
      ),
      { numRuns: 50 }
    );
  });
});
