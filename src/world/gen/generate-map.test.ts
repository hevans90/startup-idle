/**
 * The map a new company founds on.
 *
 * Two promises, and they pull against each other: it should be somewhere you
 * have not seen, and it must be somewhere you can start. These test the second
 * one hardest, because a varied map that cannot be built on is worse than a
 * dull one — and because carving around the street is exactly the design
 * decision that makes the guarantee possible whatever shape the street takes.
 */
import { describe, expect, test } from "bun:test";

import {
  MIN_FRONTAGE, frontageOf, generateMap, generatePlayableMap, paintGround, plantTrees,
} from "./generate-map";
import { distanceFromPaved } from "./road";
import { lastPath } from "./water";
import { DEFAULT_GEN, GEN_SLIDERS, withDefaults } from "./params";
import { fbm, valueNoise } from "./noise";
import { createGrid, fillTerrain, idx, surfaceHeightAt } from "../grid";
import { componentCount, createNetwork } from "../roads/network";
import { HEIGHT_MAX, HEIGHT_MIN } from "../edit/height-tools";

const MATS = { material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] };

const fresh = (w = 64, h = 64) => createGrid(w, h);
const gen = (seed: number, w = 64, h = 64, params = {}) => {
  const g = fresh(w, h);
  return { g, r: generateMap(g, { seed, ...MATS, params }) };
};
/** Every paved cell's height, as a set — one entry means the street is flat. */
/**
 * The levels the street is AT, which is its surface and not the ground.
 *
 * It used to read `height`, and had to stop the day a river was allowed to
 * cross. Where it does, the road is carried over on a span and the terrain
 * under those tiles is the riverbed — so the ground beneath the street takes
 * four or five values on a map with a crossing while the street itself is as
 * flat as it ever was. The flat thing is what you drive on. @see Grid.deck
 */
const roadHeights = (g: ReturnType<typeof fresh>) => {
  const seen = new Set<number>();
  for (let i = 0; i < g.paved.length; i++) {
    if (g.paved[i] !== 0) seen.add(surfaceHeightAt(g, i % g.w, (i / g.w) | 0));
  }
  return seen;
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
    expect([...a.g.terrain]).toEqual([...b.g.terrain]);
    expect(a.r.axis).toBe(b.r.axis);
  });

  test("different seeds give different ground", () => {
    const a = gen(1), b = gen(2);
    expect([...a.g.height]).not.toEqual([...b.g.height]);
  });

  /**
   * THE CARVE'S WHOLE PURPOSE. Routing a road over terrain can fail to find
   * anywhere flat; carving cannot, so this must hold for every seed rather
   * than most of them — and for a street of any shape, which is why it is
   * asked of the paved cells rather than of a row.
   */
  test("the street is dead flat, on every seed", () => {
    for (let seed = 0; seed < 40; seed++) {
      expect(roadHeights(gen(seed).g).size).toBe(1);
    }
  });

  /**
   * ONE STREET, NOT SEVERAL. A wander that moves more than a tile of cross
   * axis per tile of long axis leaves the road in disconnected rungs — which
   * looks like a dashed line and, worse, splits the road graph, so "is this
   * house on a street" starts answering about a fragment. Counted as
   * components rather than eyeballed, because a single missing cell is
   * invisible on a 64² map and fatal to the rule.
   */
  test("the street is one connected road, on every seed", () => {
    for (let seed = 0; seed < 40; seed++) {
      const { g } = gen(seed);
      expect(componentCount(createNetwork(g))).toBe(1);
    }
  });

  test("and it crosses the whole map", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g, r } = gen(seed);
      const long = r.axis === "x" ? g.w : g.h;
      const cross = r.axis === "x" ? g.h : g.w;
      for (let a = 0; a < long; a++) {
        let any = false;
        for (let c = 0; c < cross && !any; c++) {
          any = g.paved[r.axis === "x" ? idx(g, a, c) : idx(g, c, a)] !== 0;
        }
        expect(any).toBe(true);                             // no gap in the street
      }
    }
  });

  /**
   * A STREET THAT IS ALWAYS TWO ROWS ACROSS THE MIDDLE makes the seed a
   * decoration: the first thing a player looks at would be identical on every
   * map. Both halves matter — it has to bend, and it has to sometimes run the
   * other way.
   */
  test("it does not run the same way on every map", () => {
    const axes = new Set<string>();
    for (let seed = 0; seed < 20; seed++) axes.add(gen(seed).r.axis);
    expect(axes.size).toBe(2);
  });

  test("and it bends rather than running dead straight", () => {
    let bent = 0;
    for (let seed = 0; seed < 20; seed++) {
      const { g, r } = gen(seed);
      const long = r.axis === "x" ? g.w : g.h;
      const cross = r.axis === "x" ? g.h : g.w;
      const firstAt = (a: number) => {
        for (let c = 0; c < cross; c++) {
          if (g.paved[r.axis === "x" ? idx(g, a, c) : idx(g, c, a)] !== 0) return c;
        }
        return -1;
      };
      const seen = new Set<number>();
      for (let a = 0; a < long; a++) seen.add(firstAt(a));
      if (seen.size > 1) bent++;
    }
    expect(bent).toBe(20);
  });

  test("a street with no wander IS dead straight", () => {
    const { g, r } = gen(4, 64, 64, { wander: 0 });
    const cross = r.axis === "x" ? g.h : g.w;
    const long = r.axis === "x" ? g.w : g.h;
    const first = new Set<number>();
    for (let a = 0; a < long; a++) {
      for (let c = 0; c < cross; c++) {
        if (g.paved[r.axis === "x" ? idx(g, a, c) : idx(g, c, a)] !== 0) { first.add(c); break; }
      }
    }
    expect(first.size).toBe(1);
  });

  test("every seed opens with somewhere to build", () => {
    for (let seed = 0; seed < 40; seed++) {
      expect(gen(seed).r.frontage).toBeGreaterThanOrEqual(MIN_FRONTAGE);
    }
  });

  test("the street is not jammed against an edge", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g, r } = gen(seed);
      for (let i = 0; i < g.paved.length; i++) {
        if (g.paved[i] === 0) continue;
        const c = r.axis === "x" ? (i / g.w) | 0 : i % g.w;
        const cross = r.axis === "x" ? g.h : g.w;
        expect(c).toBeGreaterThan(0);
        expect(c).toBeLessThan(cross - 1);
      }
    }
  });

  /**
   * THE CONE, which is what makes frontage buildable rather than merely
   * adjacent: ground beside the street should meet it, not tower over it.
   * Stated against the distance field rather than against a row, so it holds
   * for a street of any shape and still means something if the relief is ever
   * turned up. @see RISE
   */
  test("the land climbs at most a slab a tile away from the street", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g } = gen(seed, 64, 64, { rivers: 0, lakes: 0 });
      const dist = distanceFromPaved(g);
      const road = [...roadHeights(g)][0];
      for (let i = 0; i < g.height.length; i++) {
        expect(Math.abs(g.height[i] - road)).toBeLessThanOrEqual(dist[i] * DEFAULT_GEN.rise);
      }
    }
  });

  /**
   * THE CHANNEL IS CUT, NEVER BUILT — asked WITHIN one map, because across
   * two it stopped meaning anything.
   *
   * It used to diff a river map against the same seed with no rivers. That
   * comparison has now failed twice for reasons that were not the thing it
   * was watching for. First the valley became terrain, so the two maps are
   * different country. Then rivers were allowed to cross the street: the
   * road's own level is the MEDIAN of the land it crosses, the valley is part
   * of that land, and so adding a river moves the whole street — measured, by
   * up to twelve half steps. A spine cell can then be higher on the river map
   * than on the dry one while being perfectly well cut into its own valley.
   *
   * So the cut is asked of the map it is in: no cell of a course stands above
   * the ground around it.
   *
   * The anti-embankment half stays cross-map, because building something up
   * IS a difference between two maps and there is no within-map way to ask
   * it. But it has to allow for the street having moved — the cone pins the
   * land near the road to the road's level, so a road that rose ten half
   * steps takes its whole corridor with it, and that is the map being shaped
   * rather than ground being piled on it. What is left over after both is
   * allowed for is what an embankment would be.
   */
  test("the channel is only ever cut away, and nothing is built up", () => {
    const AWAY = [[9, 0], [-9, 0], [0, 9], [0, -9], [7, 7], [-7, -7], [7, -7], [-7, 7]] as const;
    for (let seed = 0; seed < 12; seed++) {
      const dry = gen(seed, 64, 64, { rivers: 0, lakes: 0 });
      const wet = gen(seed, 64, 64, { rivers: 2, lakes: 2 });
      for (const i of lastPath) {
        const x = i % wet.g.w, y = (i / wet.g.w) | 0;
        let hi = -Infinity, seen = 0;
        for (const [dx, dy] of AWAY) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= wet.g.w || ny >= wet.g.h) continue;
          hi = Math.max(hi, wet.g.height[idx(wet.g, nx, ny)]);
          seen++;
        }
        if (seen < 3) continue;                       // too near a corner to say
        expect(wet.g.height[i]).toBeLessThanOrEqual(hi);
      }
      // THE BOUND COMES FROM THE MODEL, not from what a run happened to
      // produce, which is why it is `relief` and not the half of it that an
      // earlier measurement suggested. Land is `base + noise * blend` with
      // `base` never positive, so against the raw `noise` the most a cell can
      // RISE is `noise * (1 - blend)` where the noise was negative — at most
      // one relief, as the valley fades the noise out. Plus the street, since
      // the cone carries its corridor with it wherever it goes.
      const moved = Math.abs(wet.r.roadHeight - dry.r.roadHeight);
      const most = DEFAULT_GEN.relief + moved;
      for (let i = 0; i < dry.g.height.length; i++) {
        expect(wet.g.height[i] - dry.g.height[i]).toBeLessThanOrEqual(most);
      }
    }
  });

  test("and water within reach of the street only under a span", () => {
    for (let seed = 0; seed < 12; seed++) {
      const dry = gen(seed, 64, 64, { rivers: 0, lakes: 0 });
      const wet = gen(seed, 64, 64, { rivers: 3, lakes: 3 });
      const dist = distanceFromPaved(dry.g);
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] > 2) continue;
        // Wet beside the street is now allowed, and means one thing: a
        // crossing. What may never happen is water ON the road.
        if (wet.g.pool[i] > 0 && wet.g.paved[i] !== 0) {
          expect(wet.g.deck[i]).not.toBe(0);
          expect(wet.g.height[i] + wet.g.pool[i]).toBeLessThan(wet.g.deckZ[i]);
        }
      }
      // AND THE STREET IS STILL A STREET: one level end to end, with ground
      // beside it worth building on.
      const paved = [...wet.g.paved]
        .map((v, i) => (v ? surfaceHeightAt(wet.g, i % wet.g.w, (i / wet.g.w) | 0) : null))
        .filter((h): h is number => h !== null);
      expect(new Set(paved).size).toBe(1);
      expect(wet.r.frontage).toBeGreaterThan(MIN_FRONTAGE);
    }
  });

  /**
   * EVERY CELL ON A WHOLE SLAB. The tileset's skirt is exactly one full step,
   * so terrain quantised to it has cliff art that lines up; terrain on half
   * steps has walls the art can only approximate. @see terrace
   */
  test("the ground is terraced to whole slabs", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g } = gen(seed, 64, 64, { rivers: 0, lakes: 0 });
      // `Math.abs`, because -2 % 2 is -0 and `toBe` can tell the difference.
      for (const h of g.height) expect(Math.abs(h % 2)).toBe(0);
    }
  });

  /**
   * THE ONE THAT CAUGHT THE FIRST DRAFT, which took its height straight off
   * four octaves of noise. Three quarters of its cells sat a single half step
   * from a neighbour: a 16.5px ledge everywhere, no plane anywhere, and every
   * house needing its ground levelled first. It read as static, not landscape.
   * Measured over forty seeds: 21.8% level then, 64% once it was shaped.
   *
   * IT IS ASKED AWAY FROM THE RIVER NOW, and that is a change of claim rather
   * than a slackened bound, so it is worth saying exactly what moved. A map
   * has a VALLEY in it since the rivers were planned before the land, and the
   * side of a valley is not level ground — it cannot be and still be a
   * valley. At one slab a tile, which is the grade the cliff art is drawn
   * for, every tile of it steps, so a valley side scores nothing on this
   * measure however gentle or well-formed it is.
   *
   * What must not happen is the valley eating the COUNTRY. Measured over
   * forty seeds: the land more than ten tiles from the water is 60.8% level,
   * against 63.3% for the same seeds generated with no river at all — so
   * outside its own valley a river costs the plain about two points. The
   * valley itself is a third of the map, which takes the whole-map figure to
   * 44.8%; that number is the valley's footprint and not a loss of plain.
   */
  test("the land away from the river is a plain you can build on", () => {
    let near = 0, nearAll = 0, far = 0, farAll = 0, dry = 0, dryAll = 0;
    for (let seed = 0; seed < 12; seed++) {
      const { g } = gen(seed);
      const spine = [...lastPath];
      const bare = gen(seed, 64, 64, { rivers: 0, lakes: 0 }).g;
      const off = new Float32Array(g.w * g.h).fill(999);
      for (const i of spine) {
        const px = i % g.w, py = (i / g.w) | 0;
        for (let y = Math.max(0, py - 12); y <= Math.min(g.h - 1, py + 12); y++) {
          for (let x = Math.max(0, px - 12); x <= Math.min(g.w - 1, px + 12); x++) {
            const d = Math.hypot(x - px, y - py);
            if (d < off[y * g.w + x]) off[y * g.w + x] = d;
          }
        }
      }
      const level = (m: typeof g, x: number, y: number) => {
        const h = m.height[idx(m, x, y)];
        return m.height[idx(m, x + 1, y)] === h && m.height[idx(m, x - 1, y)] === h
          && m.height[idx(m, x, y + 1)] === h && m.height[idx(m, x, y - 1)] === h;
      };
      for (let y = 1; y < g.h - 1; y++) {
        for (let x = 1; x < g.w - 1; x++) {
          const on = level(g, x, y);
          nearAll++;
          if (on) near++;
          if (off[idx(g, x, y)] > 10) { farAll++; if (on) far++; }
          dryAll++;
          if (level(bare, x, y)) dry++;
        }
      }
    }
    // THE PLAIN IS INTACT: away from the valley the map is as level as one
    // with no river on it, within a couple of points.
    expect(far / farAll).toBeGreaterThan(0.55);
    expect(far / farAll).toBeGreaterThan(dry / dryAll - 0.08);
    // AND THE VALLEY HAS NOT EATEN THE MAP. Well under half would mean the
    // country is all valley side, which is the failure this guards.
    expect(near / nearAll).toBeGreaterThan(0.4);
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

  test("and it stays inside what the editor can represent", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { g } = gen(seed);
      for (const h of g.height) {
        expect(h).toBeGreaterThanOrEqual(HEIGHT_MIN);
        expect(h).toBeLessThanOrEqual(HEIGHT_MAX);
      }
    }
  });

  test("a generated map starts unbuilt", () => {
    const { g } = gen(3);
    expect(g.structures.size).toBe(0);
  });

  test("it works on the small map sizes too", () => {
    for (const size of [16, 32, 96]) {
      const { g, r } = gen(5, size, size);
      expect(r.road).toBeGreaterThan(0);
      expect(r.frontage).toBeGreaterThan(0);
      expect(roadHeights(g).size).toBe(1);
    }
  });
});

describe("rerolling a bad opening", () => {
  test("a playable map is returned and reports its frontage", () => {
    const g = fresh();
    const r = generatePlayableMap(g, { seed: 99, ...MATS });
    expect(r.frontage).toBeGreaterThanOrEqual(MIN_FRONTAGE);
    expect(frontageOf(g)).toBe(r.frontage);
  });

  /** A dull map beats no map: it must never loop or throw looking for a good one. */
  test("it gives up rather than hanging", () => {
    const g = fresh(16, 16);
    expect(() => generatePlayableMap(g, { seed: 1, ...MATS }, 2)).not.toThrow();
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
  const M = { grass: 1, dirt: 2, sand: 3, woods: [] };
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

  test("the low ground is sand — where the water is and where it would go", () => {
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

/**
 * WOODS ARE A MATERIAL, so the only thing that can go wrong is WHERE they go —
 * and the answer is grass, because every other material is saying something a
 * tree would talk over. @see plantTrees
 */
describe("trees", () => {
  const M = { grass: 1, dirt: 2, sand: 3, woods: [4, 5, 6] };
  const meadow = (w = 40) => {
    const g = createGrid(w, w);
    fillTerrain(g, M.grass);
    return g;
  };
  const wooded = (g: ReturnType<typeof meadow>) =>
    [...g.terrain].filter((t) => (M.woods as number[]).includes(t)).length;

  test("none asked for, none planted", () => {
    const g = meadow();
    expect(plantTrees(g, 5, M, { trees: 0 })).toBe(0);
    expect(wooded(g)).toBe(0);
  });

  test("more woods planted the more are asked for", () => {
    const a = meadow(), b = meadow();
    plantTrees(a, 5, M, { trees: 0.15 });
    plantTrees(b, 5, M, { trees: 0.8 });
    expect(wooded(b)).toBeGreaterThan(wooded(a));
  });

  test("they only stand on the grass", () => {
    const g = meadow();
    for (let i = 0; i < g.terrain.length; i += 3) g.terrain[i] = M.sand;
    for (let i = 1; i < g.terrain.length; i += 3) g.terrain[i] = M.dirt;
    plantTrees(g, 5, M, { trees: 0.9 });
    for (let i = 0; i < g.terrain.length; i++) {
      if (i % 3 === 0) expect(g.terrain[i]).toBe(M.sand);
      if (i % 3 === 1) expect(g.terrain[i]).toBe(M.dirt);
    }
  });

  /** A stand has an inside: thicker in the middle, thinning to its edge. */
  test("a wood thins out rather than ending", () => {
    const g = meadow(64);
    plantTrees(g, 5, M, { trees: 0.5 });
    const seen = new Set([...g.terrain].filter((t) => (M.woods as number[]).includes(t)));
    expect(seen.size).toBeGreaterThan(1);
  });

  test("with no wooded tiles in the palette, nothing is planted", () => {
    const g = meadow();
    expect(plantTrees(g, 5, { ...M, woods: [] }, { trees: 1 })).toBe(0);
  });

  test("a generated map plants some", () => {
    expect(gen(6).r.wooded).toBeGreaterThan(0);
  });
});

/**
 * TWO INPUTS, AND THE SPLIT BETWEEN THEM IS A PROMISE. The seed picks which
 * map; the parameters pick what kind. Anything that let a parameter reseed the
 * draws would break the one thing sliders are for — seeing what your change
 * did — so it is held here rather than left to care.
 */
describe("seed and settings are separate inputs", () => {
  test("same seed, same settings, same map", () => {
    const a = gen(21, 64, 64, { relief: 24 });
    const b = gen(21, 64, 64, { relief: 24 });
    expect([...a.g.height]).toEqual([...b.g.height]);
  });

  test("the street does not move when the LAND settings change", () => {
    const a = gen(21, 64, 64, { relief: 8, contrast: 1.5 });
    const b = gen(21, 64, 64, { relief: 40, contrast: 5 });
    expect([...a.g.paved]).toEqual([...b.g.paved]);
    expect(a.r.axis).toBe(b.r.axis);
  });

  test("but the land does", () => {
    const a = gen(21, 64, 64, { relief: 8 });
    const b = gen(21, 64, 64, { relief: 40 });
    expect([...a.g.height]).not.toEqual([...b.g.height]);
  });

  test("flatter settings give flatter ground", () => {
    const tall = gen(9, 64, 64, { relief: 40 }), flat = gen(9, 64, 64, { relief: 4 });
    const range = (g: ReturnType<typeof fresh>) => {
      let lo = Infinity, hi = -Infinity;
      for (const h of g.height) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
      return hi - lo;
    };
    expect(range(tall.g)).toBeGreaterThan(range(flat.g));
  });

  /**
   * A generator is only worth tuning by hand if every position of every slider
   * still makes a map — so this walks each one to both ends and asks for the
   * guarantees back. It is the test that catches a range nobody tried.
   */
  test("every slider makes a playable map at both ends", () => {
    for (const s of GEN_SLIDERS) {
      for (const v of [s.min, s.max]) {
        // `size` is the one parameter generation does not read — the grid is
        // made before there is anything to generate into it — so this is where
        // it is honoured, and both ends of it are a real case: the smallest map
        // that still fits a street and the largest one anybody can ask for.
        const n = s.key === "size" ? v : 48;
        const g = fresh(n, n);
        const r = generateMap(g, { seed: 11, ...MATS, params: { [s.key]: v } });
        expect(roadHeights(g).size).toBe(1);
        expect(componentCount(createNetwork(g))).toBe(1);
        expect(r.frontage).toBeGreaterThan(0);
        for (const h of g.height) {
          expect(h).toBeGreaterThanOrEqual(HEIGHT_MIN);
          expect(h).toBeLessThanOrEqual(HEIGHT_MAX);
        }
      }
    }
  });

  test("a nonsense parameter is clamped, not obeyed", () => {
    expect(withDefaults({ relief: -50 }).relief).toBe(0);
    expect(withDefaults({ octaves: 99 }).octaves).toBe(6);
    expect(withDefaults({ relief: NaN }).relief).toBe(DEFAULT_GEN.relief);
  });

  test("every parameter has a slider, and every slider a parameter", () => {
    const keys = new Set(Object.keys(DEFAULT_GEN));
    expect(new Set(GEN_SLIDERS.map((s) => s.key))).toEqual(keys);
    for (const s of GEN_SLIDERS) {
      expect(s.min).toBeLessThan(s.max);
      expect(DEFAULT_GEN[s.key]).toBeGreaterThanOrEqual(s.min);
      expect(DEFAULT_GEN[s.key]).toBeLessThanOrEqual(s.max);
    }
  });
});
