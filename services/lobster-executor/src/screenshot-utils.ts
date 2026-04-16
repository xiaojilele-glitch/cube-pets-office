/**
 * Utility functions for screenshot capture configuration.
 *
 * - `clampInterval(ms)`: Clamps a capture interval to [1000, 10000] ms.
 * - `computeResizedDimensions(w, h, maxW, maxH)`: Scales dimensions to fit
 *   within a bounding box while preserving aspect ratio.
 */

/**
 * Clamp a screenshot capture interval to the allowed range.
 *
 * @param ms - Desired interval in milliseconds
 * @returns Clamped value in [1000, 10000]
 */
export function clampInterval(ms: number): number {
  if (ms < 1000) return 1000;
  if (ms > 10000) return 10000;
  return ms;
}

/**
 * Compute dimensions that fit within `maxW × maxH` while preserving the
 * original aspect ratio. If the input already fits, it is returned as-is.
 *
 * @param w    - Original width  (must be > 0)
 * @param h    - Original height (must be > 0)
 * @param maxW - Maximum allowed width  (must be > 0)
 * @param maxH - Maximum allowed height (must be > 0)
 * @returns `{ width, height }` rounded to the nearest integer
 */
export function computeResizedDimensions(
  w: number,
  h: number,
  maxW: number,
  maxH: number
): { width: number; height: number } {
  if (w <= maxW && h <= maxH) {
    return { width: Math.round(w), height: Math.round(h) };
  }

  const scale = Math.min(maxW / w, maxH / h);
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
  };
}
