/**
 * World v2 — TEAM LEADERS, ON THE MAP: each one hired is a person in the town,
 * walking from a home of their kind to where their kind works, a spell there,
 * and home again. Gold shirts, and a tag with their name over them while they
 * are out. @see LeaderTags, team-leaders.store
 */
import type { GeneratorId } from "../../state/generators.store";
import { housedBy, residentsIn } from "../../game/housing";
import type { Grid } from "../grid";
import type { Network } from "../roads/network";
import { placesOf, type Place } from "./roads";
import { sendOnJob, type Town } from "./town";
import { WORKPLACES } from "./commute";

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

/** The door of a home of the leader's kind, picked by who they are, so it is the same one each time. */
function homeOf(g: Grid, places: readonly Place[], seat: LeaderSeat): Place | null {
  const doors = places.filter((p) => {
    const s = p.kind === "door" && p.structure !== undefined ? g.structures.get(p.structure) : undefined;
    return !!s && housedBy(s.def)?.id === seat.role && residentsIn(s) > 0;
  });
  return doors.length ? doors[hash(seat.id) % doors.length] : null;
}

/** The door of the first standing workplace of the leader's kind. */
function workOf(g: Grid, places: readonly Place[], seat: LeaderSeat): Place | null {
  return places.find((p) => {
    const s = p.kind === "door" && p.structure !== undefined ? g.structures.get(p.structure) : undefined;
    return !!s && !s.build && WORKPLACES[seat.role].includes(s.def);
  }) ?? null;
}

/**
 * One frame of the leaders. Run before `stepWorks`, which clears arrivals.
 * A leader with no home of their kind, or nowhere to work, stays off the map.
 */
export function stepLeaders(L: Leaders, town: Town, g: Grid, net: Network, seats: readonly LeaderSeat[], dt: number): void {
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
    const home = homeOf(g, places, seat), work = workOf(g, places, seat);
    if (!home || !work || home.net !== work.net) { here.wait = AT_HOME; return; }
    const [from, to] = here.place === "home" ? [home, work] : [work, home];
    const m = sendOnJob(town, g, "person", from, to, { site: k, role: "leader" });
    if (m) m.colour = SHIRT;
    else here.wait = AT_HOME;
  });
}
