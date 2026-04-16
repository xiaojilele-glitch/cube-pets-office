import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MissionFileSnapshotStore } from "../tasks/mission-store.file.js";
import { MissionStore } from "../tasks/mission-store.js";

describe("MissionStore", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cube-pets-mission-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("hydrates persisted missions into a new MissionStore instance", () => {
    const filePath = path.join(tempDir, "mission-snapshots.json");
    const snapshotStore = new MissionFileSnapshotStore(filePath);
    const store = new MissionStore(snapshotStore);

    const mission = store.create({
      kind: "chat",
      title: "Analyze Feishu relay chain",
      stageLabels: [
        { key: "receive", label: "Receive task" },
        { key: "understand", label: "Understand problem" },
        { key: "finalize", label: "Finalize output" },
      ],
    });

    store.markRunning(mission.id, "understand", "Reading recent context", 38);
    store.markDone(mission.id, "Relay chain analyzed");

    const restored = new MissionStore(new MissionFileSnapshotStore(filePath));
    const restoredMission = restored.get(mission.id);

    expect(restoredMission).toMatchObject({
      id: mission.id,
      kind: "chat",
      status: "done",
      progress: 100,
      summary: "Relay chain analyzed",
      currentStageKey: "understand",
    });
    expect(restoredMission?.events.at(-1)?.type).toBe("done");
  });

  it("fails only running missions during recovery while preserving queued and waiting missions", () => {
    const filePath = path.join(tempDir, "mission-snapshots.json");
    const store = new MissionStore(new MissionFileSnapshotStore(filePath));

    const queued = store.create({
      kind: "chat",
      title: "Queued mission",
      stageLabels: [{ key: "receive", label: "Receive task" }],
    });
    const running = store.create({
      kind: "chat",
      title: "Running mission",
      stageLabels: [{ key: "understand", label: "Understand problem" }],
    });
    const waiting = store.create({
      kind: "chat",
      title: "Waiting mission",
      stageLabels: [{ key: "gather", label: "Gather materials" }],
    });
    const done = store.create({
      kind: "chat",
      title: "Done mission",
      stageLabels: [{ key: "finalize", label: "Finalize output" }],
    });

    store.markRunning(running.id, "understand", "Scanning files", 35);
    store.markRunning(waiting.id, "gather", "Reading docs", 40);
    store.markWaiting(waiting.id, "user confirmation", "Need a decision", 40, {
      prompt: "Choose a path",
      options: [{ id: "continue", label: "Continue" }],
    });
    store.markDone(done.id, "Mission complete");

    const recovered = store.recoverInterrupted({
      message: "Server restarted during mission execution.",
    });

    expect(recovered.map(task => task.id)).toEqual([running.id]);
    expect(store.get(queued.id)?.status).toBe("queued");
    expect(store.get(running.id)?.status).toBe("failed");
    expect(store.get(waiting.id)?.status).toBe("waiting");
    expect(store.get(done.id)?.status).toBe("done");
    expect(store.get(running.id)?.events.at(-1)?.message).toBe(
      "Server restarted during mission execution."
    );
  });

  it("persists executor metadata, instance context, artifacts, and summary", () => {
    const filePath = path.join(tempDir, "mission-snapshots.json");
    const store = new MissionStore(new MissionFileSnapshotStore(filePath));

    const mission = store.create({
      kind: "chat",
      title: "Persist execution fields",
      stageLabels: [{ key: "execute", label: "Run execution" }],
    });

    store.patchExecution(mission.id, {
      summary: "Executor completed the mission successfully.",
      executor: {
        name: "lobster",
        requestId: "req_1",
        jobId: "job_1",
        status: "completed",
      },
      instance: {
        id: "instance_1",
        workspaceRoot: "C:/workspace/demo",
        host: "docker-local",
      },
      artifacts: [
        {
          kind: "report",
          name: "Execution report",
          description: "Final report artifact",
        },
      ],
    });

    const restored = new MissionStore(
      new MissionFileSnapshotStore(filePath)
    ).get(mission.id);

    expect(restored).toMatchObject({
      id: mission.id,
      summary: "Executor completed the mission successfully.",
      executor: {
        name: "lobster",
        requestId: "req_1",
        jobId: "job_1",
        status: "completed",
      },
      instance: {
        id: "instance_1",
        workspaceRoot: "C:/workspace/demo",
        host: "docker-local",
      },
      artifacts: [
        {
          kind: "report",
          name: "Execution report",
          description: "Final report artifact",
        },
      ],
    });
  });
});
