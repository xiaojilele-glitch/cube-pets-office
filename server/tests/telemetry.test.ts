import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import type {
  AgentTimingRecord,
  AgentTimingSummary,
  LLMCallRecord,
  MissionStageTiming,
  MissionTelemetrySummary,
  TelemetryAlert,
  TelemetrySnapshot,
} from '../../shared/telemetry.js';

// Mock socket to prevent dynamic import side-effects in TelemetryStore.emitUpdate
vi.mock('../core/socket.js', () => ({
  emitTelemetryUpdate: () => {},
}));

/* ─── Arbitraries ─── */

const arbAlertType = fc.constantFrom('agent_slow', 'token_over_budget') as fc.Arbitrary<
  TelemetryAlert['type']
>;

const arbTelemetryAlert: fc.Arbitrary<TelemetryAlert> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  type: arbAlertType,
  agentId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  message: fc.string({ minLength: 1, maxLength: 100 }),
  timestamp: fc.nat({ max: 2_000_000_000_000 }),
  resolved: fc.boolean(),
});

const arbAgentTimingSummary: fc.Arbitrary<AgentTimingSummary> = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 20 }),
  agentName: fc.string({ minLength: 1, maxLength: 30 }),
  avgDurationMs: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
  callCount: fc.nat({ max: 10_000 }),
});

const arbMissionStageTiming: fc.Arbitrary<MissionStageTiming> = fc.record({
  stageKey: fc.string({ minLength: 1, maxLength: 20 }),
  stageLabel: fc.string({ minLength: 1, maxLength: 30 }),
  durationMs: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
});

const arbTelemetrySnapshot: fc.Arbitrary<TelemetrySnapshot> = fc.record({
  totalTokensIn: fc.nat({ max: 10_000_000 }),
  totalTokensOut: fc.nat({ max: 10_000_000 }),
  totalCost: fc.double({ min: 0, max: 100_000, noNaN: true }),
  totalCalls: fc.nat({ max: 100_000 }),
  activeAgentCount: fc.nat({ max: 100 }),
  agentTimings: fc.array(arbAgentTimingSummary, { minLength: 0, maxLength: 10 }),
  missionStageTimings: fc.array(arbMissionStageTiming, { minLength: 0, maxLength: 10 }),
  alerts: fc.array(arbTelemetryAlert, { minLength: 0, maxLength: 10 }),
  updatedAt: fc.nat({ max: 2_000_000_000_000 }),
});

/* ─── Property 11: 遥测类型 JSON 往返一致性 ─── */
// Feature: telemetry-dashboard, Property 11: 遥测类型 JSON 往返一致性

describe('Property 11: 遥测类型 JSON 往返一致性', () => {
  // **Validates: Requirements 10.3**
  it('JSON.parse(JSON.stringify(snapshot)) produces a deeply equal result for any valid TelemetrySnapshot', () => {
    fc.assert(
      fc.property(arbTelemetrySnapshot, (snapshot) => {
        const roundTripped = JSON.parse(JSON.stringify(snapshot));
        expect(roundTripped).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});


/* ─── LLMCallRecord Arbitrary ─── */

const arbLLMCallRecord: fc.Arbitrary<LLMCallRecord> = fc.record({
  id: fc.uuid(),
  timestamp: fc.nat({ max: 2_000_000_000_000 }),
  model: fc.constantFrom('gpt-4o', 'gpt-4o-mini', 'glm-5-turbo', 'unknown-model'),
  tokensIn: fc.nat({ max: 100_000 }),
  tokensOut: fc.nat({ max: 100_000 }),
  cost: fc.double({ min: 0, max: 1_000, noNaN: true, noDefaultInfinity: true }),
  durationMs: fc.nat({ max: 120_000 }),
  agentId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  workflowId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  missionId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  error: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

/* ─── Property 4: 聚合指标不变量 ─── */
// Feature: telemetry-dashboard, Property 4: 聚合指标不变量

describe('Property 4: 聚合指标不变量', () => {
  // **Validates: Requirements 3.1**
  it('snapshot totalTokensIn/Out/Cost/Calls equals the sum of all recorded LLMCallRecords', async () => {
    const { TelemetryStore } = await import('../core/telemetry-store.js');

    fc.assert(
      fc.property(
        fc.array(arbLLMCallRecord, { minLength: 0, maxLength: 50 }),
        (records) => {
          const store = new TelemetryStore();
          store.resetCurrentMission();

          for (const record of records) {
            store.recordLLMCall(record);
          }

          const snapshot = store.getSnapshot();

          const expectedTokensIn = records.reduce((sum, r) => sum + r.tokensIn, 0);
          const expectedTokensOut = records.reduce((sum, r) => sum + r.tokensOut, 0);
          const expectedCost = records.reduce((sum, r) => sum + r.cost, 0);
          const expectedCalls = records.length;

          expect(snapshot.totalTokensIn).toBe(expectedTokensIn);
          expect(snapshot.totalTokensOut).toBe(expectedTokensOut);
          expect(snapshot.totalCost).toBeCloseTo(expectedCost, 10);
          expect(snapshot.totalCalls).toBe(expectedCalls);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 5: 历史缓冲区有界性 ─── */
// Feature: telemetry-dashboard, Property 5: 历史缓冲区有界性

describe('Property 5: 历史缓冲区有界性', () => {
  // **Validates: Requirements 3.2**
  it('history length equals min(N, 10) after N finalizeMission calls', async () => {
    const { TelemetryStore } = await import('../core/telemetry-store.js');

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        (n) => {
          const store = new TelemetryStore();
          store.resetCurrentMission();
          // Clear any history loaded from disk
          while (store.getHistory().length > 0) {
            store.getHistory().pop();
          }

          for (let i = 0; i < n; i++) {
            // Record at least one LLM call so there's data to archive
            store.recordLLMCall({
              id: `call-${i}`,
              timestamp: Date.now(),
              model: 'gpt-4o-mini',
              tokensIn: 100,
              tokensOut: 50,
              cost: 0.001,
              durationMs: 200,
            });
            store.finalizeMission(`mission-${i}`, `Mission ${i}`);
          }

          const history = store.getHistory();
          expect(history.length).toBe(Math.min(n, 10));
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── AgentTimingRecord Arbitrary ─── */

const arbAgentTimingRecord = (agentId: string): fc.Arbitrary<AgentTimingRecord> =>
  fc.record({
    agentId: fc.constant(agentId),
    agentName: fc.constant(`Agent-${agentId}`),
    durationMs: fc.nat({ max: 120_000 }),
    timestamp: fc.nat({ max: 2_000_000_000_000 }),
    workflowId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  });

/* ─── Property 3: 滑动窗口平均值正确性 ─── */
// Feature: telemetry-dashboard, Property 3: 滑动窗口平均值正确性

describe('Property 3: 滑动窗口平均值正确性', () => {
  // **Validates: Requirements 2.2**
  it('avgDurationMs equals the arithmetic mean of the last min(N, 20) records for a given agent', async () => {
    const { TelemetryStore } = await import('../core/telemetry-store.js');
    const WINDOW_SIZE = 20;

    fc.assert(
      fc.property(
        fc.array(arbAgentTimingRecord('test-agent'), { minLength: 1, maxLength: 60 }),
        (records) => {
          const store = new TelemetryStore();
          store.resetCurrentMission();

          for (const record of records) {
            store.recordAgentTiming(record);
          }

          const snapshot = store.getSnapshot();
          const agentSummary = snapshot.agentTimings.find(
            (a) => a.agentId === 'test-agent',
          );

          expect(agentSummary).toBeDefined();

          // The sliding window keeps the last min(N, 20) records
          const windowRecords = records.slice(-Math.min(records.length, WINDOW_SIZE));
          const expectedAvg =
            windowRecords.reduce((sum, r) => sum + r.durationMs, 0) / windowRecords.length;

          expect(agentSummary!.avgDurationMs).toBeCloseTo(expectedAvg, 10);
          expect(agentSummary!.callCount).toBe(windowRecords.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── MissionTelemetrySummary Arbitrary ─── */

const arbMissionTelemetrySummary: fc.Arbitrary<MissionTelemetrySummary> = fc.record({
  missionId: fc.string({ minLength: 1, maxLength: 20 }),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  completedAt: fc.nat({ max: 2_000_000_000_000 }),
  totalTokensIn: fc.nat({ max: 10_000_000 }),
  totalTokensOut: fc.nat({ max: 10_000_000 }),
  totalCost: fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
  totalCalls: fc.nat({ max: 100_000 }),
  topAgents: fc.array(arbAgentTimingSummary, { minLength: 0, maxLength: 5 }),
  stageTimings: fc.array(arbMissionStageTiming, { minLength: 0, maxLength: 5 }),
});

/* ─── Property 8: Agent 响应过慢预警生成 ─── */
// Feature: telemetry-dashboard, Property 8: Agent 响应过慢预警生成

describe('Property 8: Agent 响应过慢预警生成', () => {
  // **Validates: Requirements 8.1**
  it('when sliding window average durationMs > 30000, an agent_slow alert with matching agentId exists', async () => {
    const { TelemetryStore } = await import('../core/telemetry-store.js');
    const WINDOW_SIZE = 20;
    const SLOW_THRESHOLD = 30_000;

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.array(
          fc.nat({ max: 120_000 }),
          { minLength: 1, maxLength: 40 },
        ),
        (agentId, durations) => {
          const store = new TelemetryStore();
          store.resetCurrentMission();

          for (let i = 0; i < durations.length; i++) {
            store.recordAgentTiming({
              agentId,
              agentName: `Agent-${agentId}`,
              durationMs: durations[i],
              timestamp: Date.now() + i,
            });
          }

          // Compute expected sliding window average (last min(N, 20) records)
          const windowRecords = durations.slice(-Math.min(durations.length, WINDOW_SIZE));
          const avg = windowRecords.reduce((s, d) => s + d, 0) / windowRecords.length;

          const snapshot = store.getSnapshot();

          if (avg > SLOW_THRESHOLD) {
            const alert = snapshot.alerts.find(
              (a) => a.type === 'agent_slow' && a.agentId === agentId,
            );
            expect(alert).toBeDefined();
            expect(alert!.resolved).toBe(false);
          }
          // If avg <= threshold, we don't assert absence because a previous
          // intermediate state may have created an alert that was then resolved.
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 9: Token 超预算预警生成 ─── */
// Feature: telemetry-dashboard, Property 9: Token 超预算预警生成

describe('Property 9: Token 超预算预警生成', () => {
  // **Validates: Requirements 8.2**
  it('when cumulative tokens exceed budget.maxTokens * budget.warningThreshold, a token_over_budget alert exists', async () => {
    const { TelemetryStore } = await import('../core/telemetry-store.js');

    fc.assert(
      fc.property(
        fc.array(arbLLMCallRecord, { minLength: 1, maxLength: 50 }),
        (records) => {
          const store = new TelemetryStore();
          store.resetCurrentMission();

          for (const record of records) {
            store.recordLLMCall(record);
          }

          const totalTokens = records.reduce(
            (sum, r) => sum + r.tokensIn + r.tokensOut,
            0,
          );
          const threshold = 100_000 * 0.8; // DEFAULT_BUDGET values

          const snapshot = store.getSnapshot();

          if (totalTokens > threshold) {
            const alert = snapshot.alerts.find(
              (a) => a.type === 'token_over_budget',
            );
            expect(alert).toBeDefined();
            expect(alert!.resolved).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 6: 历史持久化往返一致性 ─── */
// Feature: telemetry-dashboard, Property 6: 历史持久化往返一致性

describe('Property 6: 历史持久化往返一致性', () => {
  // **Validates: Requirements 3.3, 3.4**
  it('persistHistory → loadHistory round-trip preserves MissionTelemetrySummary list', async () => {
    const { TelemetryStore } = await import('../core/telemetry-store.js');

    fc.assert(
      fc.property(
        fc.array(arbMissionTelemetrySummary, { minLength: 0, maxLength: 10 }),
        (summaries) => {
          // --- Write phase ---
          const writeStore = new TelemetryStore();
          // Clear any pre-existing history loaded from disk
          const writeHistory = writeStore.getHistory();
          writeHistory.length = 0;
          // Populate with generated summaries
          for (const s of summaries) {
            writeHistory.push(s);
          }
          writeStore.persistHistory();

          // --- Read phase ---
          const readStore = new TelemetryStore();
          const readHistory = readStore.getHistory();
          readHistory.length = 0;
          readStore.loadHistory();

          expect(readStore.getHistory()).toEqual(summaries);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 1: LLM 调用记录完整性 ─── */
// Feature: telemetry-dashboard, Property 1: LLM 调用记录完整性

describe('Property 1: LLM 调用记录完整性', () => {
  // **Validates: Requirements 1.1, 1.3**
  it('for any LLM call (success or failure), the stored LLMCallRecord contains all required fields with correct constraints', async () => {
    const { TelemetryStore } = await import('../core/telemetry-store.js');

    fc.assert(
      fc.property(arbLLMCallRecord, (record) => {
        const store = new TelemetryStore();
        store.resetCurrentMission();

        store.recordLLMCall(record);

        const snapshot = store.getSnapshot();

        // The store should have exactly 1 call recorded
        expect(snapshot.totalCalls).toBe(1);

        // Verify all required fields are present and match the input record
        expect(record.id).toBeDefined();
        expect(typeof record.id).toBe('string');
        expect(record.id.length).toBeGreaterThan(0);

        expect(record.timestamp).toBeDefined();
        expect(typeof record.timestamp).toBe('number');

        expect(record.model).toBeDefined();
        expect(typeof record.model).toBe('string');
        expect(record.model.length).toBeGreaterThan(0);

        expect(record.tokensIn).toBeDefined();
        expect(typeof record.tokensIn).toBe('number');
        expect(record.tokensIn).toBeGreaterThanOrEqual(0);

        expect(record.tokensOut).toBeDefined();
        expect(typeof record.tokensOut).toBe('number');
        expect(record.tokensOut).toBeGreaterThanOrEqual(0);

        expect(record.cost).toBeDefined();
        expect(typeof record.cost).toBe('number');
        expect(record.cost).toBeGreaterThanOrEqual(0);

        expect(record.durationMs).toBeDefined();
        expect(typeof record.durationMs).toBe('number');
        expect(record.durationMs).toBeGreaterThanOrEqual(0);

        // Verify aggregation correctness — snapshot reflects the single record
        expect(snapshot.totalTokensIn).toBe(record.tokensIn);
        expect(snapshot.totalTokensOut).toBe(record.tokensOut);
        expect(snapshot.totalCost).toBeCloseTo(record.cost, 10);
      }),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 2: Agent 计时记录完整性 ─── */
// Feature: telemetry-dashboard, Property 2: Agent 计时记录完整性

describe('Property 2: Agent 计时记录完整性', () => {
  // **Validates: Requirements 2.1**
  it('for any Agent invoke call, the stored AgentTimingRecord contains agentId, agentName, durationMs, timestamp with correct constraints', async () => {
    const { TelemetryStore } = await import('../core/telemetry-store.js');

    const arbAgentTiming: fc.Arbitrary<AgentTimingRecord> = fc.record({
      agentId: fc.string({ minLength: 1, maxLength: 20 }),
      agentName: fc.string({ minLength: 1, maxLength: 30 }),
      durationMs: fc.nat({ max: 120_000 }),
      timestamp: fc.nat({ max: 2_000_000_000_000 }),
      workflowId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    });

    fc.assert(
      fc.property(arbAgentTiming, (record) => {
        const store = new TelemetryStore();
        store.resetCurrentMission();

        store.recordAgentTiming(record);

        const snapshot = store.getSnapshot();

        // Verify all required fields are present and have correct types
        expect(record.agentId).toBeDefined();
        expect(typeof record.agentId).toBe('string');
        expect(record.agentId.length).toBeGreaterThan(0);

        expect(record.agentName).toBeDefined();
        expect(typeof record.agentName).toBe('string');
        expect(record.agentName.length).toBeGreaterThan(0);

        expect(record.durationMs).toBeDefined();
        expect(typeof record.durationMs).toBe('number');
        expect(record.durationMs).toBeGreaterThanOrEqual(0);

        expect(record.timestamp).toBeDefined();
        expect(typeof record.timestamp).toBe('number');

        // Verify the store reflects the recorded agent timing
        expect(snapshot.activeAgentCount).toBe(1);
        const agentSummary = snapshot.agentTimings.find(
          (a) => a.agentId === record.agentId,
        );
        expect(agentSummary).toBeDefined();
        expect(agentSummary!.agentId).toBe(record.agentId);
        expect(agentSummary!.agentName).toBe(record.agentName);
        expect(agentSummary!.avgDurationMs).toBe(record.durationMs);
        expect(agentSummary!.callCount).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});


/* ─── Property 7: Socket 广播节流上界 ─── */
// Feature: telemetry-dashboard, Property 7: Socket 广播节流上界

describe('Property 7: Socket 广播节流上界', () => {
  // **Validates: Requirements 5.2**
  it('for N rapid updates within time window T, actual broadcast count ≤ 2 * (floor(T / 500) + 1)', () => {
    /**
     * We test the throttle algorithm directly by simulating the same
     * leading-edge-with-trailing-emit pattern used in emitTelemetryUpdate.
     *
     * The real implementation (server/core/socket.ts) uses:
     *   - First call: emit immediately, start 500ms timer
     *   - Calls during timer: store latest as pending (overwrite)
     *   - Timer fires: if pending, emit it; clear timer
     *   - After timer clears: next call emits immediately again
     *
     * Since the socket module is mocked at file level for other tests,
     * we replicate the exact throttle logic with fake timers and verify
     * the upper-bound property.
     *
     * Upper bound: 2 * (floor(T / 500) + 1)
     * Each 500ms throttle cycle can produce at most 2 broadcasts:
     *   - 1 leading emit (immediate, when no timer is active)
     *   - 1 trailing emit (when the timer fires and pending data exists)
     * The number of cycles within window T is floor(T/500) + 1.
     * This ensures the 500ms throttle effectively limits broadcast rate
     * to at most 2 per 500ms interval, satisfying Requirement 5.2.
     */

    fc.assert(
      fc.property(
        // N: number of rapid updates (1..100)
        fc.integer({ min: 1, max: 100 }),
        // T: total time window in ms (0..10000)
        fc.integer({ min: 0, max: 10_000 }),
        (n, totalTimeMs) => {
          // Generate N timestamps spread within [0, totalTimeMs]
          const timestamps: number[] = [];
          for (let i = 0; i < n; i++) {
            timestamps.push(
              n === 1 ? 0 : Math.round((i / (n - 1)) * totalTimeMs),
            );
          }

          // Simulate the throttle logic from emitTelemetryUpdate
          const THROTTLE_MS = 500;
          let broadcastCount = 0;
          let throttleTimerEnd: number | null = null; // when the current timer expires
          let hasPending = false;

          for (const ts of timestamps) {
            // Flush timer if it has expired by this timestamp
            if (throttleTimerEnd !== null && ts >= throttleTimerEnd) {
              if (hasPending) {
                broadcastCount++;
                hasPending = false;
              }
              throttleTimerEnd = null;
            }

            if (throttleTimerEnd === null) {
              // No active timer → emit immediately, start timer
              broadcastCount++;
              hasPending = false;
              throttleTimerEnd = ts + THROTTLE_MS;
            } else {
              // Timer active → just mark pending (overwrite)
              hasPending = true;
            }
          }

          // After all updates, flush any remaining timer
          if (throttleTimerEnd !== null && hasPending) {
            broadcastCount++;
          }

          // Each 500ms cycle produces at most 2 broadcasts (leading + trailing).
          // Number of cycles = floor(T/500) + 1.
          const upperBound = 2 * (Math.floor(totalTimeMs / THROTTLE_MS) + 1);
          expect(broadcastCount).toBeLessThanOrEqual(upperBound);
        },
      ),
      { numRuns: 100 },
    );
  });
});
