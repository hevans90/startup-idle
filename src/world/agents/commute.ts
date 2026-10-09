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

/** Tiles of commute that cost nothing, what each one past them costs, and the least a commute leaves. */
export const FREE = 8;
export const PER_TILE = 0.0125;
export const WORST = 0.5;
/** What people with no road to any workplace manage. */
export const STRANDED = 0.25;

/** The share of a day's work a commute of `tiles` leaves; `null` tiles is no way there. */
export const commuteEfficiency = (tiles: number | null): number =>
  tiles === null ? STRANDED : Math.max(WORST, Math.min(1, 1 - (tiles - FREE) * PER_TILE));

/** One house's commute: how far, what it leaves of the work, and where to. */
export type Commute = { tiles: number | null; eff: number; to: number | null };

const DIRS = ["N", "E", "S", "W"] as const;

/**
 * Every house's commute, by its id: a breadth-first search along the roads,
 * one per kind, from the doors of every finished workplace of that kind at
 * once — so each house finds its nearest in one pass, however many offices
 * there are.
 */
export function commutesOf(g: Grid, places: readonly Place[]): Map<number, Commute> {
  const doorOf = new Map<number, Place>();
  for (const p of places) if (p.kind === "door" && p.structure !== undefined) doorOf.set(p.structure, p);
  const out = new Map<number, Commute>();
  for (const who of Object.keys(WORKPLACES) as GeneratorId[]) {
    const houses = [...g.structures.values()].filter((s) => housedBy(s.def)?.id === who);
    if (!houses.length) continue;
    const dist = new Int32Array(g.w * g.h).fill(-1);
    const from = new Int32Array(g.w * g.h).fill(-1);
    const queue: number[] = [];
    for (const s of g.structures.values()) {
      if (s.build || workplaceKind(s.def) !== who) continue;
      const d = doorOf.get(s.id);
      if (!d) continue;
      const i = idx(g, d.x, d.y);
      if (dist[i] >= 0) continue;
      dist[i] = 0; from[i] = s.id; queue.push(i);
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.w, y = (i - x) / g.w;
      for (const dir of DIRS) {
        if (!connects(g, x, y, dir)) continue;
        const [dx, dy] = NEIGHBOUR[dir];
        const j = idx(g, x + dx, y + dy);
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1; from[j] = from[i]; queue.push(j);
      }
    }
    for (const s of houses) {
      const d = doorOf.get(s.id);
      const i = d ? idx(g, d.x, d.y) : -1;
      const tiles = i >= 0 && dist[i] >= 0 ? dist[i] : null;
      out.set(s.id, { tiles, eff: commuteEfficiency(tiles), to: tiles === null ? null : from[i] });
    }
  }
  return out;
}

let memo: { g: Grid | null; rev: number; sites: number; value: Map<number, Commute> } = { g: null, rev: -1, sites: -1, value: new Map() };

/**
 * Every house's commute on this map now, worked out again only when the map
 * has been edited — roads and buildings are what it depends on. Shared by the
 * economy, which asks every tick, and the labels. @see Grid.rev
 */
export function liveCommutes(g: Grid, net: Network): Map<number, Commute> {
  // And the sites still going up: one opening is a new workplace, though
  // finishing a build is not an edit of the map.
  let sites = 0;
  for (const st of g.structures.values()) if (st.build) sites++;
  if (memo.g !== g || memo.rev !== g.rev || memo.sites !== sites) {
    memo = { g, rev: g.rev, sites, value: commutesOf(g, placesOf(g, net)) };
  }
  return memo.value;
}

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
