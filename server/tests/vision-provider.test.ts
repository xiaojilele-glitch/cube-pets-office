import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock callLLM before importing the module under test
vi.mock("../core/llm-client.js", () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from "../core/llm-client.js";
import {
  parseVisionResponse,
  analyzeImage,
  analyzeImages,
} from "../core/vision-provider.js";

const mockCallLLM = vi.mocked(callLLM);

describe("parseVisionResponse", () => {
  it("parses a well-formatted response", () => {
    const raw =
      "DESCRIPTION: A cat sitting on a table\n" +
      "ELEMENTS:\n- cat\n- table\n- window\n" +
      "TEXT: Hello World";

    const result = parseVisionResponse(raw);

    expect(result.description).toBe("A cat sitting on a table");
    expect(result.elements).toEqual(["cat", "table", "window"]);
    expect(result.textContent).toBe("Hello World");
    expect(result.rawResponse).toBe(raw);
  });

  it("handles TEXT: NONE as empty textContent", () => {
    const raw = "DESCRIPTION: A landscape\nELEMENTS:\n- mountain\nTEXT: NONE";

    const result = parseVisionResponse(raw);

    expect(result.textContent).toBe("");
  });

  it("falls back to using entire response as description when format is unrecognized", () => {
    const raw = "This is just a plain text response about an image.";

    const result = parseVisionResponse(raw);

    expect(result.description).toBe(raw);
    expect(result.elements).toEqual([]);
    expect(result.textContent).toBe("");
    expect(result.rawResponse).toBe(raw);
  });

  it("handles empty elements section", () => {
    const raw = "DESCRIPTION: Empty scene\nELEMENTS:\nTEXT: NONE";

    const result = parseVisionResponse(raw);

    expect(result.description).toBe("Empty scene");
    expect(result.elements).toEqual([]);
  });
});

describe("analyzeImage", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Set baseline LLM config
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://test.example.com/v1";
    process.env.LLM_MODEL = "test-model";
    process.env.LLM_WIRE_API = "chat_completions";
    mockCallLLM.mockReset();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it("sends a multimodal message with image_url and parses the response", async () => {
    mockCallLLM.mockResolvedValue({
      content: "DESCRIPTION: A dog\nELEMENTS:\n- dog\n- grass\nTEXT: NONE",
    });

    const result = await analyzeImage("data:image/png;base64,abc123");

    expect(mockCallLLM).toHaveBeenCalledOnce();
    const [messages, options] = mockCallLLM.mock.calls[0];

    // Should be a single user message with multimodal content
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(Array.isArray(messages[0].content)).toBe(true);

    const content = messages[0].content as any[];
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("text");
    expect(content[1].type).toBe("image_url");
    expect(content[1].image_url.url).toBe("data:image/png;base64,abc123");
    expect(content[1].image_url.detail).toBe("low"); // default

    // Options should use vision config defaults
    expect(options?.maxTokens).toBe(1000);
    expect(options?.temperature).toBe(0.3);

    // Result should be parsed
    expect(result.description).toBe("A dog");
    expect(result.elements).toEqual(["dog", "grass"]);
    expect(result.textContent).toBe("");
  });

  it("uses custom prompt when provided", async () => {
    mockCallLLM.mockResolvedValue({
      content: "DESCRIPTION: test\nELEMENTS:\nTEXT: NONE",
    });

    await analyzeImage("data:image/png;base64,abc", "Describe this chart");

    const [messages] = mockCallLLM.mock.calls[0];
    const content = messages[0].content as any[];
    expect(content[0].text).toBe("Describe this chart");
  });

  it("uses detail from VISION_LLM_DETAIL config", async () => {
    process.env.VISION_LLM_DETAIL = "high";
    mockCallLLM.mockResolvedValue({
      content: "DESCRIPTION: test\nELEMENTS:\nTEXT: NONE",
    });

    await analyzeImage("data:image/png;base64,abc");

    const [messages] = mockCallLLM.mock.calls[0];
    const content = messages[0].content as any[];
    expect(content[1].image_url.detail).toBe("high");
  });

  it("propagates callLLM errors", async () => {
    mockCallLLM.mockRejectedValue(new Error("LLM timeout"));

    await expect(analyzeImage("data:image/png;base64,abc")).rejects.toThrow(
      "LLM timeout"
    );
  });
});

describe("analyzeImages", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { ...process.env };
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://test.example.com/v1";
    process.env.LLM_MODEL = "test-model";
    process.env.LLM_WIRE_API = "chat_completions";
    mockCallLLM.mockReset();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it("processes multiple images in parallel and returns a Map", async () => {
    mockCallLLM
      .mockResolvedValueOnce({
        content: "DESCRIPTION: Cat\nELEMENTS:\n- cat\nTEXT: NONE",
      })
      .mockResolvedValueOnce({
        content: "DESCRIPTION: Dog\nELEMENTS:\n- dog\nTEXT: Woof",
      });

    const images = [
      { base64DataUrl: "data:image/png;base64,cat", name: "cat.png" },
      { base64DataUrl: "data:image/png;base64,dog", name: "dog.png" },
    ];

    const result = await analyzeImages(images);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get("cat.png")?.description).toBe("Cat");
    expect(result.get("dog.png")?.description).toBe("Dog");
    expect(result.get("dog.png")?.textContent).toBe("Woof");
  });

  it("handles partial failures — failed images are excluded from the Map", async () => {
    mockCallLLM
      .mockResolvedValueOnce({
        content: "DESCRIPTION: Cat\nELEMENTS:\nTEXT: NONE",
      })
      .mockRejectedValueOnce(new Error("timeout"));

    const images = [
      { base64DataUrl: "data:image/png;base64,cat", name: "cat.png" },
      { base64DataUrl: "data:image/png;base64,bad", name: "bad.png" },
    ];

    const result = await analyzeImages(images);

    expect(result.size).toBe(1);
    expect(result.has("cat.png")).toBe(true);
    expect(result.has("bad.png")).toBe(false);
  });

  it("returns empty Map when all images fail", async () => {
    mockCallLLM.mockRejectedValue(new Error("all fail"));

    const images = [
      { base64DataUrl: "data:image/png;base64,a", name: "a.png" },
      { base64DataUrl: "data:image/png;base64,b", name: "b.png" },
    ];

    const result = await analyzeImages(images);

    expect(result.size).toBe(0);
  });

  it("returns empty Map for empty input array", async () => {
    const result = await analyzeImages([]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });
});
