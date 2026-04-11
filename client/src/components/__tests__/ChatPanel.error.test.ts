import { describe, expect, it } from "vitest";

import { buildChatErrorContent } from "@/components/ChatPanel";
import { getMessages } from "@/i18n/messages";

describe("ChatPanel error copy", () => {
  const copy = getMessages("en-US");

  it("renders structured fallback errors without exposing parser details", () => {
    const content = buildChatErrorContent(
      {
        kind: "offline",
        source: "html-fallback",
        endpoint: "/api/chat",
        message: "The backend is temporarily unavailable.",
        detail: "Retry after the API is available again.",
        retryable: true,
      },
      copy
    );

    expect(content).toContain(copy.chat.errorTitle);
    expect(content).toContain("The backend is temporarily unavailable.");
    expect(content).toContain("Retry after the API is available again.");
    expect(content).not.toContain("Unexpected token");
  });

  it("replaces raw parser errors with the generic chat hint", () => {
    const content = buildChatErrorContent(
      new Error("Unexpected token '<', \"<!doctype\" is not valid JSON"),
      copy
    );

    expect(content).toContain(copy.chat.errorTitle);
    expect(content).toContain(copy.chat.errorHint);
    expect(content).not.toContain("Unexpected token");
  });
});
