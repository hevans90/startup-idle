/**
 * World v2 — STREETS: the road between one junction and the next. The road
 * network is one piece wherever it joins up, which says where a trip can go
 * but not which street a building is on; a street is a run of road between
 * junctions — where the road runs on both ways, further than any road is
 * wide — and a junction is where streets meet, on none of them.
 *
 * A street has no name of its own: it is known by the biggest earner on it,
 * "the street by the Vibe Coder Studio". @see streetEarnings
 */
import { NEIGHBOUR } from "../../iso/dir";
import { idx, type Grid } from "../grid";
import { connects } from "./mask";

const DIRS = ["N", "E", "S", "W"] as const;

export type Streets = {
  /** The street each road tile is on, -1 for a junction or no road. */
  of: Int32Array;
  /** Each street's tiles, by its number. */
  tiles: number[][];
};

/** How many ways on a road tile has. */
const waysOn = (g: Grid, x: number, y: number) => DIRS.reduce((n, d) => n + (connects(g, x, y, d) ? 1 : 0), 0);

/** Wider than any road is: a tile the road runs on past this both ways is a junction. @see GenParams.roadWidth */
const WIDEST = 4;

/** How far the road runs through each tile, joined up, along one axis. */
function runs(g: Grid, along: "x" | "y"): Int32Array {
  const out = new Int32Array(g.w * g.h);
  const [back, on] = along === "x" ? (["N", "S"] as const) : (["E", "W"] as const);
  const [dx, dy] = NEIGHBOUR[on];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      if (out[i] || !waysOn(g, x, y) || connects(g, x, y, back)) continue;
      // From the start of a run, along it to its end, and every tile told the length.
      const run = [i];
      for (let cx = x, cy = y; connects(g, cx, cy, on); cx += dx, cy += dy) run.push(idx(g, cx + dx, cy + dy));
      for (const j of run) out[j] = run.length;
    }
  }
  return out;
}

export function streetsOf(g: Grid): Streets {
  const of = new Int32Array(g.w * g.h).fill(-1);
  const tiles: number[][] = [];
  // A JUNCTION is where the road runs on both ways further than any road is
  // wide: a crossing, a corner, the head of a T. Across a wide road is not one:
  // its lanes are the one street.
  const junction = new Uint8Array(g.w * g.h);
  const rx = runs(g, "x"), ry = runs(g, "y");
  for (let i = 0; i < junction.length; i++) if (rx[i] > WIDEST && ry[i] > WIDEST) junction[i] = 1;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y);
      if (of[i] >= 0 || junction[i] || !waysOn(g, x, y)) continue;
      const n = tiles.length, run = [i];
      of[i] = n;
      for (let q = 0; q < run.length; q++) {
        const c = run[q], cx = c % g.w, cy = (c - cx) / g.w;
        for (const d of DIRS) {
          if (!connects(g, cx, cy, d)) continue;
          const [dx, dy] = NEIGHBOUR[d];
          const j = idx(g, cx + dx, cy + dy);
          if (of[j] >= 0 || junction[j]) continue;
          of[j] = n;
          run.push(j);
        }
      }
      tiles.push(run);
    }
  }
  return { of, tiles };
}

/** A street's earnings, and its biggest earner. */
export type StreetEarning = { street: number; perSecond: number; best: number };

/**
 * WHAT EACH STREET EARNS: everything earned by the buildings whose doors open
 * onto it, a second, best first. `doors` is each building's door tile; a door
 * on a junction counts for the street it leads on to first.
 */
export function streetEarnings(
  g: Grid, streets: Streets, doors: ReadonlyMap<number, number>, earning: ReadonlyMap<number, number>,
): StreetEarning[] {
  const by = new Map<number, { perSecond: number; best: number; most: number }>();
  for (const [structure, amount] of earning) {
    const door = doors.get(structure);
    if (door === undefined || amount <= 0) continue;
    let street = streets.of[door];
    if (street < 0) {
      const x = door % g.w, y = (door - x) / g.w;
      for (const d of DIRS) {
        if (!connects(g, x, y, d)) continue;
        const [dx, dy] = NEIGHBOUR[d];
        street = streets.of[idx(g, x + dx, y + dy)];
        if (street >= 0) break;
      }
    }
    if (street < 0) continue;
    const e = by.get(street) ?? { perSecond: 0, best: structure, most: 0 };
    e.perSecond += amount;
    if (amount > e.most) { e.most = amount; e.best = structure; }
    by.set(street, e);
  }
  return [...by.entries()].map(([street, e]) => ({ street, perSecond: e.perSecond, best: e.best }))
    .sort((a, b) => b.perSecond - a.perSecond);
}
