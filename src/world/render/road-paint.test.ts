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

  test("the closest level, however close", () => {
    expect(lodFor(100)).toBe(LOD_RES.length - 1);
  });
});
