/**
 * World v2 — SERVICES, and housing that EVOLVES around them. Caesar's loop.
 *
 * A café, a park and a gym each SERVE the homes within `RANGE` tiles of it
 * along the roads — measured from door to door, like a commute. A house that
 * is FULL and served well enough GROWS into the next tier of its kind where it
 * stands — more beds on the same ground, for nothing — once it has been so for
 * `GROW_AFTER` seconds:
 *  - a lot grows to II with a café;
 *  - II to III with a café and a park;
 *  - III to a tower with a café, a park and a gym.
 * A house that GREW and has lost what its tier needs DECLINES a tier after
 * `DECLINE_AFTER` seconds, and whoever no longer has a bed moves out — they
 * are hired still, and come back when there is room. Housing bought at a tier
 * never declines below it: only growth is given back. @see Structure.grown
 *
 * And 10X DEVS ARE PARTICULAR: they move only into a lot served by a café and
 * a park. @see stepArrivals
 */
import { housedBy, residentsIn } from "../../game/housing";
import { NEIGHBOUR } from "../../iso/dir";
import type { GeneratorId } from "../../state/generators.store";
import { idx, type Grid, type Structure } from "../grid";
import { connects } from "../roads/mask";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "./roads";

export type ServiceId = "cafe" | "park" | "gym";
export const SERVICE_IDS: readonly ServiceId[] = ["cafe", "park", "gym"];
export const SERVICE_NAME: Record<ServiceId, string> = { cafe: "café", park: "park", gym: "gym" };

/** Road tiles a service reaches from its door. */
export const RANGE = 8;
/** Seconds a house must be ready before it grows, and lacking before it declines. */
export const GROW_AFTER = 20;
export const DECLINE_AFTER = 30;

/** The tiers of housing, in order, and what each needs to grow INTO it. */
export const TIERS = ["t0", "t1", "t2", "landmark"] as const;
export type Tier = (typeof TIERS)[number];
export const NEEDS: Record<Tier, readonly ServiceId[]> = {
  t0: [],
  t1: ["cafe"],
  t2: ["cafe", "park"],
  landmark: ["cafe", "park", "gym"],
};
/** What a kind needs before it will move in at all. */
export const MOVE_IN_NEEDS: Partial<Record<GeneratorId, readonly ServiceId[]>> = { "10x_dev": ["cafe", "park"] };

export const tierOf = (defId: string): Tier | null =>
  (/\.(t0|t1|t2|landmark)$/.exec(defId)?.[1] as Tier | undefined) ?? null;
const withTier = (defId: string, t: Tier) => defId.replace(/\.(t0|t1|t2|landmark)$/, `.${t}`);

/** Which service a structure is, if it is one. */
export const serviceOf = (defId: string): ServiceId | null =>
  (SERVICE_IDS as readonly string[]).includes(defId) ? (defId as ServiceId) : null;

/** What serves each house, by its id. */
export type Coverage = Map<number, Set<ServiceId>>;

const DIRS = ["N", "E", "S", "W"] as const;

/**
 * What serves every house: a breadth-first search along the roads from each
 * kind of service's doors at once, out to `RANGE`, and the houses whose doors
 * it reaches.
 */
export function coverageOf(g: Grid, places: readonly Place[]): Coverage {
  const doorOf = new Map<number, Place>();
  for (const p of places) if (p.kind === "door" && p.structure !== undefined) doorOf.set(p.structure, p);
  const out: Coverage = new Map();
  for (const service of SERVICE_IDS) {
    const dist = new Int32Array(g.w * g.h).fill(-1);
    const queue: number[] = [];
    for (const s of g.structures.values()) {
      if (s.build || serviceOf(s.def) !== service) continue;
      const d = doorOf.get(s.id);
      if (!d) continue;
      const i = idx(g, d.x, d.y);
      if (dist[i] < 0) { dist[i] = 0; queue.push(i); }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.w, y = (i - x) / g.w;
      if (dist[i] >= RANGE) continue;
      for (const dir of DIRS) {
        if (!connects(g, x, y, dir)) continue;
        const [dx, dy] = NEIGHBOUR[dir];
        const j = idx(g, x + dx, y + dy);
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1; queue.push(j);
      }
    }
    for (const s of g.structures.values()) {
      if (!housedBy(s.def)) continue;
      const d = doorOf.get(s.id);
      if (!d || dist[idx(g, d.x, d.y)] < 0) continue;
      let set = out.get(s.id);
      if (!set) out.set(s.id, (set = new Set()));
      set.add(service);
    }
  }
  return out;
}

let memo: { g: Grid | null; rev: number; sites: number; value: Coverage } = { g: null, rev: -1, sites: -1, value: new Map() };

/** What serves every house on this map now, worked out again only when it has changed. @see liveCommutes */
export function liveCoverage(g: Grid, net: Network): Coverage {
  let sites = 0;
  for (const s of g.structures.values()) if (s.build) sites++;
  if (memo.g !== g || memo.rev !== g.rev || memo.sites !== sites) {
    memo = { g, rev: g.rev, sites, value: coverageOf(g, placesOf(g, net)) };
  }
  return memo.value;
}

/** Whether a set of services meets a list of needs. */
export const meets = (have: ReadonlySet<ServiceId> | undefined, need: readonly ServiceId[]) =>
  need.every((n) => have?.has(n));

/** What a house is short of to grow, or null if it is at the top. */
export function growthNeeds(s: Structure, coverage: Coverage): ServiceId[] | null {
  const t = tierOf(s.def);
  const k = t ? TIERS.indexOf(t) : -1;
  if (k < 0 || k >= TIERS.length - 1) return null;
  const have = coverage.get(s.id);
  return NEEDS[TIERS[k + 1]].filter((n) => !have?.has(n));
}

/** Seconds each house has been ready to grow, or lacking, by id. Live state; not saved. */
export type Evolution = { ready: Map<number, number>; lacking: Map<number, number> };
export const createEvolution = (): Evolution => ({ ready: new Map(), lacking: new Map() });

/**
 * One step of the town evolving: houses that are full and served grow a
 * tier, houses that grew and have lost their services decline one. Returns
 * the houses changed. @see GROW_AFTER, DECLINE_AFTER
 */
export function stepEvolution(e: Evolution, g: Grid, coverage: Coverage, dt: number): number[] {
  const changed: number[] = [];
  for (const s of g.structures.values()) {
    const h = housedBy(s.def), t = tierOf(s.def);
    if (!h || !t || s.build) continue;
    const k = TIERS.indexOf(t), have = coverage.get(s.id);
    // GROWING: full, and served for the next tier.
    const next = TIERS[k + 1];
    if (next && residentsIn(s) >= h.slots && meets(have, NEEDS[next])) {
      const r = (e.ready.get(s.id) ?? 0) + dt;
      e.ready.set(s.id, r);
      if (r >= GROW_AFTER) {
        s.def = withTier(s.def, next);
        s.grown = (s.grown ?? 0) + 1;
        e.ready.delete(s.id);
        changed.push(s.id);
      }
    } else e.ready.delete(s.id);
    // DECLINING: grown, and no longer served for the tier it grew to.
    if ((s.grown ?? 0) > 0 && !meets(have, NEEDS[t])) {
      const l = (e.lacking.get(s.id) ?? 0) + dt;
      e.lacking.set(s.id, l);
      if (l >= DECLINE_AFTER) {
        s.def = withTier(s.def, TIERS[k - 1]);
        s.grown = (s.grown ?? 1) - 1;
        if (!s.grown) delete s.grown;
        const slots = housedBy(s.def)!.slots;
        if (s.residents !== undefined) s.residents = Math.min(s.residents, slots);
        e.lacking.delete(s.id);
        changed.push(s.id);
      }
    } else e.lacking.delete(s.id);
  }
  return changed;
}
