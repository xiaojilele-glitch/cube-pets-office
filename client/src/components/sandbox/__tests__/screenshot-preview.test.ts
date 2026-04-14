/**
 * ScreenshotPreview 单元测试：占位符渲染、时间戳显示
 *
 * Tests the component's behavioral logic via the store,
 * consistent with the project's testing patterns.
 *
 * 需求: 5.1, 5.5
 */
import { describe, expect, it } from "vitest";

import {
  useSandboxStore,
  formatTimestamp,
  type ScreenshotFrame,
} from "../../../lib/sandbox-store";

describe("ScreenshotPreview 逻辑测试", () => {
  describe("占位符状态 (无截图)", () => {
    it("初始状态 latestScreenshot 为 null", () => {
      useSandboxStore.getState().reset();
      expect(useSandboxStore.getState().latestScreenshot).toBeNull();
    });

    it("初始状态 previousScreenshot 为 null", () => {
      useSandboxStore.getState().reset();
      expect(useSandboxStore.getState().previousScreenshot).toBeNull();
    });
  });

  describe("截图更新", () => {
    it("updateScreenshot 设置 latestScreenshot", () => {
      useSandboxStore.getState().reset();
      const frame: ScreenshotFrame = {
        stepIndex: 0,
        imageData: "iVBORw0KGgo=",
        width: 800,
        height: 600,
        timestamp: "2026-04-04T12:00:00Z",
      };
      useSandboxStore.getState().updateScreenshot(frame);
      expect(useSandboxStore.getState().latestScreenshot).toEqual(frame);
    });

    it("updateScreenshot 将旧截图移到 previousScreenshot", () => {
      useSandboxStore.getState().reset();
      const frame1: ScreenshotFrame = {
        stepIndex: 0,
        imageData: "frame1",
        width: 800,
        height: 600,
        timestamp: "2026-04-04T12:00:00Z",
      };
      const frame2: ScreenshotFrame = {
        stepIndex: 1,
        imageData: "frame2",
        width: 800,
        height: 600,
        timestamp: "2026-04-04T12:00:01Z",
      };
      useSandboxStore.getState().updateScreenshot(frame1);
      useSandboxStore.getState().updateScreenshot(frame2);

      const state = useSandboxStore.getState();
      expect(state.latestScreenshot).toEqual(frame2);
      expect(state.previousScreenshot).toEqual(frame1);
    });

    it("reset 清除所有截图", () => {
      useSandboxStore.getState().setFocusedPane("browser");
      useSandboxStore.getState().updateScreenshot({
        stepIndex: 0,
        imageData: "test",
        width: 100,
        height: 100,
        timestamp: new Date().toISOString(),
      });
      useSandboxStore.getState().reset();
      expect(useSandboxStore.getState().latestScreenshot).toBeNull();
      expect(useSandboxStore.getState().previousScreenshot).toBeNull();
      expect(useSandboxStore.getState().focusedPane).toBeNull();
    });
  });

  describe("时间戳显示", () => {
    it("formatTimestamp 输出 HH:MM:SS 格式", () => {
      const result = formatTimestamp("2026-04-04T14:30:45Z");
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it("formatTimestamp 对无效输入返回原始字符串", () => {
      expect(formatTimestamp("not-a-date")).toBe("not-a-date");
    });
  });
});
