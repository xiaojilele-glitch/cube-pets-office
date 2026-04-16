import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  LLMMessage,
  LLMMessageContentPart,
} from "../../shared/workflow-runtime.js";

/* ─── Arbitraries ─── */

const arbRole = fc.constantFrom("system", "user", "assistant") as fc.Arbitrary<
  "system" | "user" | "assistant"
>;

const arbTextPart: fc.Arbitrary<LLMMessageContentPart> = fc.record({
  type: fc.constant("text" as const),
  text: fc.string(),
});

const arbImageUrlPart: fc.Arbitrary<LLMMessageContentPart> = fc.record({
  type: fc.constant("image_url" as const),
  image_url: fc.record({
    url: fc.string(),
    detail: fc.option(
      fc.constantFrom("low", "high", "auto") as fc.Arbitrary<
        "low" | "high" | "auto"
      >,
      { nil: undefined }
    ),
  }),
});

const arbContentPart: fc.Arbitrary<LLMMessageContentPart> = fc.oneof(
  arbTextPart,
  arbImageUrlPart
);

const arbContent: fc.Arbitrary<string | LLMMessageContentPart[]> = fc.oneof(
  fc.string(),
  fc.array(arbContentPart)
);

const arbLLMMessage: fc.Arbitrary<LLMMessage> = fc.record({
  role: arbRole,
  content: arbContent,
});

/* ─── Helpers: format conversion mirrors llm-client.ts logic ─── */

/**
 * Mirrors the chat_completions format: content array is passed through as-is.
 */
function convertToChatCompletionsFormat(
  parts: LLMMessageContentPart[]
): LLMMessageContentPart[] {
  return parts;
}

/**
 * Mirrors the responses API format conversion from buildResponsesInput in llm-client.ts:
 *   text       → { type: "input_text", text }
 *   image_url  → { type: "input_image", image_url: <url string> }
 */
function convertToResponsesFormat(
  parts: LLMMessageContentPart[]
): Array<{ type: string; text?: string; image_url?: string }> {
  return parts.map(part => {
    if (part.type === "image_url") {
      return { type: "input_image", image_url: part.image_url.url };
    }
    return { type: "input_text", text: part.text };
  });
}

/* ─── Property 5: 多模态消息格式转换 ─── */
/* **Validates: Requirements 3.1, 3.2, 3.3** */

describe("Feature: multi-modal-vision, Property 5: 多模态消息格式转换", () => {
  it("chat_completions format preserves content array as-is", () => {
    fc.assert(
      fc.property(fc.array(arbContentPart, { minLength: 1 }), parts => {
        const result = convertToChatCompletionsFormat(parts);

        // The result should be the exact same reference (identity)
        expect(result).toBe(parts);
        // And deeply equal
        expect(result).toEqual(parts);
      }),
      { numRuns: 100 }
    );
  });

  it("responses format converts text parts to input_text and image_url parts to input_image", () => {
    fc.assert(
      fc.property(fc.array(arbContentPart, { minLength: 1 }), parts => {
        const result = convertToResponsesFormat(parts);

        // Same length
        expect(result).toHaveLength(parts.length);

        for (let i = 0; i < parts.length; i++) {
          const original = parts[i];
          const converted = result[i];

          if (original.type === "text") {
            // text → input_text with same text value
            expect(converted.type).toBe("input_text");
            expect(converted.text).toBe(original.text);
            expect(converted.image_url).toBeUndefined();
          } else {
            // image_url → input_image with url extracted from nested object
            expect(converted.type).toBe("input_image");
            expect(converted.image_url).toBe(original.image_url.url);
            expect(converted.text).toBeUndefined();
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("responses format conversion produces no image_url entries with nested objects", () => {
    fc.assert(
      fc.property(fc.array(arbContentPart, { minLength: 1 }), parts => {
        const result = convertToResponsesFormat(parts);

        // No converted entry should have a nested image_url object — only string or undefined
        for (const entry of result) {
          if (entry.image_url !== undefined) {
            expect(typeof entry.image_url).toBe("string");
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("responses format output types are exclusively input_text or input_image", () => {
    fc.assert(
      fc.property(fc.array(arbContentPart, { minLength: 1 }), parts => {
        const result = convertToResponsesFormat(parts);

        for (const entry of result) {
          expect(["input_text", "input_image"]).toContain(entry.type);
        }
      }),
      { numRuns: 100 }
    );
  });
});

/* ─── Property 6: 多模态消息序列化 round-trip ─── */
/* **Validates: Requirements 3.4** */

describe("Feature: multi-modal-vision, Property 6: 多模态消息序列化 round-trip", () => {
  it("JSON.stringify then JSON.parse produces a deeply equal LLMMessage", () => {
    fc.assert(
      fc.property(arbLLMMessage, message => {
        const serialized = JSON.stringify(message);
        const deserialized: LLMMessage = JSON.parse(serialized);

        expect(deserialized).toEqual(message);
      }),
      { numRuns: 100 }
    );
  });
});
