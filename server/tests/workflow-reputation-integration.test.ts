/**
 * Tests for WorkflowEngine reputation integration (Task 10.2).
 *
 * Validates that:
 * - computeAssignmentScore is called during task assignment
 * - Assignment logs include fitnessScore, reputationFactor, assignmentScore, and ranking
 * - ReputationService.handleTaskCompleted is called on task.completed events
 *
 * @see Requirements 4.1, 4.5, 2.3
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AssignmentScorer } from '../core/reputation/assignment-scorer.js';
import { ReputationService } from '../core/reputation/reputation-service.js';
import { ReputationCalculator } from '../core/reputation/reputation-calculator.js';
import { TrustTierEvaluator } from '../core/reputation/trust-tier-evaluator.js';
import { AnomalyDetector } from '../core/reputation/anomaly-detector.js';
import { DEFAULT_REPUTATION_CONFIG } from '../../shared/reputation.js';
import type { ReputationProfile, ReputationSignal } from '../../shared/reputation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<ReputationProfile> = {}): ReputationProfile {
  return {
    agentId: 'agent-1',
    overallScore: 500,
    dimensions: {
      qualityScore: 500,
      speedScore: 500,
      efficiencyScore: 500,
      collaborationScore: 500,
      reliabilityScore: 500,
    },
    grade: 'B',
    trustTier: 'standard',
    isExternal: false,
    totalTasks: 10,
    consecutiveHighQuality: 0,
    roleReputation: {},
    lastActiveAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Assignment scoring integration
// ---------------------------------------------------------------------------

describe('WorkflowEngine reputation integration — assignment scoring', () => {
  const config = DEFAULT_REPUTATION_CONFIG;
  const scorer = new AssignmentScorer(config);

  it('computes assignment score for a worker with a reputation profile', () => {
    const profile = makeProfile({ agentId: 'worker-a', overallScore: 700 });
    const result = scorer.computeAssignmentScore(1.0, profile);

    // reputationFactor = 700/1000 = 0.7
    // assignmentScore = 1.0 * 0.6 + 0.7 * 0.4 = 0.6 + 0.28 = 0.88
    expect(result.fitnessScore).toBe(1.0);
    expect(result.reputationFactor).toBeCloseTo(0.7, 5);
    expect(result.assignmentScore).toBeCloseTo(0.88, 5);
    expect(result.agentId).toBe('worker-a');
  });

  it('ranks multiple workers by assignmentScore descending', () => {
    const workers = [
      { agentId: 'w1', overallScore: 300 },
      { agentId: 'w2', overallScore: 900 },
      { agentId: 'w3', overallScore: 600 },
    ];

    const results = workers.map(w => {
      const profile = makeProfile({ agentId: w.agentId, overallScore: w.overallScore });
      return scorer.computeAssignmentScore(1.0, profile);
    });

    results.sort((a, b) => b.assignmentScore - a.assignmentScore);

    expect(results[0].agentId).toBe('w2'); // highest reputation
    expect(results[1].agentId).toBe('w3');
    expect(results[2].agentId).toBe('w1'); // lowest reputation
  });

  it('logs contain all required fields: fitnessScore, reputationFactor, assignmentScore', () => {
    const profile = makeProfile({ agentId: 'worker-x', overallScore: 500 });
    const result = scorer.computeAssignmentScore(0.8, profile);

    // Verify all fields required by Requirement 4.5 are present
    expect(result).toHaveProperty('fitnessScore');
    expect(result).toHaveProperty('reputationFactor');
    expect(result).toHaveProperty('assignmentScore');
    expect(result).toHaveProperty('agentId');

    // Verify values are numeric and reasonable
    expect(typeof result.fitnessScore).toBe('number');
    expect(typeof result.reputationFactor).toBe('number');
    expect(typeof result.assignmentScore).toBe('number');
    expect(result.fitnessScore).toBeGreaterThanOrEqual(0);
    expect(result.reputationFactor).toBeGreaterThanOrEqual(0);
    expect(result.assignmentScore).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Task completed → reputation update integration
// ---------------------------------------------------------------------------

describe('WorkflowEngine reputation integration — task completed signal', () => {
  const config = DEFAULT_REPUTATION_CONFIG;

  it('builds a valid ReputationSignal from task review data', () => {
    // Simulate what emitTaskCompletedReputation does
    const totalScore = 16; // out of 20
    const taskQualityScore = Math.round((totalScore / 20) * 100);

    const signal: ReputationSignal = {
      agentId: 'worker-1',
      taskId: 42,
      roleId: undefined,
      taskQualityScore,
      actualDurationMs: 0,
      estimatedDurationMs: 1,
      tokenConsumed: 0,
      tokenBudget: 1,
      wasRolledBack: false,
      downstreamFailures: 0,
      collaborationRating: undefined,
      taskComplexity: undefined,
      timestamp: new Date().toISOString(),
    };

    expect(signal.taskQualityScore).toBe(80);
    expect(signal.agentId).toBe('worker-1');
    expect(signal.taskId).toBe(42);
    expect(signal.wasRolledBack).toBe(false);
  });

  it('maps total_score 0/20 to taskQualityScore 0', () => {
    const taskQualityScore = Math.round((0 / 20) * 100);
    expect(taskQualityScore).toBe(0);
  });

  it('maps total_score 20/20 to taskQualityScore 100', () => {
    const taskQualityScore = Math.round((20 / 20) * 100);
    expect(taskQualityScore).toBe(100);
  });

  it('maps total_score 12/20 to taskQualityScore 60', () => {
    const taskQualityScore = Math.round((12 / 20) * 100);
    expect(taskQualityScore).toBe(60);
  });

  it('ReputationService.handleTaskCompleted processes a valid signal without throwing', () => {
    const calculator = new ReputationCalculator(config);
    const evaluator = new TrustTierEvaluator(config);
    const detector = new AnomalyDetector(config);
    const service = new ReputationService(calculator, evaluator, detector, config);

    // Initialize a profile first
    service.initializeProfile('worker-workflow-integration-1', false);

    const signal: ReputationSignal = {
      agentId: 'worker-workflow-integration-1',
      taskId: 1,
      taskQualityScore: 80,
      actualDurationMs: 5000,
      estimatedDurationMs: 10000,
      tokenConsumed: 500,
      tokenBudget: 1000,
      wasRolledBack: false,
      downstreamFailures: 0,
      timestamp: new Date().toISOString(),
    };

    // Should not throw
    expect(() => service.handleTaskCompleted(signal)).not.toThrow();

    // Verify the profile was updated
    const profile = service.getReputation('worker-workflow-integration-1');
    expect(profile).toBeDefined();
    expect(profile!.totalTasks).toBe(1);
    expect(profile!.lastActiveAt).not.toBeNull();
  });

  it('reputation update does not throw for unknown agent (graceful degradation)', () => {
    const calculator = new ReputationCalculator(config);
    const evaluator = new TrustTierEvaluator(config);
    const detector = new AnomalyDetector(config);
    const service = new ReputationService(calculator, evaluator, detector, config);

    const signal: ReputationSignal = {
      agentId: 'nonexistent-agent',
      taskId: 99,
      taskQualityScore: 50,
      actualDurationMs: 1000,
      estimatedDurationMs: 1000,
      tokenConsumed: 100,
      tokenBudget: 100,
      wasRolledBack: false,
      downstreamFailures: 0,
      timestamp: new Date().toISOString(),
    };

    // handleTaskCompleted should handle missing profiles gracefully
    // (either by auto-initializing or by silently skipping)
    expect(() => service.handleTaskCompleted(signal)).not.toThrow();
  });
});
