/**
 * The map a new company founds on.
 *
 * Two promises, and they pull against each other: it should be somewhere you
 * have not seen, and it must be somewhere you can start. These test the second
 * one hardest, because a varied map that cannot be built on is worse than a
 * dull one — and because carving the road is exactly the design decision that
 * makes the guarantee possible.
 */
import { describe, expect, test } from "bun:test";

import {
  MIN_FRONTAGE, frontageOf, generateMap, generatePlayableMap,
} from "./generate-map";
import { fbm, valueNoise } from "./noise";
import { createGrid, idx } from "../grid";
import { HEIGHT_MAX, HEIGHT_MIN } from "../edit/height-tools";

const fresh = (w = 64, h = 64) => createGrid(w, h);
const gen = (seed: number, w = 64, h = 64) => {
  const g = fresh(w, h);
  return { g, r: generateMap(g, { seed, material: 1 }) };
};

describe("the noise underneath", () => {
  test("the same seed and place gives the same number, always", () => {
    expect(valueNoise(7, 3.25, 9.5)).toBe(valueNoise(7, 3.25, 9.5));
    expect(fbm(7, 3.25, 9.5)).toBe(fbm(7, 3.25, 9.5));
  });

  test("a different seed gives a different landscape", () => {
    expect(valueNoise(1, 3.25, 9.5)).not.toBe(valueNoise(2, 3.25, 9.5));
  });

  test("it stays in range however many octaves are asked for", () => {
    for (const oct of [1, 2, 4, 8]) {
      for (let k = 0; k < 200; k++) {
        const v = fbm(3, k * 0.37, k * 0.11, oct);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  /** Smooth, or the lattice shows as creases along every integer line. */
  test("neighbouring samples are close — it is smooth, not hash noise", () => {
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      const x = k * 0.013, y = 5.5;
      worst = Math.max(worst, Math.abs(valueNoise(9, x, y) - valueNoise(9, x + 0.01, y)));
    }
    expect(worst).toBeLessThan(0.05);
  });
});

describe("what a generated map guarantees", () => {
  test("the same seed founds on the same ground", () => {
    const a = gen(12345), b = gen(12345);
    expect([...a.g.height]).toEqual([...b.g.height]);
    expect([...a.g.paved]).toEqual([...b.g.paved]);
    expect(a.r.roadRow).toBe(b.r.roadRow);
  });

  test("different seeds give different ground", () => {
    const a = gen(1), b = gen(2);
    expect([...a.g.height]).not.toEqual([...b.g.height]);
  });

  /**
   * THE CARVE'S WHOLE PURPOSE. Routing a road over terrain can fail to find
   * anywhere flat; carving cannot, so this must hold for every seed rather
   * than most of them.
   */
  test("the road is dead flat, on every seed", () => {
    for (let seed = 0; seed < 40; seed++) {
      const { g, r } = gen(seed);
      const h = g.height[idx(g, 0, r.roadRow)];
      for (let x = 0; x < g.w; x++) {
        for (let y = r.roadRow; y < r.roadRow + 2; y++) {
          expect(g.height[idx(g, x, y)]).toBe(h);
        }
      }
    }
  });

  test("and it crosses the whole map", () => {
    const { g, r } = gen(4);
    for (let x = 0; x < g.w; x++) {
      expect(g.paved[idx(g, x, r.roadRow)]).not.toBe(0);
    }
  });

  test("every seed opens with somewhere to build", () => {
    for (let seed = 0; seed < 40; seed++) {
      expect(gen(seed).r.frontage).toBeGreaterThanOrEqual(MIN_FRONTAGE);
    }
  });

  test("the road is not jammed against an edge", () => {
    for (let seed = 0; seed < 40; seed++) {
      const { g, r } = gen(seed);
      expect(r.roadRow).toBeGreaterThan(0);
      expect(r.roadRow + 2).toBeLessThan(g.h);
    }
  });

  /** Terrain has to actually vary, or this is an elaborate flat map. */
  test("the land away from the road has relief", () => {
    const { g } = gen(11);
    let lo = Infinity, hi = -Infinity;
    for (const h of g.height) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
    expect(hi - lo).toBeGreaterThan(4);
  });

  test("and it stays inside what the editor can represent", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g } = gen(seed);
      for (const h of g.height) {
        expect(h).toBeGreaterThanOrEqual(HEIGHT_MIN);
        expect(h).toBeLessThanOrEqual(HEIGHT_MAX);
      }
    }
  });

  /**
   * The shoulder is what makes frontage buildable rather than merely adjacent:
   * ground beside the street should meet it, not tower over it.
   */
  test("the ground beside the road meets it", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g, r } = gen(seed);
      const road = g.height[idx(g, 0, r.roadRow)];
      for (let x = 0; x < g.w; x++) {
        for (const y of [r.roadRow - 1, r.roadRow + 2]) {
          if (y < 0 || y >= g.h) continue;
          expect(Math.abs(g.height[idx(g, x, y)] - road)).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  test("a generated map starts dry and unbuilt", () => {
    const { g } = gen(3);
    expect(g.structures.size).toBe(0);
    expect([...g.pool].every((p) => p === 0)).toBe(true);
    expect([...g.source].every((s) => s === 0)).toBe(true);
  });

  test("it works on the small map sizes too", () => {
    for (const size of [16, 32, 96]) {
      const { g, r } = gen(5, size, size);
      expect(r.roadRow + 2).toBeLessThan(g.h);
      expect(r.frontage).toBeGreaterThan(0);
    }
  });
});

describe("rerolling a bad opening", () => {
  test("a playable map is returned and reports its frontage", () => {
    const g = fresh();
    const r = generatePlayableMap(g, { seed: 99, material: 1 });
    expect(r.frontage).toBeGreaterThanOrEqual(MIN_FRONTAGE);
    expect(frontageOf(g)).toBe(r.frontage);
  });

  /** A dull map beats no map: it must never loop or throw looking for a good one. */
  test("it gives up rather than hanging", () => {
    const g = fresh(16, 16);
    expect(() => generatePlayableMap(g, { seed: 1, material: 1 }, 2)).not.toThrow();
  });
});
