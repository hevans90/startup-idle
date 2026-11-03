/**
 * World v2 — SERVICES, and housing that EVOLVES where it is good to live.
 *
 * Each service — opened by the town itself where it is needed — MEETS A NEED
 * of the homes within `RANGE` tiles of it along the roads, measured from door
 * to door like a commute; a need met is a large part of what makes a house
 * DESIRABLE. A house that is FULL GROWS into the next tier of its kind where
 * it stands — more beds on the same ground, for nothing — once it has stood
 * above that tier's desirability, with enough of its kind's needs met, for
 * `GROW_AFTER` seconds; and a house that grew and has fallen well below the
 * tier it grew to, or lost the needs it grew on, DECLINES one after
 * `DECLINE_AFTER` seconds, whoever no longer has a bed moving out (hired
 * still; they come back when there is room). Housing bought at a tier never
 * declines below it. @see GROW_AT, NEEDS_FOR, world/agents/desirability,
 * world/agents/town-services
 *
 * And 10X DEVS ARE PARTICULAR: they move only into a house desirable enough.
 * @see MOVE_IN_AT, stepArrivals
 */
import { housedBy, residentsIn } from "../../game/housing";
import type { GeneratorId } from "../../state/generators.store";
import { NEIGHBOUR } from "../../iso/dir";
import { idx, type Grid, type Structure } from "../grid";
import { connects } from "../roads/mask";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "./roads";
import { notable } from "../../game/machine";
import { fusionNow } from "../../game/fusion";
import { inAiDistrictNow } from "../ai/district";
import { DECLINE_MARGIN, GROW_AT, MOOD, NEED_WHY, needsCounted, type MoodParts } from "./mood-rules";
import { NEEDS, needsAt, serviceDef, type NeedId, serviceIn } from "./needs";
import { serviceOpen } from "./unlocks";

export { SERVICE_IDS, serviceIn, serviceOf, type NeedId, type ServiceId } from "./needs";

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

/** What need each house has met near it, by its id. */
export type Coverage = Map<number, Set<NeedId>>;

/** A house's own needs met, of its kind's. */
export const needsMet = (s: Structure, cover: Coverage): NeedId[] => {
  const who = housedBy(s.def)?.id;
  const have = cover.get(s.id);
  return who && have ? NEEDS[who].filter((n) => have.has(n)) : [];
};

const DIRS = ["N", "E", "S", "W"] as const;

/** How much further every service reaches: an Aesthete fused into the founder. @see game/fusion */
const reachNow = () => RANGE + fusionNow().serviceReach;

/**
 * What need is met at every house: a breadth-first search along the roads
 * from the doors of each need's services at once — buildings of their own,
 * and shops in the ground floors of houses — out to `RANGE`, and the houses
 * whose doors it reaches. A service `extra` says reaches further — the
 * Machine's Holo-Concierge — is searched apart, out to its own reach: one
 * search from doors of two reaches would number the roads wrong.
 * @see CONCIERGE_REACH
 *
 * A PARK WITH NO ROAD beside it is walked to across the grass: it serves the
 * homes within the same reach of it as the crow flies, edge to edge.
 */
export function coverageOf(g: Grid, places: readonly Place[], extra: (s: Structure) => number = () => 0, range = RANGE): Coverage {
  const doorOf = new Map<number, Place>();
  for (const p of places) if (p.kind === "door" && p.structure !== undefined) doorOf.set(p.structure, p);
  const out: Coverage = new Map();
  const groups = new Map<string, { need: NeedId; more: number; from: Structure[] }>();
  for (const s of g.structures.values()) {
    const sv = s.build ? null : serviceIn(s);
    // Not yet unlocked: standing, but the town does not count it. @see stepLadder
    if (!sv || !serviceOpen(g, sv) || !doorOf.has(s.id)) continue;
    const need = serviceDef(sv)!.need, more = extra(s), k = `${need}|${more}`;
    const grp = groups.get(k) ?? { need, more, from: [] };
    grp.from.push(s);
    groups.set(k, grp);
  }
  for (const { need, more, from } of groups.values()) {
    const dist = new Int32Array(g.w * g.h).fill(-1);
    const queue: number[] = [];
    for (const s of from) {
      const d = doorOf.get(s.id)!;
      const i = idx(g, d.x, d.y);
      if (dist[i] < 0) { dist[i] = 0; queue.push(i); }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % g.w, y = (i - x) / g.w;
      if (dist[i] >= range + more) continue;
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
      serve(out, s.id, need);
    }
  }
  // OFF THE ROADS, a park: the homes round it, as the crow flies.
  for (const park of g.structures.values()) {
    if (park.build || park.def !== "park" || doorOf.has(park.id) || !serviceOpen(g, "park")) continue;
    const reach = range + extra(park);
    for (const s of g.structures.values()) {
      if (housedBy(s.def) && gapBetween(park, s) <= reach) serve(out, s.id, "quiet");
    }
  }
  return out;
}

function serve(out: Coverage, house: number, need: NeedId) {
  let set = out.get(house);
  if (!set) out.set(house, (set = new Set()));
  set.add(need);
}

/** Tiles between two footprints, edge to edge: 0 for touching. */
function gapBetween(a: Structure, b: Structure): number {
  const gx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const gy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.max(gx, gy);
}

/** Road tiles further a Holo-Concierge's service reaches. @see game/machine "concierge" */
export const CONCIERGE_REACH = 4;
/** What a service in the AI's district reaches further, with the Holo-Concierge. */
const concierge = (g: Grid) => (s: Structure) => (notable("concierge") && inAiDistrictNow(g, s.x, s.y) ? CONCIERGE_REACH : 0);

/**
 * THE TOWN'S OWN CHANGES — a shop opening in a house, or closing — which no
 * edit to the map's layers bumps its `rev` for. What is worked out from the
 * services keys on this as well. @see stepTown
 */
let townRev = 0;
export const townChanged = () => { townRev++; };
export const townRevNow = () => townRev;

let memo: { g: Grid | null; rev: number; town: number; sites: number; reach: string; value: Coverage } = { g: null, rev: -1, town: -1, sites: -1, reach: "", value: new Map() };

/** What need is met at every house on this map now, worked out again only when it has changed. @see liveCommutes */
export function liveCoverage(g: Grid, net: Network): Coverage {
  let sites = 0;
  for (const s of g.structures.values()) if (s.build) sites++;
  // Which services reach further: the Holo-Concierge's, as the district grows. @see CONCIERGE_REACH
  const more = concierge(g);
  const range = reachNow();
  const reach = range + (notable("concierge") ? ":" + [...g.structures.values()].filter((s) => serviceIn(s) && more(s)).map((s) => s.id).join() : "");
  if (memo.g !== g || memo.rev !== g.rev || memo.town !== townRev || memo.sites !== sites || memo.reach !== reach) {
    memo = { g, rev: g.rev, town: townRev, sites, reach, value: coverageOf(g, placesOf(g, net), more, range) };
  }
  return memo.value;
}

/** Tiers dense enough to feel crowded without a park, to those who need quiet. @see MOOD.crowded */
const CROWDED: ReadonlySet<Tier> = new Set(["t2", "landmark"]);
/** Whether a kind minds crowding: those who need quiet. */
export const mindsCrowding = (defId: string) => {
  const who = housedBy(defId)?.id;
  return !!who && NEEDS[who].includes("quiet");
};

/**
 * A house's desirability AT ANOTHER TIER: crowding comes with density, so a
 * house growing into III without a park has the crowding to count against it
 * before it grows — or it would grow, find itself crowded, and decline.
 */
export function desirabilityAt(m: MoodParts, from: Tier, to: Tier, crowds = true): number {
  if (!crowds || m.parts.some((p) => p.why === NEED_WHY.quiet)) return m.total;
  const crowd = (t: Tier) => (CROWDED.has(t) ? MOOD.crowded : 0);
  return m.total - crowd(from) + crowd(to);
}

/** How much more desirable a house must get to grow, or null if it is at the top. */
export function growthShort(s: Structure, m: MoodParts | undefined): number | null {
  const t = tierOf(s.def);
  const k = t ? TIERS.indexOf(t) : -1;
  if (k < 0 || k >= TIERS.length - 1 || !m) return null;
  const next = TIERS[k + 1];
  return Math.max(0, GROW_AT[next] - desirabilityAt(m, t!, next, mindsCrowding(s.def)));
}

/** Which of its kind's needs a house still lacks to grow, or null if it is at the top or lacks none. */
export function needsShort(s: Structure, cover: Coverage, open: (n: NeedId) => boolean = () => true): NeedId[] | null {
  const t = tierOf(s.def), who = housedBy(s.def)?.id;
  const k = t ? TIERS.indexOf(t) : -1;
  if (!who || k < 0 || k >= TIERS.length - 1) return null;
  const met = needsMet(s, cover);
  if (met.length >= needsAt(who, TIERS[k + 1])) return null;
  // Only what the town can open yet: none, and it waits on the ladder. @see stepLadder
  return NEEDS[who].filter((n) => !met.includes(n) && open(n));
}

/** Seconds each house has been ready to grow, or lacking, by id. Live state; not saved. */
export type Evolution = { ready: Map<number, number>; lacking: Map<number, number> };
export const createEvolution = (): Evolution => ({ ready: new Map(), lacking: new Map() });

/**
 * One step of the town evolving: full houses desirable enough for the next
 * tier, with enough of their kind's needs met, grow into it; and houses that
 * grew and have fallen well below their tier, or lost the needs it wants,
 * decline one. Returns the houses changed. @see GROW_AFTER, DECLINE_AFTER, NEEDS_FOR
 */
export function stepEvolution(e: Evolution, g: Grid, moods: ReadonlyMap<number, MoodParts>, cover: Coverage, dt: number): number[] {
  const changed: number[] = [];
  for (const s of g.structures.values()) {
    const h = housedBy(s.def), t = tierOf(s.def), m = moods.get(s.id);
    if (!h || !t || s.build || !m) continue;
    const k = TIERS.indexOf(t), met = needsMet(s, cover).length;
    // GROWING: full, desirable enough for the next tier, and its needs met.
    const next = TIERS[k + 1];
    if (next && residentsIn(s) >= h.slots && met >= needsAt(h.id, next) && desirabilityAt(m, t, next, mindsCrowding(s.def)) >= GROW_AT[next]) {
      const r = (e.ready.get(s.id) ?? 0) + dt;
      e.ready.set(s.id, r);
      if (r >= GROW_AFTER) {
        s.def = withTier(s.def, next);
        s.grown = (s.grown ?? 0) + 1;
        e.ready.delete(s.id);
        changed.push(s.id);
      }
    } else e.ready.delete(s.id);
    // DECLINING: grown, and fallen well below the tier it grew to, or short of its needs.
    if ((s.grown ?? 0) > 0 && (m.total < GROW_AT[t] - DECLINE_MARGIN || met < needsAt(h.id, t))) {
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

/**
 * THE SHARE OF EACH KIND WITH EVERY NEED MET, by resident: what quickens its
 * work. @see needsBonus
 */
export function needsShare(g: Grid, moods: ReadonlyMap<number, MoodParts>): Partial<Record<GeneratorId, number>> {
  const all: Partial<Record<GeneratorId, number>> = {}, met: Partial<Record<GeneratorId, number>> = {};
  for (const s of g.structures.values()) {
    const h = s.build ? null : housedBy(s.def), n = h ? residentsIn(s) : 0;
    if (!h || !n) continue;
    all[h.id] = (all[h.id] ?? 0) + n;
    const m = moods.get(s.id);
    if (m && needsCounted(m) >= NEEDS[h.id].length) met[h.id] = (met[h.id] ?? 0) + n;
  }
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const [who, n] of Object.entries(all) as [GeneratorId, number][]) out[who] = (met[who] ?? 0) / n;
  return out;
}
