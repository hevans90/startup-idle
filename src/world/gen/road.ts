/**
 * The street a new company founds on: where it runs, and how far everything
 * else is from it.
 *
 * IT WANDERS, AND IT PICKS ITS OWN AXIS. The first draft ran two dead-straight
 * rows across the middle of every map, which made the seed a decoration — you
 * could tell two maps apart by their hills and by nothing else, and the one
 * thing a player looks at first was identical every time. The spine here is a
 * slow noise curve along whichever axis the seed chose, so a street bends, and
 * the autotiler already has the corner, T and dead-end frames to draw it.
 *
 * THE DISTANCE FIELD IS THE POINT. Everything the road guarantees — flat ground
 * under it, a gentle climb beside it, frontage to build on — was written
 * against "which row is the road on", which only means anything for a straight
 * one. Measured as a breadth-first distance from every paved cell instead, the
 * same rules hold for a street of any shape, and the carve does not need to
 * know what shape that is.
 */
import { idx, type Grid } from "../grid";
import { valueNoise } from "./noise";
import type { GenParams } from "./params";

export type Road = {
  /** The long axis the street runs along. */
  axis: "x" | "y";
  /** Tiles to the nearest paved cell, per cell, parallel to the grid. */
  distance: Int16Array;
  /** How many cells it paved. */
  cells: number;
};

/** Tiles of map kept clear of the street at each end of its cross axis. */
const MARGIN = 4;

/** Tiles along the street per turn of its wander — long, or it is a slalom. */
const BEND = 26;

/**
 * Lay a street across the map and measure everything's distance from it.
 *
 * Paves as it goes rather than returning a path, because the shape that matters
 * downstream is the SET of paved cells — the carve, the frontage count and the
 * material rules all ask "how far is this from any road", never "where does the
 * road go next".
 */
export function layRoad(g: Grid, p: GenParams, rng: () => number, paved: number): Road {
  const axis: "x" | "y" = rng() < 0.5 ? "x" : "y";
  // Long axis is the one the street runs ALONG; the cross axis is what it
  // wanders across. Named so the loop below reads the same for either.
  const long = axis === "x" ? g.w : g.h;
  const cross = axis === "x" ? g.h : g.w;

  const span = Math.max(1, cross - 2 * MARGIN - p.roadWidth);
  const mid = MARGIN + span / 2;
  const wander = Math.min(p.wander, span / 2);
  const phase = rng() * 1000;

  const pave = (a: number, b: number) => {
    const i = axis === "x" ? idx(g, a, b) : idx(g, b, a);
    if (g.paved[i] !== 0) return 0;
    g.paved[i] = paved;
    return 1;
  };

  let cells = 0, last = -1;
  for (let a = 0; a < long; a++) {
    const off = (at(phase, a) - 0.5) * 2 * wander;
    const b = Math.round(Math.max(MARGIN, Math.min(cross - MARGIN - p.roadWidth, mid + off)));
    // FILL THE GAP the wander opened. A curve that moves more than one tile of
    // cross axis per tile of long axis leaves the street in disconnected
    // rungs — visible as a dashed road, and fatal to the road graph, which is
    // what "is this house on a street" is asked of.
    const from = last < 0 ? b : Math.min(last, b);
    const to = last < 0 ? b : Math.max(last, b);
    for (let c = from; c <= to + p.roadWidth - 1; c++) cells += pave(a, c);
    last = b;
  }

  return { axis, cells, distance: distanceFromPaved(g) };
}

/**
 * The wander curve: slow noise, in `[0, 1)`.
 *
 * A pure function of the seed's phase and the distance along the street, so it
 * is smooth — a street built from independent draws per tile is not a bend, it
 * is a zigzag.
 */
const at = (phase: number, a: number) => valueNoise(1, phase + a / BEND, 0.5);

/**
 * Tiles to the nearest paved cell, by breadth-first search from all of them.
 *
 * One pass over the grid however many cells the street covers, and it answers
 * the only question the rest of generation asks about the road.
 */
export function distanceFromPaved(g: Grid): Int16Array {
  const n = g.w * g.h;
  const dist = new Int16Array(n).fill(-1);
  // A flat queue rather than shift(): a 64² map is four thousand cells and
  // Array.shift is linear in what is left, which makes the walk quadratic.
  const queue = new Int32Array(n);
  let head = 0, tail = 0;

  for (let i = 0; i < n; i++) if (g.paved[i] !== 0) { dist[i] = 0; queue[tail++] = i; }
  if (tail === 0) return dist.fill(0);                    // no street: nothing is far

  while (head < tail) {
    const i = queue[head++];
    const x = i % g.w, y = (i / g.w) | 0, d = dist[i] + 1;
    if (x + 1 < g.w && dist[i + 1] < 0) { dist[i + 1] = d; queue[tail++] = i + 1; }
    if (x - 1 >= 0 && dist[i - 1] < 0) { dist[i - 1] = d; queue[tail++] = i - 1; }
    if (y + 1 < g.h && dist[i + g.w] < 0) { dist[i + g.w] = d; queue[tail++] = i + g.w; }
    if (y - 1 >= 0 && dist[i - g.w] < 0) { dist[i - g.w] = d; queue[tail++] = i - g.w; }
  }
  return dist;
}
