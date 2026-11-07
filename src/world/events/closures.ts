/**
 * World v2 — WHAT AN EVENT DOES TO THE STREETS AND HOMES, live: a junction
 * closed for road works, which no commute may cross; and homes on a tenants'
 * strike working at a share for a while. Read by the commutes, which work out
 * again whenever these change. Live state; not saved. @see ROAD_WORKS, TENANTS
 */
import type { Grid } from "../grid";
import { idx } from "../grid";
import { connects } from "../roads/mask";

const DIRS = ["N", "E", "S", "W"] as const;

let closed = new Set<number>();
let version = 0;

/** The road tiles closed now, by index; none to open them all. */
export function setClosed(tiles: Iterable<number>): void {
  const next = new Set(tiles);
  if (next.size === closed.size && [...next].every((t) => closed.has(t))) return;
  closed = next;
  version++;
}
export const isClosed = (i: number) => closed.has(i);
/** A number that changes whenever what is closed does. */
export const closuresVersion = () => version;

/** A junction: a road tile with three or more ways out. */
export function isJunction(g: Grid, x: number, y: number): boolean {
  let n = 0;
  for (const d of DIRS) if (connects(g, x, y, d)) n++;
  return n >= 3;
}

/**
 * THE BUSIEST JUNCTION: the one the most people live near — within `reach`
 * tiles, by their homes' residents. Null with none. @see ROAD_WORKS
 */
export function busiestJunction(g: Grid, homes: readonly { x: number; y: number; n: number }[], reach = 6): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, most = 0;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!isJunction(g, x, y)) continue;
      let n = 0;
      for (const h of homes) if (Math.abs(h.x - x) + Math.abs(h.y - y) <= reach) n += h.n;
      if (n > most) { most = n; best = { x, y }; }
    }
  }
  return best;
}
export const tileOf = (g: Grid, at: { x: number; y: number }) => idx(g, at.x, at.y);

/** Homes working at a share of a day's work, until a time: a tenants' strike. */
const houses = new Map<number, { share: number; until: number }>();
export function setHouseWork(ids: Iterable<number>, share: number, until: number): void {
  for (const id of ids) houses.set(id, { share, until });
  version++;
}
/** The share of its work a home does now: one, unless on strike. */
export function houseWork(id: number, now = Date.now()): number {
  const h = houses.get(id);
  if (!h) return 1;
  if (h.until <= now) { houses.delete(id); version++; return 1; }
  return h.share;
}
/** A new company: nothing closed, nobody on strike. */
export function resetClosures(): void {
  closed = new Set();
  houses.clear();
  version++;
}
