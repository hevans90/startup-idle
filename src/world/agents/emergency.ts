/**
 * World v2 — THE EMERGENCY SERVICES, on the roads: a fire engine and the
 * police to a building on fire, an ambulance to one a quake, a flood or the
 * heat has had. They come on from the edge of the map with their blue lights
 * going — the traffic pulls in for them and the junctions hold for them —
 * stand at the door a while, lights still turning, and drive off again
 * quietly. Only to what the town's own disasters do: nobody is called out for
 * nothing. @see events/damage, town giveWayToBlues
 *
 * Cosmetic: nothing here touches the damage or its repair.
 */
import type { DamageCause } from "../events/damage";
import type { Grid } from "../grid";
import { sendOnJob, stopHere, type Mover, type Town } from "./town";
import type { Place } from "./roads";

/** Who answers what. */
export const CALLS: Partial<Record<DamageCause, NonNullable<Mover["siren"]>[]>> = {
  fire: ["fire", "police"],
  quake: ["ambulance", "police"],
  flood: ["ambulance"],
  heat: ["ambulance"],
};

/** Seconds an emergency vehicle stands at the scene; how much faster than a car it goes on a call; at most this many on the roads. */
export const AT_SCENE = 30;
const HURRY = 1.3;
const MOST = 6;
/** Seconds between one service setting off and the next to the same call. */
const STAGGER = 4;

export type Emergency = {
  /** Each building called out to, and for what. */
  answered: Map<number, DamageCause>;
  /** Vehicles still to send: when, who, where. */
  queue: { at: number; siren: NonNullable<Mover["siren"]>; site: number }[];
  clock: number;
};

export const createEmergency = (): Emergency => ({ answered: new Map(), queue: [], clock: 0 });

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Where a call is answered from, or home to, best first: the ways onto the map on its roads, nearest first — or, with none, its farthest doors. */
function basesFor(places: readonly Place[], site: Place): Place[] {
  const same = places.filter((p) => p.net === site.net && p !== site);
  const gates = same.filter((p) => p.kind === "gateway").sort((p, q) => dist(p, site) - dist(q, site));
  return gates.length ? gates : same.sort((p, q) => dist(q, site) - dist(p, site)).slice(0, 4);
}

/** The first of `ends` there is a way to or from, sent: null if none. */
function sendVia(ends: readonly Place[], send: (p: Place) => Mover | null): Mover | null {
  for (const p of ends) { const m = send(p); if (m) return m; }
  return null;
}

/**
 * A step of the emergency services: new damage called in, the services sent
 * a few seconds apart, and those at the scene long enough sent home.
 */
export function stepEmergency(e: Emergency, t: Town, g: Grid, damaged: readonly [number, DamageCause][], dt: number): void {
  e.clock += dt;
  const now = new Map(damaged);
  for (const id of [...e.answered.keys()]) if (now.get(id) !== e.answered.get(id)) e.answered.delete(id);
  for (const [id, cause] of damaged) {
    if (e.answered.has(id)) continue;
    e.answered.set(id, cause);
    (CALLS[cause] ?? []).forEach((siren, k) => e.queue.push({ at: e.clock + k * STAGGER, siren, site: id }));
  }

  const doorOf = (id: number) => t.places.find((p) => p.kind === "door" && p.structure === id);
  // SENT, when their turn comes and there is room on the roads for them.
  const out = t.movers.filter((m) => m.siren).length;
  const due = e.queue.findIndex((q) => q.at <= e.clock);
  if (due >= 0 && out < MOST) {
    const [q] = e.queue.splice(due, 1);
    const door = g.structures.has(q.site) ? doorOf(q.site) : undefined;
    const m = door ? sendVia(basesFor(t.places, door), (from) => sendOnJob(t, g, "car", from, door, { site: q.site, role: "emergency" })) : null;
    if (m) { m.siren = q.siren; m.blues = true; m.cruise *= HURRY; }
  }

  // THERE ALREADY, one of the others: the next stops short behind it, its call answered there.
  for (const m of t.movers) {
    if (m.job?.role !== "emergency" || m.speed > 0.05 || m.at[m.at.length - 1] - m.s > 2) continue;
    const site = m.job.site;
    const behind = t.movers.some((o) => o !== m && o.siren && o.job?.site === site && (o.wait ?? 0) > 0 && dist(o, m) < 1.5);
    // (Stopped for that, not for a car beside it still pulling out.)
    const fx = Math.cos(m.heading), fy = Math.sin(m.heading);
    const beside = t.movers.some((o) => o !== m && !o.siren && o.kind !== "person" && dist(o, m) < 0.7
      && Math.abs((o.x - m.x) * fx + (o.y - m.y) * fy) < 0.4);
    if (behind && !beside) stopHere(m);
  }

  // AT THE SCENE: standing, lights going, then off home without them.
  for (const m of t.arrived) {
    if (m.job?.role !== "emergency" || !m.siren) continue;
    const here = doorOf(m.job.site) ?? t.places.find((p) => Math.round(p.x) === Math.round(m.x) && Math.round(p.y) === Math.round(m.y));
    if (!here) continue;
    const site = m.job.site;
    const back = sendVia(basesFor(t.places, here), (home) => sendOnJob(t, g, "car", here, home, { site, role: "emergency-back" }, m));
    if (!back) continue;
    back.siren = m.siren;
    back.colour = m.colour;
    back.side = m.side;
    back.x = m.x; back.y = m.y;
    back.wait = AT_SCENE;
  }
}

/** Whether a vehicle's blue lights are going: on a call, or stood at the scene. */
export const flashing = (m: Mover) => !!m.siren && (!!m.blues || (m.wait ?? 0) > 0);
