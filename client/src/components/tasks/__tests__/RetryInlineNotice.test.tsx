import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RetryInlineNotice } from "../RetryInlineNotice";

describe("RetryInlineNotice", () => {
  it("renders the title, description, and retry action", () => {
    const markup = renderToStaticMarkup(
      <RetryInlineNotice
        title="Connection issue"
        description="Try again after the backend is ready."
        actionLabel="Retry"
        onRetry={() => {}}
      />
    );

    expect(markup).toContain("Connection issue");
    expect(markup).toContain("Try again after the backend is ready.");
    expect(markup).toContain("Retry");
  });

  it("wires the retry callback to the action button", () => {
    const onRetry = vi.fn();
    const element = RetryInlineNotice({
      title: "Connection issue",
      description: "Try again after the backend is ready.",
      actionLabel: "Retry",
      onRetry,
    }) as any;

    const buttonElement = element.props.children[1];
    buttonElement.props.onClick();

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
