import { describe, it, expect, vi } from "vitest";
import { NLCommandSocketEmitter } from "../../core/nl-command/socket-emitter.js";
import { NL_COMMAND_SOCKET_EVENTS } from "../../../shared/nl-command/socket.js";
import type {
  StrategicCommand,
  CommandAnalysis,
  ClarificationQuestion,
  MissionDecomposition,
  NLExecutionPlan,
  PlanAdjustment,
  Alert,
} from "../../../shared/nl-command/contracts.js";

function makeEmitSpy() {
  return vi.fn<(event: string, payload: unknown) => void>();
}

function makeCommand(): StrategicCommand {
  return {
    commandId: "cmd-1",
    commandText: "Refactor payment module",
    userId: "user-1",
    timestamp: Date.now(),
    status: "draft",
    constraints: [],
    objectives: ["zero downtime"],
    priority: "high",
  };
}

function makeAnalysis(): CommandAnalysis {
  return {
    intent: "refactor",
    entities: [],
    constraints: [],
    objectives: ["zero downtime"],
    risks: [],
    assumptions: [],
    confidence: 0.9,
    needsClarification: false,
  };
}

function makeDecomposition(): MissionDecomposition {
  return {
    decompositionId: "dec-1",
    commandId: "cmd-1",
    missions: [],
    dependencies: [],
    executionOrder: [],
    totalEstimatedDuration: 100,
    totalEstimatedCost: 500,
  };
}

function makePlan(): NLExecutionPlan {
  return {
    planId: "plan-1",
    commandId: "cmd-1",
    status: "draft",
    missions: [],
    tasks: [],
    timeline: {
      startDate: "",
      endDate: "",
      criticalPath: [],
      milestones: [],
      entries: [],
    },
    resourceAllocation: { entries: [], totalAgents: 0, peakConcurrency: 0 },
    riskAssessment: { risks: [], overallRiskLevel: "low" },
    costBudget: {
      totalBudget: 0,
      missionCosts: {},
      taskCosts: {},
      agentCosts: {},
      modelCosts: {},
      currency: "USD",
    },
    contingencyPlan: {
      alternatives: [],
      degradationStrategies: [],
      rollbackPlan: "",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("NLCommandSocketEmitter", () => {
  it("emitCommandCreated sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);
    const cmd = makeCommand();

    emitter.emitCommandCreated(cmd);

    expect(emit).toHaveBeenCalledOnce();
    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.commandCreated);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.commandCreated,
      command: cmd,
    });
    expect((payload as any).issuedAt).toBeTypeOf("number");
  });

  it("emitCommandAnalysis sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);
    const analysis = makeAnalysis();

    emitter.emitCommandAnalysis("cmd-1", analysis);

    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.commandAnalysis);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.commandAnalysis,
      commandId: "cmd-1",
      analysis,
    });
  });

  it("emitClarificationQuestion sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);
    const questions: ClarificationQuestion[] = [
      { questionId: "q-1", text: "Which module?", type: "free_text" },
    ];

    emitter.emitClarificationQuestion("cmd-1", questions);

    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.clarificationQuestion);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.clarificationQuestion,
      commandId: "cmd-1",
      questions,
    });
  });

  it("emitDecompositionComplete sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);
    const decomposition = makeDecomposition();

    emitter.emitDecompositionComplete("cmd-1", decomposition);

    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.decompositionComplete);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.decompositionComplete,
      commandId: "cmd-1",
      decomposition,
    });
  });

  it("emitPlanGenerated sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);
    const plan = makePlan();

    emitter.emitPlanGenerated("cmd-1", plan);

    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.planGenerated);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.planGenerated,
      commandId: "cmd-1",
      plan,
    });
  });

  it("emitPlanApproved sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);

    emitter.emitPlanApproved("plan-1", ["user-a", "user-b"]);

    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.planApproved);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.planApproved,
      planId: "plan-1",
      approvedBy: ["user-a", "user-b"],
    });
  });

  it("emitPlanAdjusted sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);
    const adjustment: PlanAdjustment = {
      adjustmentId: "adj-1",
      planId: "plan-1",
      reason: "delay",
      changes: [],
      impact: { timelineImpact: "+1d", costImpact: "+10%", riskImpact: "none" },
      approvalRequired: false,
      status: "applied",
      createdAt: Date.now(),
    };

    emitter.emitPlanAdjusted("plan-1", adjustment);

    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.planAdjusted);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.planAdjusted,
      planId: "plan-1",
      adjustment,
    });
  });

  it("emitAlert sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);
    const alert: Alert = {
      alertId: "alert-1",
      type: "COST_EXCEEDED",
      priority: "critical",
      message: "Budget exceeded",
      entityId: "plan-1",
      entityType: "plan",
      triggeredAt: Date.now(),
      acknowledged: false,
    };

    emitter.emitAlert(alert);

    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.alert);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.alert,
      alert,
    });
  });

  it("emitProgressUpdate sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);

    emitter.emitProgressUpdate({
      commandId: "cmd-1",
      planId: "plan-1",
      progress: 0.5,
      status: "executing",
    });

    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.progressUpdate);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.progressUpdate,
      commandId: "cmd-1",
      planId: "plan-1",
      progress: 0.5,
      status: "executing",
    });
  });

  it("emitSuggestion sends correct event and payload", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);

    emitter.emitSuggestion({
      planId: "plan-1",
      suggestionType: "cost",
      title: "Reduce agents",
      description: "Use fewer agents to save cost",
    });

    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(NL_COMMAND_SOCKET_EVENTS.suggestion);
    expect(payload).toMatchObject({
      type: NL_COMMAND_SOCKET_EVENTS.suggestion,
      planId: "plan-1",
      suggestionType: "cost",
      title: "Reduce agents",
      description: "Use fewer agents to save cost",
    });
  });

  it("all payloads include issuedAt as a recent timestamp", () => {
    const emit = makeEmitSpy();
    const emitter = new NLCommandSocketEmitter(emit);
    const before = Date.now();

    emitter.emitCommandCreated(makeCommand());
    emitter.emitAlert({
      alertId: "a",
      type: "ERROR_OCCURRED",
      priority: "info",
      message: "x",
      entityId: "e",
      entityType: "task",
      triggeredAt: 0,
      acknowledged: false,
    });

    const after = Date.now();
    for (const [, payload] of emit.mock.calls) {
      const p = payload as { issuedAt: number };
      expect(p.issuedAt).toBeGreaterThanOrEqual(before);
      expect(p.issuedAt).toBeLessThanOrEqual(after);
    }
  });
});
