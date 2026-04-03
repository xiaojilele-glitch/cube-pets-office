// Feature: scene-mission-fusion, Property 1: Mission 选择优先级
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { MissionTaskDetail, MissionTaskSummary, TaskInteriorAgent, TaskTimelineEvent } from "@/lib/tasks-store";
import { extractActiveAgents, getIslandScale, selectDisplayMission, sliceRecentEvents, truncateTitle } from "@/components/tasks/mission-island-helpers";

/* ─── Arbitraries ─── */

const arbMissionTaskStatus = fc.constantFrom(
  "queued" as const,
  "running" as const,
  "waiting" as const,
  "done" as const,
  "failed" as const,
);

const arbSyntheticWfStatus = fc.constantFrom(
  "pending" as const,
  "running" as const,
  "completed" as const,
  "completed_with_errors" as const,
  "failed" as const,
);

const arbMissionTaskSummary: fc.Arbitrary<MissionTaskSummary> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 60 }),
  kind: fc.constantFrom("chat", "workflow", "task"),
  sourceText: fc.string({ maxLength: 40 }),
  status: arbMissionTaskStatus,
  workflowStatus: arbSyntheticWfStatus,
  progress: fc.integer({ min: 0, max: 100 }),
  currentStageKey: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  currentStageLabel: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  summary: fc.string({ maxLength: 80 }),
  waitingFor: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  createdAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  updatedAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  startedAt: fc.option(fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }), { nil: null }),
  completedAt: fc.option(fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }), { nil: null }),
  departmentLabels: fc.array(fc.string({ minLength: 1, maxLength: 15 }), { maxLength: 4 }),
  taskCount: fc.nat({ max: 50 }),
  completedTaskCount: fc.nat({ max: 50 }),
  messageCount: fc.nat({ max: 200 }),
  activeAgentCount: fc.nat({ max: 10 }),
  attachmentCount: fc.nat({ max: 20 }),
  issueCount: fc.nat({ max: 10 }),
  hasWarnings: fc.boolean(),
  lastSignal: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
});

/* ─── Property 1: Mission 选择优先级 ─── */
/* **Validates: Requirements 1.3, 4.2** */

describe("Property 1: Mission 选择优先级", () => {
  it("empty list returns null", () => {
    expect(selectDisplayMission([])).toBeNull();
  });

  it("returns a running mission when one exists", () => {
    fc.assert(
      fc.property(
        fc.array(arbMissionTaskSummary, { minLength: 1, maxLength: 20 }),
        arbMissionTaskSummary,
        (others, runningBase) => {
          const running: MissionTaskSummary = { ...runningBase, status: "running" };
          // Ensure no other running missions so the result is deterministic
          const nonRunning = others.map((t) => ({
            ...t,
            status: t.status === "running" ? ("done" as const) : t.status,
          }));
          const tasks = [...nonRunning, running];
          // Shuffle to avoid position bias
          const shuffled = [...tasks].sort(() => Math.random() - 0.5);

          const result = selectDisplayMission(shuffled);
          return result !== null && result.status === "running";
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns a waiting mission when no running mission exists", () => {
    fc.assert(
      fc.property(
        fc.array(arbMissionTaskSummary, { minLength: 0, maxLength: 20 }),
        arbMissionTaskSummary,
        (others, waitingBase) => {
          const waiting: MissionTaskSummary = { ...waitingBase, status: "waiting" };
          // Remove running and waiting from others
          const filtered = others.map((t) => ({
            ...t,
            status:
              t.status === "running" || t.status === "waiting"
                ? ("done" as const)
                : t.status,
          }));
          const tasks = [...filtered, waiting];
          const shuffled = [...tasks].sort(() => Math.random() - 0.5);

          const result = selectDisplayMission(shuffled);
          return result !== null && result.status === "waiting";
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns the most recently created mission when no running or waiting exists", () => {
    fc.assert(
      fc.property(
        fc.array(arbMissionTaskSummary, { minLength: 1, maxLength: 20 }).map((arr) =>
          arr.map((t) => ({
            ...t,
            status:
              t.status === "running" || t.status === "waiting"
                ? ("done" as const)
                : t.status,
          })),
        ),
        (tasks) => {
          const result = selectDisplayMission(tasks);
          if (result === null) return false;

          const maxCreatedAt = Math.max(...tasks.map((t) => t.createdAt));
          return result.createdAt === maxCreatedAt;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("running takes priority over waiting", () => {
    fc.assert(
      fc.property(
        arbMissionTaskSummary,
        arbMissionTaskSummary,
        fc.array(arbMissionTaskSummary, { minLength: 0, maxLength: 10 }),
        (runningBase, waitingBase, extras) => {
          const running: MissionTaskSummary = { ...runningBase, status: "running" };
          const waiting: MissionTaskSummary = { ...waitingBase, status: "waiting" };
          const others = extras.map((t) => ({
            ...t,
            status:
              t.status === "running" || t.status === "waiting"
                ? ("queued" as const)
                : t.status,
          }));
          const tasks = [...others, waiting, running];
          const shuffled = [...tasks].sort(() => Math.random() - 0.5);

          const result = selectDisplayMission(shuffled);
          return result !== null && result.status === "running";
        },
      ),
      { numRuns: 100 },
    );
  });

  it("result is always a member of the input list", () => {
    fc.assert(
      fc.property(
        fc.array(arbMissionTaskSummary, { minLength: 1, maxLength: 20 }),
        (tasks) => {
          const result = selectDisplayMission(tasks);
          return result !== null && tasks.some((t) => t.id === result.id);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: scene-mission-fusion, Property 2: 标题截断保持前缀不变
/* **Validates: Requirements 2.2** */

describe("Property 2: 标题截断保持前缀不变", () => {
  const DEFAULT_MAX = 40;

  it("short titles are returned unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: DEFAULT_MAX }),
        (title) => {
          const result = truncateTitle(title, DEFAULT_MAX);
          return result === title;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("result length never exceeds maxLength + 1 (ellipsis is one char)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.integer({ min: 1, max: 100 }),
        (title, maxLength) => {
          const result = truncateTitle(title, maxLength);
          return result.length <= maxLength + 1;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("long titles end with ellipsis and the prefix is from the original title", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: DEFAULT_MAX + 1, maxLength: 200 }),
        (title) => {
          const result = truncateTitle(title, DEFAULT_MAX);
          // Must end with '…'
          if (!result.endsWith("\u2026")) return false;
          // Remove the ellipsis to get the prefix
          const prefix = result.slice(0, -1);
          // The prefix (after trimEnd in implementation) must be a prefix of the original title
          return title.startsWith(prefix);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("titles exactly at maxLength are returned unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: DEFAULT_MAX, maxLength: DEFAULT_MAX }),
        (title) => {
          const result = truncateTitle(title, DEFAULT_MAX);
          return result === title;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: scene-mission-fusion, Property 3: 活跃 Agent 提取上限与过滤
/* **Validates: Requirements 2.3** */

const arbInteriorAgentStatus = fc.constantFrom(
  "idle" as const,
  "working" as const,
  "thinking" as const,
  "done" as const,
  "error" as const,
);

const arbTaskInteriorAgent: fc.Arbitrary<TaskInteriorAgent> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  role: fc.string({ minLength: 1, maxLength: 20 }),
  department: fc.string({ minLength: 1, maxLength: 20 }),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  status: arbInteriorAgentStatus,
  stageKey: fc.string({ minLength: 1, maxLength: 15 }),
  stageLabel: fc.string({ minLength: 1, maxLength: 20 }),
  progress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  angle: fc.double({ min: 0, max: Math.PI * 2 }),
});

function makeMinimalDetail(agents: TaskInteriorAgent[]): MissionTaskDetail {
  return {
    id: "test",
    title: "test",
    kind: "chat",
    sourceText: "",
    status: "running",
    workflowStatus: "running",
    progress: 50,
    currentStageKey: null,
    currentStageLabel: null,
    summary: "",
    waitingFor: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    departmentLabels: [],
    taskCount: 0,
    completedTaskCount: 0,
    messageCount: 0,
    activeAgentCount: agents.length,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    workflow: { id: "w", directive: "", status: "running", stages: [], currentStageKey: null, progress: 0 },
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: [],
    agents,
    timeline: [],
    artifacts: [],
    failureReasons: [],
    decisionPresets: [],
    decisionPrompt: null,
    decisionPlaceholder: null,
    decisionAllowsFreeText: false,
    decision: null,
    instanceInfo: [],
    logSummary: [],
    decisionHistory: [],
  } as MissionTaskDetail;
}

describe("Property 3: 活跃 Agent 提取上限与过滤", () => {
  it("returned count never exceeds maxCount", () => {
    fc.assert(
      fc.property(
        fc.array(arbTaskInteriorAgent, { minLength: 0, maxLength: 15 }),
        fc.integer({ min: 1, max: 10 }),
        (agents, maxCount) => {
          const detail = makeMinimalDetail(agents);
          const result = extractActiveAgents(detail, maxCount);
          return result.length <= maxCount;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all returned agents were working or thinking in the input", () => {
    fc.assert(
      fc.property(
        fc.array(arbTaskInteriorAgent, { minLength: 1, maxLength: 15 }),
        (agents) => {
          const detail = makeMinimalDetail(agents);
          const result = extractActiveAgents(detail, 10);
          const activeIds = new Set(
            agents.filter((a) => a.status === "working" || a.status === "thinking").map((a) => a.id),
          );
          return result.every((r) => activeIds.has(r.id));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns all active agents when count <= maxCount", () => {
    fc.assert(
      fc.property(
        fc.array(arbTaskInteriorAgent, { minLength: 0, maxLength: 15 }),
        (agents) => {
          const activeCount = agents.filter(
            (a) => a.status === "working" || a.status === "thinking",
          ).length;
          const maxCount = activeCount + 5; // always enough room
          const detail = makeMinimalDetail(agents);
          const result = extractActiveAgents(detail, maxCount);
          return result.length === activeCount;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("each result has id and emoji string fields", () => {
    fc.assert(
      fc.property(
        fc.array(arbTaskInteriorAgent, { minLength: 1, maxLength: 10 }),
        (agents) => {
          const detail = makeMinimalDetail(agents);
          const result = extractActiveAgents(detail, 5);
          return result.every(
            (r) => typeof r.id === "string" && typeof r.emoji === "string",
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: scene-mission-fusion, Property 4: 时间线事件截断
/* **Validates: Requirements 3.3** */

const arbTimelineLevel = fc.constantFrom(
  "info" as const,
  "success" as const,
  "warn" as const,
  "error" as const,
);

const arbTaskTimelineEvent: fc.Arbitrary<TaskTimelineEvent> = fc.record({
  id: fc.uuid(),
  type: fc.string({ minLength: 1, maxLength: 20 }),
  time: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  level: arbTimelineLevel,
  title: fc.string({ minLength: 1, maxLength: 40 }),
  description: fc.string({ maxLength: 80 }),
});

describe("Property 4: 时间线事件截断", () => {
  it("returns at most 10 events", () => {
    fc.assert(
      fc.property(
        fc.array(arbTaskTimelineEvent, { minLength: 0, maxLength: 50 }),
        (events) => {
          const result = sliceRecentEvents(events);
          return result.length <= 10;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns all events when input has 10 or fewer", () => {
    fc.assert(
      fc.property(
        fc.array(arbTaskTimelineEvent, { minLength: 0, maxLength: 10 }),
        (events) => {
          const result = sliceRecentEvents(events);
          return result.length === events.length;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("events are sorted by time descending", () => {
    fc.assert(
      fc.property(
        fc.array(arbTaskTimelineEvent, { minLength: 2, maxLength: 30 }),
        (events) => {
          const result = sliceRecentEvents(events);
          for (let i = 1; i < result.length; i++) {
            if (result[i].time > result[i - 1].time) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when input > 10, result contains the 10 most recent events", () => {
    fc.assert(
      fc.property(
        fc.array(arbTaskTimelineEvent, { minLength: 11, maxLength: 50 }),
        (events) => {
          const result = sliceRecentEvents(events);
          const sortedAll = [...events].sort((a, b) => b.time - a.time);
          const minResultTime = Math.min(...result.map((e) => e.time));
          const tenthTime = sortedAll[9].time;
          return minResultTime >= tenthTime;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: scene-mission-fusion, Property 5: 视口缩放映射
/* **Validates: Requirements 1.5** */

import type { ViewportTier } from "@/hooks/useViewportTier";

describe("Property 5: 视口缩放映射", () => {
  it("desktop tier returns 1.0", () => {
    expect(getIslandScale("desktop")).toBe(1.0);
  });

  it("tablet tier returns 0.85", () => {
    expect(getIslandScale("tablet")).toBe(0.85);
  });

  it("mobile tier returns 0.7", () => {
    expect(getIslandScale("mobile")).toBe(0.7);
  });

  it("all viewport tiers map to a valid scale in (0, 1]", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ViewportTier>("mobile", "tablet", "desktop"),
        (tier) => {
          const scale = getIslandScale(tier);
          return scale > 0 && scale <= 1.0;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("desktop >= tablet >= mobile scale ordering", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const d = getIslandScale("desktop");
        const t = getIslandScale("tablet");
        const m = getIslandScale("mobile");
        return d >= t && t >= m;
      }),
      { numRuns: 10 },
    );
  });
});
