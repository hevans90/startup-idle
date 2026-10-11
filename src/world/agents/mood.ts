/**
 * World v2 — HOW HAPPY EACH HOUSE IS, and what that does: the town drives
 * employee satisfaction, rather than a number nobody can see the cause of.
 *
 * A house's MOOD is the sum of what it lives with:
 *  - its COMMUTE: nothing within the free distance, then worse the more of
 *    the day it costs, and worst with no road to work at all;
 *  - its SERVICES: a café, a park and a gym in reach each lift it, and none
 *    at all drags it down;
 *  - the SLOP PIT, near it: the fuller, the worse;
 *  - CROWDING: a dense house — grown to III or a tower — with no park;
 *  - a WONDER near it, which people like living by.
 * Each kind of employee's satisfaction leans toward the mood of the houses
 * they live in, weighted by how many live in each. @see setTownMoodReader
 *
 * And an UNHAPPY house — at or below `MOVE_OUT_AT` — loses someone now and
 * then: still hired, but gone from there, and new arrivals will not move into
 * it. A neglected street empties; a good one fills. @see stepMood
 */
import { housedBy, residentsIn } from "../../game/housing";
import { projectForStructure } from "../../game/projects";
import type { GeneratorId } from "../../state/generators.store";
import type { Grid, Structure } from "../grid";
import type { Network } from "../roads/network";
import { liveCommutes, workplaceKind, type Commute } from "./commute";
import { liveCoverage, tierOf, type Coverage } from "./services";

/** What each thing adds to a house's mood, in satisfaction points. */
export const MOOD = {
  perTenthLost: -6,
  stranded: -30,
  cafe: 4,
  park: 6,
  gym: 4,
  noServices: -6,
  slopNear: -8,
  slopFull: -12,
  crowded: -6,
  wonder: 5,
  sludge: -15,
  flooded: -20,
} as const;
/** How near the slop pit and a wonder count, in tiles. */
export const SLOP_REACH = 6;
export const WONDER_REACH = 10;
/** A house's mood never goes past this, either way. */
export const MOOD_LIMIT = 40;
/** At or below this, people start to leave; one every this many seconds. */
export const MOVE_OUT_AT = -25;
export const MOVE_OUT_EVERY = 60;

/** What a house's mood is made of, each part signed. */
export type MoodParts = { total: number; parts: { why: string; points: number }[] };

/** Tiles between two footprints, the nearer edges, along either axis. */
function gap(a: Structure, b: Structure): number {
  const dx = Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1));
  const dy = Math.max(0, b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1));
  return Math.max(dx, dy);
}

/**
 * Every house's mood, by id, and what it is made of. `slopFill` is the pit's
 * fill, 0 to 1.
 */
export function moodsOf(
  g: Grid, commutes: ReadonlyMap<number, Commute>, coverage: Coverage, slopFill: number,
  sludged: ReadonlySet<number> = new Set(), flooded: ReadonlySet<number> = new Set(),
): Map<number, MoodParts> {
  const pits: Structure[] = [], wonders: Structure[] = [];
  // Kinds with somewhere to work: with none at all, there is no commute to
  // count against anybody's home. @see WORKPLACES
  const working = new Set<GeneratorId>();
  for (const s of g.structures.values()) {
    if (s.build) continue;
    if (s.def === "slop-pit") pits.push(s);
    if (projectForStructure(s.def)?.bonus) wonders.push(s);
    const w = workplaceKind(s.def);
    if (w) working.add(w);
  }
  const out = new Map<number, MoodParts>();
  for (const s of g.structures.values()) {
    if (!housedBy(s.def) || s.build) continue;
    const parts: MoodParts["parts"] = [];
    const c = working.has(housedBy(s.def)!.id) ? commutes.get(s.id) : undefined;
    if (c) {
      if (c.tiles === null) parts.push({ why: "no road to work", points: MOOD.stranded });
      else if (c.eff < 1) parts.push({ why: "long commute", points: Math.round(((1 - c.eff) * 10) * MOOD.perTenthLost) });
    }
    const have = coverage.get(s.id);
    if (!have?.size) parts.push({ why: "no services", points: MOOD.noServices });
    else {
      if (have.has("cafe")) parts.push({ why: "café", points: MOOD.cafe });
      if (have.has("park")) parts.push({ why: "park", points: MOOD.park });
      if (have.has("gym")) parts.push({ why: "gym", points: MOOD.gym });
    }
    if (pits.some((p) => gap(s, p) <= SLOP_REACH)) {
      parts.push({ why: "slop pit", points: Math.round(MOOD.slopNear + MOOD.slopFull * Math.max(0, Math.min(1, slopFill))) });
    }
    const tier = tierOf(s.def);
    if ((tier === "t2" || tier === "landmark") && !have?.has("park")) parts.push({ why: "crowded", points: MOOD.crowded });
    if (wonders.some((w) => gap(s, w) <= WONDER_REACH)) parts.push({ why: "near a wonder", points: MOOD.wonder });
    if (sludged.has(s.id)) parts.push({ why: "sludge", points: MOOD.sludge });
    if (flooded.has(s.id)) parts.push({ why: "flooded", points: MOOD.flooded });
    const total = Math.max(-MOOD_LIMIT, Math.min(MOOD_LIMIT, parts.reduce((n, p) => n + p.points, 0)));
    out.set(s.id, { total, parts });
  }
  return out;
}

/**
 * Each kind's lean: the mood of the houses its people live in, weighted by
 * how many live in each. Nothing for a kind with nobody on the map.
 */
export function moodOffsets(g: Grid, moods: ReadonlyMap<number, MoodParts>): Partial<Record<GeneratorId, number>> {
  const sum: Partial<Record<GeneratorId, number>> = {}, people: Partial<Record<GeneratorId, number>> = {};
  for (const s of g.structures.values()) {
    const h = housedBy(s.def), m = moods.get(s.id);
    if (!h || !m) continue;
    const n = residentsIn(s);
    if (!n) continue;
    sum[h.id] = (sum[h.id] ?? 0) + m.total * n;
    people[h.id] = (people[h.id] ?? 0) + n;
  }
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const id of Object.keys(sum) as GeneratorId[]) out[id] = sum[id]! / people[id]!;
  return out;
}

let memo: { g: Grid | null; rev: number; sites: number; fill: number; sludge: string; value: Map<number, MoodParts> } = {
  g: null, rev: -1, sites: -1, fill: -1, sludge: "", value: new Map(),
};

/**
 * Houses with the slop pit's sludge on them, as the scene last found them.
 * Kept here rather than worked out on every ask: it means reading the water.
 * @see sludgedHouses
 */
let sludged: ReadonlySet<number> = new Set();
export const setSludged = (s: ReadonlySet<number>) => { sludged = s; };
/** Houses a flood has reached and nothing kept dry, likewise. @see floodedNow */
let flooded: ReadonlySet<number> = new Set();
export const setFlooded = (s: ReadonlySet<number>) => { flooded = s; };

/**
 * Every house's mood on this map now, worked out again when the map, its
 * sites, or the slop pit's fill (to a twentieth) has changed. @see liveCommutes
 */
export function liveMoods(g: Grid, net: Network, slopFill: number): Map<number, MoodParts> {
  let sites = 0;
  for (const s of g.structures.values()) if (s.build) sites++;
  const fill = Math.round(Math.max(0, Math.min(1, slopFill)) * 20);
  const sludge = [...sludged].sort((a, b) => a - b).join(",") + "|" + [...flooded].sort((a, b) => a - b).join(",");
  if (memo.g !== g || memo.rev !== g.rev || memo.sites !== sites || memo.fill !== fill || memo.sludge !== sludge) {
    memo = { g, rev: g.rev, sites, fill, sludge, value: moodsOf(g, liveCommutes(g, net), liveCoverage(g, net), fill / 20, sludged, flooded) };
  }
  return memo.value;
}

/** Seconds each unhappy house has been so, by id. Live state; not saved. */
export type Unrest = Map<number, number>;

/**
 * One step of people leaving unhappy houses: one at a time, every
 * `MOVE_OUT_EVERY` seconds a house stays at or below `MOVE_OUT_AT`. Returns
 * the houses changed. Only houses with a count of their people — lots placed
 * in the game — lose anyone. @see Structure.residents
 */
export function stepMood(u: Unrest, g: Grid, moods: ReadonlyMap<number, MoodParts>, dt: number): number[] {
  const changed: number[] = [];
  for (const [id, m] of moods) {
    const s = g.structures.get(id);
    if (!s || s.residents === undefined || s.residents <= 0 || m.total > MOVE_OUT_AT) { u.delete(id); continue; }
    const t = (u.get(id) ?? 0) + dt;
    if (t >= MOVE_OUT_EVERY) {
      s.residents--;
      changed.push(id);
      u.set(id, 0);
    } else u.set(id, t);
  }
  return changed;
}

/** Whether a house is too unhappy for anyone new to move into. @see stepArrivals */
export const tooUnhappy = (m: MoodParts | undefined) => (m?.total ?? 0) <= MOVE_OUT_AT;

/** The tint a house is drawn with when the mood is shown: green to red. */
export const moodTint = (total: number) =>
  total >= 15 ? 0x8fe39a : total >= 0 ? 0xd6f2c4 : total > MOVE_OUT_AT ? 0xf5c46b : 0xf0706a;

/** A mood in a word. */
export const moodWord = (total: number) =>
  total >= 15 ? "Happy" : total >= 0 ? "Content" : total > MOVE_OUT_AT ? "Unhappy" : "Miserable";
