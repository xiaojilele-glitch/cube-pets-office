import { describe, expect, it } from "vitest";

import { formatLaunchAttachmentSize } from "../LaunchAttachmentSection";
import { getLaunchRouteBannerTitle } from "../LaunchRouteBanner";
import {
  getLaunchAttachmentCountLabel,
  getLaunchRuntimeLabel,
} from "../LaunchRuntimeMeta";
import {
  getUnifiedLaunchRouteHint,
  getUnifiedLaunchSubmitLabel,
} from "../UnifiedLaunchComposer";

describe("UnifiedLaunchComposer helper logic", () => {
  it("uses mission copy for direct mission launches", () => {
    expect(getLaunchRouteBannerTitle("zh-CN", "mission")).toBe(
      "系统判断：快速任务"
    );
    expect(getUnifiedLaunchRouteHint("zh-CN", "mission")).toContain(
      "直接创建 mission"
    );
    expect(
      getUnifiedLaunchSubmitLabel("zh-CN", {
        kind: "mission",
        submitting: false,
      })
    ).toBe("创建任务");
  });

  it("uses clarification copy for underspecified requests", () => {
    expect(getLaunchRouteBannerTitle("zh-CN", "clarify")).toBe(
      "系统判断：先补问"
    );
    expect(getUnifiedLaunchRouteHint("zh-CN", "clarify")).toContain(
      "先补问关键信息"
    );
    expect(
      getUnifiedLaunchSubmitLabel("zh-CN", {
        kind: "clarify",
        submitting: false,
      })
    ).toBe("先澄清");
  });

  it("uses workflow copy when attachment context is required", () => {
    expect(getLaunchRouteBannerTitle("zh-CN", "workflow")).toBe(
      "系统判断：高级编排"
    );
    expect(getUnifiedLaunchRouteHint("zh-CN", "workflow")).toContain(
      "进入 workflow"
    );
    expect(
      getUnifiedLaunchSubmitLabel("zh-CN", {
        kind: "workflow",
        submitting: false,
      })
    ).toBe("智能发起");
  });

  it("uses runtime upgrade copy when frontend mode cannot execute directly", () => {
    expect(getLaunchRouteBannerTitle("zh-CN", "upgrade-required")).toBe(
      "系统判断：需要高级执行"
    );
    expect(getUnifiedLaunchRouteHint("zh-CN", "upgrade-required")).toContain(
      "切换到高级模式"
    );
    expect(
      getUnifiedLaunchSubmitLabel("zh-CN", {
        kind: "upgrade-required",
        submitting: false,
      })
    ).toBe("切到高级执行");
  });

  it("uses submitting copy while the launcher is busy", () => {
    expect(
      getUnifiedLaunchSubmitLabel("zh-CN", {
        kind: "mission",
        submitting: true,
      })
    ).toBe("提交中...");
  });

  it("formats attachment sizes for bytes, KB and MB", () => {
    expect(formatLaunchAttachmentSize(512)).toBe("512 B");
    expect(formatLaunchAttachmentSize(2048)).toBe("2 KB");
    expect(formatLaunchAttachmentSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("reports runtime and attachment meta labels", () => {
    expect(getLaunchRuntimeLabel("zh-CN", "frontend")).toBe("当前：前端预览");
    expect(getLaunchRuntimeLabel("zh-CN", "advanced")).toBe("当前：高级执行");
    expect(getLaunchAttachmentCountLabel("zh-CN", 2)).toBe("已附 2 个文件");
  });
});
