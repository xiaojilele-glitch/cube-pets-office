import { describe, expect, it, vi } from "vitest";

import { MissionOrchestrator } from "../core/mission-orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createExecutorClientStub() {
  return {
    dispatchPlan: vi.fn(async () => ({
      request: { executor: "lobster", requestId: "req_1" },
      response: { jobId: "job_1", receivedAt: "2026-03-30T10:00:00.000Z" },
    })),
  } as any;
}

async function startMission() {
  const orchestrator = new MissionOrchestrator({
    executorClient: createExecutorClientStub(),
  });
  const result = await orchestrator.startMission({
    title: "Enrichment unit test mission",
    sourceText: "Testing enrichment extraction functions.",
    workspaceRoot: "C:/workspace/demo",
  });
  return { orchestrator, mission: result.mission };
}

function completedEvent(
  missionId: string,
  payload: Record<string, unknown> | undefined
) {
  return {
    version: "2026-03-28" as const,
    eventId: "evt_complete",
    missionId,
    jobId: "job_1",
    executor: "lobster",
    type: "job.completed" as const,
    status: "completed" as const,
    occurredAt: "2026-03-30T11:00:00.000Z",
    progress: 100,
    message: "Done",
    payload,
  };
}

// ---------------------------------------------------------------------------
// extractOrganization 转换正确性
// ---------------------------------------------------------------------------

describe("extractOrganization correctness", () => {
  it("populates organization with valid departments containing key and label", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        organization: {
          departments: [
            { key: "eng", label: "Engineering" },
            { key: "design", label: "Design" },
          ],
          agentCount: 4,
        },
      })
    );

    expect(completed.organization).toBeDefined();
    expect(completed.organization!.departments).toHaveLength(2);
    expect(completed.organization!.departments[0]).toEqual({
      key: "eng",
      label: "Engineering",
      managerName: undefined,
    });
    expect(completed.organization!.departments[1]).toEqual({
      key: "design",
      label: "Design",
      managerName: undefined,
    });
  });

  it("preserves managerName when present on departments", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        organization: {
          departments: [
            { key: "eng", label: "Engineering", managerName: "Alice" },
            { key: "qa", label: "QA", managerName: "Bob" },
          ],
          agentCount: 5,
        },
      })
    );

    expect(completed.organization!.departments[0].managerName).toBe("Alice");
    expect(completed.organization!.departments[1].managerName).toBe("Bob");
  });

  it("filters out departments with empty key or empty label", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        organization: {
          departments: [
            { key: "", label: "No Key Dept" },
            { key: "valid", label: "Valid Dept" },
            { key: "empty-label", label: "" },
          ],
          agentCount: 3,
        },
      })
    );

    expect(completed.organization).toBeDefined();
    expect(completed.organization!.departments).toHaveLength(1);
    expect(completed.organization!.departments[0].key).toBe("valid");
  });

  it("returns undefined organization when all departments are invalid", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        organization: {
          departments: [
            { key: "", label: "" },
            { key: "", label: "Missing key" },
          ],
          agentCount: 2,
        },
      })
    );

    expect(completed.organization).toBeUndefined();
  });

  it("preserves agentCount when valid number; defaults to departments.length when missing", async () => {
    const { orchestrator, mission: m1 } = await startMission();

    // Valid agentCount
    const c1 = await orchestrator.applyExecutorEvent(
      completedEvent(m1.id, {
        organization: {
          departments: [{ key: "a", label: "A" }],
          agentCount: 10,
        },
      })
    );
    expect(c1.organization!.agentCount).toBe(10);

    // Missing agentCount → defaults to departments.length
    const { orchestrator: o2, mission: m2 } = await startMission();
    const c2 = await o2.applyExecutorEvent(
      completedEvent(m2.id, {
        organization: {
          departments: [
            { key: "a", label: "A" },
            { key: "b", label: "B" },
          ],
        },
      })
    );
    expect(c2.organization!.agentCount).toBe(2);
  });

  it("defaults agentCount to departments.length when agentCount is not a number", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        organization: {
          departments: [
            { key: "x", label: "X" },
            { key: "y", label: "Y" },
            { key: "z", label: "Z" },
          ],
          agentCount: "invalid",
        },
      })
    );

    expect(completed.organization!.agentCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// extractWorkPackages 转换正确性
// ---------------------------------------------------------------------------

describe("extractWorkPackages correctness", () => {
  it("populates workPackages with valid entries having id, title, stageKey, and valid status", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        workPackages: [
          {
            id: "wp-1",
            title: "Build feature",
            stageKey: "execute",
            status: "passed",
          },
          {
            id: "wp-2",
            title: "Write tests",
            stageKey: "execute",
            status: "verified",
          },
        ],
      })
    );

    expect(completed.workPackages).toHaveLength(2);
    expect(completed.workPackages![0]).toMatchObject({
      id: "wp-1",
      title: "Build feature",
      stageKey: "execute",
      status: "passed",
    });
    expect(completed.workPackages![1]).toMatchObject({
      id: "wp-2",
      title: "Write tests",
      stageKey: "execute",
      status: "verified",
    });
  });

  it("filters out work packages with invalid status", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        workPackages: [
          { id: "wp-1", title: "Valid", stageKey: "execute", status: "passed" },
          {
            id: "wp-2",
            title: "Bad status",
            stageKey: "execute",
            status: "unknown",
          },
          {
            id: "wp-3",
            title: "Another bad",
            stageKey: "execute",
            status: "cancelled",
          },
        ],
      })
    );

    expect(completed.workPackages).toHaveLength(1);
    expect(completed.workPackages![0].id).toBe("wp-1");
  });

  it("filters out work packages with empty id", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        workPackages: [
          { id: "", title: "No ID", stageKey: "execute", status: "passed" },
          {
            id: "wp-valid",
            title: "Has ID",
            stageKey: "execute",
            status: "running",
          },
        ],
      })
    );

    expect(completed.workPackages).toHaveLength(1);
    expect(completed.workPackages![0].id).toBe("wp-valid");
  });

  it("filters out null and non-object entries", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        workPackages: [
          null,
          42,
          "string-entry",
          undefined,
          {
            id: "wp-1",
            title: "Valid",
            stageKey: "execute",
            status: "pending",
          },
        ],
      })
    );

    expect(completed.workPackages).toHaveLength(1);
    expect(completed.workPackages![0].id).toBe("wp-1");
  });

  it("keeps only valid entries from a mix of valid and invalid", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        workPackages: [
          { id: "wp-1", title: "Good", stageKey: "execute", status: "passed" },
          { id: "", title: "Empty ID", stageKey: "execute", status: "passed" },
          {
            id: "wp-3",
            title: "Bad status",
            stageKey: "execute",
            status: "unknown",
          },
          null,
          {
            id: "wp-5",
            title: "Also good",
            stageKey: "review",
            status: "failed",
          },
        ],
      })
    );

    expect(completed.workPackages).toHaveLength(2);
    expect(completed.workPackages!.map(wp => wp.id)).toEqual(["wp-1", "wp-5"]);
  });

  it("preserves optional fields (assignee, score, deliverable, feedback) when present", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        workPackages: [
          {
            id: "wp-1",
            title: "Full package",
            stageKey: "execute",
            status: "verified",
            assignee: "Agent-A",
            score: 95,
            deliverable: "Feature implemented",
            feedback: "Great work",
          },
        ],
      })
    );

    expect(completed.workPackages).toHaveLength(1);
    const wp = completed.workPackages![0];
    expect(wp.assignee).toBe("Agent-A");
    expect(wp.score).toBe(95);
    expect(wp.deliverable).toBe("Feature implemented");
    expect(wp.feedback).toBe("Great work");
  });

  it("returns undefined workPackages when all entries are invalid", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {
        workPackages: [
          { id: "", title: "No ID", stageKey: "execute", status: "passed" },
          null,
          42,
        ],
      })
    );

    expect(completed.workPackages).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// workflow 不存在时安全跳过 (safe skip when no enrichment data)
// ---------------------------------------------------------------------------

describe("safe skip when enrichment data is absent", () => {
  it("leaves all enrichment fields undefined when payload is empty object", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, {})
    );

    expect(completed.status).toBe("done");
    expect(completed.organization).toBeUndefined();
    expect(completed.workPackages).toBeUndefined();
    expect(completed.messageLog).toBeUndefined();
  });

  it("leaves all enrichment fields undefined when payload is undefined", async () => {
    const { orchestrator, mission } = await startMission();

    const completed = await orchestrator.applyExecutorEvent(
      completedEvent(mission.id, undefined)
    );

    expect(completed.status).toBe("done");
    expect(completed.organization).toBeUndefined();
    expect(completed.workPackages).toBeUndefined();
    expect(completed.messageLog).toBeUndefined();
  });

  it("does not apply enrichment on job.progress events even with valid payload", async () => {
    const { orchestrator, mission } = await startMission();

    const running = await orchestrator.applyExecutorEvent({
      version: "2026-03-28",
      eventId: "evt_progress",
      missionId: mission.id,
      jobId: "job_1",
      executor: "lobster",
      type: "job.progress" as any,
      status: "running" as any,
      occurredAt: "2026-03-30T10:30:00.000Z",
      progress: 50,
      message: "In progress",
      payload: {
        organization: {
          departments: [{ key: "eng", label: "Engineering" }],
          agentCount: 3,
        },
        workPackages: [
          { id: "wp-1", title: "Task", stageKey: "execute", status: "passed" },
        ],
        messageLog: [{ sender: "Agent-A", content: "Hello", time: 1000 }],
      },
    });

    expect(running.status).toBe("running");
    expect(running.organization).toBeUndefined();
    expect(running.workPackages).toBeUndefined();
    expect(running.messageLog).toBeUndefined();
  });
});
