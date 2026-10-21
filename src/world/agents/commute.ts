/**
 * World v2 — GOING TO WORK: how far each house is from somewhere its people
 * can work, and what that costs the company.
 *
 * Each kind of employee works at the building that opened them — interns at
 * the Founder's Garage, vibe coders at the Studio, 10x devs at the Campus — or
 * at an OFFICE for their kind, which the player can build anywhere on the
 * road. A house's COMMUTE is the way along the roads from its door to the
 * nearest of those, in tiles; and a long commute is time not at a desk:
 *  - up to `FREE` tiles, nothing lost;
 *  - beyond, a little lost a tile, down to `WORST`;
 *  - and no road to any workplace at all, `STRANDED`.
 * So where housing goes, and where offices go, is a choice the economy feels:
 * a sprawling town with one office at the end of it works at half speed.
 *
 * AND EVERY WORKPLACE HAS SO MANY DESKS. People take the nearest free desk:
 * the closest house and workplace fill first, and a house whose nearest is
 * full commutes on to the next. When every desk of a kind is taken, the rest
 * work without one, at `DESKLESS`. So a growing company needs desks as it
 * needs beds — an office is room to work as well as a shorter walk.
 * @see commuteFactor, attendance
 *
 * People living off the map work remotely, and lose nothing.
 */
import { housedBy, residentsIn } from "../../game/housing";
import { NEIGHBOUR } from "../../iso/dir";
import type { GeneratorId } from "../../state/generators.store";
import { idx, type Grid } from "../grid";
import { connects } from "../roads/mask";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "./roads";
import { notable } from "../../game/machine";

/** Where each kind works: the building that opened them, and their offices. */
export const WORKPLACES: Record<GeneratorId, readonly string[]> = {
  intern: ["garage", "office-intern"],
  vibe_coder: ["studio", "office-vibe"],
  "10x_dev": ["campus", "office-10x"],
};

/** The kind a workplace is for, or null. */
export function workplaceKind(defId: string): GeneratorId | null {
  for (const [id, defs] of Object.entries(WORKPLACES)) if (defs.includes(defId)) return id as GeneratorId;
  return null;
}

/** Desks at each kind of workplace. @see seat */
export const DESKS: Record<string, number> = {
  garage: 20, "office-intern": 40,
  studio: 30, "office-vibe": 40,
  campus: 10, "office-10x": 10,
};
/** What people manage with no desk to go to: perched wherever they can. */
export const DESKLESS = 0.35;
/** And with the Machine's Night Shift: working the empty desks at night. @see game/machine "nightshift" */
export const NIGHT_SHIFT = 0.7;
export const desklessShare = (): number => (notable("nightshift") ? NIGHT_SHIFT : DESKLESS);

/** Tiles of commute that cost nothing, what each one past them costs, and the least a commute leaves. */
export const FREE = 8;
export const PER_TILE = 0.0125;
export const WORST = 0.5;
/** What people with no road to any workplace manage. */
export const STRANDED = 0.25;

/** The share of a day's work a commute of `tiles` leaves; `null` tiles is no way there. */
export const commuteEfficiency = (tiles: number | null): number =>
  tiles === null ? STRANDED : Math.max(WORST, Math.min(1, 1 - (tiles - FREE) * PER_TILE));

/**
 * One house's commute: how far its people go (to the desk most of them
 * have), what it leaves of their work — the commute for those with a desk,
 * DESKLESS for those without — where to, and how many found no desk.
 */
export type Commute = { tiles: number | null; eff: number; to: number | null; deskless: number };

const DIRS = ["N", "E", "S", "W"] as const;

/**
 * Every house's commute, by its id: a breadth-first search along the roads,
 * one per kind, from the doors of every finished workplace of that kind at
 * once — so each house finds its nearest in one pass, however many offices
 * there are.
 */
export function commutesOf(g: Grid, places: readonly Place[]): Map<number, Commute> {
  return seat(g, places).commutes;
}

/** Every house's commute, and how full each workplace is: desks taken, and desks. */
export type Seating = { commutes: Map<number, Commute>; desks: Map<number, { used: number; of: number }> };

/** What a step of road up or down a level — onto a ramp — counts for on the way to work: a hill town's walk is longer. */
export const CLIMB = 2;

/**
 * The walk along the roads from some doors to every cell, in tiles — a ramp
 * counting `CLIMB` — and -1 where there is no way.
 */
export function walkFrom(g: Grid, starts: readonly number[]): Int32Array {
  const dist = new Int32Array(g.w * g.h).fill(-1);
  // Steps of one or two: a bucket a distance, worked through in order.
  const buckets: number[][] = [[]];
  for (const i of starts) if (dist[i] < 0) { dist[i] = 0; buckets[0].push(i); }
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let q = 0; q < bucket.length; q++) {
      const i = bucket[q];
      if (dist[i] !== d) continue;
      const x = i % g.w, y = (i - x) / g.w;
      for (const dir of DIRS) {
        if (!connects(g, x, y, dir)) continue;
        const [dx, dy] = NEIGHBOUR[dir];
        const j = idx(g, x + dx, y + dy);
        // Onto a ramp is up or down a level. @see Grid.ramp
        const nd = d + (g.ramp[j] && !g.deck[j] ? CLIMB : 1);
        if (dist[j] >= 0 && dist[j] <= nd) continue;
        dist[j] = nd;
        (buckets[nd] ??= []).push(j);
      }
    }
  }
  return dist;
}

const roadsFrom = (g: Grid, start: number) => walkFrom(g, [start]);

/**
 * WHO SITS WHERE: each kind's people living on the map, given desks at its
 * finished workplaces, the nearest pairs of house and workplace first. A
 * search along the roads from each workplace's door — a town has a handful
 * of workplaces of a kind, and the roads are a few thousand cells.
 */
export function seat(g: Grid, places: readonly Place[]): Seating {
  const doorOf = new Map<number, Place>();
  for (const p of places) if (p.kind === "door" && p.structure !== undefined) doorOf.set(p.structure, p);
  const commutes = new Map<number, Commute>();
  const desks = new Map<number, { used: number; of: number }>();
  for (const who of Object.keys(WORKPLACES) as GeneratorId[]) {
    const houses = [...g.structures.values()].filter((s) => housedBy(s.def)?.id === who);
    const works = [...g.structures.values()].filter((s) => !s.build && workplaceKind(s.def) === who);
    for (const w of works) desks.set(w.id, { used: 0, of: DESKS[w.def] ?? 0 });
    if (!houses.length) continue;
    // Every house and workplace a road joins, nearest first.
    const pairs: { house: number; work: number; tiles: number }[] = [];
    for (const w of works) {
      const wd = doorOf.get(w.id);
      if (!wd) continue;
      const dist = roadsFrom(g, idx(g, wd.x, wd.y));
      for (const h of houses) {
        const hd = doorOf.get(h.id);
        const t = hd ? dist[idx(g, hd.x, hd.y)] : -1;
        if (t >= 0) pairs.push({ house: h.id, work: w.id, tiles: t });
      }
    }
    pairs.sort((a, b) => a.tiles - b.tiles || a.house - b.house);
    const left = new Map(houses.map((h) => [h.id, residentsIn(h)]));
    const sat = new Map<number, { work: number; tiles: number; n: number }[]>();
    for (const p of pairs) {
      const want = left.get(p.house) ?? 0, room = desks.get(p.work)!;
      const n = Math.min(want, room.of - room.used);
      if (n <= 0) continue;
      room.used += n;
      left.set(p.house, want - n);
      const list = sat.get(p.house) ?? [];
      list.push({ work: p.work, tiles: p.tiles, n });
      sat.set(p.house, list);
    }
    const reachable = new Set(pairs.map((p) => p.house));
    for (const h of houses) {
      const n = residentsIn(h), list = sat.get(h.id) ?? [], deskless = left.get(h.id) ?? 0;
      if (!reachable.has(h.id)) {
        // No road to anywhere its people could work.
        commutes.set(h.id, { tiles: null, eff: STRANDED, to: null, deskless: 0 });
        continue;
      }
      // An empty house: the commute its people would have, to the nearest.
      const nearest = pairs.find((p) => p.house === h.id)!;
      if (n === 0) {
        commutes.set(h.id, { tiles: nearest.tiles, eff: commuteEfficiency(nearest.tiles), to: nearest.work, deskless: 0 });
        continue;
      }
      const main = list.reduce<{ work: number; tiles: number; n: number } | null>((m, x) => (!m || x.n > m.n ? x : m), null);
      const work = list.reduce((sum, x) => sum + x.n * commuteEfficiency(x.tiles), 0) + deskless * desklessShare();
      commutes.set(h.id, {
        tiles: main?.tiles ?? nearest.tiles, eff: work / n, to: main?.work ?? nearest.work, deskless,
      });
    }
  }
  return { commutes, desks };
}

let memo: { g: Grid | null; rev: number; sites: number; people: string; value: Seating } = {
  g: null, rev: -1, sites: -1, people: "", value: { commutes: new Map(), desks: new Map() },
};

/**
 * Who sits where on this map now, worked out again only when the map has
 * been edited, a site has opened, or people have moved in or out — roads,
 * buildings and residents are what it depends on. Shared by the economy,
 * which asks every tick, and the labels. @see Grid.rev
 */
export function liveSeating(g: Grid, net: Network): Seating {
  // And the sites still going up: one opening is a new workplace, though
  // finishing a build is not an edit of the map.
  let sites = 0, a = 0, b = 0;
  for (const st of g.structures.values()) {
    if (st.build) sites++;
    if (housedBy(st.def)) { const n = residentsIn(st); a += n; b = (b * 31 + n * st.id) | 0; }
  }
  const people = `${a}:${b}`;
  if (memo.g !== g || memo.rev !== g.rev || memo.sites !== sites || memo.people !== people) {
    memo = { g, rev: g.rev, sites, people, value: seat(g, placesOf(g, net)) };
  }
  return memo.value;
}

/** Every house's commute on this map now. @see liveSeating */
export const liveCommutes = (g: Grid, net: Network): Map<number, Commute> => liveSeating(g, net).commutes;

/**
 * WHAT COMMUTING LEAVES of each kind's work: the share of a full day's work
 * its people do, averaged over everyone — those living on the map by their
 * house's commute, and those living off it, remotely, in full. One for a kind
 * with nobody here.
 */
export function commuteFactor(
  g: Grid, commutes: ReadonlyMap<number, Commute>,
  owned: Partial<Record<GeneratorId, number>>, remote: Partial<Record<string, number>>,
): Partial<Record<GeneratorId, number>> {
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const who of Object.keys(WORKPLACES) as GeneratorId[]) {
    // Remote beds count only as far as there are people in them.
    let people = Math.min(remote[who] ?? 0, owned[who] ?? 0), work = people;
    for (const s of g.structures.values()) {
      if (housedBy(s.def)?.id !== who) continue;
      const n = residentsIn(s);
      people += n;
      work += n * (commutes.get(s.id)?.eff ?? 1);
    }
    out[who] = people > 0 ? work / people : 1;
  }
  return out;
}
