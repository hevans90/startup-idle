/**
 * World v2 — MOPPING UP: sludge that has run out of the slop pit is cleaned
 * up by hand. Vibe coders leave their desks — so many for each tile of it,
 * and they produce nothing while they are out — walk to it, and drain it a
 * tile at a time until it is gone, then go back to work.
 *
 * A few walkers on the map stand for the whole crew: each does its share of
 * the crew's work where it stands. @see stepCleanup
 */
import { idx, type Grid, type Structure } from "../grid";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "../agents/roads";
import { sendOnJob, walkInto, type Mover, type Town } from "../agents/town";
import { drainAt, type WaterField } from "../water/field";
import { inPit, sludgeAt } from "./sludge";

/** Under this, half steps, a tile is dry enough to leave. */
export const CLEAN_MIN = 0.05;
/** Half steps a second one vibe coder takes off the tile they are mopping. */
export const CLEAN_RATE = 0.03;
/** Vibe coders called away for each tile under sludge. */
export const CLEANERS_PER_TILE = 2;
/** Walkers on the map, at most, however big the crew. */
export const MAX_WALKERS = 8;
/** How far from the pit sludge is looked for, tiles. */
const REACH = 16;
/** Seconds between one walker setting off and the next. */
const SEND_GAP = 0.6;

/**
 * VIBE CODERS AWAY MOPPING, as the scene last had it: the economy reads it
 * between frames. Live state; not saved. @see world-canvas
 */
let away = 0;
export const setCleanupAway = (n: number) => { away = n; };
export const cleanupAway = () => away;

/** Live state: the crew out, and when the next walker may set off. Not saved. */
export type Cleanup = { away: number; untilSend: number };
export const createCleanup = (): Cleanup => ({ away: 0, untilSend: 0 });

/** Tiles round the pit with sludge on them, outside it. */
export function wetTiles(field: WaterField, g: Grid, pit: Structure): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = Math.max(0, pit.y - REACH); y < Math.min(g.h, pit.y + pit.h + REACH); y++) {
    for (let x = Math.max(0, pit.x - REACH); x < Math.min(g.w, pit.x + pit.w + REACH); x++) {
      if (!inPit(g, x, y) && sludgeAt(field, x, y) > CLEAN_MIN) out.push({ x, y });
    }
  }
  return out;
}

const isCleaner = (m: Mover) => m.job?.role === "clean-go" || m.job?.role === "clean" || m.job?.role === "cleaning";
const tileOf = (g: Grid, i: number) => ({ x: i % g.w, y: (i / g.w) | 0 });

/** The nearest of `tiles` to a point that nobody else is on, or null. */
function nearestFree(tiles: readonly { x: number; y: number }[], x: number, y: number, taken: ReadonlySet<number>, g: Grid) {
  let best: { x: number; y: number } | null = null, bestD = Infinity;
  for (const t of tiles) {
    if (taken.has(idx(g, t.x, t.y))) continue;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

/** Walk a mover already on the ground over to a tile, to mop it on arrival. */
function walkOver(m: Mover, g: Grid, to: { x: number; y: number }): void {
  const line = [{ x: m.x, y: m.y }, { x: to.x, y: to.y }];
  m.line = line;
  m.at = new Float32Array([0, Math.hypot(to.x - m.x, to.y - m.y)]);
  m.s = 0;
  m.speed = 0;
  m.heading = Math.atan2(to.y - m.y, to.x - m.x);
  m.job = { site: idx(g, to.x, to.y), role: "clean" };
}

/**
 * One frame of the mop-up. `owned` is how many vibe coders there are; `from`
 * where they come out of — a vibe coder's workplace door, or anywhere on the
 * map when there is none. Run before `stepWorks`, which clears the arrivals.
 * Returns how many vibe coders are away from their desks for it.
 */
export function stepCleanup(
  c: Cleanup, town: Town, g: Grid, net: Network, field: WaterField, pit: Structure,
  owned: number, workplaces: readonly number[], dt: number,
): number {
  const wet = wetTiles(field, g, pit);
  c.away = Math.min(owned, wet.length * CLEANERS_PER_TILE);
  const places = placesOf(g, net);

  // ARRIVED at the door nearest the sludge: off the road, over to it.
  for (const m of town.arrived) {
    if (m.job?.role === "clean-go") {
      const to = tileOf(g, m.job.site);
      walkInto(town, g, m.path[m.path.length - 1], to, pit.id).job = { site: m.job.site, role: "clean" };
    } else if (m.job?.role === "clean") {
      // AT THE TILE: standing there, mopping. Back on the list it came off.
      town.movers.push({ ...m, s: 0, speed: 0, job: { site: m.job.site, role: "cleaning" } });
    }
  }

  const crew = town.movers.filter(isCleaner);
  const taken = new Set(crew.map((m) => m.job!.site));
  const standing = crew.filter((m) => m.job!.role === "cleaning");

  // MOPPING: each walker its share of the crew's work, on its own tile, and
  // when that is dry, on to the nearest tile nobody has.
  const share = standing.length ? c.away / standing.length : 0;
  for (const m of standing) {
    const t = tileOf(g, m.job!.site);
    if (sludgeAt(field, t.x, t.y) > CLEAN_MIN) {
      drainAt(field, t.x, t.y, CLEAN_RATE * share * dt);
      continue;
    }
    taken.delete(m.job!.site);
    const next = nearestFree(wet, m.x, m.y, taken, g);
    if (next) { walkOver(m, g, next); taken.add(idx(g, next.x, next.y)); }
  }

  // DONE: everybody back to work.
  if (!wet.length) {
    if (crew.length) {
      const home = places.find((p) => p.kind === "door" && workplaces.includes(p.structure ?? -1));
      town.movers = town.movers.filter((m) => !isCleaner(m));
      for (const m of crew) {
        const near = nearestPlace(places, m.x, m.y);
        if (near && home) sendOnJob(town, g, "person", near, home, { site: pit.id, role: "clean-back" });
      }
    }
    return c.away;
  }

  // SENT FOR, a walker at a time, while the crew is short of them: from a
  // vibe coder's workplace, along the roads, to the door nearest the sludge.
  c.untilSend -= dt;
  const want = Math.min(MAX_WALKERS, wet.length, c.away);
  let stuck = false;
  if (crew.length < want && c.untilSend <= 0) {
    c.untilSend = SEND_GAP;
    const from = places.find((p) => p.kind === "door" && workplaces.includes(p.structure ?? -1))
      ?? places.find((p) => p.kind === "gateway");
    const target = from && nearestFree(wet, from.x, from.y, taken, g);
    const to = target && nearestPlace(places.filter((p) => p.net === from!.net), target.x, target.y);
    if (from && target && to) {
      const m = sendOnJob(town, g, "person", from, to, { site: idx(g, target.x, target.y), role: "clean-go" });
      // Already at the door: straight over.
      if (!m) walkInto(town, g, to, target, pit.id).job = { site: idx(g, target.x, target.y), role: "clean" };
    } else stuck = true;
  }

  // NOBODY CAN GET THERE — no road to it, or none from work — and it is
  // mopped up anyway by whoever is out: the sludge must not stay for ever.
  if (!crew.length && c.away > 0 && stuck) {
    for (const t of wet) drainAt(field, t.x, t.y, (CLEAN_RATE * c.away * dt) / wet.length);
  }
  return c.away;
}

/** The door or way off the map nearest a point. */
function nearestPlace(places: readonly Place[], x: number, y: number): Place | null {
  let best: Place | null = null, bestD = Infinity;
  for (const p of places) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}
