import { describe, expect, test } from "bun:test";

import { createCollapse, fracture, styleOf, type MassIn } from "./collapse-sim";

const house: MassIn[] = [{ u0: 0.1, v0: 0.1, u1: 0.9, v1: 0.9, w0: 0, w1: 1.3, storey: 0.63, skin: "masonry" }];
const tower: MassIn[] = [{ u0: 0.3, v0: 0.3, u1: 2.7, v1: 2.7, w0: 0, w1: 5, storey: 0.63, skin: "glass" }];
const shed: MassIn[] = [{ u0: 0.2, v0: 0.2, u1: 3.8, v1: 1.8, w0: 0, w1: 0.8, storey: 0.8, skin: "sheet" }];

/** Run it out: its time, and long enough after for everything to have landed. */
function run(masses: MassIn[], plot: { w: number; h: number }, seconds: number) {
  const C = createCollapse(masses, plot, { u: plot.w / 2, v: plot.h + 0.2 }, seconds);
  let shattered = 0, thuds = 0;
  for (let t = 0; t < seconds + 8; t += 1 / 30) {
    if (t > seconds) C.finish(t);
    for (const h of C.step(1 / 30, t)) { if (h.kind === "shatter") shattered++; if (h.kind === "thud") thuds++; }
  }
  return { C, shattered, thuds };
}

describe("a building brought down", () => {
  test("is broken along its own lines, every piece standing on something or on the ground", () => {
    const chunks = fracture(house);
    expect(chunks.length).toBeGreaterThan(20);
    expect(chunks.filter((c) => c.part === "plate" && c.outer === 16).length).toBeGreaterThan(0);
    // (Nothing above the ground storey stands on nothing.)
    for (const c of chunks) if (c.floor > 0) expect(c.sup.length).toBeGreaterThan(0);
  });
  test("by what it is: a house pulled down, a tower imploded, a shed's roof first", () => {
    expect(styleOf(house)).toBe("pull");
    expect(styleOf(tower)).toBe("implode");
    expect(styleOf(shed)).toBe("shed");
  });
  test("comes down, all of it, and lies on its own plot", () => {
    for (const [m, plot] of [[house, { w: 1, h: 1 }], [tower, { w: 3, h: 3 }], [shed, { w: 4, h: 2 }]] as const) {
      const { C, thuds } = run(m as MassIn[], plot, 10);
      expect(C.standing()).toBe(0);
      expect(C.falling()).toBe(0);
      expect(thuds).toBeGreaterThan(0);
      for (const c of C.chunks) if (c.state === 2) {
        expect(c.c[0]).toBeGreaterThan(-0.8); expect(c.c[0]).toBeLessThan(plot.w + 0.8);
        expect(c.c[1]).toBeGreaterThan(-0.8); expect(c.c[1]).toBeLessThan(plot.h + 0.8);
        expect(c.c[2]).toBeLessThan(1.2);
      }
    }
  });
  test("a tower's glazing goes first, and it comes down through itself: its top is still up when its bottom is gone", () => {
    const C = createCollapse(tower, { w: 3, h: 3 }, { u: 1.5, v: 3.2 }, 12);
    let glass = 0, lowGone = -1, topGone = -1;
    for (let t = 0; t < 12; t += 1 / 30) {
      for (const h of C.step(1 / 30, t)) if (h.kind === "shatter") glass++;
      const low = C.chunks.some((c) => c.floor === 0 && c.part === "plate" && c.state === 0), top = C.chunks.some((c) => c.floor === 7 && c.part === "plate" && c.state === 0);
      if (!low && lowGone < 0) lowGone = t;
      if (!top && topGone < 0) topGone = t;
    }
    expect(glass).toBeGreaterThan(40);
    expect(lowGone).toBeGreaterThan(0);
    expect(topGone).toBeGreaterThanOrEqual(lowGone);
  });
  test("what lies there is cleared, nearest the digger first", () => {
    const { C } = run(house, { w: 1, h: 1 }, 8);
    const lying = C.chunks.filter((c) => c.state === 2).length;
    C.clear(0.5);
    const left = C.chunks.filter((c) => c.state === 2).length;
    expect(left).toBeLessThan(lying);
    expect(left).toBeGreaterThan(0);
    C.clear(1);
    expect(C.chunks.filter((c) => c.state === 2).length).toBe(0);
  });
});
