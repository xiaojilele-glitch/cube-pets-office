import { describe, it, expect, beforeEach } from "vitest";

import { useDemoStore } from "../demo-store";
import type { DemoMemoryEntry, DemoEvolutionLog } from "../demo-store";

// Reset store between tests
beforeEach(() => {
  useDemoStore.getState().reset();
});

describe("useDemoStore", () => {
  it("starts with correct initial state", () => {
    const state = useDemoStore.getState();
    expect(state.isActive).toBe(false);
    expect(state.playbackState).toBe("idle");
    expect(state.memoryTimeline).toEqual([]);
    expect(state.evolutionLogs).toEqual([]);
    expect(state.currentStage).toBeNull();
  });

  it("activate sets isActive to true", () => {
    useDemoStore.getState().activate();
    expect(useDemoStore.getState().isActive).toBe(true);
  });

  it("deactivate sets isActive to false", () => {
    useDemoStore.getState().activate();
    useDemoStore.getState().deactivate();
    expect(useDemoStore.getState().isActive).toBe(false);
  });

  it("setPlaybackState updates playbackState", () => {
    useDemoStore.getState().setPlaybackState("playing");
    expect(useDemoStore.getState().playbackState).toBe("playing");

    useDemoStore.getState().setPlaybackState("paused");
    expect(useDemoStore.getState().playbackState).toBe("paused");
  });

  it("appendMemoryEntry appends to memoryTimeline", () => {
    const entry: DemoMemoryEntry = {
      agentId: "agent-1",
      kind: "short_term",
      stage: "execution",
      content: "Test memory",
      timestampOffset: 5000,
    };

    useDemoStore.getState().appendMemoryEntry(entry);
    expect(useDemoStore.getState().memoryTimeline).toHaveLength(1);
    expect(useDemoStore.getState().memoryTimeline[0]).toEqual(entry);

    const entry2: DemoMemoryEntry = {
      agentId: "agent-2",
      kind: "medium_term",
      stage: "summary",
      content: "Another memory",
      timestampOffset: 23000,
    };

    useDemoStore.getState().appendMemoryEntry(entry2);
    expect(useDemoStore.getState().memoryTimeline).toHaveLength(2);
    expect(useDemoStore.getState().memoryTimeline[1]).toEqual(entry2);
  });

  it("setEvolutionLogs replaces evolutionLogs", () => {
    const logs: DemoEvolutionLog[] = [
      {
        agentId: "agent-1",
        dimension: "accuracy",
        oldScore: 0.7,
        newScore: 0.85,
        patchContent: "patch-1",
        applied: true,
      },
    ];

    useDemoStore.getState().setEvolutionLogs(logs);
    expect(useDemoStore.getState().evolutionLogs).toEqual(logs);

    // Replacing with new logs overwrites
    const newLogs: DemoEvolutionLog[] = [];
    useDemoStore.getState().setEvolutionLogs(newLogs);
    expect(useDemoStore.getState().evolutionLogs).toEqual([]);
  });

  it("setCurrentStage updates currentStage", () => {
    useDemoStore.getState().setCurrentStage("execution");
    expect(useDemoStore.getState().currentStage).toBe("execution");

    useDemoStore.getState().setCurrentStage(null);
    expect(useDemoStore.getState().currentStage).toBeNull();
  });

  it("reset restores all state to initial values", () => {
    // Mutate everything
    const {
      activate,
      setPlaybackState,
      appendMemoryEntry,
      setEvolutionLogs,
      setCurrentStage,
    } = useDemoStore.getState();

    activate();
    setPlaybackState("playing");
    appendMemoryEntry({
      agentId: "a",
      kind: "long_term",
      stage: "evolution",
      content: "x",
      timestampOffset: 0,
    });
    setEvolutionLogs([
      {
        agentId: "a",
        dimension: "format",
        oldScore: 0.5,
        newScore: 0.9,
        patchContent: "",
        applied: true,
      },
    ]);
    setCurrentStage("evolution");

    // Reset
    useDemoStore.getState().reset();

    const state = useDemoStore.getState();
    expect(state.isActive).toBe(false);
    expect(state.playbackState).toBe("idle");
    expect(state.memoryTimeline).toEqual([]);
    expect(state.evolutionLogs).toEqual([]);
    expect(state.currentStage).toBeNull();
  });
});
