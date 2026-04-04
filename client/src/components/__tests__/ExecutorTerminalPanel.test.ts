/**
 * Unit tests for ExecutorTerminalPanel integration.
 *
 * Validates the Socket.IO log stream integration logic:
 * - sandbox store receives and stores log lines with stdout/stderr distinction
 * - activeMission filtering ensures only relevant logs are displayed
 * - formatLine correctly distinguishes stdout from stderr
 *
 * @see Requirements 5.4
 */
import { describe, it, expect, beforeEach } from "vitest";

import { useSandboxStore, formatLogLine, type LogLine } from "../../lib/sandbox-store";
import type { ExecutorTerminalPanelProps } from "../ExecutorTerminalPanel";

function makeLine(overrides?: Partial<LogLine>): LogLine {
  return {
    stepIndex: 0,
    stream: "stdout",
    data: "hello world",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("ExecutorTerminalPanel integration", () => {
  beforeEach(() => {
    useSandboxStore.getState().reset();
  });

  describe("props contract", () => {
    it("accepts a missionId string", () => {
      const props: ExecutorTerminalPanelProps = { missionId: "mission-123" };
      expect(props.missionId).toBe("mission-123");
    });
  });

  describe("sandbox store log streaming", () => {
    it("appends stdout log lines", () => {
      const line = makeLine({ stream: "stdout", data: "output line" });
      useSandboxStore.getState().appendLog(line);

      const state = useSandboxStore.getState();
      expect(state.logLines).toHaveLength(1);
      expect(state.logLines[0].stream).toBe("stdout");
      expect(state.logLines[0].data).toBe("output line");
    });

    it("appends stderr log lines", () => {
      const line = makeLine({ stream: "stderr", data: "error output" });
      useSandboxStore.getState().appendLog(line);

      const state = useSandboxStore.getState();
      expect(state.logLines).toHaveLength(1);
      expect(state.logLines[0].stream).toBe("stderr");
      expect(state.logLines[0].data).toBe("error output");
    });

    it("interleaves stdout and stderr lines in order", () => {
      useSandboxStore.getState().appendLog(makeLine({ stream: "stdout", data: "out-1" }));
      useSandboxStore.getState().appendLog(makeLine({ stream: "stderr", data: "err-1" }));
      useSandboxStore.getState().appendLog(makeLine({ stream: "stdout", data: "out-2" }));

      const lines = useSandboxStore.getState().logLines;
      expect(lines).toHaveLength(3);
      expect(lines.map((l) => l.stream)).toEqual(["stdout", "stderr", "stdout"]);
      expect(lines.map((l) => l.data)).toEqual(["out-1", "err-1", "out-2"]);
    });

    it("sets isStreaming to true when logs arrive", () => {
      expect(useSandboxStore.getState().isStreaming).toBe(false);
      useSandboxStore.getState().appendLog(makeLine());
      expect(useSandboxStore.getState().isStreaming).toBe(true);
    });
  });

  describe("activeMission filtering", () => {
    it("setActiveMission clears previous log lines", () => {
      useSandboxStore.getState().appendLog(makeLine({ data: "old-line" }));
      expect(useSandboxStore.getState().logLines).toHaveLength(1);

      useSandboxStore.getState().setActiveMission("new-mission");
      expect(useSandboxStore.getState().logLines).toHaveLength(0);
      expect(useSandboxStore.getState().activeMissionId).toBe("new-mission");
    });

    it("setActiveMission resets isStreaming", () => {
      useSandboxStore.getState().appendLog(makeLine());
      expect(useSandboxStore.getState().isStreaming).toBe(true);

      useSandboxStore.getState().setActiveMission("another-mission");
      expect(useSandboxStore.getState().isStreaming).toBe(false);
    });
  });

  describe("stdout/stderr formatting", () => {
    it("formats stdout lines as plain text", () => {
      const line = makeLine({ stream: "stdout", data: "normal output" });
      const formatted = formatLogLine(line);
      expect(formatted).toBe("normal output");
      expect(formatted).not.toContain("\x1b[31m");
    });

    it("formats stderr lines with ANSI red escape codes", () => {
      const line = makeLine({ stream: "stderr", data: "error output" });
      const formatted = formatLogLine(line);
      expect(formatted).toContain("\x1b[31m");
      expect(formatted).toContain("error output");
      expect(formatted).toContain("\x1b[0m");
    });
  });

  describe("log history", () => {
    it("setLogHistory replaces all lines", () => {
      useSandboxStore.getState().appendLog(makeLine({ data: "existing" }));

      const history = [
        makeLine({ data: "hist-1", stream: "stdout" }),
        makeLine({ data: "hist-2", stream: "stderr" }),
      ];
      useSandboxStore.getState().setLogHistory(history);

      const lines = useSandboxStore.getState().logLines;
      expect(lines).toHaveLength(2);
      expect(lines[0].data).toBe("hist-1");
      expect(lines[1].data).toBe("hist-2");
    });

    it("setLogHistory with non-empty lines sets isStreaming true", () => {
      useSandboxStore.getState().setLogHistory([makeLine()]);
      expect(useSandboxStore.getState().isStreaming).toBe(true);
    });

    it("setLogHistory with empty array sets isStreaming false", () => {
      useSandboxStore.getState().appendLog(makeLine());
      useSandboxStore.getState().setLogHistory([]);
      expect(useSandboxStore.getState().isStreaming).toBe(false);
    });
  });
});
