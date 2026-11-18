/**
 * World v2 — A JOB'S MACHINES COME FROM THE YARD, AND GO HOME. Whatever is
 * built off the road — a line, a road, a site's groundworks — its plant is
 * the company's: kept under the yard's shed, sent out one after another
 * through the town when the job is ordered, and the job not worked till they
 * are there; and when it is done they gather at the road and go home the same
 * way, and only then is the job over. On the road each is a mover; across the
 * job the job's own drawing drives it (@see render/plant-kit `follow`), from
 * the very place its mover stopped. Nothing is set down; nothing taken up.
 */
import {
  FLEET_TIPPER_EMPTY_COLOUR, PLANT_CRANE_COLOUR, PLANT_LOADER_COLOUR, PLANT_MIXER_COLOUR, PLANT_PICKUP_COLOUR,
} from "../agents/cars/fleet";
import { placesOf, type Place } from "../agents/roads";
import { setOff, type Mover, type Town } from "../agents/town";
import type { Grid } from "../grid";
import type { Network } from "../roads/network";
import { isYard, plantComing, plantOut } from "./fleet";

/** A machine as it travels: the crane; a mixer; a low-loader, with a digger or a roller or a paver on it; the gang's pickup; a tipper, empty. */
export type PlantKind = "crane" | "mixer" | "loader" | "pickup" | "tipper";
/**
 * A job's machines: which are still to set off, and seconds till the next does; whether they are all there; and,
 * the job done, seconds since and which are still to set off home. Where each stopped at the road as it came, by
 * its paint; where the one setting off home now is to drive to — where its way on the road begins; and the road
 * tile they come to.
 */
export type Plant = {
  queue: PlantKind[]; t: number; here: boolean; leaving?: number; home?: PlantKind[];
  at?: { colour: number; x: number; y: number; heading: number }[];
  to?: { kind: PlantKind; x: number; y: number; heading: number };
  head?: { x: number; y: number };
};
/** Each kind's paint on the road: its model, and how one that has come is told. @see cars/fleet */
export const PLANT_COLOUR: Readonly<Record<PlantKind, number>> = {
  crane: PLANT_CRANE_COLOUR, mixer: PLANT_MIXER_COLOUR, loader: PLANT_LOADER_COLOUR, pickup: PLANT_PICKUP_COLOUR, tipper: FLEET_TIPPER_EMPTY_COLOUR,
};
/** Seconds between one machine setting off and the next; seconds a finished job's machines take to gather at the road before the first goes home. */
export const PLANT_GAP = 1.8, PLANT_GATHER = 6;
/** Which job a machine is for: a line's, a road's, a site's. Their numbers are their own, so the kind is told too. */
export type PlantRole = "plant" | "road-plant" | "site-plant";

/** The machine waiting at the road to go home, its way found: held till it has driven to where that begins. By job. */
const going = new Map<string, Mover>();

/**
 * A FRAME OF A JOB'S MACHINES. `host` keeps them (`plant`); `head` is the road tile they come to, or null with
 * none; `kinds` what it sends for; `started`, that the job was under way before this looked (a map loaded with it
 * half built: they are on it); `hold`, that it is not yet to let them go home (its lorries are still on it).
 * Says where it has got to: `wait` (not worked yet), `work`, `leaving` (done — `host.plant.leaving` set by its
 * owner — its machines going), `gone` (to be taken off its list). `none` for a job nothing comes to by road.
 */
export function stepPlant(
  g: Grid, haul: { net: Network; town: Town }, host: { plant?: false | Plant }, key: { id: number; role: PlantRole },
  head: Place | null, kinds: readonly PlantKind[], started: boolean, dt: number, hold = false,
): "none" | "wait" | "work" | "leaving" | "gone" {
  if (host.plant === false || !kinds.length) return "none";
  const from = head && yardOn(g, placesOf(g, haul.net), head);
  const ok = !!head && !!from && (from.x !== head.x || from.y !== head.y);
  if (!host.plant) {
    if (!ok || started) { host.plant = ok ? { queue: [], t: 0, here: true, head: { x: head!.x, y: head!.y } } : false; return ok ? "work" : "none"; }
    host.plant = { queue: [...kinds], t: 0, here: false, head: { x: head!.x, y: head!.y } };
  }
  const p = host.plant, name = `${key.role}:${key.id}`;
  // THOSE THAT HAVE GOT THERE: where each stopped is where it sets out across the job from.
  for (let k = haul.town.arrived.length - 1; k >= 0; k--) {
    const m = haul.town.arrived[k];
    if (m.job?.role !== key.role || m.job.site !== key.id) continue;
    haul.town.arrived.splice(k, 1);
    if (!m.gone) (p.at ??= []).push({ colour: m.colour, x: m.x, y: m.y, heading: m.heading });
  }
  if (p.leaving !== undefined) {
    p.leaving += dt;
    p.home ??= [...kinds];
    if (p.leaving >= PLANT_GATHER && p.home.length && !hold) {
      if (!p.to) {
        // THE NEXT OF THEM OFF: its way home found, and where that begins is where it drives to from where it stands.
        const kind = p.home[0], next = ok ? setOff(haul.town, g, "truck", head!, from!) : null;
        if (next) going.set(name, next); else going.delete(name);
        p.to = { kind, x: next?.x ?? p.head?.x ?? 0, y: next?.y ?? p.head?.y ?? 0, heading: next?.heading ?? 0 };
        p.t = PLANT_GAP;
      } else {
        p.t -= dt;
        if (p.t <= 0) {
          const next = going.get(name);
          going.delete(name);
          if (next) { next.colour = PLANT_COLOUR[p.to.kind]; next.job = { site: key.id, role: "haul-back" }; haul.town.movers.push(next); }
          p.home.shift();
          p.to = undefined;
        }
      }
    }
    return p.home.length ? "leaving" : "gone";
  }
  if (p.here) return "work";
  // (Its road gone from under it since: they are counted as there.)
  if (!ok) { p.queue = []; p.here = true; return "work"; }
  p.t -= dt;
  // (Each out of the yard's shed and through its gate, and so onto the road. @see fleet plantOut)
  if (p.queue.length && p.t <= 0) { plantOut(g, haul.town, from!, head!, { site: key.id, role: key.role }, PLANT_COLOUR[p.queue.shift()!]); p.t = PLANT_GAP * 1.3; }
  const onRoad = haul.town.movers.some((m) => m.job?.role === key.role && m.job.site === key.id && !haul.town.arrived.includes(m)) || plantComing(haul.town, name);
  if (!p.queue.length && !onRoad) p.here = true;
  return p.here ? "work" : "wait";
}

/** The yard nearest a place on its roads; null with none: a job's machines come from a yard or not at all. */
function yardOn(g: Grid, places: readonly Place[], at: Place): Place | null {
  let best: Place | null = null, bestD = Infinity;
  for (const pl of places) {
    if (pl.net !== at.net || !isYard(g, pl)) continue;
    const d = Math.abs(pl.x - at.x) + Math.abs(pl.y - at.y);
    if (d < bestD) { best = pl; bestD = d; }
  }
  return best;
}
