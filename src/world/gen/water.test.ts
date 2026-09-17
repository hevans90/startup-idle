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
import { bedGuide, reachAt } from "./water";
import { DEFAULT_GEN, withDefaults } from "./params";
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
      // TWO-SIDED ON PURPOSE. A ceiling alone is satisfied by having no river,
      // which is the easiest way to pass it and the worst way: the map has to
      // be wet enough to have one and dry enough not to be a swamp.
      expect(r.wet).toBeGreaterThan(r.cells / 100);
      expect(r.wet).toBeLessThan(r.cells / 6);
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

/**
 * THE SHAPE OF A RIVER, as two rules a map is not needed to check.
 *
 * Both are functions of how far along the course you are, which is why the
 * course is walked before any of it is cut — and testing them here rather than
 * by measuring a finished map is the difference between a test that says what
 * the rule is and one that says what one seed happened to produce.
 */
describe("a river is not the same river all the way down", () => {
  const P = DEFAULT_GEN;

  test("it widens from one tile at the head to its full width at the mouth", () => {
    expect(reachAt(P, 0).half * 2).toBeCloseTo(1, 5);
    expect(reachAt(P, 1).half * 2).toBeCloseTo(P.riverWidth, 5);
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const w = reachAt(P, t).half;
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
  });

  test("and deepens, without ever cutting nothing at all", () => {
    expect(reachAt(P, 1).deep).toBeCloseTo(P.riverDepth, 5);
    expect(reachAt(P, 0).deep).toBeLessThan(P.riverDepth);
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const d = reachAt(P, t).deep;
      expect(d).toBeGreaterThanOrEqual(Math.max(2, last));
      last = d;
    }
  });

  /** A confluence of equals reads as a fork, and a fork reads as a mistake. */
  test("a side stream is smaller than what it joins", () => {
    expect(reachAt(P, 1, 0.55).half).toBeLessThan(reachAt(P, 1).half);
    expect(reachAt(P, 1, 0.55).deep).toBeLessThan(reachAt(P, 1).deep);
  });

  /**
   * CONCAVE, which is the shape every river on earth has. Half the drop inside
   * the first third of the course — a straight line would put a third of it
   * there, and the whole map would read as one uniform ramp.
   */
  test("the bed falls fast near the source and flattens towards the sea", () => {
    const rise = 20, floor = -20, total = rise - floor;
    expect(bedGuide(rise, floor, 0)).toBeCloseTo(rise, 5);
    expect(bedGuide(rise, floor, 1)).toBeCloseTo(floor, 5);
    expect(rise - bedGuide(rise, floor, 1 / 3)).toBeGreaterThan(total * 0.5);
    let last = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const h = bedGuide(rise, floor, t);
      expect(h).toBeLessThanOrEqual(last);
      last = h;
    }
  });
});

/**
 * WHAT THE WALK HAS TO PRODUCE.
 *
 * The first draft's rivers were puddles — a mean of twenty-five wet cells in a
 * bounding box of four by five — because the source was chosen for height
 * alone and the carve clamps the highest ground hard against an edge. These
 * are the properties that were missing, stated so they cannot quietly go away
 * again.
 */
describe("a river is long, joined up, and does not eat the map", () => {
  const spine = (seed: number, params = {}) => {
    const g = createGrid(64, 64);
    return { g, r: generateMap(g, { seed, ...MATS, params }) };
  };

  test("it crosses a real part of the map rather than puddling", () => {
    let total = 0;
    for (let seed = 0; seed < 12; seed++) {
      const { r } = spine(seed, { lakes: 0 });
      expect(r.river).toBeGreaterThan(30);
      total += r.river;
    }
    expect(total / 12).toBeGreaterThan(60);              // measured: ~128
  });

  test("and asking for a longer one gets a longer one", () => {
    let shortSum = 0, longSum = 0;
    for (let seed = 0; seed < 8; seed++) {
      shortSum += spine(seed, { riverLength: 1, tributaries: 0 }).r.river;
      longSum += spine(seed, { riverLength: 6, tributaries: 0 }).r.river;
    }
    expect(longSum).toBeGreaterThan(shortSum * 1.5);
  });

  /**
   * ONE WATER SYSTEM. A side stream that was carved without reaching its river
   * is an orphan watercourse starting nowhere and ending nowhere — it happened
   * on three of fifteen seeds before the walk's arrival was checked.
   */
  test("every side stream reaches the river it joins", () => {
    for (let seed = 0; seed < 15; seed++) {
      const { g } = spine(seed, { lakes: 0, rivers: 1, tributaries: 2 });
      expect(componentsOfWater(g)).toBe(1);
    }
  });

  /**
   * THE RATCHET. A meandering course crosses its own valley, so a bed measured
   * against the LIVE ground reads what it has already cut and takes another
   * river's depth off it — twenty crossings at six half steps came out as a
   * chasm to the floor of the world, height −126, on a default map. Stated as a
   * bound on the whole map rather than on the code, so any future way of
   * digging too deep trips it too.
   */
  test("the cut is bounded by the relief and the river's own depth", () => {
    const p = withDefaults({});
    const most = p.relief + 2 * p.riverDepth + 2 * p.terrace;
    for (let seed = 0; seed < 40; seed++) {
      const { g } = spine(seed);
      let lo = Infinity;
      for (const h of g.height) lo = Math.min(lo, h);
      expect(lo).toBeGreaterThan(-most);
    }
  });
});

/** Connected components of standing water, 4-connected. */
function componentsOfWater(g: ReturnType<typeof createGrid>): number {
  const seen = new Uint8Array(g.w * g.h);
  let n = 0;
  for (let i = 0; i < seen.length; i++) {
    if (!g.pool[i] || seen[i]) continue;
    n++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % g.w, y = (c / g.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= g.w || y + dy >= g.h) continue;
        const j = idx(g, x + dx, y + dy);
        if (g.pool[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
  }
  return n;
}
