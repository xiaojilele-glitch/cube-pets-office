/**
 * Feature: sandbox-live-preview
 * Property 4: 截图间隔钳位
 * Property 3: 截图载荷约束
 *
 * **Validates: Requirements 2.1, 2.2, 2.3**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { clampInterval, computeResizedDimensions } from "./screenshot-utils.js";

describe("Property 4: 截图间隔钳位", () => {
  it("output is always in [1000, 10000] for any integer input", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10000, max: 100000 }), (ms) => {
        const result = clampInterval(ms);
        expect(result).toBeGreaterThanOrEqual(1000);
        expect(result).toBeLessThanOrEqual(10000);
      }),
      { numRuns: 200 },
    );
  });

  it("returns 1000 when input < 1000", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100000, max: 999 }), (ms) => {
        expect(clampInterval(ms)).toBe(1000);
      }),
      { numRuns: 100 },
    );
  });

  it("returns 10000 when input > 10000", () => {
    fc.assert(
      fc.property(fc.integer({ min: 10001, max: 1000000 }), (ms) => {
        expect(clampInterval(ms)).toBe(10000);
      }),
      { numRuns: 100 },
    );
  });

  it("returns input unchanged when in [1000, 10000]", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 10000 }), (ms) => {
        expect(clampInterval(ms)).toBe(ms);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Property 3: 截图载荷约束", () => {
  const arbDimension = fc.integer({ min: 1, max: 4000 });

  it("output dimensions are always ≤ maxW × maxH (800 × 600)", () => {
    fc.assert(
      fc.property(arbDimension, arbDimension, (w, h) => {
        const { width, height } = computeResizedDimensions(w, h, 800, 600);
        expect(width).toBeLessThanOrEqual(800);
        expect(height).toBeLessThanOrEqual(600);
      }),
      { numRuns: 200 },
    );
  });

  it("aspect ratio is preserved within ±1px tolerance", () => {
    fc.assert(
      fc.property(arbDimension, arbDimension, (w, h) => {
        const { width, height } = computeResizedDimensions(w, h, 800, 600);
        if (width === 0 || height === 0) return; // degenerate

        const originalRatio = w / h;
        const resultRatio = width / height;
        // Allow ±1px rounding error
        const tolerance = 1 / Math.min(width, height) + 1 / Math.min(w, h);
        expect(Math.abs(originalRatio - resultRatio)).toBeLessThanOrEqual(
          originalRatio * tolerance + 0.02,
        );
      }),
      { numRuns: 200 },
    );
  });

  it("images already within bounds are returned as-is", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 800 }),
        fc.integer({ min: 1, max: 600 }),
        (w, h) => {
          const { width, height } = computeResizedDimensions(w, h, 800, 600);
          expect(width).toBe(w);
          expect(height).toBe(h);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("output dimensions are always ≤ arbitrary maxW × maxH", () => {
    fc.assert(
      fc.property(
        arbDimension,
        arbDimension,
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        (w, h, maxW, maxH) => {
          const { width, height } = computeResizedDimensions(w, h, maxW, maxH);
          expect(width).toBeLessThanOrEqual(maxW);
          expect(height).toBeLessThanOrEqual(maxH);
        },
      ),
      { numRuns: 200 },
    );
  });
});
