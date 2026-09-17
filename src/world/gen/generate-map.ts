/**
 * The map a new company starts on.
 *
 * Founding a startup should hand you somewhere you have not seen before — but
 * it has to be somewhere you can actually start. Those pull against each other,
 * and the whole design here is about the second one winning where they conflict.
 *
 * THE ROAD IS CARVED, NOT ROUTED. Terrain is generated first and the road is
 * then cut through it at ONE height, with the ground either side eased down to
 * meet it. Routing a road over existing terrain means pathfinding for a route
 * that is flat enough, which can fail; carving cannot. The player is guaranteed
 * a flat street with buildable frontage on both sides, whatever the noise did.
 *
 * DETERMINISTIC. Everything comes from the seed, so a map is stored as a number
 * and the same company always founds on the same ground. @see mulberry32
 */
import { edited, fillTerrain, idx, inBounds, recomputeHeightRange, type Grid } from "../grid";
import { HEIGHT_MAX, HEIGHT_MIN } from "../edit/height-tools";
import { fbm } from "./noise";
import { mulberry32 } from "../../utils/rng";

export type GenOptions = {
  /** The same seed always gives the same map. */
  seed: number;
  /** Terrain palette index to lay down. */
  material: number;
  /** Road palette index. */
  paved?: number;
};

/**
 * How tall the land gets, in half steps.
 *
 * Modest on purpose. Terrain exists here to make WHERE you build a decision,
 * not to be scenery you cannot use — and every half step of relief is ground
 * that has to be levelled before anything stands on it. Twelve gives visible
 * hills and valleys at the eight-to-a-tile vertical scale without walling the
 * map into pockets.
 */
const RELIEF = 12;

/** Tiles across one feature of the landscape — bigger is smoother, broader hills. */
const FEATURE = 22;

/** Lanes the road is wide. Two, or the autotiler draws a path rather than a street. */
const ROAD_W = 2;

/**
 * Tiles either side of the road that are flattened to meet it.
 *
 * THIS IS THE BUILDABLE FRONTAGE and it is the number that decides whether an
 * opening is playable. Housing needs a cell beside the road, and placing levels
 * its own footprint — but levelling a cell that sits six half steps above the
 * street leaves a visible scar and costs the player nothing, which reads as the
 * terrain not mattering. Eased to nothing over this distance instead.
 */
const SHOULDER = 3;

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
  const margin = SHOULDER + 2;
  const roadRow = margin + Math.floor(rng() * Math.max(1, g.h - 2 * margin - ROAD_W));

  // OFFSET THE NOISE BY THE SEED so two maps do not share a corner. Sampling
  // the same field at a different origin is cheaper than reseeding the hash and
  // gives the same independence.
  const ox = rng() * 1000, oy = rng() * 1000;

  // 1. THE LAND. Centred on zero so the road's level sits in the middle of the
  //    range and the terrain has somewhere to go both up and down.
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const n = fbm(seed, ox + x / FEATURE, oy + y / FEATURE);
      g.height[idx(g, x, y)] = Math.round((n - 0.5) * 2 * RELIEF);
    }
  }

  // 2. THE ROAD'S OWN LEVEL: the median of the land it crosses, so the carve
  //    moves as little ground as possible and the street sits IN the landscape
  //    rather than on an embankment across it.
  const along: number[] = [];
  for (let x = 0; x < g.w; x++) along.push(g.height[idx(g, x, roadRow)]);
  along.sort((a, b) => a - b);
  const roadHeight = clampHeight(along[(along.length - 1) >> 1]);

  // 3. CARVE. The road's own rows go flat; the shoulder eases from the road's
  //    height back to the land's over `SHOULDER` tiles, so the street has level
  //    ground beside it and the hills still arrive.
  for (let y = 0; y < g.h; y++) {
    const from = y < roadRow ? roadRow - y : y - (roadRow + ROAD_W - 1);
    const d = y >= roadRow && y < roadRow + ROAD_W ? 0 : from;
    if (d > SHOULDER) continue;
    // Nought on the road itself, one at the far edge of the shoulder.
    const blend = d / (SHOULDER + 1);
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      g.height[i] = Math.round(roadHeight + (g.height[i] - roadHeight) * blend);
    }
  }

  // 4. THE STREET ITSELF, once the ground under it is flat.
  for (let y = roadRow; y < roadRow + ROAD_W; y++) {
    for (let x = 0; x < g.w; x++) g.paved[idx(g, x, y)] = paved;
  }

  recomputeHeightRange(g);
  edited(g);
  return { seed, roadHeight, roadRow, frontage: frontageOf(g) };
}

const clampHeight = (v: number) =>
  Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(v)));

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
      const beside =
        (inBounds(g, x + 1, y) && g.paved[idx(g, x + 1, y)] !== 0)
        || (inBounds(g, x - 1, y) && g.paved[idx(g, x - 1, y)] !== 0)
        || (inBounds(g, x, y + 1) && g.paved[idx(g, x, y + 1)] !== 0)
        || (inBounds(g, x, y - 1) && g.paved[idx(g, x, y - 1)] !== 0);
      if (beside) n++;
    }
  }
  return n;
}

/**
 * Generate, and reroll a seed that would open badly.
 *
 * Carving means the first seed should always pass, so this is insurance rather
 * than a search — but "should always" is exactly the kind of claim that stops
 * being true after someone tunes `SHOULDER`, and an unplayable opening is a
 * much worse failure than a slightly different map. Falls back to the last
 * attempt rather than looping: a dull map beats no map.
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
