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
  MIN_FRONTAGE, frontageOf, generateMap, generatePlayableMap, paintGround,
} from "./generate-map";
import { fbm, valueNoise } from "./noise";
import { createGrid, fillTerrain, idx } from "../grid";
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
   * THE CONE, which is what makes frontage buildable rather than merely
   * adjacent: ground beside the street should meet it, not tower over it.
   * Stated as the rule itself rather than as a number for the first row, so it
   * still means something if the relief is ever turned up. @see RISE
   */
  test("the land climbs at most a slab a tile away from the road", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g, r } = gen(seed);
      const road = g.height[idx(g, 0, r.roadRow)];
      for (let y = 0; y < g.h; y++) {
        const away = y < r.roadRow ? r.roadRow - y
          : y >= r.roadRow + 2 ? y - (r.roadRow + 1)
          : 0;
        for (let x = 0; x < g.w; x++) {
          expect(Math.abs(g.height[idx(g, x, y)] - road)).toBeLessThanOrEqual(away * 2);
        }
      }
    }
  });

  /**
   * EVERY CELL ON A WHOLE SLAB. The tileset's skirt is exactly one full step,
   * so terrain quantised to it has cliff art that lines up; terrain on half
   * steps has walls the art can only approximate. @see TERRACE
   */
  test("the ground is terraced to whole slabs", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g } = gen(seed);
      // `Math.abs`, because -2 % 2 is -0 and `toBe` can tell the difference.
      for (const h of g.height) expect(Math.abs(h % 2)).toBe(0);
    }
  });

  /**
   * THE ONE THAT CAUGHT THE FIRST DRAFT, which took its height straight off
   * four octaves of noise. Three quarters of its cells sat a single half step
   * from a neighbour: a 16.5px ledge everywhere, no plane anywhere, and every
   * house needing its ground levelled first. It read as static, not landscape.
   * Measured over forty seeds: 21.8% level then, 64% now.
   */
  test("most of the map is a plain you can build on", () => {
    let level = 0, cells = 0;
    for (let seed = 0; seed < 12; seed++) {
      const { g } = gen(seed);
      for (let y = 1; y < g.h - 1; y++) {
        for (let x = 1; x < g.w - 1; x++) {
          const h = g.height[idx(g, x, y)];
          const flat = g.height[idx(g, x + 1, y)] === h && g.height[idx(g, x - 1, y)] === h
            && g.height[idx(g, x, y + 1)] === h && g.height[idx(g, x, y - 1)] === h;
          if (flat) level++;
          cells++;
        }
      }
    }
    expect(level / cells).toBeGreaterThan(0.5);
  });

  /** And plains are not the whole story, or this is an elaborate flat map. */
  test("every seed still gets real hills", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g } = gen(seed);
      let lo = Infinity, hi = -Infinity;
      for (const h of g.height) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
      expect(hi - lo).toBeGreaterThanOrEqual(20);          // ten slabs
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

/**
 * What the ground is MADE of.
 *
 * Tested through `paintGround` on ground chosen rather than ground the noise
 * happened to produce — the rules are about height and adjacency, and a test
 * that has to go hunting through forty seeds for a cliff is testing the noise.
 * The margins below are `JITTER`-wide on purpose: the thresholds wander by
 * design, so a case sitting on one proves nothing either way.
 */
describe("grass, earth and sand", () => {
  const M = { grass: 1, dirt: 2, sand: 3 };
  /** Flat bare ground at one height, nothing paved. */
  const ground = (h = 0, w = 13) => {
    const g = createGrid(w, w);
    fillTerrain(g, M.grass);
    g.height.fill(h);
    return g;
  };
  const at = (g: ReturnType<typeof ground>, x: number, y: number) => g.terrain[idx(g, x, y)];

  test("the middle ground is grass", () => {
    const g = ground(2);
    paintGround(g, 7, 0, M);
    expect(at(g, 6, 6)).toBe(M.grass);
  });

  test("the low ground is sand — where water will one day collect", () => {
    const g = ground(-8);
    paintGround(g, 7, 0, M);
    expect(at(g, 6, 6)).toBe(M.sand);
  });

  test("the high ground goes back to bare earth", () => {
    const g = ground(12);
    paintGround(g, 7, 0, M);
    expect(at(g, 6, 6)).toBe(M.dirt);
  });

  /**
   * THE VERGE IS THE RULE MADE VISIBLE: these are exactly the cells housing
   * may be built on, so the art says where to build without a tooltip.
   */
  test("the verge beside the road is earth, and so is its bed", () => {
    const g = ground(0);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 6)] = 1;
    paintGround(g, 7, 0, M);
    expect(at(g, 4, 6)).toBe(M.dirt);                     // under the road
    expect(at(g, 4, 5)).toBe(M.dirt);                     // beside it
    expect(at(g, 4, 7)).toBe(M.dirt);
    expect(at(g, 4, 3)).toBe(M.grass);                    // and no further
  });

  test("a verge in the low ground is still earth, not sand", () => {
    const g = ground(-8);
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 6)] = 1;
    paintGround(g, 7, 0, M);
    expect(at(g, 4, 5)).toBe(M.dirt);
    expect(at(g, 4, 2)).toBe(M.sand);
  });

  /** A two-slab face is drawn in earth; grass over it is a lawn on a quarry. */
  test("the brow of a cliff is earth", () => {
    const g = ground(2);
    for (let y = 0; y < g.h; y++) {
      for (let x = 7; x < g.w; x++) g.height[idx(g, x, y)] = -4;
    }
    paintGround(g, 7, 0, M);
    expect(at(g, 6, 6)).toBe(M.dirt);                     // the brow
    expect(at(g, 3, 6)).toBe(M.grass);                    // well back from it
  });

  test("void stays void", () => {
    const g = ground(0);
    g.terrain[idx(g, 6, 6)] = 0;
    paintGround(g, 7, 0, M);
    expect(at(g, 6, 6)).toBe(0);
  });

  /** A caller with one tile still gets a map, rather than a hole in the palette. */
  test("without a separate earth or sand tile, it is all one material", () => {
    const g = createGrid(24, 24);
    generateMap(g, { seed: 3, material: 1 });
    expect([...g.terrain].every((t) => t === 1)).toBe(true);
  });

  test("a generated map uses all three", () => {
    const g = createGrid(64, 64);
    for (const seed of [0, 1, 2, 3, 4]) {
      generateMap(g, { seed, material: 1, dirt: 2, sand: 3 });
      const seen = new Set(g.terrain);
      expect(seen).toEqual(new Set([1, 2, 3]));
    }
  });
});
