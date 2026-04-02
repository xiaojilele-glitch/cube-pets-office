import { beforeEach, describe, expect, it } from 'vitest';

import type { RolePerformanceRecord } from '../../shared/role-schema.js';
import { RolePerformanceTracker, type TaskResult } from '../core/role-performance-tracker.js';

/** Helper: build a task result */
function makeTaskResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    taskId: overrides.taskId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    qualityScore: overrides.qualityScore ?? 80,
    latencyMs: overrides.latencyMs ?? 1000,
    success: overrides.success ?? true,
  };
}

describe('RolePerformanceTracker', () => {
  let tracker: RolePerformanceTracker;

  beforeEach(() => {
    tracker = new RolePerformanceTracker();
  });

  // ── updateOnTaskComplete basic ─────────────────────────────────

  describe('updateOnTaskComplete', () => {
    it('creates a new record on first task completion', () => {
      tracker.updateOnTaskComplete('agent-1', 'coder', makeTaskResult({ qualityScore: 90, latencyMs: 500, success: true }));

      const record = tracker.getPerformance('agent-1', 'coder') as RolePerformanceRecord;
      expect(record).toBeDefined();
      expect(record.totalTasks).toBe(1);
      expect(record.avgQualityScore).toBe(90);
      expect(record.avgLatencyMs).toBe(500);
      expect(record.successRate).toBe(1);
      expect(record.lowConfidence).toBe(true);
      expect(record.recentTasks).toHaveLength(1);
      expect(record.lastActiveAt).toBeTruthy();
    });

    it('increments totalTasks on each completion', () => {
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult());
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult());
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult());

      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.totalTasks).toBe(3);
      expect(record.recentTasks).toHaveLength(3);
    });

    it('recalculates avgQualityScore from recentTasks', () => {
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ qualityScore: 60 }));
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ qualityScore: 80 }));

      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.avgQualityScore).toBe(70); // (60 + 80) / 2
    });

    it('recalculates avgLatencyMs from recentTasks', () => {
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ latencyMs: 200 }));
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ latencyMs: 400 }));

      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.avgLatencyMs).toBe(300); // (200 + 400) / 2
    });

    it('tracks successRate correctly', () => {
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ success: true }));
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ success: false }));
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ success: true }));

      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      // 2 successes out of 3
      expect(record.successRate).toBeCloseTo(2 / 3, 5);
    });

    it('updates lastActiveAt on each completion', () => {
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult());
      const record1 = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      const first = record1.lastActiveAt;

      tracker.updateOnTaskComplete('a', 'r', makeTaskResult());
      const record2 = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record2.lastActiveAt).toBeTruthy();
      expect(new Date(record2.lastActiveAt).getTime()).toBeGreaterThanOrEqual(
        new Date(first).getTime()
      );
    });
  });

  // ── lowConfidence ──────────────────────────────────────────────

  describe('lowConfidence', () => {
    it('is true when totalTasks < 10', () => {
      for (let i = 0; i < 9; i++) {
        tracker.updateOnTaskComplete('a', 'r', makeTaskResult());
      }
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.totalTasks).toBe(9);
      expect(record.lowConfidence).toBe(true);
    });

    it('becomes false when totalTasks reaches 10', () => {
      for (let i = 0; i < 10; i++) {
        tracker.updateOnTaskComplete('a', 'r', makeTaskResult());
      }
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.totalTasks).toBe(10);
      expect(record.lowConfidence).toBe(false);
    });
  });

  // ── Ring Buffer ────────────────────────────────────────────────

  describe('Ring Buffer (recentTasks max 50)', () => {
    it('keeps all tasks when under 50', () => {
      for (let i = 0; i < 30; i++) {
        tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ taskId: `t-${i}` }));
      }
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.recentTasks).toHaveLength(30);
    });

    it('caps at 50 entries', () => {
      for (let i = 0; i < 55; i++) {
        tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ taskId: `t-${i}` }));
      }
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.recentTasks).toHaveLength(50);
      expect(record.totalTasks).toBe(55);
    });

    it('removes oldest entries when exceeding 50', () => {
      for (let i = 0; i < 55; i++) {
        tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ taskId: `t-${i}` }));
      }
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      // Oldest 5 should be removed (t-0 through t-4)
      expect(record.recentTasks[0].taskId).toBe('t-5');
      expect(record.recentTasks[49].taskId).toBe('t-54');
    });

    it('recalculates averages from the ring buffer window only', () => {
      // Add 50 tasks with quality 50
      for (let i = 0; i < 50; i++) {
        tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ qualityScore: 50, latencyMs: 100 }));
      }
      // Add 50 more tasks with quality 100 — old ones get evicted
      for (let i = 0; i < 50; i++) {
        tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ qualityScore: 100, latencyMs: 200 }));
      }
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      // Averages should reflect only the last 50 tasks (all quality 100)
      expect(record.avgQualityScore).toBe(100);
      expect(record.avgLatencyMs).toBe(200);
    });

    it('handles exactly 50 entries without eviction', () => {
      for (let i = 0; i < 50; i++) {
        tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ taskId: `t-${i}` }));
      }
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.recentTasks).toHaveLength(50);
      expect(record.recentTasks[0].taskId).toBe('t-0');
      expect(record.recentTasks[49].taskId).toBe('t-49');
    });

    it('handles single entry (boundary: 1 task)', () => {
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ taskId: 't-0' }));
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.recentTasks).toHaveLength(1);
      expect(record.recentTasks[0].taskId).toBe('t-0');
    });
  });

  // ── qualityScore clamping ──────────────────────────────────────

  describe('qualityScore clamping', () => {
    it('clamps qualityScore above 100 to 100', () => {
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ qualityScore: 150 }));
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.recentTasks[0].qualityScore).toBe(100);
      expect(record.avgQualityScore).toBe(100);
    });

    it('clamps qualityScore below 0 to 0', () => {
      tracker.updateOnTaskComplete('a', 'r', makeTaskResult({ qualityScore: -20 }));
      const record = tracker.getPerformance('a', 'r') as RolePerformanceRecord;
      expect(record.recentTasks[0].qualityScore).toBe(0);
      expect(record.avgQualityScore).toBe(0);
    });
  });

  // ── getPerformance ─────────────────────────────────────────────

  describe('getPerformance', () => {
    it('returns undefined for unknown agentId', () => {
      expect(tracker.getPerformance('unknown')).toBeUndefined();
    });

    it('returns undefined for unknown roleId', () => {
      tracker.updateOnTaskComplete('a', 'r1', makeTaskResult());
      expect(tracker.getPerformance('a', 'r2')).toBeUndefined();
    });

    it('returns single record when roleId is provided', () => {
      tracker.updateOnTaskComplete('a', 'r1', makeTaskResult());
      tracker.updateOnTaskComplete('a', 'r2', makeTaskResult());

      const record = tracker.getPerformance('a', 'r1');
      expect(record).toBeDefined();
      expect((record as RolePerformanceRecord).totalTasks).toBe(1);
    });

    it('returns Map of all roles when no roleId is provided', () => {
      tracker.updateOnTaskComplete('a', 'r1', makeTaskResult());
      tracker.updateOnTaskComplete('a', 'r2', makeTaskResult());

      const result = tracker.getPerformance('a');
      expect(result).toBeInstanceOf(Map);
      const map = result as Map<string, RolePerformanceRecord>;
      expect(map.size).toBe(2);
      expect(map.has('r1')).toBe(true);
      expect(map.has('r2')).toBe(true);
    });

    it('returns a copy of the map (not the internal reference)', () => {
      tracker.updateOnTaskComplete('a', 'r1', makeTaskResult());
      const map1 = tracker.getPerformance('a') as Map<string, RolePerformanceRecord>;
      const map2 = tracker.getPerformance('a') as Map<string, RolePerformanceRecord>;
      expect(map1).not.toBe(map2);
    });
  });

  // ── multi-agent isolation ──────────────────────────────────────

  describe('multi-agent isolation', () => {
    it('tracks performance independently per agent', () => {
      tracker.updateOnTaskComplete('agent-1', 'coder', makeTaskResult({ qualityScore: 90 }));
      tracker.updateOnTaskComplete('agent-2', 'coder', makeTaskResult({ qualityScore: 60 }));

      const r1 = tracker.getPerformance('agent-1', 'coder') as RolePerformanceRecord;
      const r2 = tracker.getPerformance('agent-2', 'coder') as RolePerformanceRecord;

      expect(r1.avgQualityScore).toBe(90);
      expect(r2.avgQualityScore).toBe(60);
    });

    it('tracks performance independently per role within same agent', () => {
      tracker.updateOnTaskComplete('a', 'coder', makeTaskResult({ qualityScore: 90 }));
      tracker.updateOnTaskComplete('a', 'reviewer', makeTaskResult({ qualityScore: 70 }));

      const coder = tracker.getPerformance('a', 'coder') as RolePerformanceRecord;
      const reviewer = tracker.getPerformance('a', 'reviewer') as RolePerformanceRecord;

      expect(coder.avgQualityScore).toBe(90);
      expect(reviewer.avgQualityScore).toBe(70);
    });
  });
});
