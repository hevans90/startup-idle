/**
 * World v2 — a seaport's QUAY: the side of it that is on the water.
 *
 * A port FACES the water. Its footprint is a length of quay along the bank and
 * two tiles of yard behind it; the side the quay is on is stored with it, and
 * its berths, its drawing and its gate all read that side. Every tile of the
 * quay has river beside it, so a port always has the berths its tier says.
 * @see plans/seaports.md §1
 *
 * THE BANK IS THE STANDING WATER'S, not this second's: where a port may go is
 * read off the grid's own pool, which a flood, a drought or a slosh does not
 * move. Boats still tie up on the river as it runs. @see steadyRivers
 */
import { NEIGHBOUR } from "../../iso/dir";
import { idx, inBounds, type Grid, type Structure } from "../grid";
import { mapRiver, poolDepthOf, riverAt, stepsFrom, type BerthSpot, type RiverMap } from "./river";

export type Facing = NonNullable<Structure["facing"]>;

/** The sides a quay may be on, the two the camera sees first. */
export const FACINGS: readonly Facing[] = ["W", "S", "E", "N"];
/** How deep a port is behind its quay, tiles. */
export const PORT_DEPTH = 2;
/** The most a bank may stand over the water for a quay to be cut into it, half steps. */
export const QUAY_MAX_DROP = 3;
/** How far in from its tile's middle toward the quay a boat ties up, tiles. */
const BERTH_IN = 0.2;

export type Rect = { x: number; y: number; w: number; h: number };

/** Whether a quay on this side runs along x. */
export const alongX = (f: Facing) => NEIGHBOUR[f][0] === 0;

/** The footprint of a port `length` tiles of quay long, facing `f`. */
export const portShape = (length: number, f: Facing) =>
  alongX(f) ? { w: length, h: PORT_DEPTH } : { w: PORT_DEPTH, h: length };

/** How many tiles of quay a footprint has on side `f`. */
export const quayLength = (r: Rect, f: Facing) => (alongX(f) ? r.w : r.h);

/** A tile of quay, the water tile it looks on, and the tile behind the port in line with it. */
export type QuayTile = { x: number; y: number; wx: number; wy: number; bx: number; by: number };

/** A footprint's quay on side `f`, in order along it. */
export function quayTiles(r: Rect, f: Facing): QuayTile[] {
  const [dx, dy] = NEIGHBOUR[f];
  const out: QuayTile[] = [];
  const depth = alongX(f) ? r.h : r.w;
  for (let k = 0; k < quayLength(r, f); k++) {
    const x = dx > 0 ? r.x + r.w - 1 : dx < 0 ? r.x : r.x + k;
    const y = dy > 0 ? r.y + r.h - 1 : dy < 0 ? r.y : r.y + k;
    out.push({ x, y, wx: x + dx, wy: y + dy, bx: x - dx * depth, by: y - dy * depth });
  }
  return out;
}

let steady: { g: Grid; rev: number; r: RiverMap } | null = null;

/**
 * The rivers as they normally stand: off the grid's standing water, kept
 * until the grid is next edited.
 */
export function steadyRivers(g: Grid): RiverMap {
  if (!steady || steady.g !== g || steady.rev !== g.rev) steady = { g, rev: g.rev, r: mapRiver(g, poolDepthOf(g)) };
  return steady.r;
}

/**
 * The river a quay is on: the first any tile of it looks on, or nought. A
 * tile of it looking on none, or on another, is off the water.
 */
export function quayRiver(r: RiverMap, quay: readonly QuayTile[]): number {
  for (const q of quay) { const k = riverAt(r, q.wx, q.wy); if (k) return k; }
  return 0;
}

/**
 * The height a quay is built at: a half step over the standing water beside
 * it. Null with no water beside it.
 */
export function quayLevel(g: Grid, quay: readonly QuayTile[]): number | null {
  let top = -Infinity;
  for (const q of quay) {
    if (!inBounds(g, q.wx, q.wy)) continue;
    const i = idx(g, q.wx, q.wy);
    if (g.pool[i] > 0) top = Math.max(top, g.height[i] + g.pool[i]);
  }
  return top === -Infinity ? null : Math.floor(top) + 1;
}

/**
 * Where boats tie up at a port: the river tiles along its quay, in order,
 * `n` of them at most, spread along it. On the rivers handed in, so a tile
 * of quay the water has left for now has no berth.
 */
export function berthsAlong(r: RiverMap, s: Rect, f: Facing, n: number): BerthSpot[] {
  const [dx, dy] = NEIGHBOUR[f];
  const all: BerthSpot[] = [];
  for (const q of quayTiles(s, f)) {
    const river = riverAt(r, q.wx, q.wy);
    if (river && (!all.length || all[0].river === river)) all.push({ tx: q.wx, ty: q.wy, x: q.wx - dx * BERTH_IN, y: q.wy - dy * BERTH_IN, river });
  }
  if (all.length <= n) return all;
  if (n === 1) return [all[(all.length - 1) >> 1]];
  return Array.from({ length: n }, (_, k) => all[Math.round((k * (all.length - 1)) / (n - 1))]);
}

/**
 * The side of a port with the most river along it: its quay, for one saved
 * before ports faced the water. The camera's sides first on a tie.
 */
export function bestFacing(r: RiverMap, s: Rect): Facing {
  let best: Facing = FACINGS[0], most = -1;
  for (const f of FACINGS) {
    const n = quayTiles(s, f).filter((q) => riverAt(r, q.wx, q.wy)).length;
    if (n > most) { best = f; most = n; }
  }
  return best;
}

/** Give every seaport without a facing the side its water is on. For a map just loaded. */
export function facePorts(g: Grid, isPort: (s: Structure) => boolean): void {
  let r: RiverMap | null = null;
  for (const s of g.structures.values()) {
    if (s.facing || !isPort(s)) continue;
    r ??= mapRiver(g, poolDepthOf(g));
    s.facing = bestFacing(r, s);
  }
}

/**
 * The way a boat comes to a berth: river tiles from where the river comes in
 * to the water tile `at`, in order. Empty when no boat can get there.
 */
export function channelTo(r: RiverMap, at: { x: number; y: number }): { x: number; y: number }[] {
  const river = riverAt(r, at.x, at.y);
  if (!river) return [];
  const steps = stepsFrom(r, [at]);
  let from: { x: number; y: number } | null = null, least = Infinity;
  for (const s of r.sources) {
    const d = s.river === river ? steps[s.y * r.w + s.x] : Infinity;
    if (d < least) { from = s; least = d; }
  }
  if (!from) return [];
  const out = [{ x: from.x, y: from.y }];
  let { x, y } = from;
  while (steps[y * r.w + x] > 0) {
    let next: { x: number; y: number } | null = null;
    for (const [dx, dy] of Object.values(NEIGHBOUR)) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
      if (steps[ny * r.w + nx] === steps[y * r.w + x] - 1) { next = { x: nx, y: ny }; break; }
    }
    if (!next) return [];
    out.push(next);
    ({ x, y } = next);
  }
  return out;
}
