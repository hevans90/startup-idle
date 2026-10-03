/**
 * The map a new company starts on.
 *
 * Founding a startup should hand you somewhere you have not seen before — but
 * it has to be somewhere you can actually start. Those pull against each other,
 * and the whole design here is about the second one winning where they conflict.
 *
 * THE ROAD IS CARVED, NOT ROUTED. The street is laid first and the terrain is
 * then clamped into a cone around it that rises a slab a tile. Routing a road
 * over existing terrain means pathfinding for a route that is flat enough,
 * which can fail; carving cannot. The player is guaranteed a flat street with
 * buildable frontage along all of it, whatever the noise did. @see layRoad
 *
 * TWO INPUTS. The seed picks WHICH map; the parameters pick what kind. Every
 * random draw comes from the seed alone, so holding it and moving a slider
 * gives the same country under different weather. @see GenParams
 *
 * DETERMINISTIC. Everything comes from the two, so a map is stored as a number
 * and a settings object, and the same company always founds on the same ground.
 */
import { edited, fillTerrain, idx, inBounds, recomputeHeightRange, type Grid } from "../grid";
import { HEIGHT_MAX, HEIGHT_MIN } from "../edit/height-tools";
import { fbm, valueNoise } from "./noise";
import { layRoad, type Road } from "./road";
import { carveWater } from "./water";
import { planRivers, valleyGround } from "./valley";
import { withDefaults, type GenParams } from "./params";
import { mulberry32 } from "../../utils/rng";

export type GenOptions = {
  /** The same seed always gives the same map. */
  seed: number;
  /** Terrain palette index for the grass, and the fallback for the rest. */
  material: number;
  /** Bare earth: the verge, the brows of cliffs, the tops of hills. */
  dirt?: number;
  /** Low ground, where water collects. */
  sand?: number;
  /** Grass under trees, thinnest first. Empty leaves the map unwooded. */
  woods?: readonly number[];
  /** Road palette index. */
  paved?: number;
  /** What kind of map. Anything left out takes its default. @see DEFAULT_GEN */
  params?: Partial<GenParams>;
};

/**
 * The drop to a neighbour that counts as a cliff, in half steps.
 *
 * Grass does not hold on a scarp, and the cliff faces under one are drawn in
 * earth already — so a grass top over an earth wall reads as a lawn laid on a
 * quarry. Four is two slabs: one slab is a step, two is a face.
 */
const SCARP = 4;

/** Tiles across one blotch of the material jitter. */
const PATCH = 9;

/**
 * Half steps the sand and earth lines wander by.
 *
 * Without it their edges are CONTOURS — smooth closed curves at exactly one
 * height, which no coastline is. Displacing the threshold by its own slow noise
 * breaks the line up without moving where the sand broadly is.
 */
const JITTER = 3;

/** The result, so a caller can tell a good map from one worth rerolling. */
export type GenReport = {
  seed: number;
  /** Cells that are bare ground, beside the road, and level enough to build on. */
  frontage: number;
  /** The height the road sits at. */
  roadHeight: number;
  /** Which axis the street runs along. */
  axis: "x" | "y";
  /** Cells the street paved. */
  road: number;
  /** Cells holding water at the start. */
  wet: number;
  /** Spine cells walked, across every river and side stream. */
  river: number;
  /** Springs feeding a river. */
  springs: number;
  /** Cells under trees. */
  wooded: number;
};

/**
 * The fewest frontage cells a map may open with.
 *
 * A map that gives a player nowhere to put their first house is worse than a
 * dull one. Carving guarantees frontage, so this is a backstop against a future
 * change to the carve rather than something the noise can trip today.
 */
export const MIN_FRONTAGE = 12;

/**
 * Lay down terrain, a road and water. Returns what it made, for the caller to
 * judge.
 *
 * The grid is written in place and its cached height range recomputed once at
 * the end — the fixtures' own idiom, and much cheaper than `setHeight` per cell,
 * which maintains that range on every one of four thousand writes.
 */
export function generateMap(g: Grid, opts: GenOptions): GenReport {
  const { seed, material, paved = 1 } = opts;
  const p = withDefaults(opts.params);
  const rng = mulberry32(seed);
  const terrace = (v: number) => Math.round(v / p.terrace) * p.terrace;

  fillTerrain(g, material);
  g.height.fill(0);
  g.ramp.fill(0);
  g.paved.fill(0);
  g.source.fill(0);
  g.inflow.fill(0);
  g.fluid.fill(0);
  g.pool.fill(0);
  g.deckPool.fill(0);
  g.pipe.fill(0);
  g.pipeZ.fill(0);

  // 1. THE STREET, first, because everything else is measured from it.
  const road: Road = layRoad(g, p, rng, paved);

  // OFFSET THE NOISE BY THE SEED so two maps do not share a corner. Sampling
  // the same field at a different origin is cheaper than reseeding the hash and
  // gives the same independence.
  const ox = rng() * 1000, oy = rng() * 1000;

  // 2. THE RIVERS, as lines on a blank map, BEFORE there is any land.
  //
  //    This is the order everything else here turned on. Shaped first and cut
  //    afterwards, the bed inherits whatever the noise did between its two
  //    ends — measured over eight seeds, 38 half steps of CLIMB against 15 of
  //    net fall, because `relief` is bigger than a river's whole descent. A
  //    course chosen first can be given ground that falls all the way.
  //    @see planRivers
  const plan = planRivers(g, p, rng);
  const valley = valleyGround(g, p, plan);

  // 3. THE LAND, in a scratch field rather than in the grid. `g.height` is an
  //    Int8Array and would truncate every sample on the way in — the carve
  //    below reads these numbers back, and rounding them twice, once by
  //    accident, is how a terrace ends up a half step out.
  const land = new Float32Array(g.w * g.h);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const n = fbm(seed, ox + x / p.feature, oy + y / p.feature, p.octaves);
      land[idx(g, x, y)] = n;
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    }
  }
  // STRETCHED TO ITS OWN EXTREMES, and this is what puts the hills back.
  // Several octaves of noise summed pile up around the middle: over a 64² map
  // the raw field spans maybe a third of nought-to-one, so land taken straight
  // off it uses a third of the relief it was given and every map comes out the
  // same gentle swell. Rescaling each map to the range it actually reached
  // means the highest ground on every seed is a real hill, and the shaping
  // below still decides how much of the map is plain.
  const span = Math.max(1e-6, hi - lo);
  for (let i = 0; i < land.length; i++) {
    const s = ((land[i] - lo) / span - 0.5) * 2;                 // −1…1
    const shaped = Math.sign(s) * Math.abs(s) ** p.contrast * p.relief;
    // THE VALLEY FIRST, AND THE NOISE FADED OUT INSIDE IT. Full strength in
    // the channel the noise is larger than the river's entire fall, which is
    // exactly how a bed ends up climbing; `blend` is nought on the spine and
    // one out on the plain, so the floor is clean and the uplands are as
    // rough as they ever were. @see valleyGround
    land[i] = valley.base[i] + shaped * valley.blend[i];
  }

  // 4. THE ROAD'S OWN LEVEL: the median of the land it crosses, so the carve
  //    moves as little ground as possible and the street sits IN the landscape
  //    rather than on an embankment across it.
  const along: number[] = [];
  for (let i = 0; i < land.length; i++) if (g.paved[i] !== 0) along.push(land[i]);
  along.sort((a, b) => a - b);
  const roadHeight = along.length
    ? clampHeight(terrace(along[(along.length - 1) >> 1]))
    : 0;

  // 5. CARVE, AND TERRACE, in the one pass — every cell's final height is
  //    decided here. Paved cells are pinned to the street's level; everywhere
  //    else the land may differ from it by a slab per tile of distance, which
  //    stops binding as soon as the cone is wider than the relief.
  for (let i = 0; i < land.length; i++) {
    const cap = road.distance[i] * p.rise;
    const dh = Math.max(-cap, Math.min(cap, land[i] - roadHeight));
    g.height[i] = clampHeight(terrace(roadHeight + dh));
  }

  // 6. THE CHANNELS AND THE WATER, cut into ground that has stopped moving.
  const water = carveWater(g, p, rng, road.distance, plan, roadHeight);

  // 7. WHAT THE GROUND IS MADE OF, read off the finished map — so the materials
  //    describe it rather than predicting it.
  const mats = {
    grass: material,
    dirt: opts.dirt ?? material,
    sand: opts.sand ?? opts.dirt ?? material,
    woods: opts.woods ?? [],
  };
  paintGround(g, seed, roadHeight, mats, p);
  const wooded = plantTrees(g, seed, mats, p);

  recomputeHeightRange(g);
  edited(g);
  return {
    seed, roadHeight, axis: road.axis, road: road.cells,
    frontage: frontageOf(g), wet: water.wet, wooded,
    river: water.length, springs: water.springs,
  };
}

const clampHeight = (v: number) =>
  Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(v)));

/** Whether a cell orthogonally touches a paved one. @see frontageOf */
export function touchesPaved(g: Grid, x: number, y: number): boolean {
  return (inBounds(g, x + 1, y) && g.paved[idx(g, x + 1, y)] !== 0)
    || (inBounds(g, x - 1, y) && g.paved[idx(g, x - 1, y)] !== 0)
    || (inBounds(g, x, y + 1) && g.paved[idx(g, x, y + 1)] !== 0)
    || (inBounds(g, x, y - 1) && g.paved[idx(g, x, y - 1)] !== 0);
}

/** The steepest drop or rise to a 4-neighbour, in half steps. */
function relief(g: Grid, x: number, y: number): number {
  const h = g.height[idx(g, x, y)];
  let worst = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (!inBounds(g, x + dx, y + dy)) continue;
    worst = Math.max(worst, Math.abs(g.height[idx(g, x + dx, y + dy)] - h));
  }
  return worst;
}

/** Which palette index stands for what, once the fallbacks are resolved. */
export type Materials = {
  grass: number;
  /** Bare earth: the verge, the brows of cliffs, the tops of hills. */
  dirt: number;
  /** Low ground, where water collects. */
  sand: number;
  /** Grass under trees, thinnest first. Empty leaves the map unwooded. */
  woods: readonly number[];
};

/**
 * Grass, earth and sand over ground that is already shaped.
 *
 * FOUR RULES, IN PRECEDENCE ORDER, and each says something the player can act
 * on rather than being decoration:
 *
 *  - **the verge is earth** — the cells touching the street, which are exactly
 *    the cells housing may be built on. The one place the art is allowed to
 *    give the rules away, because a player hunting for legal frontage by
 *    clicking around is a player reading a tooltip instead of a map;
 *  - **the brow of a cliff is earth** — a scarp's face is drawn in earth
 *    already (@see WALL_FRAME), and grass over a two-slab face reads as a lawn
 *    laid on a quarry;
 *  - **the high ground is earth** and **the low ground is sand** — the pair
 *    that makes elevation readable without counting slabs, and the sand marks
 *    where the water is and where it would go.
 *
 * Everything else is grass. Separate from `generateMap` because it is a pure
 * function of a finished grid, which is the only way to test the rules on
 * ground chosen rather than ground the noise happened to produce.
 */
export function paintGround(
  g: Grid, seed: number, roadHeight: number, m: Materials, params?: Partial<GenParams>,
): void {
  const p = withDefaults(params);
  const sandLine = roadHeight - p.lowland, dirtLine = roadHeight + p.upland;

  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      if (g.terrain[i] === 0) continue;                     // void stays void
      const h = g.height[i];
      // The lines wander, or they are CONTOURS. @see JITTER
      const wander = (valueNoise(seed ^ 0x5eed, x / PATCH, y / PATCH) - 0.5) * 2 * JITTER;

      g.terrain[i] =
        g.paved[i] !== 0 || touchesPaved(g, x, y) ? m.dirt
        : relief(g, x, y) >= SCARP ? m.dirt
        : h + wander > dirtLine ? m.dirt
        : h + wander < sandLine ? m.sand
        : m.grass;
    }
  }
}

/**
 * Trees, on the grass and nowhere else.
 *
 * WOODS ARE A MATERIAL, not objects standing on one: a wooded cell is a ground
 * tile with trees baked into it (@see bake-trees), so it saves, paints, undoes
 * and renders through the paths that already exist and nothing downstream has
 * to learn about a second kind of thing. What that costs is felling a single
 * tree; what it buys is that trees are free everywhere else.
 *
 * ON GRASS ONLY, deliberately. The verge, the brows and the sand are all saying
 * something — where you may build, where the ground breaks, where the water is
 * — and a tree over any of them is noise on a signal. It also means woods never
 * touch the street, so they cannot be mistaken for an obstacle to building.
 *
 * Thicker where the noise is higher, so a wood has an inside.
 */
export function plantTrees(
  g: Grid, seed: number, m: Materials, params?: Partial<GenParams>,
): number {
  const p = withDefaults(params);
  if (!m.woods.length || p.trees <= 0) return 0;
  // The share asked for, as a level in a field that is roughly flat in [0,1).
  const line = 1 - p.trees;
  let n = 0;

  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      if (g.terrain[i] !== m.grass) continue;
      const v = valueNoise(seed ^ 0x7ee5, x / p.woodSize, y / p.woodSize);
      if (v < line) continue;
      // How far INTO the wood this cell is, nought at its edge and one at its
      // densest — which is what makes a stand thin out rather than end.
      const into = (v - line) / p.trees;
      const tier = Math.min(m.woods.length - 1, Math.floor(into * m.woods.length));
      g.terrain[i] = m.woods[tier];
      n++;
    }
  }
  return n;
}

/**
 * Cells a house could go on: bare, unpaved, and orthogonally touching a road.
 *
 * The same question `touchesRoad` asks at placement time, counted over the
 * whole map — so the number this reports is the number of openings a player
 * actually has. @see touchesRoad
 */
export function frontageOf(g: Grid): number {
  let n = 0;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      if (g.paved[i] !== 0) continue;
      if (g.terrain[i] === 0) continue;
      if (touchesPaved(g, x, y)) n++;
    }
  }
  return n;
}

/**
 * Generate, and reroll a seed that would open badly.
 *
 * Carving guarantees frontage, so this is insurance rather than a search — but
 * "should always" is exactly the kind of claim that stops being true after
 * someone drags a slider somewhere new, and an unplayable opening is a much
 * worse failure than a slightly different map. Falls back to the last attempt
 * rather than looping: a dull map beats no map.
 */
export function generatePlayableMap(
  g: Grid, opts: GenOptions, tries = 8,
): GenReport {
  let report = generateMap(g, opts);
  for (let n = 1; n < tries && report.frontage < MIN_FRONTAGE; n++) {
    report = generateMap(g, { ...opts, seed: (opts.seed + n * 0x9e3779b9) | 0 });
  }
  return report;
}
