import { describe, expect, it } from "vitest";

import { compareHandwritingPointClouds } from "../../src/services/handwriting-comparison";

describe("handwriting comparison", () => {
  it("accepts a complete matching shape", () => {
    const reference = shape([
      [20, 48, 76, 48],
      [48, 20, 48, 76],
    ]);
    const result = compareHandwritingPointClouds(reference, reference);

    expect(result.isMatch).toBe(true);
    expect(result.score).toBeGreaterThan(0.95);
    expect(result.breakdown.coverage).toBeGreaterThan(0.95);
  });

  it("tolerates a small handwriting displacement", () => {
    const reference = shape([
      [20, 48, 76, 48],
      [48, 20, 48, 76],
    ]);
    const shifted = reference.map((point) => ({
      x: point.x + 2,
      y: point.y - 1,
    }));
    const result = compareHandwritingPointClouds(shifted, reference);

    expect(result.isMatch).toBe(true);
  });

  it("accepts a recognizable handwritten variant without matching the typeface", () => {
    const reference = shape([
      [18, 28, 54, 28],
      [38, 14, 28, 70],
      [65, 18, 82, 27],
      [69, 44, 52, 48],
      [52, 48, 44, 61],
      [44, 61, 52, 73],
      [52, 73, 69, 62],
      [69, 62, 69, 44],
      [58, 56, 82, 72],
    ]);
    const handwritten = shape([
      [10, 40, 56, 40],
      [35, 13, 18, 77],
      [64, 16, 88, 31],
      [80, 54, 64, 67],
      [64, 67, 40, 74],
      [40, 74, 46, 88],
      [46, 88, 65, 80],
      [65, 80, 81, 61],
      [58, 71, 90, 90],
    ]);

    const result = compareHandwritingPointClouds(handwritten, reference);

    expect(result.isMatch).toBe(true);
    expect(result.score).toBeGreaterThan(0.68);
  });

  it("rejects an incomplete shape even when its remaining stroke aligns", () => {
    const reference = shape([
      [20, 48, 76, 48],
      [48, 20, 48, 76],
    ]);
    const incomplete = shape([[48, 20, 48, 76]]);
    const result = compareHandwritingPointClouds(incomplete, reference);

    expect(result.isMatch).toBe(false);
    expect(result.breakdown.proportion).toBeLessThan(0.5);
  });

  it("rejects a differently oriented shape", () => {
    const horizontal = shape([[18, 48, 78, 48]]);
    const vertical = shape([[48, 18, 48, 78]]);

    expect(compareHandwritingPointClouds(horizontal, vertical).isMatch).toBe(
      false,
    );
  });
});

function shape(lines: readonly (readonly number[])[]) {
  const pixels = new Map<string, { x: number; y: number }>();
  for (const [startX, startY, endX, endY] of lines) {
    const steps = Math.max(
      Math.abs((endX ?? 0) - (startX ?? 0)),
      Math.abs((endY ?? 0) - (startY ?? 0)),
    );
    for (let step = 0; step <= steps; step += 1) {
      const progress = steps === 0 ? 0 : step / steps;
      const x = Math.round((startX ?? 0) + ((endX ?? 0) - (startX ?? 0)) * progress);
      const y = Math.round((startY ?? 0) + ((endY ?? 0) - (startY ?? 0)) * progress);
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
          const point = { x: x + offsetX, y: y + offsetY };
          pixels.set(`${point.x}:${point.y}`, point);
        }
      }
    }
  }
  return [...pixels.values()];
}
