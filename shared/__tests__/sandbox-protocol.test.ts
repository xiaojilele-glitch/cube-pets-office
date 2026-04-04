import { describe, expect, it } from "vitest";
import {
  EXECUTOR_EVENT_TYPES,
  type ExecutorEvent,
} from "../executor/contracts.js";
import {
  SANDBOX_SOCKET_EVENTS,
  type SandboxLogPayload,
  type SandboxScreenPayload,
  type SandboxLogHistoryPayload,
} from "../mission/socket.js";

describe("Sandbox Live Preview — 协议类型", () => {
  describe("EXECUTOR_EVENT_TYPES", () => {
    it('包含 "job.log_stream" 事件类型', () => {
      expect(EXECUTOR_EVENT_TYPES).toContain("job.log_stream");
    });

    it('包含 "job.screenshot" 事件类型', () => {
      expect(EXECUTOR_EVENT_TYPES).toContain("job.screenshot");
    });
  });

  describe("ExecutorEvent 扩展字段完整性", () => {
    it("job.log_stream 事件包含 stepIndex、stream、data 字段", () => {
      const event: ExecutorEvent = {
        version: "2026-03-28",
        eventId: "evt-1",
        missionId: "m-1",
        jobId: "j-1",
        executor: "lobster",
        type: "job.log_stream",
        status: "running",
        occurredAt: new Date().toISOString(),
        message: "log stream",
        stepIndex: 0,
        stream: "stdout",
        data: "hello world",
      };

      expect(event.stepIndex).toBe(0);
      expect(event.stream).toBe("stdout");
      expect(event.data).toBe("hello world");
    });

    it("job.screenshot 事件包含 stepIndex、imageData、imageWidth、imageHeight 字段", () => {
      const event: ExecutorEvent = {
        version: "2026-03-28",
        eventId: "evt-2",
        missionId: "m-1",
        jobId: "j-1",
        executor: "lobster",
        type: "job.screenshot",
        status: "running",
        occurredAt: new Date().toISOString(),
        message: "screenshot",
        stepIndex: 1,
        imageData: "iVBORw0KGgo=",
        imageWidth: 800,
        imageHeight: 600,
      };

      expect(event.stepIndex).toBe(1);
      expect(event.imageData).toBe("iVBORw0KGgo=");
      expect(event.imageWidth).toBe(800);
      expect(event.imageHeight).toBe(600);
    });
  });

  describe("SANDBOX_SOCKET_EVENTS", () => {
    it('missionLog 对应 "mission_log"', () => {
      expect(SANDBOX_SOCKET_EVENTS.missionLog).toBe("mission_log");
    });

    it('missionScreen 对应 "mission_screen"', () => {
      expect(SANDBOX_SOCKET_EVENTS.missionScreen).toBe("mission_screen");
    });

    it('missionLogHistory 对应 "mission_log_history"', () => {
      expect(SANDBOX_SOCKET_EVENTS.missionLogHistory).toBe("mission_log_history");
    });
  });

  describe("SandboxLogPayload 字段完整性", () => {
    it("包含所有必需字段", () => {
      const payload: SandboxLogPayload = {
        missionId: "m-1",
        jobId: "j-1",
        stepIndex: 0,
        stream: "stderr",
        data: "error output",
        timestamp: new Date().toISOString(),
      };

      expect(payload.missionId).toBe("m-1");
      expect(payload.jobId).toBe("j-1");
      expect(payload.stepIndex).toBe(0);
      expect(payload.stream).toBe("stderr");
      expect(payload.data).toBe("error output");
      expect(payload.timestamp).toBeTruthy();
    });
  });

  describe("SandboxScreenPayload 字段完整性", () => {
    it("包含所有必需字段", () => {
      const payload: SandboxScreenPayload = {
        missionId: "m-1",
        jobId: "j-1",
        stepIndex: 2,
        imageData: "base64data",
        width: 800,
        height: 600,
        timestamp: new Date().toISOString(),
      };

      expect(payload.missionId).toBe("m-1");
      expect(payload.jobId).toBe("j-1");
      expect(payload.stepIndex).toBe(2);
      expect(payload.imageData).toBe("base64data");
      expect(payload.width).toBe(800);
      expect(payload.height).toBe(600);
      expect(payload.timestamp).toBeTruthy();
    });
  });

  describe("SandboxLogHistoryPayload 字段完整性", () => {
    it("包含 missionId 和 lines 数组", () => {
      const payload: SandboxLogHistoryPayload = {
        missionId: "m-1",
        lines: [
          {
            missionId: "m-1",
            jobId: "j-1",
            stepIndex: 0,
            stream: "stdout",
            data: "line 1",
            timestamp: new Date().toISOString(),
          },
          {
            missionId: "m-1",
            jobId: "j-1",
            stepIndex: 0,
            stream: "stderr",
            data: "line 2",
            timestamp: new Date().toISOString(),
          },
        ],
      };

      expect(payload.missionId).toBe("m-1");
      expect(payload.lines).toHaveLength(2);
      expect(payload.lines[0].stream).toBe("stdout");
      expect(payload.lines[1].stream).toBe("stderr");
    });
  });
});
