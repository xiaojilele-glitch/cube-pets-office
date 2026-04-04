/**
 * 服务端中继层单元测试：SandboxRelay + 事件路由验证
 *
 * 验证:
 * - SandboxRelay 基本操作（追加、查询、清理）
 * - 新事件类型在 EXECUTOR_EVENT_TYPES 中存在
 * - SANDBOX_SOCKET_EVENTS 常量正确
 *
 * 需求: 3.1, 3.2, 3.3, 3.5
 */
import { describe, expect, it } from "vitest";

import { SandboxRelay, type LogBufferEntry } from "../core/sandbox-relay.js";
import { EXECUTOR_EVENT_TYPES } from "../../shared/executor/contracts.js";
import { SANDBOX_SOCKET_EVENTS } from "../../shared/mission/socket.js";

function makeEntry(overrides?: Partial<LogBufferEntry>): LogBufferEntry {
  return {
    missionId: "m-1",
    jobId: "j-1",
    stepIndex: 0,
    stream: "stdout",
    data: "hello",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("SandboxRelay 单元测试", () => {
  it("空缓冲区查询返回空数组", () => {
    const relay = new SandboxRelay();
    expect(relay.getLogHistory("nonexistent")).toEqual([]);
  });

  it("单条追加后可查询", () => {
    const relay = new SandboxRelay();
    const entry = makeEntry();
    relay.appendLog(entry);
    const history = relay.getLogHistory("m-1");
    expect(history).toHaveLength(1);
    expect(history[0].data).toBe("hello");
  });

  it("clearMission 清理指定 Mission", () => {
    const relay = new SandboxRelay();
    relay.appendLog(makeEntry({ missionId: "m-1" }));
    relay.appendLog(makeEntry({ missionId: "m-2" }));
    relay.clearMission("m-1");
    expect(relay.getLogHistory("m-1")).toHaveLength(0);
    expect(relay.getLogHistory("m-2")).toHaveLength(1);
  });

  it("FIFO 淘汰：超过 200 条时移除最旧", () => {
    const relay = new SandboxRelay();
    for (let i = 0; i < 210; i++) {
      relay.appendLog(makeEntry({ data: `line-${i}` }));
    }
    const history = relay.getLogHistory("m-1");
    expect(history).toHaveLength(200);
    expect(history[0].data).toBe("line-10");
    expect(history[199].data).toBe("line-209");
  });
});

describe("事件类型路由验证", () => {
  it("EXECUTOR_EVENT_TYPES 包含 job.log_stream", () => {
    expect(EXECUTOR_EVENT_TYPES).toContain("job.log_stream");
  });

  it("EXECUTOR_EVENT_TYPES 包含 job.screenshot", () => {
    expect(EXECUTOR_EVENT_TYPES).toContain("job.screenshot");
  });
});

describe("SANDBOX_SOCKET_EVENTS 常量验证", () => {
  it("missionLog = mission_log", () => {
    expect(SANDBOX_SOCKET_EVENTS.missionLog).toBe("mission_log");
  });

  it("missionScreen = mission_screen", () => {
    expect(SANDBOX_SOCKET_EVENTS.missionScreen).toBe("mission_screen");
  });

  it("missionLogHistory = mission_log_history", () => {
    expect(SANDBOX_SOCKET_EVENTS.missionLogHistory).toBe("mission_log_history");
  });
});
