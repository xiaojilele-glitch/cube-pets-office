// Feature: agent-autonomy-upgrade - Taskforce, CostMonitor & Global Switch PBT (Properties 24-29)
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { CapabilityProfileManager } from '../core/capability-profile-manager.js';
import { TaskforceManager } from '../core/taskforce-manager.js';
import type { RuntimeMessageBus, TaskforceApplication } from '../core/taskforce-manager.js';
import { SelfAssessment } from '../core/self-assessment.js';
import type { TaskRequest } from '../core/self-assessment.js';
import { CostMonitor } from '../core/cost-monitor.js';
import { TaskAllocator } from '../core/task-allocator.js';
import { CompetitionEngine } from '../core/competition-engine.js';
import type { CompetitionTaskRequest } from '../core/competition-engine.js';
import type {
  AssessmentResult,
  AutonomyConfig,
  CompetitionSession,
  TaskforceMember,
  TaskforceSession,
} from '../../shared/autonomy-types.js';

// ─── Default Config ──────────────────────────────────────────

const DC: AutonomyConfig = {
  enabled: true,
  assessmentWeights: { w1_skillMatch: 0.4, w2_loadFactor: 0.2, w3_confidence: 0.25, w4_resource: 0.15 },
  competition: { defaultContestantCount: 3, maxDeadlineMs: 300_000, budgetRatio: 0.3 },
  taskforce: { heartbeatIntervalMs: 30_000, maxMissedHeartbeats: 3 },
  skillDecay: { inactiveDays: 30, decayRatePerWeek: 0.05 },
};

function makeMsgBus(): RuntimeMessageBus {
  return { createRoom: vi.fn(), broadcastToRoom: vi.fn(), destroyRoom: vi.fn() };
}

function makePM(c = DC) { return new CapabilityProfileManager(c); }
function makeSA(pm: CapabilityProfileManager, c = DC) { return new SelfAssessment(pm, c); }

// ─── Generators ──────────────────────────────────────────────

const arb01 = fc.double({ min: 0, max: 1, noNaN: true });

const arbAssessmentResult = fc.record({
  agentId: fc.string({ minLength: 1, maxLength: 10 }),
  taskId: fc.constant('task-1'),
  fitnessScore: arb01,
  decision: fc.constantFrom('ACCEPT' as const, 'ACCEPT_WITH_CAVEAT' as const, 'REQUEST_ASSIST' as const, 'REJECT_AND_REFER' as const),
  reason: fc.constant('test'),
  referralList: fc.constant([] as string[]),
  assessedAt: fc.constant(Date.now()),
  durationMs: fc.constant(5),
});

// ─── Property 24: Lead 选举正确性 ────────────────────────────

// Feature: agent-autonomy-upgrade, Property 24: Lead 选举正确性
// Validates: Requirements 6.1
describe('Property 24: Lead 选举正确性', () => {
  it('electLead returns the agent with the highest fitnessScore', () => {
    fc.assert(fc.property(
      fc.array(arbAssessmentResult, { minLength: 1, maxLength: 20 })
        .filter(arr => {
          // Ensure unique agentIds
          const ids = arr.map(a => a.agentId);
          return new Set(ids).size === ids.length;
        }),
      (candidates) => {
        const pm = makePM();
        const sa = makeSA(pm);
        const tfm = new TaskforceManager(sa, pm, makeMsgBus(), DC);

        const result = tfm.electLead(candidates);

        // Find the expected winner: highest fitnessScore
        const best = candidates.reduce((a, b) => b.fitnessScore > a.fitnessScore ? b : a, candidates[0]);
        expect(result).toBe(best.agentId);
      },
    ), { numRuns: 200 });
  });

  it('returns empty string for empty candidates', () => {
    const pm = makePM();
    const sa = makeSA(pm);
    const tfm = new TaskforceManager(sa, pm, makeMsgBus(), DC);
    expect(tfm.electLead([])).toBe('');
  });
});


// ─── Property 25: 应征资格条件 ───────────────────────────────

// Feature: agent-autonomy-upgrade, Property 25: 应征资格条件
// Validates: Requirements 6.3
describe('Property 25: 应征资格条件', () => {
  it('eligible iff fitnessScore >= 0.5 AND loadFactor < 0.8', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        agentId: fc.string({ minLength: 1, maxLength: 8 }),
        fitnessScore: fc.double({ min: 0, max: 1, noNaN: true }),
        loadFactor: fc.double({ min: 0, max: 1, noNaN: true }),
        estimatedCompletionTime: fc.integer({ min: 1000, max: 60_000 }),
      }),
      async (app) => {
        const pm = makePM();
        const sa = makeSA(pm);
        const tfm = new TaskforceManager(sa, pm, makeMsgBus(), DC);

        const session: TaskforceSession = {
          taskforceId: 'tf-test',
          taskId: 'task-1',
          leadAgentId: 'lead-1',
          members: [{ agentId: 'lead-1', role: 'lead', joinedAt: Date.now(), lastHeartbeat: Date.now(), online: true }],
          status: 'recruiting',
          subTasks: [],
          createdAt: Date.now(),
        };

        (tfm as any).activeSessions.set('tf-test', session);

        const applications: TaskforceApplication[] = [app];
        const members = await tfm.processApplications('tf-test', applications);

        const eligible = app.fitnessScore >= 0.5 && app.loadFactor < 0.8;
        if (eligible) {
          expect(members.length).toBe(1);
          expect(members[0].agentId).toBe(app.agentId);
        } else {
          expect(members.length).toBe(0);
        }
      },
    ), { numRuns: 200 });
  });
});

// ─── Property 26: Taskforce 角色约束 ─────────────────────────

// Feature: agent-autonomy-upgrade, Property 26: Taskforce 角色约束
// Validates: Requirements 6.5
describe('Property 26: Taskforce 角色约束', () => {
  const arbRole = fc.constantFrom('lead' as const, 'worker' as const, 'reviewer' as const);

  const arbMember = fc.record({
    agentId: fc.string({ minLength: 1, maxLength: 8 }),
    role: arbRole,
    joinedAt: fc.constant(Date.now()),
    lastHeartbeat: fc.constant(Date.now()),
    online: fc.constant(true),
  });

  it('a valid TaskforceSession has exactly one lead and all roles are valid', () => {
    fc.assert(fc.property(
      // Generate 0-5 non-lead members, then prepend exactly one lead
      fc.array(arbMember.map(m => ({ ...m, role: fc.sample(fc.constantFrom('worker' as const, 'reviewer' as const), 1)[0] })), { minLength: 0, maxLength: 5 }),
      fc.string({ minLength: 1, maxLength: 8 }),
      (workers, leadId) => {
        const leadMember: TaskforceMember = {
          agentId: leadId,
          role: 'lead',
          joinedAt: Date.now(),
          lastHeartbeat: Date.now(),
          online: true,
        };

        const members = [leadMember, ...workers];

        const session: TaskforceSession = {
          taskforceId: 'tf-test',
          taskId: 'task-1',
          leadAgentId: leadId,
          members,
          status: 'active',
          subTasks: [],
          createdAt: Date.now(),
        };

        // Exactly one lead
        const leads = session.members.filter(m => m.role === 'lead');
        expect(leads.length).toBe(1);

        // All roles are valid
        for (const m of session.members) {
          expect(['lead', 'worker', 'reviewer']).toContain(m.role);
        }
      },
    ), { numRuns: 200 });
  });

  it('formTaskforce creates session with exactly one lead member', async () => {
    const pm = makePM();
    pm.initProfile('agent-a', ['coding']);
    pm.initProfile('agent-b', ['coding']);

    const sa = makeSA(pm);
    const tfm = new TaskforceManager(sa, pm, makeMsgBus(), DC);

    const task: TaskRequest = { taskId: 'task-1', requiredSkills: ['coding'], requiredSkillWeights: new Map([['coding', 1.0]]) };
    const session = await tfm.formTaskforce(task, 'agent-a');

    const leads = session.members.filter(m => m.role === 'lead');
    expect(leads.length).toBe(1);
    for (const m of session.members) {
      expect(['lead', 'worker', 'reviewer']).toContain(m.role);
    }
  });
});


// ─── Property 27: 心跳离线检测 ───────────────────────────────

// Feature: agent-autonomy-upgrade, Property 27: 心跳离线检测
// Validates: Requirements 6.7
describe('Property 27: 心跳离线检测', () => {
  it('member goes offline after 3 missed heartbeats (90s), stays online before', () => {
    const heartbeatIntervalMs = 30_000; // 30 seconds
    const threshold = 3 * heartbeatIntervalMs; // 90 seconds

    fc.assert(fc.property(
      // elapsed time since last heartbeat in ms (0 to 200 seconds)
      fc.integer({ min: 0, max: 200_000 }),
      (elapsedMs) => {
        const config: AutonomyConfig = {
          ...DC,
          taskforce: { heartbeatIntervalMs, maxMissedHeartbeats: 3 },
        };
        const pm = makePM(config);
        const sa = makeSA(pm, config);
        const tfm = new TaskforceManager(sa, pm, makeMsgBus(), config);

        const now = Date.now();
        const lastHeartbeat = now - elapsedMs;

        const session: TaskforceSession = {
          taskforceId: 'tf-hb',
          taskId: 'task-1',
          leadAgentId: 'lead-1',
          members: [
            { agentId: 'lead-1', role: 'lead', joinedAt: now - 100_000, lastHeartbeat, online: true },
          ],
          status: 'active',
          subTasks: [],
          createdAt: now - 100_000,
        };

        (tfm as any).activeSessions.set('tf-hb', session);

        // Mock Date.now to return a fixed value
        const originalNow = Date.now;
        vi.spyOn(Date, 'now').mockReturnValue(now);

        const offlineIds = tfm.checkOfflineMembers('tf-hb');

        vi.spyOn(Date, 'now').mockRestore();

        if (elapsedMs > threshold) {
          // Should be offline
          expect(offlineIds).toContain('lead-1');
          expect(session.members[0].online).toBe(false);
        } else {
          // Should remain online
          expect(offlineIds).not.toContain('lead-1');
          expect(session.members[0].online).toBe(true);
        }
      },
    ), { numRuns: 200 });
  });
});

// ─── Property 28: 竞争 ROI 计算与告警 ───────────────────────

// Feature: agent-autonomy-upgrade, Property 28: 竞争 ROI 计算与告警
// Validates: Requirements 8.1
describe('Property 28: 竞争 ROI 计算与告警', () => {
  it('ROI = winnerQuality / normalEstimate, warns when < 1.0', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 10, noNaN: true }),
      fc.double({ min: 0.001, max: 10, noNaN: true }), // avoid zero denominator
      (winnerQuality, normalEstimate) => {
        const cm = new CostMonitor(DC);
        const roi = cm.computeROI(winnerQuality, normalEstimate);
        const expected = winnerQuality / normalEstimate;
        expect(roi).toBeCloseTo(expected, 10);
      },
    ), { numRuns: 200 });
  });

  it('ROI is Infinity when normalEstimate is 0', () => {
    const cm = new CostMonitor(DC);
    expect(cm.computeROI(0.5, 0)).toBe(Infinity);
  });

  it('recordCompetitionCost triggers warning when ROI < 1.0', () => {
    const cm = new CostMonitor(DC);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create a session where ROI will be < 1.0
    // recordCompetitionCost computes ROI as winnerQuality / (estimatedNormalTokens > 0 ? 1.0 : 0)
    // So ROI = winnerQuality / 1.0 = winnerQuality
    // When winnerQuality < 1.0, ROI < 1.0
    const session: CompetitionSession = {
      id: 'comp-test',
      taskId: 'task-1',
      contestants: [
        { agentId: 'a1', isExternal: false, tokenConsumed: 100, timedOut: false },
        { agentId: 'a2', isExternal: false, tokenConsumed: 100, timedOut: false },
      ],
      status: 'completed',
      deadline: 300_000,
      budgetApproved: true,
      startedAt: Date.now(),
      judgingResult: {
        scores: [
          { agentId: 'a1', correctness: 0.3, quality: 0.3, efficiency: 0.3, novelty: 0.3, totalWeighted: 0.3 },
          { agentId: 'a2', correctness: 0.2, quality: 0.2, efficiency: 0.2, novelty: 0.2, totalWeighted: 0.2 },
        ],
        ranking: ['a1', 'a2'],
        rationaleText: 'test',
        winnerId: 'a1',
        mergeRequired: false,
      },
    };

    const cost = cm.recordCompetitionCost(session);

    // The winner's totalWeighted is 0.3, normalEstimate is 1.0 (since estimatedNormalTokens > 0)
    // ROI = 0.3 / 1.0 = 0.3 < 1.0 → should warn
    expect(cost.roi).toBeLessThan(1.0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('COMPETITION_LOW_ROI'));

    warnSpy.mockRestore();
  });
});


// ─── Property 29: 全局开关回退 ───────────────────────────────

// Feature: agent-autonomy-upgrade, Property 29: 全局开关回退
// Validates: Requirements 8.5
describe('Property 29: 全局开关回退', () => {
  it('when autonomy disabled, TaskAllocator uses static assignment skipping self-assessment', async () => {
    fc.assert(await fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 4 }),
      async (skills) => {
        const disabledConfig: AutonomyConfig = { ...DC, enabled: false };
        const pm = makePM(disabledConfig);

        // Register agents with matching skills
        const agentId = 'agent-static';
        pm.initProfile(agentId, skills);

        const sa = makeSA(pm, disabledConfig);
        const ta = new TaskAllocator(sa, pm, disabledConfig);

        const task: TaskRequest = {
          taskId: 'task-disabled',
          requiredSkills: skills,
          requiredSkillWeights: new Map(skills.map(s => [s, 1.0])),
        };

        const decision = await ta.allocateTask(task);

        // When disabled: static assignment, no self-assessment involved
        expect(decision.strategy).toBe('DIRECT_ASSIGN');
        expect(decision.reason).toContain('Static assignment');
        expect(decision.assessments.length).toBe(0);
      },
    ), { numRuns: 100 });
  });

  it('when autonomy disabled, CompetitionEngine.shouldTrigger still evaluates conditions but allocator never reaches it', () => {
    // The global switch is enforced at the TaskAllocator level.
    // CompetitionEngine itself doesn't check the switch — the allocator skips it entirely.
    // We verify that the allocator path never invokes competition logic when disabled.
    const disabledConfig: AutonomyConfig = { ...DC, enabled: false };
    const pm = makePM(disabledConfig);
    pm.initProfile('a1', ['coding']);

    const sa = makeSA(pm, disabledConfig);
    const ce = new CompetitionEngine(pm, new CostMonitor(disabledConfig), disabledConfig);

    // Even a critical task won't matter — allocator won't call competition engine
    const criticalTask: CompetitionTaskRequest = {
      taskId: 't1',
      requiredSkills: ['coding'],
      requiredSkillWeights: new Map([['coding', 1.0]]),
      priority: 'critical',
      qualityRequirement: 'high',
      dataSecurityLevel: 'normal',
      estimatedDurationMs: 10_000,
      manualCompetition: true,
      historicalFailRate: 1.0,
      descriptionAmbiguity: 1.0,
    };

    // CompetitionEngine would trigger, but allocator bypasses it
    expect(ce.shouldTrigger(criticalTask, 0)).toBe(true);

    // The key property: allocator with disabled config does static assignment
    const ta = new TaskAllocator(sa, pm, disabledConfig);
    return ta.allocateTask({
      taskId: 't1',
      requiredSkills: ['coding'],
      requiredSkillWeights: new Map([['coding', 1.0]]),
    }).then(decision => {
      expect(decision.strategy).toBe('DIRECT_ASSIGN');
      expect(decision.assessments.length).toBe(0);
    });
  });

  it('when autonomy disabled, TaskforceManager.formTaskforce still works but allocator never triggers it', async () => {
    const disabledConfig: AutonomyConfig = { ...DC, enabled: false };
    const pm = makePM(disabledConfig);
    pm.initProfile('a1', ['coding']);

    const sa = makeSA(pm, disabledConfig);
    const tfm = new TaskforceManager(sa, pm, makeMsgBus(), disabledConfig);

    // TaskforceManager itself doesn't check the switch — it's the allocator's job
    // Verify allocator bypasses taskforce formation
    const ta = new TaskAllocator(sa, pm, disabledConfig);
    const decision = await ta.allocateTask({
      taskId: 't1',
      requiredSkills: ['coding'],
      requiredSkillWeights: new Map([['coding', 1.0]]),
    });

    expect(decision.strategy).toBe('DIRECT_ASSIGN');
    expect(decision.assessments.length).toBe(0);

    // No taskforces should have been formed
    expect(tfm.getActiveTaskforces().length).toBe(0);
  });
});
