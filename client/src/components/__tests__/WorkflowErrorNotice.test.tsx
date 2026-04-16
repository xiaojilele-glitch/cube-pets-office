import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { WorkflowErrorNotice } from "@/components/WorkflowPanel";
import { getMessages } from "@/i18n/messages";
import { useAppStore } from "@/lib/store";

describe("WorkflowErrorNotice", () => {
  beforeEach(() => {
    useAppStore.setState({ locale: "zh-CN" });
  });

  it("distinguishes demo fallback copy from generic errors", () => {
    const markup = renderToStaticMarkup(
      <WorkflowErrorNotice
        error={{
          kind: "demo",
          source: "html-fallback",
          endpoint: "/api/workflows",
          message: "Showing cached preview data.",
          detail: "Switch to advanced mode after the backend is ready.",
          retryable: true,
        }}
        onRetry={() => {}}
      />
    );

    expect(markup).toContain("Showing cached preview data.");
    expect(markup).toContain(
      "Switch to advanced mode after the backend is ready."
    );
    expect(markup).toContain(getMessages("zh-CN").tasks.statuses.action.retry);
  });

  it("hides the retry action when the error is not retryable", () => {
    const markup = renderToStaticMarkup(
      <WorkflowErrorNotice
        error={{
          kind: "error",
          source: "http",
          endpoint: "/api/workflows",
          message: "The request failed with a validation error.",
          detail: "This response should not be retried automatically.",
          retryable: false,
        }}
      />
    );

    expect(markup).toContain("The request failed with a validation error.");
    expect(markup).not.toContain("Retry");
    expect(markup).not.toContain(
      getMessages("zh-CN").tasks.statuses.action.retry
    );
  });
});
