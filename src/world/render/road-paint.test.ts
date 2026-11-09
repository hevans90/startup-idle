import { describe, expect, test } from "bun:test";

import { LOD_RES, lodFor } from "./road-paint";

describe("lodFor", () => {
  test("the map's own level until a frame pixel shows bigger than its texels", () => {
    expect(lodFor(0.5)).toBe(0);
    expect(lodFor(LOD_RES[0])).toBe(0);
    expect(lodFor(LOD_RES[0] * 1.2)).toBe(0);
  });

  test("closer levels as the zoom comes in, never magnified past 1.2×", () => {
    for (let px = 0.25; px <= 16; px += 0.25) {
      const l = lodFor(px);
      if (l < LOD_RES.length - 1) expect(px).toBeLessThanOrEqual(LOD_RES[l] * 1.2);
      if (l > 0) expect(px).toBeGreaterThan(LOD_RES[l - 1] * 1.2);
    }
  });

  test("down a level only well past the line, so a zoom resting on it does not flicker", () => {
    const line = LOD_RES[0] * 1.2;
    expect(lodFor(line * 1.01)).toBe(1);
    expect(lodFor(line * 0.95, 1)).toBe(1);
    expect(lodFor(line * 0.75, 1)).toBe(0);
    expect(lodFor(line * 1.01, 0)).toBe(1);
  });

  test("the closest level, however close", () => {
    expect(lodFor(100)).toBe(LOD_RES.length - 1);
  });
});
