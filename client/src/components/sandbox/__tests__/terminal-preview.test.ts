/**
 * TerminalPreview 单元测试：空闲态逻辑、全屏切换状态
 *
 * Tests the component's behavioral logic without DOM rendering,
 * consistent with the project's testing patterns.
 *
 * 需求: 4.5, 4.6
 */
import { describe, expect, it } from "vitest";

import { useSandboxStore } from "../../../lib/sandbox-store";
import type { LogLine } from "../../../lib/sandbox-store";

describe("TerminalPreview 逻辑测试", () => {
  describe("空闲态 (isStreaming === false)", () => {
    it("初始状态 isStreaming 为 false", () => {
      const state = useSandboxStore.getState();
      state.reset();
      expect(useSandboxStore.getState().isStreaming).toBe(false);
    });

    it("appendLog 后 isStreaming 变为 true", () => {
      const state = useSandboxStore.getState();
      state.reset();
      const line: LogLine = {
        stepIndex: 0,
        stream: "stdout",
        data: "hello",
        timestamp: new Date().toISOString(),
      };
      useSandboxStore.getState().appendLog(line);
      expect(useSandboxStore.getState().isStreaming).toBe(true);
    });

    it("reset 后 isStreaming 回到 false", () => {
      useSandboxStore.getState().appendLog({
        stepIndex: 0,
        stream: "stdout",
        data: "test",
        timestamp: new Date().toISOString(),
      });
      useSandboxStore.getState().reset();
      expect(useSandboxStore.getState().isStreaming).toBe(false);
    });
  });

  describe("全屏切换", () => {
    it("初始状态 fullscreen 为 false", () => {
      useSandboxStore.getState().reset();
      expect(useSandboxStore.getState().fullscreen).toBe(false);
    });

    it("setFullscreen(true) 切换到全屏", () => {
      useSandboxStore.getState().reset();
      useSandboxStore.getState().setFullscreen(true);
      expect(useSandboxStore.getState().fullscreen).toBe(true);
    });

    it("setFullscreen(false) 退出全屏", () => {
      useSandboxStore.getState().setFullscreen(true);
      useSandboxStore.getState().setFullscreen(false);
      expect(useSandboxStore.getState().fullscreen).toBe(false);
    });

    it("reset 后 fullscreen 回到 false", () => {
      useSandboxStore.getState().setFullscreen(true);
      useSandboxStore.getState().reset();
      expect(useSandboxStore.getState().fullscreen).toBe(false);
    });
  });

  describe("logLines 上限", () => {
    it("logLines 不超过 500 行", () => {
      useSandboxStore.getState().reset();
      for (let i = 0; i < 550; i++) {
        useSandboxStore.getState().appendLog({
          stepIndex: 0,
          stream: "stdout",
          data: `line-${i}`,
          timestamp: new Date().toISOString(),
        });
      }
      expect(useSandboxStore.getState().logLines.length).toBeLessThanOrEqual(500);
    });
  });
});
