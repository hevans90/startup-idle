/**
 * The rivers and lakes a new map opens with.
 *
 * ONE OF THESE IS NOT LIKE THE OTHERS. Most of what generation does is static —
 * it writes a grid and you can read the grid back. Water is not: the map writes
 * an initial condition and a RATE, and what happens next is the solver's. So
 * some tests run the solver, because the only way to know that a fed river is
 * a river and not a slow flood is to watch it for a few minutes — the longest
 * in files of their own, to run side by side: water-settled, water-fed and
 * water-river.
 */
import { describe, expect, test } from "bun:test";

import { generateMap } from "./generate-map";
import { reachAt } from "./water";
import { DEFAULT_GEN, withDefaults } from "./params";
import { distanceFromPaved } from "./road";
import { createGrid, idx } from "../grid";
import { createWaterField, poolSnapshot, runSources, stepWater } from "../water/field";

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

  // Averaged, because how much a channel HOLDS is a property of the ground it
  // was cut through — one seed can put a third river across country that had
  // already been dug.
  /**
   * MORE CHANNEL, not more water, and the difference is real rather than a
   * weaker claim. A channel is a drain as much as a vessel: a third river cut
   * across country the first two had already filled can open a way to the map
   * edge for water that was standing, and the map comes out with more
   * watercourse and less water in it. Measured over eight seeds, three rivers
   * hold 2,359 wet cells against one river's 2,519.
   */
  test("more rivers, more watercourse", () => {
    let one = 0, three = 0;
    for (let seed = 0; seed < 8; seed++) {
      one += gen(seed, { rivers: 1, lakes: 0 }).r.river;
      three += gen(seed, { rivers: 3, lakes: 0 }).r.river;
    }
    expect(three).toBeGreaterThan(one);
  });

  test("a bigger lake holds more", () => {
    const small = gen(4, { rivers: 0, lakes: 1, lakeSize: 4 });
    const big = gen(4, { rivers: 0, lakes: 1, lakeSize: 16 });
    expect(big.r.wet).toBeGreaterThan(small.r.wet);
  });

  /**
   * WHERE THERE IS WATER BESIDE THE STREET, THERE IS A SPAN OVER IT.
   *
   * This used to say nothing was ever cut or wetted within reach of the
   * street, and the reason given was "there is no bridge in the tileset to
   * put back what it broke". There is now — not a sprite, but the thing that
   * matters, a surface at its own level with a gap under it — so a river may
   * cross, and on every seed tried it does. What replaces the old rule is
   * that a crossing is always a CROSSING: water by the road means road over
   * water, never road in it.
   */
  test("water beside the street only ever means a span over it", () => {
    for (let seed = 0; seed < 12; seed++) {
      const { g } = gen(seed, { rivers: 3, lakes: 3 });
      const dist = distanceFromPaved(g);
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] > 2) continue;
        // A tap on the street's own ground would be a spring in the road.
        expect(g.source[i]).toBe(0);
        if (g.pool[i] === 0) continue;
        // Wet, so this is a crossing: the paving here is carried over it, and
        // the water stands below the level you drive on.
        expect(g.paved[i] === 0 || g.deck[i] !== 0).toBe(true);
        if (g.deck[i] !== 0) expect(g.height[i] + g.pool[i]).toBeLessThan(g.deckZ[i]);
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
  /**
   * On ground the river CUT, not on ground that happens to be wet. A fed
   * channel is left open at its mouth on purpose — see the bar in
   * `carveChannel` — so it drains until the spring has run, and what the
   * generator can promise is that the source sits in the channel it feeds.
   */
  /**
   * ACROSS THE CHANNEL, not on one cell of it. `Grid.source` is an Int8Array,
   * so a single cell tops out at 127 half steps a second however hard it is
   * pushed — and a point source leaves a channel that drains faster than it
   * fills. Measured on a course that had been running dry: one cell wet none
   * of it, the same rate over the channel's width took it to 56% of its length
   * with three cells of spill anywhere else on the map. @see feed
   */
  test("a river is fed across its width, on ground it cut", () => {
    for (let seed = 0; seed < 12; seed++) {
      const dry = gen(seed, { rivers: 1, lakes: 0, springs: 0 });
      const { g } = gen(seed, { rivers: 1, lakes: 0, springs: 1 });
      const fed = [...g.source].filter((r) => r > 0).length;
      if (fed === 0) continue;                             // no course, no source
      expect(fed).toBeGreaterThan(1);
      for (let i = 0; i < g.source.length; i++) {
        if (g.source[i] <= 0) continue;
        expect(g.height[i]).toBeLessThanOrEqual(dry.g.height[i]);
      }
    }
  });

  /**
   * IT RUNS ONTO THE MAP AND OFF IT, which is the promise that matters — and
   * both halves of it are structural rather than lucky.
   *
   * The edge is the map's only outlet, so a river fed with nowhere to put its
   * water floods everything; and the feed is the edge ITSELF, held at a
   * level, so a course that never reached one would have nothing to be fed
   * BY. A walk can be boxed in by the street and stop inland, which is why
   * the planner tries again rather than keeping what it got. @see planRivers
   */
  test("a river runs from one edge of the map to another", () => {
    for (let seed = 0; seed < 12; seed++) {
      const { g } = gen(seed, { rivers: 1, lakes: 0, springs: 1 });
      const bare = gen(seed, { rivers: 0, lakes: 0 });
      const onRim = (i: number) => {
        const x = i % g.w, y = (i / g.w) | 0;
        return x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1;
      };
      // FED OVER THE BOUNDARY, and only ever there. @see Grid.inflow
      const fed = [...g.inflow].map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
      expect(fed.length).toBeGreaterThan(0);
      for (const i of fed) expect(onRim(i)).toBe(true);
      // AND THE CHANNEL GETS OUT, measured as ground cut away on the rim
      // somewhere OTHER than where it is fed — an inlet alone would pass a
      // test that only asked whether the edge had been touched.
      let out = false;
      for (let i = 0; i < g.height.length && !out; i++) {
        if (!onRim(i) || g.inflow[i] > 0) continue;
        out = g.height[i] < bare.g.height[i];
      }
      expect(out).toBe(true);
    }
  });
});

/**
 * AND IT IS FULL THE MOMENT THE MAP OPENS.
 *
 * A fed river reaches its own level in about a minute. That is fine for the
 * river and wrong for the player: the map appears as an empty trench and fills
 * while they watch it, which reads as the generator having failed and then
 * thought better of it.
 *
 * The flood cannot supply this and it is not a shortcoming of the flood. A
 * course runs onto the map and off it again, so both ends drain and the honest
 * answer to "what stands in this channel" is nothing. What is in it is what
 * the FLOW holds — and the carve already knows that number, because it is the
 * waterline the channel was cut to. @see standWater
 */
describe("a river is full before anything has run", () => {
  const MATS4 = { material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] };

  /** The share of the excavated footprint already holding water. */
  const filledAtSpawn = (seed: number) => {
    const bare = createGrid(64, 64), g = createGrid(64, 64);
    generateMap(bare, { seed, ...MATS4, params: { rivers: 0, lakes: 0 } });
    generateMap(g, { seed, ...MATS4, params: { lakes: 0 } });
    let cut = 0, wet = 0;
    for (let i = 0; i < g.height.length; i++) {
      if (g.height[i] >= bare.height[i]) continue;
      cut++;
      if (g.pool[i] > 0) wet++;
    }
    return cut ? wet / cut : null;
  };

  /**
   * Measured against the WHOLE cut, banks included — the flare either side is
   * meant to be dry, so this can never approach one. Before the channel was
   * primed it was 21%; it is about half now, and the difference is the bed.
   */
  test("most of the channel bed already holds water", () => {
    let total = 0, n = 0;
    for (let seed = 0; seed < 8; seed++) {
      const share = filledAtSpawn(seed);
      if (share === null) continue;
      expect(share).toBeGreaterThan(0.25);
      total += share; n++;
    }
    expect(n).toBeGreaterThan(5);
    expect(total / n).toBeGreaterThan(0.4);
  });
});

/**
 * FULL, BUT NOT OVER THE TOP — which is the whole point of the water model and
 * the one thing no other test here says.
 *
 * FREEBOARD is the measure: for a wet cell, how far the lowest DRY ground
 * beside the water still stands above the waterline. Negative would mean the
 * water is over its banks. Large would mean what the first three drafts had —
 * a deep channel with a ribbon of water in the bottom of it, the surface
 * metres below ground that was cut for it.
 *
 * Both halves matter and neither alone is worth anything: a map with no water
 * passes any ceiling on freeboard, and a drowned one passes any floor.
 */
describe("a river stands close to its banks", () => {
  const MATS2 = { material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] };

  /**
   * Every wet cell's freeboard, in half steps. @see fillDepressions
   *
   * THE MAP AS IT IS ACTUALLY MADE, which means FED. It used to force the
   * feed off, and that was right when a spring was off by default; now a
   * river arrives over the map's edge and is held there, and generating
   * without one measures a configuration nobody ships. It also measures
   * almost nothing: a graded channel running to an open edge holds no
   * STANDING water at all, so the unfed map came back with nineteen wet
   * cells on it and no river to ask questions about.
   */
  const freeboards = (seed: number, params = {}, sim = 0) => {
    const g = createGrid(64, 64);
    generateMap(g, { seed, ...MATS2, params });
    if (sim > 0) {
      const f = createWaterField(g);
      const dt = 1 / 20;
      for (let t = 0; t < sim; t++) {
        for (let k = 0; k < 20; k++) { runSources(f, g, dt); stepWater(f, dt); }
      }
      g.pool.set(poolSnapshot(f, g));
    }
    const out: number[] = [];
    for (let y = 1; y < g.h - 1; y++) {
      for (let x = 1; x < g.w - 1; x++) {
        const i = idx(g, x, y);
        if (!g.pool[i]) continue;
        const surface = g.height[i] + g.pool[i];
        let lowestDry = Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = idx(g, x + dx, y + dy);
          if (g.pool[j]) continue;                 // still the same water
          lowestDry = Math.min(lowestDry, g.height[j]);
        }
        if (lowestDry !== Infinity) out.push(lowestDry - surface);
      }
    }
    return out.sort((a, b) => a - b);
  };

  /**
   * IT COMES RIGHT UP TO ITS BANKS, and that is the headline number.
   *
   * The median cell on the shore of a generated river has a freeboard of
   * exactly NOUGHT — the water is at the level of the lowest ground touching
   * it, on every seed tried. That is what "a river full of water" means, and
   * the drafts this replaced sat six half steps and more below their own
   * banks with a ribbon in the bottom of a trench.
   */
  test("the water comes right up to its banks", () => {
    for (let seed = 0; seed < 12; seed++) {
      const fb = freeboards(seed);
      expect(fb.length).toBeGreaterThan(20);
      expect(fb[fb.length >> 1]).toBe(0);
    }
  });

  /**
   * AND ONLY A FRINGE OF IT STANDS OVER THEM AT THE MOMENT IT OPENS.
   *
   * Standing water can never be over its bank — the flood puts it at the
   * spill point by construction. A RUNNING channel is different: the map
   * opens with the river at the level the flow holds it at, and a flowing
   * surface stands above the static one in places, which is what flow means.
   * The carve draws that line from the valley floor, so where a cell on the
   * cut happens to touch much lower ground outside it the line is over that
   * ground until the solver says otherwise. Measured over twelve seeds it is
   * ten to nineteen per cent of the shore, and the quartile is already nought
   * — so the bound is on how MUCH of the river is over, not on whether any
   * of it is, which is the honest shape for a claim about a transient.
   */
  test("and only a fringe of it is over them when the map opens", () => {
    for (let seed = 0; seed < 12; seed++) {
      const fb = freeboards(seed);
      const over = fb.filter((v) => v < 0).length;
      expect(over / fb.length).toBeLessThan(0.25);
      expect(fb[Math.floor(fb.length * 0.25)]).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * AND IT IS ALL BACK INSIDE THEM WITHIN HALF A MINUTE.
   *
   * What matters about the fringe above is that it is a surface the physics
   * agrees with within moments, rather than a wave waiting to fall on
   * somebody's frontage. Measured, the worst cell on the map goes from as
   * much as forty half steps over to between one and three.
   */
  test("and it is back inside them within half a minute", () => {
    for (const seed of [0, 4, 7]) {
      const fb = freeboards(seed, {}, 30);
      expect(fb.length).toBeGreaterThan(20);
      // MEASURED BY HOW FAR OVER, NOT BY HOW MANY, and the difference is a
      // real thing about shorelines rather than a loosened bound. Settling
      // takes the worst cell on the map from six half steps over to one, and
      // at the same time takes the SHARE that are over from 9% up to 20% —
      // because a settled shore is a film creeping one half step onto the
      // bank all the way along, which is what a waterline between two
      // terraces looks like. Counting those would call a calm river a flood.
      expect(fb[0]).toBeGreaterThanOrEqual(-4);
      expect(fb[fb.length >> 1]).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  /**
   * AND IT IS ACTUALLY FULL. The bank a river is measured against here is the
   * lowest ground touching it, so the median is what the shore looks like —
   * two slabs is a waterline just under the grass, which is what was asked
   * for. The drafts this replaced sat six and more below their own banks.
   */
  test("and it comes up close to them", () => {
    let over = 0;
    for (let seed = 0; seed < 12; seed++) {
      const fb = freeboards(seed);
      if (fb[fb.length >> 1] > 4) over++;
    }
    expect(over).toBe(0);
  });

  test("a deeper channel does not mean a lower waterline", () => {
    for (const seed of [1, 4, 7]) {
      const shallow = freeboards(seed, { riverDepth: 2 });
      const deep = freeboards(seed, { riverDepth: 14 });
      const mid = (a: number[]) => a[a.length >> 1];
      expect(mid(deep)).toBeLessThanOrEqual(mid(shallow) + 2);
    }
  });
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

  test("it arrives ALREADY A RIVER and widens to its full width at the mouth", () => {
    // It used to enter one tile wide, because the head was a spring in the
    // hills and a spring starts as a trickle. A river that arrives over the
    // map's edge is already a river somewhere off the map, and the only
    // reason it grows crossing this one is the side streams joining it — so
    // it comes in at most of its width rather than at none of it.
    expect(reachAt(P, 0).half * 2).toBeGreaterThan(P.riverWidth * 0.5);
    expect(reachAt(P, 0).half * 2).toBeLessThan(P.riverWidth);
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
   * THE WATERLINE IS NOT A CURVE ANY MORE, and that is the whole of why rivers
   * are full. It used to follow a concave profile from the head down past the
   * map's lowest ground — a fine shape for a BED and a hopeless one for a
   * water surface, because a reach whose surface sits well below its own banks
   * is a reach that drains. Most of them did: the maps came out as deep
   * valleys with a couple of pools in them and dry gravel between. The surface
   * tracks the local land a slab under it now, so the rim is above the water
   * by construction and the channel can be full without anything spilling.
   * @see carveChannel
   */
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
   * A SIDE STREAM WITH NO RIVER TO JOIN IS NOT CARVED AT ALL.
   *
   * This replaced a test that counted the connected pieces of the cut and
   * asked for exactly one. That was true when it was written and stopped being
   * true when the weirs arrived: a weir may only put ground back up to what
   * the land was — it is not allowed to build an embankment — so where the
   * reach above it stands higher than the ground beside it, the cells it
   * restores come back at their old height and stop counting as cut. The
   * region splits with nothing wrong, and no threshold on the biggest piece
   * says anything about orphans without being fitted to the data.
   *
   * So the guard is asked about directly instead. A side stream is walked
   * towards a distance field measured to the river; with no river there is
   * nothing to measure to, and nothing may be cut on the strength of it.
   */
  test("a side stream with no river to join is not carved", () => {
    for (let seed = 0; seed < 10; seed++) {
      const { g, r } = spine(seed, { rivers: 0, lakes: 0, tributaries: 3 });
      expect(r.river).toBe(0);
      expect(r.wet).toBe(0);
      expect([...g.pool].every((d) => d === 0)).toBe(true);
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
  test("the cut is bounded by the relief, the valley, and the river's depth", () => {
    // THE VALLEY IS PART OF THE BOUND NOW, and it has to be: the floor is
    // sunk `valleyDepth` below the plain and falls a further `riverFall` on
    // its way to the mouth, so the deepest ground on the map is the bed at
    // the mouth of the deepest valley. What the bound still catches is the
    // thing it was written for — a cut that feeds back into itself and
    // ratchets, which once took a map to the floor of the world at −126.
    const p = withDefaults({});
    const most = p.relief + p.valleyDepth + p.riverFall
      + 2 * p.riverDepth + 2 * p.terrace;
    for (let seed = 0; seed < 40; seed++) {
      const { g } = spine(seed);
      let lo = Infinity;
      for (const h of g.height) lo = Math.min(lo, h);
      expect(lo).toBeGreaterThan(-most);
    }
  });
});

