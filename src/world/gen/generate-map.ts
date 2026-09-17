/**
 * The map a new company starts on.
 *
 * Founding a startup should hand you somewhere you have not seen before — but
 * it has to be somewhere you can actually start. Those pull against each other,
 * and the whole design here is about the second one winning where they conflict.
 *
 * THE ROAD IS CARVED, NOT ROUTED. Terrain is generated first and the road is
 * then cut through it at ONE height, with the ground either side clamped into a
 * cone that rises a slab a tile. Routing a road over existing terrain means
 * pathfinding for a route that is flat enough, which can fail; carving cannot.
 * The player is guaranteed a flat street with buildable frontage on both sides,
 * whatever the noise did.
 *
 * DETERMINISTIC. Everything comes from the seed, so a map is stored as a number
 * and the same company always founds on the same ground. @see mulberry32
 */
import { edited, fillTerrain, idx, inBounds, recomputeHeightRange, type Grid } from "../grid";
import { HEIGHT_MAX, HEIGHT_MIN } from "../edit/height-tools";
import { fbm, valueNoise } from "./noise";
import { mulberry32 } from "../../utils/rng";

export type GenOptions = {
  /** The same seed always gives the same map. */
  seed: number;
  /** Terrain palette index for the grass, and the fallback for the other two. */
  material: number;
  /** Bare earth: the road's verge and the brows of cliffs. */
  dirt?: number;
  /** Low ground, where water will one day collect. */
  sand?: number;
  /** Road palette index. */
  paved?: number;
};

/**
 * How tall the land gets, in half steps.
 *
 * Terrain exists here to make WHERE you build a decision, not to be scenery
 * you cannot use — and every half step of relief is ground that has to be
 * levelled before anything stands on it. Sixteen is eight slabs either way,
 * which the shaping below spends on a few real hills rather than on a general
 * unevenness: measured over forty seeds, two thirds of the map comes out with
 * a level neighbourhood and the highest ground stands about fifteen slabs over
 * the lowest.
 */
const RELIEF = 16;

/** Tiles across one feature of the landscape — bigger is smoother, broader hills. */
const FEATURE = 34;

/**
 * Octaves of noise in the land.
 *
 * THREE, NOT FOUR, and dropping one is a fix rather than a saving. The fourth
 * octave's wavelength is under two tiles, so all it can express at this scale
 * is a one-cell bump — and a one-cell bump is a full 16.5px ledge that has to
 * be levelled before anything stands on it. The first draft had it, and the
 * result read as static rather than as landscape: every cell a slightly
 * different height, no plane anywhere big enough to notice.
 */
const OCTAVES = 3;

/**
 * How hard the land is pushed away from its middle.
 *
 * Noise is densest in the middle of its range, so terrain taken straight off it
 * is gently undulating EVERYWHERE and flat nowhere. Raising the signed height to
 * a power above one pulls the middle towards nought and leaves the extremes
 * where they are: most of the map settles into plains you can build on, and what
 * is left rises into hills that are worth the levelling. Below one it would do
 * the opposite and there would be nothing but slope.
 */
const CONTRAST = 3;

/**
 * Half steps the land is quantised to.
 *
 * TWO — one full slab, which is the step the tileset is drawn for: a ground
 * frame is a diamond top plus a 33px skirt, and that skirt is exactly one full
 * step of wall. @see WALL_FRAME. Terraced to it, every cliff on a generated map
 * is a whole number of slabs and the art lines up; left unterraced, half the
 * map sits on half-step ledges that the wall art has to fake.
 */
const TERRACE = 2;

/**
 * Half steps the land may climb per tile away from the road.
 *
 * THE FRONTAGE GUARANTEE, and it is a cone rather than a shoulder for a reason.
 * A shoulder that blends the land towards the road over a fixed few tiles keeps
 * frontage gentle only for as long as nobody raises `RELIEF` — the blend is a
 * FRACTION of the drop, so taller land means a taller first step. A cap on the
 * climb per tile is absolute: the cell beside the street is within one slab of
 * it whatever the noise did, the next within two, and by seven tiles out the
 * cone is wider than the relief and the land is its own shape again. No seam,
 * because the constraint fades out instead of stopping.
 */
const RISE = 2;

/** Lanes the road is wide. Two, or the autotiler draws a path rather than a street. */
const ROAD_W = 2;

/**
 * Half steps below the street at which ground becomes sand.
 *
 * The bottom of the map, where water will collect once there are rivers — so
 * the sand is a promise about drainage rather than decoration. Two slabs down,
 * which after terracing is the first level that reads as a basin and not as a
 * dip.
 */
const LOWLAND = 4;

/**
 * Half steps above the street at which ground goes back to bare earth.
 *
 * The mirror of `LOWLAND`, and the pair of them is what makes height legible
 * at a glance: sand in the bottoms, grass in the middle where the building
 * happens, earth on the tops. Without it the only cue for how high a hill is
 * is counting its slabs, and flat land is the resource this game is about.
 */
const UPLAND = 8;

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
 * Half steps the sand line wanders by.
 *
 * Without it the sand's edge is a CONTOUR — a smooth closed curve at exactly
 * one height, which no coastline is. Displacing the threshold by its own slow
 * noise breaks the line up without moving where the sand broadly is.
 */
const JITTER = 3;

/** The result, so a caller can tell a good map from one worth rerolling. */
export type GenReport = {
  seed: number;
  /** Cells that are bare ground, beside the road, and level enough to build on. */
  frontage: number;
  /** The height the road sits at. */
  roadHeight: number;
  /** Which row the road runs along. */
  roadRow: number;
};

/**
 * The fewest frontage cells a map may open with.
 *
 * A map that gives a player nowhere to put their first house is worse than a
 * dull one. Carving guarantees frontage, so this is a backstop against a future
 * change to the carve rather than something the noise can trip today.
 */
export const MIN_FRONTAGE = 12;

/** Snap to whole slabs. @see TERRACE */
const terrace = (v: number) => Math.round(v / TERRACE) * TERRACE;

/**
 * Lay down terrain and a road. Returns what it made, for the caller to judge.
 *
 * The grid is written in place and its cached height range recomputed once at
 * the end — the fixtures' own idiom, and much cheaper than `setHeight` per cell,
 * which maintains that range on every one of four thousand writes.
 */
export function generateMap(g: Grid, opts: GenOptions): GenReport {
  const { seed, material, paved = 1 } = opts;
  const rng = mulberry32(seed);

  fillTerrain(g, material);
  g.height.fill(0);
  g.ramp.fill(0);
  g.paved.fill(0);
  g.source.fill(0);
  g.fluid.fill(0);
  g.pool.fill(0);
  g.pipe.fill(0);
  g.pipeZ.fill(0);

  // THE ROAD'S ROW, kept away from the edges so both sides have frontage and
  // the map does not open with the street along a border.
  const margin = 5;
  const roadRow = margin + Math.floor(rng() * Math.max(1, g.h - 2 * margin - ROAD_W));

  // OFFSET THE NOISE BY THE SEED so two maps do not share a corner. Sampling
  // the same field at a different origin is cheaper than reseeding the hash and
  // gives the same independence.
  const ox = rng() * 1000, oy = rng() * 1000;

  // 1. THE LAND, in a scratch field rather than in the grid. `g.height` is an
  //    Int8Array and would truncate every sample on the way in — the carve
  //    below reads these numbers back, and rounding them twice, once by
  //    accident, is how a terrace ends up a half step out.
  const land = new Float32Array(g.w * g.h);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const n = fbm(seed, ox + x / FEATURE, oy + y / FEATURE, OCTAVES);
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
    land[i] = Math.sign(s) * Math.abs(s) ** CONTRAST * RELIEF;
  }

  // 2. THE ROAD'S OWN LEVEL: the median of the land it crosses, so the carve
  //    moves as little ground as possible and the street sits IN the landscape
  //    rather than on an embankment across it.
  const along: number[] = [];
  for (let x = 0; x < g.w; x++) along.push(land[idx(g, x, roadRow)]);
  along.sort((a, b) => a - b);
  const roadHeight = clampHeight(terrace(along[(along.length - 1) >> 1]));

  // 3. CARVE, AND TERRACE, in the one pass — every cell's final height is
  //    decided here. The road's own rows are pinned to its level; everywhere
  //    else the land may differ from it by a slab per tile of distance, which
  //    stops binding as soon as the cone is wider than the relief.
  for (let y = 0; y < g.h; y++) {
    const away = y < roadRow ? roadRow - y
      : y >= roadRow + ROAD_W ? y - (roadRow + ROAD_W - 1)
      : 0;
    const cap = away * RISE;
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      const dh = Math.max(-cap, Math.min(cap, land[i] - roadHeight));
      g.height[i] = clampHeight(terrace(roadHeight + dh));
    }
  }

  // 4. THE STREET ITSELF, once the ground under it is flat.
  for (let y = roadRow; y < roadRow + ROAD_W; y++) {
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, y)] = paved;
  }

  // 5. WHAT THE GROUND IS MADE OF, read off the ground once it has stopped
  //    moving — so the materials describe the map rather than predicting it.
  paintGround(g, seed, roadHeight, {
    grass: material, dirt: opts.dirt ?? material, sand: opts.sand ?? opts.dirt ?? material,
  });

  recomputeHeightRange(g);
  edited(g);
  return { seed, roadHeight, roadRow, frontage: frontageOf(g) };
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
  /** Low ground, where water will one day collect. */
  sand: number;
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
 *    that makes elevation readable without counting slabs, and the sand is a
 *    promise about drainage: it marks where water will collect once there are
 *    rivers.
 *
 * Everything else is grass. Separate from `generateMap` because it is a pure
 * function of a finished grid, which is the only way to test the rules on
 * ground chosen rather than ground the noise happened to produce.
 */
export function paintGround(
  g: Grid, seed: number, roadHeight: number, m: Materials,
): void {
  const sandLine = roadHeight - LOWLAND, dirtLine = roadHeight + UPLAND;

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
 * Carving means the first seed should always pass, so this is insurance rather
 * than a search — but "should always" is exactly the kind of claim that stops
 * being true after someone tunes `RISE`, and an unplayable opening is a much
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
