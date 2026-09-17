/**
 * The rivers and lakes a new map opens with.
 *
 * ONE OF THESE IS NOT LIKE THE OTHERS. Most of what generation does is static —
 * it writes a grid and you can read the grid back. Water is not: the map writes
 * an initial condition and a RATE, and what happens next is the solver's. So
 * the last test here runs the solver, because the only way to know that a fed
 * river is a river and not a slow flood is to watch it for a few minutes.
 */
import { describe, expect, test } from "bun:test";

import { generateMap } from "./generate-map";
import { distanceFromPaved } from "./road";
import { createGrid, idx } from "../grid";
import {
  createWaterField, runSources, stepWater, totalVolume, wetTiles,
} from "../water/field";

const MATS = { material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] };
const gen = (seed: number, params = {}, size = 64) => {
  const g = createGrid(size, size);
  return { g, r: generateMap(g, { seed, ...MATS, params }) };
};
const springsOn = (g: ReturnType<typeof createGrid>) =>
  [...g.source].filter((s) => s !== 0).length;
const wetCells = (g: ReturnType<typeof createGrid>) =>
  [...g.pool].filter((p) => p > 0).length;

describe("what water generation writes", () => {
  test("none asked for, none made", () => {
    const { g, r } = gen(4, { rivers: 0, lakes: 0 });
    expect(r.wet).toBe(0);
    expect(wetCells(g)).toBe(0);
    expect(springsOn(g)).toBe(0);
  });

  test("a river wets a channel and marks it as water", () => {
    const { g, r } = gen(4, { rivers: 1, lakes: 0 });
    expect(r.wet).toBeGreaterThan(10);
    for (let i = 0; i < g.pool.length; i++) {
      if (g.pool[i] > 0) expect(g.fluid[i]).toBe(1);      // @see FLUIDS
    }
  });

  test("more rivers, more water", () => {
    const one = gen(4, { rivers: 1, lakes: 0 });
    const three = gen(4, { rivers: 3, lakes: 0 });
    expect(three.r.wet).toBeGreaterThan(one.r.wet);
  });

  test("a bigger lake holds more", () => {
    const small = gen(4, { rivers: 0, lakes: 1, lakeSize: 4 });
    const big = gen(4, { rivers: 0, lakes: 1, lakeSize: 16 });
    expect(big.r.wet).toBeGreaterThan(small.r.wet);
  });

  /**
   * THE FRONTAGE IS NOT NEGOTIABLE. The cone guarantees gentle ground beside
   * the street; a channel cut through it would take that away, and there is no
   * bridge in the tileset to put back what it broke.
   */
  test("nothing is cut or wetted within reach of the street", () => {
    for (let seed = 0; seed < 12; seed++) {
      const { g } = gen(seed, { rivers: 3, lakes: 3 });
      const dist = distanceFromPaved(g);
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] > 2) continue;
        expect(g.pool[i]).toBe(0);
        expect(g.source[i]).toBe(0);
      }
    }
  });

  test("springs are off when they are not asked for", () => {
    for (let seed = 0; seed < 8; seed++) {
      expect(springsOn(gen(seed, { springs: 0 }).g)).toBe(0);
    }
  });

  /**
   * A SPRING ONLY WHERE THE CHANNEL GOT OUT — never more springs than rivers,
   * and any that is placed sits on a wet cell, which is the head of its own
   * channel rather than somewhere on the hillside.
   */
  test("a spring stands at the head of a channel", () => {
    for (let seed = 0; seed < 12; seed++) {
      const { g } = gen(seed, { rivers: 2, lakes: 0, springs: 1 });
      expect(springsOn(g)).toBeLessThanOrEqual(2);
      for (let i = 0; i < g.source.length; i++) {
        if (g.source[i] !== 0) expect(g.pool[i]).toBeGreaterThan(0);
      }
    }
  });

  test("a fed river runs to the edge of the map", () => {
    let reached = 0;
    for (let seed = 0; seed < 12; seed++) {
      const { g } = gen(seed, { rivers: 1, lakes: 0, springs: 1 });
      if (springsOn(g) === 0) continue;                    // no outlet, no spring
      const edge = (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
      let out = false;
      for (let x = 0; x < g.w && !out; x++) out = edge(x, 0) || edge(x, g.h - 1);
      for (let y = 0; y < g.h && !out; y++) out = edge(0, y) || edge(g.w - 1, y);
      if (out) reached++;
    }
    expect(reached).toBeGreaterThan(8);
  });
});

/**
 * THE MAP MUST NOT DROWN.
 *
 * An open edge is a map's only outlet, so a spring is a promise that its
 * channel gets there. When it does not, nothing throws and nothing looks wrong
 * for the first minute — the water just keeps coming, and a map left open for
 * twenty turns into a swamp. The failure is invisible at the moment it is made
 * and only shows up in play, which is exactly the kind a test has to go
 * looking for.
 *
 * So these RUN THE SOLVER and watch. The first is the default and is held
 * strictly: standing water finds its level inside a minute and then stops, so
 * a map you leave open costs nothing. The second is the same map with springs
 * turned on, and it is held LOOSELY on purpose — a fed channel that is
 * intercepted by a deeper basin fills it before draining, which is correct and
 * slow, and the bound here is the difference between slow and unbounded.
 */
describe("a map opens settled", () => {
  const run = (seed: number, seconds: number, params = {}) => {
    const g = createGrid(48, 48);
    generateMap(g, { seed, ...MATS, params });
    const f = createWaterField(g);
    const dt = 1 / 20;
    const at: number[] = [];
    for (let s = 0; s < seconds; s++) {
      for (let k = 0; k < 20; k++) { runSources(f, g, dt); stepWater(f, dt); }
      at.push(totalVolume(f, g));
    }
    return { at, wet: wetTiles(f, g), cells: g.w * g.h };
  };

  for (const seed of [11, 4242, 7]) {
    test(`seed ${seed} finds its level and stays there`, () => {
      const r = run(seed, 120);
      // Water may still be draining away; what it may not do is keep arriving.
      expect(r.at[119]).toBeLessThanOrEqual(r.at[59] + 1);
      expect(r.wet).toBeLessThan(r.cells / 8);
    });
  }

  /**
   * Seed 11 is here by name because it is the one that showed the fault. At
   * the spring rate this started with — six half steps a second — it reached
   * 922 of 4,096 tiles under water and was still rising by over a thousand a
   * minute. @see SPRING_RATE
   */
  // Its own timeout: three minutes of solver on two maps is real work, and the
  // default five seconds is not a statement about this test.
  test("and a fed one does not drown, even on the seed that used to", () => {
    for (const seed of [11, 4242]) {
      const r = run(seed, 180, { springs: 1 });
      expect(r.wet).toBeLessThan(r.cells / 4);
      // Still filling is allowed; filling as fast as it started is not.
      const early = r.at[119] - r.at[59], late = r.at[179] - r.at[119];
      expect(late).toBeLessThan(early * 1.5 + 50);
    }
  }, 30_000);
});
