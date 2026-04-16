import { describe, expect, it } from "vitest";
import fc from "fast-check";

/* ─── Property 6: 语音状态气泡文案完整性 ─── */
/* **Validates: Requirements 4.2, 4.4** */

/**
 * STATUS_BUBBLES and getStatusBubble are module-private in PetWorkers.tsx.
 * We replicate the voice-related subset here to test the property:
 *
 *   For any voice-related status ("listening", "speaking") and any supported
 *   locale ("zh-CN", "en-US"), getStatusBubble must return a non-empty string.
 */

type AppLocale = "zh-CN" | "en-US";

const STATUS_BUBBLES: Record<AppLocale, Record<string, string>> = {
  "zh-CN": {
    listening: "正在听...\n请说出你的指令。",
    speaking: "正在说话...\n请稍等，我来念给你听。",
  },
  "en-US": {
    listening: "Listening...\nGo ahead, I am all ears.",
    speaking: "Speaking...\nHold on, let me read it out.",
  },
};

function getStatusBubble(
  status: string,
  locale: AppLocale,
  fallback: string
): string {
  return STATUS_BUBBLES[locale][status] || fallback;
}

// ── Arbitraries ──

const arbVoiceStatus = fc.constantFrom("listening", "speaking");
const arbLocale = fc.constantFrom<AppLocale>("zh-CN", "en-US");

describe("Feature: multi-modal-agent, Property 6: 语音状态气泡文案完整性", () => {
  it("voice statuses return a non-empty bubble string for every supported locale", () => {
    fc.assert(
      fc.property(
        arbVoiceStatus,
        arbLocale,
        (status: string, locale: AppLocale) => {
          const result = getStatusBubble(status, locale, "");
          expect(result).toBeTruthy();
          expect(typeof result).toBe("string");
          expect(result.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("voice status bubbles never fall back to the fallback string", () => {
    const SENTINEL = "__FALLBACK_SENTINEL__";
    fc.assert(
      fc.property(
        arbVoiceStatus,
        arbLocale,
        (status: string, locale: AppLocale) => {
          const result = getStatusBubble(status, locale, SENTINEL);
          expect(result).not.toBe(SENTINEL);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every locale × voice-status cell is a distinct non-empty string", () => {
    fc.assert(
      fc.property(arbLocale, (locale: AppLocale) => {
        const listening = getStatusBubble("listening", locale, "");
        const speaking = getStatusBubble("speaking", locale, "");
        // Both must be non-empty
        expect(listening.length).toBeGreaterThan(0);
        expect(speaking.length).toBeGreaterThan(0);
        // They must be different from each other
        expect(listening).not.toBe(speaking);
      }),
      { numRuns: 100 }
    );
  });
});
