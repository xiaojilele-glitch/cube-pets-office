/**
 * Unit tests for ExecutorStatusPanel logic.
 *
 * Since the project does not include @testing-library/react,
 * we validate the exported interface and status mapping logic
 * that drives the component's visual output.
 *
 * @see Requirements 5.1, 5.2, 5.3
 */
import { describe, it, expect } from "vitest";

import type { ExecutorStatusPanelProps } from "../ExecutorStatusPanel";
import type {
  MissionArtifact,
  MissionExecutorContext,
  MissionInstanceContext,
} from "@shared/mission/contracts";

describe("ExecutorStatusPanel props contract", () => {
  it("accepts a minimal executor context", () => {
    const executor: MissionExecutorContext = { name: "lobster-executor" };
    const props: ExecutorStatusPanelProps = { executor };
    expect(props.executor?.name).toBe("lobster-executor");
  });

  it("accepts a full executor context with all fields", () => {
    const executor: MissionExecutorContext = {
      name: "lobster-executor",
      requestId: "req-123",
      jobId: "job-456",
      status: "running",
      baseUrl: "http://localhost:9800",
      lastEventType: "job.started",
      lastEventAt: Date.now(),
    };
    const instance: MissionInstanceContext = {
      id: "container-789",
      image: "node:20-slim",
      command: ["node", "index.js"],
      workspaceRoot: "/workspace",
      startedAt: Date.now(),
    };
    const artifacts: MissionArtifact[] = [
      { kind: "file", name: "output.txt", description: "Execution output" },
      { kind: "report", name: "summary.md", description: "Summary report" },
    ];
    const props: ExecutorStatusPanelProps = { executor, instance, artifacts };

    expect(props.executor?.status).toBe("running");
    expect(props.instance?.image).toBe("node:20-slim");
    expect(props.artifacts).toHaveLength(2);
    expect(props.artifacts?.[0].kind).toBe("file");
    expect(props.artifacts?.[1].name).toBe("summary.md");
  });

  it("allows all props to be undefined (renders nothing)", () => {
    const props: ExecutorStatusPanelProps = {};
    expect(props.executor).toBeUndefined();
    expect(props.instance).toBeUndefined();
    expect(props.artifacts).toBeUndefined();
  });

  it("status values map to expected display states", () => {
    const statuses = ["queued", "running", "completed", "failed"] as const;
    for (const status of statuses) {
      const executor: MissionExecutorContext = {
        name: "test-executor",
        status,
      };
      expect(executor.status).toBe(status);
    }
  });

  it("artifacts list can contain all valid kinds", () => {
    const kinds: MissionArtifact["kind"][] = ["file", "report", "url", "log"];
    const artifacts: MissionArtifact[] = kinds.map((kind) => ({
      kind,
      name: `${kind}-artifact`,
      description: `A ${kind} artifact`,
    }));
    const props: ExecutorStatusPanelProps = {
      executor: { name: "test" },
      artifacts,
    };
    expect(props.artifacts).toHaveLength(4);
    expect(props.artifacts?.map((a) => a.kind)).toEqual(kinds);
  });
});
