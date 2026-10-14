/**
 * World v2 — TEAM LEADERS, ON THE MAP: each one hired is a person in the town,
 * walking from a home of their kind to where their kind works, a spell there,
 * and home again. Gold shirts, and a tag with their name over them while they
 * are out. @see LeaderTags, team-leaders.store
 */
import type { GeneratorId } from "../../state/generators.store";
import { housedBy, residentsIn } from "../../game/housing";
import { idx, type Grid } from "../grid";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "./roads";
import { sendOnJob, type Town } from "./town";
import { WORKPLACES, walkFrom } from "./commute";
import type { MoodParts } from "./mood-rules";

/** Seconds a leader spends at work, and at home, before setting off again. */
export const AT_WORK = 25;
export const AT_HOME = 12;
const SHIRT = 0xf2c230;

/** Who a leader is, as the town needs them. */
export type LeaderSeat = { id: string; role: GeneratorId };

/** Where each leader is: out walking, or waiting somewhere until a time. Live state; not saved. */
export type Leaders = { seats: string[]; at: Map<string, { place: "home" | "work"; wait: number }> };
export const createLeaders = (): Leaders => ({ seats: [], at: new Map() });

/** A stable number for a string, to pick a leader's home among many. */
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

/** What the people at a led workplace's desks add to their work, a leader; and the most leaders that count at one. */
export const LEAD_BOOST = 0.25;
export const LEADS_A_WORKPLACE = 2;

/**
 * WHERE THE LEADERS LIVE AND WHO THEY LEAD. A leader lives in the most
 * desirable home of their kind — the best of them, a leader each, round again
 * once every one has one — and leads the workplace nearest it along the
 * roads. So a good street beside a big office is where a leader is worth
 * most: their workplace's desks work `LEAD_BOOST` harder. @see leadShare
 */
export type Leadership = {
  /** Each leader's home and workplace, by leader id: structure ids. */
  of: Map<string, { home: number; work: number }>;
  /** Who leads each workplace, by its id: their names. */
  leads: Map<number, string[]>;
};

export function leadershipOf(
  g: Grid, places: readonly Place[], seats: readonly (LeaderSeat & { name?: string })[], moods: ReadonlyMap<number, MoodParts>,
): Leadership {
  const out: Leadership = { of: new Map(), leads: new Map() };
  const doorOf = new Map<number, Place>();
  for (const p of places) if (p.kind === "door" && p.structure !== undefined && !p.building) doorOf.set(p.structure, p);
  const k: Partial<Record<GeneratorId, number>> = {};
  for (const seat of seats) {
    const homes = [...g.structures.values()]
      .filter((s) => !s.build && housedBy(s.def)?.id === seat.role && residentsIn(s) > 0 && doorOf.has(s.id))
      .sort((a, b) => (moods.get(b.id)?.total ?? 0) - (moods.get(a.id)?.total ?? 0) || a.id - b.id);
    if (!homes.length) continue;
    const n = k[seat.role] ?? 0;
    k[seat.role] = n + 1;
    const home = homes[n % homes.length], door = doorOf.get(home.id)!;
    const walk = walkFrom(g, [idx(g, door.x, door.y)]);
    let work: number | null = null, best = Infinity;
    for (const s of g.structures.values()) {
      if (s.build || !WORKPLACES[seat.role].includes(s.def)) continue;
      const d = doorOf.get(s.id), t = d ? walk[idx(g, d.x, d.y)] : -1;
      if (t >= 0 && t < best) { best = t; work = s.id; }
    }
    if (work === null) continue;
    out.of.set(seat.id, { home: home.id, work });
    out.leads.set(work, [...(out.leads.get(work) ?? []), seat.name ?? seat.id]);
  }
  return out;
}

let memo: { g: Grid | null; rev: number; seats: string; moods: unknown; value: Leadership } = {
  g: null, rev: -1, seats: "", moods: null, value: { of: new Map(), leads: new Map() },
};

/** The leadership on this map now, worked out again when the map, the leaders or the moods change. */
export function liveLeadership(
  g: Grid, net: Network, seats: readonly (LeaderSeat & { name?: string })[], moods: ReadonlyMap<number, MoodParts>,
): Leadership {
  const key = seats.map((s) => s.id).join();
  if (memo.g !== g || memo.rev !== g.rev || memo.seats !== key || memo.moods !== moods) {
    memo = { g, rev: g.rev, seats: key, moods, value: leadershipOf(g, placesOf(g, net), seats, moods) };
  }
  return memo.value;
}

/** A structure's door, among the places. */
const doorAt = (places: readonly Place[], id: number) => places.find((p) => p.kind === "door" && p.structure === id && !p.building) ?? null;

/**
 * One frame of the leaders. Run before `stepWorks`, which clears arrivals.
 * A leader with no home of their kind, or nowhere to work, stays off the map.
 */
export function stepLeaders(L: Leaders, town: Town, g: Grid, net: Network, seats: readonly LeaderSeat[], lead: Leadership, dt: number): void {
  // WHO IS WHO: a seat a number, for the movers' jobs. Gone leaders leave the map.
  L.seats = seats.map((s) => s.id);
  for (const id of [...L.at.keys()]) if (!L.seats.includes(id)) L.at.delete(id);
  town.movers = town.movers.filter((m) => m.job?.role !== "leader" || m.job.site < L.seats.length);

  for (const m of town.arrived) {
    if (m.job?.role !== "leader") continue;
    const id = L.seats[m.job.site];
    const was = id ? L.at.get(id) : undefined;
    if (!id || !was) continue;
    L.at.set(id, was.place === "home" ? { place: "work", wait: AT_WORK } : { place: "home", wait: AT_HOME });
  }

  let places: Place[] | null = null;
  seats.forEach((seat, k) => {
    const out = town.movers.some((m) => m.job?.role === "leader" && m.job.site === k);
    if (out) return;
    const here = L.at.get(seat.id) ?? { place: "home" as const, wait: hash(seat.id) % AT_HOME };
    here.wait -= dt;
    L.at.set(seat.id, here);
    if (here.wait > 0) return;
    places ??= placesOf(g, net);
    const at = lead.of.get(seat.id);
    const home = at ? doorAt(places, at.home) : null, work = at ? doorAt(places, at.work) : null;
    if (!home || !work || home.net !== work.net) { here.wait = AT_HOME; return; }
    const [from, to] = here.place === "home" ? [home, work] : [work, home];
    const m = sendOnJob(town, g, "person", from, to, { site: k, role: "leader" });
    if (m) m.colour = SHIRT;
    else here.wait = AT_HOME;
  });
}
