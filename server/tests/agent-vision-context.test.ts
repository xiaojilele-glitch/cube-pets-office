import { describe, expect, it } from "vitest";
import {
  composeAgentMessages,
  type RuntimeAgentConfig,
  type VisionContext,
} from "../../shared/runtime-agent.js";
import type { MemoryRepository } from "../../shared/workflow-runtime.js";

/** Minimal stub that satisfies MemoryRepository for testing */
const stubMemoryRepo: MemoryRepository = {
  getSoulText: (_id: string, soulMd: string) => soulMd,
  buildPromptContext: () => [],
  appendLLMExchange: () => {},
} as unknown as MemoryRepository;

const baseConfig: RuntimeAgentConfig = {
  id: "test-agent",
  name: "TestBot",
  department: "engineering",
  role: "worker",
  managerId: null,
  model: "gpt-4",
  soulMd: "You are a helpful assistant.",
};

describe("composeAgentMessages – visionContexts injection", () => {
  it("injects vision context messages before the user prompt", () => {
    const visionContexts: VisionContext[] = [
      {
        imageName: "screenshot.png",
        visualDescription: "A dashboard with charts",
      },
    ];

    const messages = composeAgentMessages(
      baseConfig,
      "Analyze this screenshot",
      stubMemoryRepo,
      [],
      { visionContexts }
    );

    // Last message should be the user prompt
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toBe("Analyze this screenshot");

    // Second-to-last should be the vision context
    const visionMsg = messages[messages.length - 2];
    expect(visionMsg.role).toBe("user");
    expect(visionMsg.content).toBe(
      "[Vision Analysis] screenshot.png\nA dashboard with charts"
    );
  });

  it("injects multiple vision contexts in order before the prompt", () => {
    const visionContexts: VisionContext[] = [
      { imageName: "img1.png", visualDescription: "First image description" },
      { imageName: "img2.jpg", visualDescription: "Second image description" },
    ];

    const messages = composeAgentMessages(
      baseConfig,
      "Compare these images",
      stubMemoryRepo,
      [],
      { visionContexts }
    );

    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.content).toBe("Compare these images");

    const vc1 = messages[messages.length - 3];
    expect(vc1.content).toContain("[Vision Analysis] img1.png");

    const vc2 = messages[messages.length - 2];
    expect(vc2.content).toContain("[Vision Analysis] img2.jpg");
  });

  it("does not inject anything when visionContexts is undefined", () => {
    const messages = composeAgentMessages(
      baseConfig,
      "Hello",
      stubMemoryRepo,
      [],
      {}
    );

    // system + user prompt = 2 messages
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("Hello");
  });

  it("does not inject anything when visionContexts is empty", () => {
    const messages = composeAgentMessages(
      baseConfig,
      "Hello",
      stubMemoryRepo,
      [],
      { visionContexts: [] }
    );

    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe("Hello");
  });

  it("places vision contexts after regular context items", () => {
    const visionContexts: VisionContext[] = [
      { imageName: "photo.webp", visualDescription: "A cat sitting on a desk" },
    ];

    const messages = composeAgentMessages(
      baseConfig,
      "Describe the pet",
      stubMemoryRepo,
      ["Some prior context"],
      { visionContexts }
    );

    // Order: system, context, vision, prompt
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toBe("Some prior context");
    expect(messages[2].content).toContain("[Vision Analysis] photo.webp");
    expect(messages[3].content).toBe("Describe the pet");
  });
});
