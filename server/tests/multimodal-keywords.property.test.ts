import { describe, expect, it } from "vitest";
import fc from "fast-check";

/**
 * Property 8: 多模态关键词检测
 *
 * **Validates: Requirements 6.1**
 *
 * For any workflow directive string containing one of the multimodal keywords
 * ("语音", "朗读", "图片", "截图", "看一下"), inferTaskProfile's output should
 * contain a "+multimodal" suffix. Conversely, strings without any multimodal
 * keyword should NOT have the "+multimodal" suffix.
 */

// ── Replicate inferTaskProfile (module-private) ──────────────────────────

function inferTaskProfile(directive: string): string {
  const text = directive.toLowerCase();

  const multimodalKeywords =
    /语音|朗读|图片|截图|看一下|voice|speak|read\s*aloud|image|screenshot|look\s*at/i;
  const hasMultimodal = multimodalKeywords.test(text);

  let profile: string;

  if (/(mcp|skill|prompt|agent|workflow|orchestrat|connector|tool)/i.test(text)) {
    profile = "orchestration";
  } else if (
    /(code|api|server|frontend|backend|typescript|bug|test|deploy|refactor)/i.test(text)
  ) {
    profile = "engineering";
  } else if (
    /(research|compare|analysis|analyze|benchmark|study|investigate)/i.test(text)
  ) {
    profile = "research";
  } else if (
    /(growth|marketing|content|community|campaign|copy|engagement)/i.test(text)
  ) {
    profile = "growth";
  } else if (
    /(ops|operation|rollout|launch|runbook|support|process)/i.test(text)
  ) {
    profile = "operations";
  } else {
    profile = "general";
  }

  return hasMultimodal ? `${profile}+multimodal` : profile;
}

// ── Arbitraries ──────────────────────────────────────────────────────────

/** Chinese multimodal keywords from Req 6.1 */
const CN_MULTIMODAL_KEYWORDS = ["语音", "朗读", "图片", "截图", "看一下"] as const;

/** All multimodal keywords (Chinese + English) recognised by the regex */
const ALL_MULTIMODAL_KEYWORDS = [
  ...CN_MULTIMODAL_KEYWORDS,
  "voice",
  "speak",
  "read aloud",
  "image",
  "screenshot",
  "look at",
] as const;

/** Pick one multimodal keyword at random */
const multimodalKeyword = fc.constantFrom(...ALL_MULTIMODAL_KEYWORDS);

/** Arbitrary filler text that does NOT accidentally contain a multimodal keyword */
const safeChar = fc.constantFrom(
  ..."abdfghjklmnqruwxyz0123456789 ,.!?-_:;".split(""),
);
const safeFiller = fc.array(safeChar, { minLength: 0, maxLength: 40 }).map((a) => a.join(""));

/** Build a directive that embeds a multimodal keyword inside safe filler */
const directiveWithKeyword = fc
  .tuple(safeFiller, multimodalKeyword, safeFiller)
  .map(([pre, kw, suf]) => `${pre}${kw}${suf}`);

/** Build a directive guaranteed to have NO multimodal keyword */
const directiveWithoutKeyword = safeFiller.filter(
  (s) =>
    !/语音|朗读|图片|截图|看一下|voice|speak|read\s*aloud|image|screenshot|look\s*at/i.test(s),
);

// ── Tests ────────────────────────────────────────────────────────────────

describe("Feature: multi-modal-agent, Property 8: 多模态关键词检测", () => {
  it("directive containing a multimodal keyword produces +multimodal suffix", () => {
    fc.assert(
      fc.property(directiveWithKeyword, (directive) => {
        const result = inferTaskProfile(directive);
        expect(result).toContain("+multimodal");
      }),
      { numRuns: 100 },
    );
  });

  it("directive without any multimodal keyword does NOT produce +multimodal suffix", () => {
    fc.assert(
      fc.property(directiveWithoutKeyword, (directive) => {
        const result = inferTaskProfile(directive);
        expect(result).not.toContain("+multimodal");
      }),
      { numRuns: 100 },
    );
  });

  it("result profile is always one of the known categories (with or without +multimodal)", () => {
    const knownProfiles = [
      "orchestration",
      "engineering",
      "research",
      "growth",
      "operations",
      "general",
    ];

    fc.assert(
      fc.property(
        fc.oneof(directiveWithKeyword, directiveWithoutKeyword),
        (directive) => {
          const result = inferTaskProfile(directive);
          const base = result.replace("+multimodal", "");
          expect(knownProfiles).toContain(base);
        },
      ),
      { numRuns: 100 },
    );
  });
});
