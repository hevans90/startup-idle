/**
 * World v2 — DESIRABILITY: how good a place a tile is to live, as one number
 * the player can read before they build. @see world/agents/mood
 *
 * It is the house's mood, and the same parts: the commute, the needs met in
 * reach, a view of water, a wonder nearby, and derelicts. A house
 * GROWS by it — a tier at each threshold, and back down when it falls below —
 * and new hires move in by it, so a good street fills and climbs and a bad one
 * stays lots. @see GROW_AT, stepEvolution
 *
 * And it can be asked of an EMPTY tile: what a house would get if it stood
 * there, from maps of every tile's road distance to what meets each need and
 * the workplaces. That is what the placing heat map shows. @see desireAt
 */
import { BEAUTY_MOOD, liveBeauty } from "./beauty";
import { NEIGHBOUR } from "../../iso/dir";
import { projectForStructure } from "../../game/projects";
import type { GeneratorId } from "../../state/generators.store";
import { idx, inBounds, type Grid, type Structure } from "../grid";
import { connects, isPaved } from "../roads/mask";
import type { Network } from "../roads/network";
import { cultureVersion } from "../../game/culture-now";
import { commuteEfficiency, walkFrom, WORKPLACES } from "./commute";
import { DERELICT_REACH, MOOD, MOOD_LIMIT, NEED_MOOD, NEED_WHY, WATER_REACH, WHY, WONDER_REACH, type MoodParts } from "./mood-rules";
import { fusionNow } from "../../game/fusion";
import { placesOf, type Place } from "./roads";
import { RANGE, serviceIn, townRevNow } from "./services";
import { NEED_KIND, NEEDS, serviceDef, type NeedId } from "./needs";
import { serviceOpen, wantsAny } from "./unlocks";

const DIRS = ["N", "E", "S", "W"] as const;

/** Road tiles from a set of starting cells to every cell, out to `reach`; -1 where there is no way. */
function roadsFrom(g: Grid, starts: readonly number[], reach = Infinity): Int32Array {
  const dist = new Int32Array(g.w * g.h).fill(-1);
  const queue: number[] = [];
  for (const i of starts) if (dist[i] < 0) { dist[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % g.w, y = (i - x) / g.w;
    if (dist[i] >= reach) continue;
    for (const dir of DIRS) {
      if (!connects(g, x, y, dir)) continue;
      const [dx, dy] = NEIGHBOUR[dir];
      const j = idx(g, x + dx, y + dy);
      if (dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

/** Everything a tile's desirability is read from, worked out once per map. */
export type DesireMaps = {
  /** Road distance from the doors of what meets each need, out to its range. */
  need: Record<NeedId, Int32Array>;
  /** Road distance from each kind's workplaces' doors; absent for a kind with none. */
  work: Partial<Record<GeneratorId, Int32Array>>;
  derelicts: Structure[];
  wonders: Structure[];
  /** Tiles with standing water within `WATER_REACH`. */
  water: Uint8Array;
  /** The level of the street each road tile is on, on the live map. @see liveBeauty */
  street?: Int8Array;
};

/** The maps, from the map and where its doors are. */
export function desireMapsOf(g: Grid, places: readonly Place[]): DesireMaps {
  const doorOf = new Map<number, Place>();
  for (const p of places) if (p.kind === "door" && p.structure !== undefined && !p.building) doorOf.set(p.structure, p);
  const doorsOf = (pred: (s: Structure) => boolean) => {
    const out: number[] = [];
    for (const s of g.structures.values()) {
      if (s.build || !pred(s)) continue;
      const d = doorOf.get(s.id);
      if (d) out.push(idx(g, d.x, d.y));
    }
    return out;
  };
  const need = {} as Record<NeedId, Int32Array>;
  for (const n of Object.keys(NEED_KIND) as NeedId[]) need[n] = roadsFrom(g, doorsOf((s) => { const sv = serviceIn(s); return !!sv && serviceOpen(g, sv) && serviceDef(sv)!.need === n; }), RANGE);
  const work: Partial<Record<GeneratorId, Int32Array>> = {};
  for (const [who, defs] of Object.entries(WORKPLACES) as [GeneratorId, readonly string[]][]) {
    const doors = doorsOf((s) => defs.includes(s.def));
    // The walk to work, climbs and all, as the commute counts it. @see walkFrom
    if (doors.length) work[who] = walkFrom(g, doors);
  }
  const derelicts: Structure[] = [], wonders: Structure[] = [];
  for (const s of g.structures.values()) {
    if (s.build) continue;
    if (s.def === "derelict") derelicts.push(s);
    if (projectForStructure(s.def)?.bonus) wonders.push(s);
  }
  const water = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!g.pool[idx(g, x, y)]) continue;
      for (let dy = -WATER_REACH; dy <= WATER_REACH; dy++) {
        for (let dx = -WATER_REACH; dx <= WATER_REACH; dx++) {
          if (inBounds(g, x + dx, y + dy)) water[idx(g, x + dx, y + dy)] = 1;
        }
      }
    }
  }
  return { need, work, derelicts, wonders, water };
}

let memo: { g: Grid | null; rev: number; town: number; sites: number; deck: number; value: DesireMaps | null } = { g: null, rev: -1, town: -1, sites: -1, deck: -1, value: null };

/** The maps for this map now, worked out again only when it has changed. */
export function liveDesireMaps(g: Grid, net: Network): DesireMaps {
  let sites = 0;
  for (const s of g.structures.values()) if (s.build) sites++;
  // And the culture deck: Shuttle Bus moves what a commute costs. @see CARDS
  const deck = cultureVersion();
  if (memo.g !== g || memo.rev !== g.rev || memo.town !== townRevNow() || memo.sites !== sites || memo.deck !== deck || !memo.value) {
    memo = { g, rev: g.rev, town: townRevNow(), sites, deck, value: { ...desireMapsOf(g, placesOf(g, net)), street: liveBeauty(g, net).tile } };
  }
  return memo.value!;
}

/** Tiles between a tile and a footprint, edge to edge. */
const gapTo = (x: number, y: number, s: Structure) =>
  Math.max(Math.max(0, s.x - x, x - (s.x + s.w - 1)), Math.max(0, s.y - y, y - (s.y + s.h - 1)));

/**
 * WHAT A HOUSE AT (x, y) WOULD GET, for the kind `who`: its door the nearest
 * road beside it, and each part as the mood counts it. Null where there is no
 * road beside the tile to have a door on.
 */
export function desireAt(g: Grid, maps: DesireMaps, x: number, y: number, who: GeneratorId): MoodParts | null {
  const doors: number[] = [];
  for (const dir of DIRS) {
    const [dx, dy] = NEIGHBOUR[dir];
    if (isPaved(g, x + dx, y + dy)) doors.push(idx(g, x + dx, y + dy));
  }
  if (!doors.length) return null;
  const best = (d: Int32Array) => doors.reduce((m, i) => (d[i] >= 0 && (m < 0 || d[i] < m) ? d[i] : m), -1);
  const parts: MoodParts["parts"] = [];
  const work = maps.work[who];
  if (work) {
    const t = best(work);
    const eff = commuteEfficiency(t < 0 ? null : t);
    if (t < 0) parts.push({ why: WHY.stranded, points: MOOD.stranded });
    else if (eff < 1) parts.push({ why: WHY.commute, points: Math.round((1 - eff) * 10 * MOOD.perTenthLost) });
  }
  const met = NEEDS[who].filter((n) => best(maps.need[n]) >= 0);
  if (!met.length && wantsAny(g, who)) parts.push({ why: WHY.unmet, points: MOOD.unmet });
  for (const n of met) parts.push({ why: NEED_WHY[n], points: NEED_MOOD[who] });
  if (maps.water[idx(g, x, y)]) parts.push({ why: WHY.waterView, points: fusionNow().waterView });
  // A Zoner fused into the founder, for every house. @see game/fusion
  if (fusionNow().houseDesire) parts.push({ why: WHY.planned, points: fusionNow().houseDesire });
  if (maps.wonders.some((w) => gapTo(x, y, w) <= WONDER_REACH)) parts.push({ why: WHY.wonder, points: MOOD.wonder });
  if (maps.derelicts.some((d) => gapTo(x, y, d) <= DERELICT_REACH)) parts.push({ why: WHY.derelict, points: MOOD.derelict });
  const fine = maps.street ? Math.max(0, ...doors.map((d) => maps.street![d])) : 0;
  if (fine > 0) parts.push({ why: WHY.street, points: BEAUTY_MOOD[fine] });
  const total = Math.max(-MOOD_LIMIT, Math.min(MOOD_LIMIT, parts.reduce((n, p) => n + p.points, 0)));
  return { total, parts };
}

/** Whether any tile of a footprint has a view of water. */
export function seesWater(maps: DesireMaps, g: Grid, s: Structure): boolean {
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (maps.water[idx(g, x, y)]) return true;
  return false;
}
