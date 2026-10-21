/**
 * World v2 — SERVICES, and housing that EVOLVES where it is good to live.
 *
 * A café, a park and a gym each SERVE the homes within `RANGE` tiles of it
 * along the roads — measured from door to door, like a commute — and serving
 * one is a large part of what makes a house DESIRABLE. A house that is FULL
 * GROWS into the next tier of its kind where it stands — more beds on the same
 * ground, for nothing — once it has stood above that tier's desirability for
 * `GROW_AFTER` seconds; and a house that grew and has fallen well below the
 * tier it grew to DECLINES one after `DECLINE_AFTER` seconds, whoever no
 * longer has a bed moving out (hired still; they come back when there is
 * room). Housing bought at a tier never declines below it. @see GROW_AT,
 * world/agents/desirability
 *
 * And 10X DEVS ARE PARTICULAR: they move only into a house desirable enough.
 * @see MOVE_IN_AT, stepArrivals
 */
import { housedBy, residentsIn } from "../../game/housing";
import { NEIGHBOUR } from "../../iso/dir";
import { idx, type Grid, type Structure } from "../grid";
import { connects } from "../roads/mask";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "./roads";
import { notable } from "../../game/machine";
import { inAiDistrictNow } from "../ai/district";
import { DECLINE_MARGIN, GROW_AT, MOOD, type MoodParts } from "./mood-rules";

export type ServiceId = "cafe" | "park" | "gym";
export const SERVICE_IDS: readonly ServiceId[] = ["cafe", "park", "gym"];
export const SERVICE_NAME: Record<ServiceId, string> = { cafe: "café", park: "park", gym: "gym" };

/** Road tiles a service reaches from its door. */
export const RANGE = 8;
/** Seconds a house must be ready before it grows, and lacking before it declines. */
export const GROW_AFTER = 20;
export const DECLINE_AFTER = 30;

/** The tiers of housing, in order. */
export const TIERS = ["t0", "t1", "t2", "landmark"] as const;
export type Tier = (typeof TIERS)[number];

export const tierOf = (defId: string): Tier | null =>
  (/\.(t0|t1|t2|landmark)$/.exec(defId)?.[1] as Tier | undefined) ?? null;
export const withTier = (defId: string, t: Tier) => defId.replace(/\.(t0|t1|t2|landmark)$/, `.${t}`);

/** Which service a structure is, if it is one. */
export const serviceOf = (defId: string): ServiceId | null =>
  (SERVICE_IDS as readonly string[]).includes(defId) ? (defId as ServiceId) : null;

/** What serves each house, by its id. */
export type Coverage = Map<number, Set<ServiceId>>;

const DIRS = ["N", "E", "S", "W"] as const;

/**
 * What serves every house: a breadth-first search along the roads from each
 * kind of service's doors at once, out to `RANGE`, and the houses whose doors
 * it reaches. A service `extra` says reaches further — the Machine's
 * Holo-Concierge — is searched apart, out to its own reach: one search from
 * doors of two reaches would number the roads wrong. @see CONCIERGE_REACH
 */
export function coverageOf(g: Grid, places: readonly Place[], extra: (s: Structure) => number = () => 0): Coverage {
  const doorOf = new Map<number, Place>();
  for (const p of places) if (p.kind === "door" && p.structure !== undefined) doorOf.set(p.structure, p);
  const out: Coverage = new Map();
  for (const service of SERVICE_IDS) {
    const groups = new Map<number, Structure[]>();
    for (const s of g.structures.values()) {
      if (s.build || serviceOf(s.def) !== service || !doorOf.has(s.id)) continue;
      const k = extra(s);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    for (const [more, from] of groups) {
      const dist = new Int32Array(g.w * g.h).fill(-1);
      const queue: number[] = [];
      for (const s of from) {
        const d = doorOf.get(s.id)!;
        const i = idx(g, d.x, d.y);
        if (dist[i] < 0) { dist[i] = 0; queue.push(i); }
      }
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q], x = i % g.w, y = (i - x) / g.w;
        if (dist[i] >= RANGE + more) continue;
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
  }
  return out;
}

/** Road tiles further a Holo-Concierge's service reaches. @see game/machine "concierge" */
export const CONCIERGE_REACH = 4;
/** What a service in the AI's district reaches further, with the Holo-Concierge. */
const concierge = (g: Grid) => (s: Structure) => (notable("concierge") && inAiDistrictNow(g, s.x, s.y) ? CONCIERGE_REACH : 0);

let memo: { g: Grid | null; rev: number; sites: number; reach: string; value: Coverage } = { g: null, rev: -1, sites: -1, reach: "", value: new Map() };

/** What serves every house on this map now, worked out again only when it has changed. @see liveCommutes */
export function liveCoverage(g: Grid, net: Network): Coverage {
  let sites = 0;
  for (const s of g.structures.values()) if (s.build) sites++;
  // Which services reach further: the Holo-Concierge's, as the district grows. @see CONCIERGE_REACH
  const more = concierge(g);
  const reach = notable("concierge") ? [...g.structures.values()].filter((s) => serviceOf(s.def) && more(s)).map((s) => s.id).join() : "";
  if (memo.g !== g || memo.rev !== g.rev || memo.sites !== sites || memo.reach !== reach) {
    memo = { g, rev: g.rev, sites, reach, value: coverageOf(g, placesOf(g, net), more) };
  }
  return memo.value;
}

/** Tiers dense enough to feel crowded without a park. @see MOOD.crowded */
const CROWDED: ReadonlySet<Tier> = new Set(["t2", "landmark"]);

/**
 * A house's desirability AT ANOTHER TIER: crowding comes with density, so a
 * house growing into III without a park has the crowding to count against it
 * before it grows — or it would grow, find itself crowded, and decline.
 */
export function desirabilityAt(m: MoodParts, from: Tier, to: Tier): number {
  const park = m.parts.some((p) => p.why === "park");
  if (park) return m.total;
  const crowd = (t: Tier) => (CROWDED.has(t) ? MOOD.crowded : 0);
  return m.total - crowd(from) + crowd(to);
}

/** How much more desirable a house must get to grow, or null if it is at the top. */
export function growthShort(s: Structure, m: MoodParts | undefined): number | null {
  const t = tierOf(s.def);
  const k = t ? TIERS.indexOf(t) : -1;
  if (k < 0 || k >= TIERS.length - 1 || !m) return null;
  const next = TIERS[k + 1];
  return Math.max(0, GROW_AT[next] - desirabilityAt(m, t!, next));
}

/** Seconds each house has been ready to grow, or lacking, by id. Live state; not saved. */
export type Evolution = { ready: Map<number, number>; lacking: Map<number, number> };
export const createEvolution = (): Evolution => ({ ready: new Map(), lacking: new Map() });

/**
 * One step of the town evolving: full houses desirable enough for the next
 * tier grow into it, and houses that grew and have fallen well below their
 * tier decline one. Returns the houses changed. @see GROW_AFTER, DECLINE_AFTER
 */
export function stepEvolution(e: Evolution, g: Grid, moods: ReadonlyMap<number, MoodParts>, dt: number): number[] {
  const changed: number[] = [];
  for (const s of g.structures.values()) {
    const h = housedBy(s.def), t = tierOf(s.def), m = moods.get(s.id);
    if (!h || !t || s.build || !m) continue;
    const k = TIERS.indexOf(t);
    // GROWING: full, and desirable enough for the next tier.
    const next = TIERS[k + 1];
    if (next && residentsIn(s) >= h.slots && desirabilityAt(m, t, next) >= GROW_AT[next]) {
      const r = (e.ready.get(s.id) ?? 0) + dt;
      e.ready.set(s.id, r);
      if (r >= GROW_AFTER) {
        s.def = withTier(s.def, next);
        s.grown = (s.grown ?? 0) + 1;
        e.ready.delete(s.id);
        changed.push(s.id);
      }
    } else e.ready.delete(s.id);
    // DECLINING: grown, and fallen well below the tier it grew to.
    if ((s.grown ?? 0) > 0 && m.total < GROW_AT[t] - DECLINE_MARGIN) {
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
