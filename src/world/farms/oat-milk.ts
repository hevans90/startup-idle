/**
 * World v2 — OAT MILK: what every farm makes besides its harvest's pay.
 *
 * - Each field cut makes a unit, into its farm's SILO (60 at most; past that the harvest is only sold).
 * - Each unit is a VAN, one at a time from the silo — three a farm on the road at most — to the café or kombucha
 *   bar in its road's reach with the least stock, until every one is full.
 * - A café holds three units and uses one a season (15 minutes of play). While it has any it serves oat flat
 *   whites: the desks it reaches work harder, and it reaches further. @see deskPerks
 *
 * Live state of the session, not saved: a reload starts every silo and café empty. @see plans/farms-and-flood-walls.md §3
 */
import { OAT_VAN_COLOUR } from "../agents/cars/fleet";
import type { Network } from "../roads/network";
import { placesOf } from "../agents/roads";
import { serviceDef, serviceIn } from "../agents/needs";
import { sendOnJob, type Town } from "../agents/town";
import { serviceOpen } from "../agents/unlocks";
import { YEAR_SECONDS } from "../calendar";
import type { Grid, Structure } from "../grid";

/** The most a farm's silo holds. */
export const SILO_CAP = 60;
/** The most vans one farm has on the road at once. */
export const VANS_A_FARM = 3;
/** The most a café holds, and how long a unit lasts it: a season. */
export const CAFE_HOLDS = 3;
export const UNIT_SECONDS = YEAR_SECONDS / 4;
/** What a stocked café's coffee adds to the desks it reaches, and how far: oat flat whites. @see CAFE_BOOST */
export const OAT_BOOST = 0.15;
export const OAT_REACH = 4;

export type Dairy = {
  /** Units in each farm's silo, by its id; fractions carried. */
  silo: Map<number, number>;
  /** Units each café has, by its id. */
  stock: Map<number, number>;
  /** The vans on the road: mover id → the farm it came from and the café it is going to. */
  vans: Map<number, { farm: number; cafe: number }>;
  /** Seconds to the next look for a van to send. */
  wait: number;
};

export const newDairy = (): Dairy => ({ silo: new Map(), stock: new Map(), vans: new Map(), wait: 0 });
/** The session's. */
export const dairy: Dairy = newDairy();

/** A harvest's units into a farm's silo, up to its cap. Returns what went in. */
export function harvestMilk(D: Dairy, farm: number, units: number): number {
  const had = D.silo.get(farm) ?? 0, now = Math.min(SILO_CAP, had + units);
  D.silo.set(farm, now);
  return now - had;
}

/** Whether a building serves coffee: a café or a kombucha bar, standing, its kind open. */
export function servesCoffee(g: Grid, s: Structure): boolean {
  if (s.build) return false;
  const sv = serviceIn(s);
  return !!sv && serviceOpen(g, sv) && serviceDef(sv)!.need === "coffee";
}

/** What a café has in stock. */
export const cafeStock = (D: Dairy, id: number) => D.stock.get(id) ?? 0;
/** Vans on their way to a café, or out from a farm. */
export const vansTo = (D: Dairy, cafe: number) => { let n = 0; for (const v of D.vans.values()) if (v.cafe === cafe) n++; return n; };
export const vansFrom = (D: Dairy, farm: number) => { let n = 0; for (const v of D.vans.values()) if (v.farm === farm) n++; return n; };

/** THE CAFÉ A VAN GOES TO: the one with least in stock and on its way, among those not full; null when all are. */
export function pickCafe(cafes: readonly { id: number; stock: number; coming: number }[]): number | null {
  let best: number | null = null, low = Infinity;
  for (const c of cafes) {
    const will = c.stock + c.coming;
    if (will > CAFE_HOLDS - 1 + 1e-9) continue;
    if (will < low) { low = will; best = c.id; }
  }
  return best;
}

/** A café's stock used for `dt` seconds of play; a café gone, its stock with it. */
export function useStock(D: Dairy, g: Grid, dt: number) {
  for (const [id, n] of D.stock) {
    const left = n - dt / UNIT_SECONDS;
    if (!g.structures.has(id) || left <= 0) D.stock.delete(id);
    else D.stock.set(id, left);
  }
}

/** A van in at its café: a unit more there. */
export function delivered(D: Dairy, cafe: number) {
  D.stock.set(cafe, Math.min(CAFE_HOLDS, cafeStock(D, cafe) + 1));
}

/**
 * THE DAIRY, a frame on: cafés using what they have, vans that have arrived stocking theirs, and a van sent from
 * each farm with milk in its silo to the café in its road's reach that wants it most.
 */
export function stepDairy(D: Dairy, g: Grid, net: Network, town: Town, farms: readonly Structure[], dt: number) {
  useStock(D, g, dt);
  for (const m of town.arrived) {
    if (m.job?.role !== "oat-milk") continue;
    const v = D.vans.get(m.id);
    D.vans.delete(m.id);
    if (!v) continue;
    // (One that found its road gone: the unit is back in the silo.)
    if (m.gone) harvestMilk(D, v.farm, 1);
    else delivered(D, v.cafe);
  }
  // (Vans that left the road some other way: off the books.)
  if (D.vans.size) {
    const live = new Set(town.movers.map((m) => m.id));
    for (const [id, v] of D.vans) if (!live.has(id) && !town.arrived.some((m) => m.id === id)) { D.vans.delete(id); harvestMilk(D, v.farm, 1); }
  }
  D.wait -= dt;
  if (D.wait > 0) return;
  D.wait = 1;
  if (!farms.some((f) => (D.silo.get(f.id) ?? 0) >= 1)) return;
  const places = placesOf(g, net);
  const cafes = [...g.structures.values()].filter((s) => servesCoffee(g, s));
  for (const f of farms) {
    if ((D.silo.get(f.id) ?? 0) < 1 || vansFrom(D, f.id) >= VANS_A_FARM) continue;
    const door = places.find((p) => p.kind === "door" && p.structure === f.id && !p.building);
    if (!door) continue;
    // (In its road's reach: a door on the same road network.)
    const reach = cafes
      .map((c) => ({ c, door: places.find((p) => p.kind === "door" && p.structure === c.id && !p.building && p.net === door.net) }))
      .filter((x) => x.door);
    const to = pickCafe(reach.map((x) => ({ id: x.c.id, stock: cafeStock(D, x.c.id), coming: vansTo(D, x.c.id) })));
    if (to === null) continue;
    const van = sendOnJob(town, g, "truck", door, reach.find((x) => x.c.id === to)!.door!, { site: to, role: "oat-milk" });
    if (!van) continue;
    van.colour = OAT_VAN_COLOUR;
    D.vans.set(van.id, { farm: f.id, cafe: to });
    D.silo.set(f.id, (D.silo.get(f.id) ?? 0) - 1);
  }
}

/** A farm's dairy, for its label: the silo, the cafés in reach it keeps stocked and those running low, its vans. */
export function dairyOf(D: Dairy, g: Grid, farm: number): { silo: number; stocked: number; low: number; vans: number } {
  let stocked = 0, low = 0;
  for (const [id, n] of D.stock) {
    if (!g.structures.has(id)) continue;
    stocked++;
    if (n < 1) low++;
  }
  return { silo: Math.floor(D.silo.get(farm) ?? 0), stocked, low, vans: vansFrom(D, farm) };
}
