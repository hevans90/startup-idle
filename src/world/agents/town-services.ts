/**
 * World v2 — THE TOWN OPENS ITS OWN SERVICES: nobody places a bakery. Each
 * NEIGHBOURHOOD — streets with homes on them, joined at their junctions, a
 * couple of dozen homes at most — looks every few seconds at what its people
 * need and do not have near, and where enough of them want the same thing it
 * opens something for it — of the services unlocked (`stepLadder`): a small
 * one in the ground floor of a house among them, a big one on a free lot. Then it waits before the next. A service
 * nobody of its kind lives near any more closes. @see NEEDS, coverageOf
 */
import { housedBy, isLot, residentsIn } from "../../game/housing";
import { NEIGHBOUR } from "../../iso/dir";
import type { Grid, Structure } from "../grid";
import { connects } from "../roads/mask";
import type { Network } from "../roads/network";
import { streetsOf, type Streets } from "../roads/streets";
import { NEED_KIND, NEEDS, SERVICES_FOR, serviceDef, type NeedId, type ServiceId } from "./needs";
import { placesOf } from "./roads";
import { RANGE, serviceIn, townChanged, type Coverage } from "./services";
import { serviceOpen } from "./unlocks";

/** Seconds between looks at what the town needs. */
export const CHECK_EVERY = 5;
/** Seconds a neighbourhood waits after opening something before the next. */
export const OPEN_GAP = 60;
/** People wanting the same thing before a neighbourhood opens something for it. */
export const MIN_DEMAND = 6;
/** Homes a neighbourhood holds, at most. */
export const NEIGHBOURHOOD_HOMES = 24;
/** Seconds a service can stand with nobody of its kind near before it closes. */
export const CLOSE_AFTER = 180;

const DIRS = ["N", "E", "S", "W"] as const;

/** Where in the town each home is: streets with homes, grouped. */
export type Neighbourhood = { id: number; streets: number[]; homes: number[] };

/** Live state; not saved. A reload starts every neighbourhood ready, and every idle service's clock afresh. */
export type TownServices = { since: number; wait: Map<number, number>; idle: Map<number, number> };
export const createTownServices = (): TownServices => ({ since: 0, wait: new Map(), idle: new Map() });

/** What changed, for whatever shows it. */
export type TownEvent = { kind: "open" | "close"; service: ServiceId; structure: number };

/** What stepping the town may do to the map, given by the store: placing and clearing are its. */
export type TownHands = {
  /** Whether a building of `def` could open with its corner at (x, y). */
  canPlace: (def: string, x: number, y: number) => boolean;
  /** Open it there: the new structure's id, or null. */
  place: (def: string, x: number, y: number) => number | null;
  /** Take a service building down. */
  clear: (id: number) => void;
  rand: () => number;
};

/** The street a door opens on: its own, or, on a junction, the first it leads on to. */
export function streetAt(g: Grid, streets: Streets, door: number): number {
  let street = streets.of[door];
  if (street >= 0) return street;
  const x = door % g.w, y = (door - x) / g.w;
  for (const d of DIRS) {
    if (!connects(g, x, y, d)) continue;
    const [dx, dy] = NEIGHBOUR[d];
    street = streets.of[(y + dy) * g.w + x + dx];
    if (street >= 0) return street;
  }
  return -1;
}

/**
 * THE NEIGHBOURHOODS: the streets with homes on them, each grown from the
 * fullest street not yet in one along the streets that meet it, until it holds
 * `NEIGHBOURHOOD_HOMES`. Known by its first street's first tile, which stays
 * put while the town grows round it.
 */
export function neighbourhoodsOf(g: Grid, streets: Streets, doors: ReadonlyMap<number, number>): Neighbourhood[] {
  const homesOn = new Map<number, number[]>();
  for (const s of g.structures.values()) {
    if (s.build || !housedBy(s.def)) continue;
    const door = doors.get(s.id);
    const street = door === undefined ? -1 : streetAt(g, streets, door);
    if (street < 0) continue;
    homesOn.set(street, [...(homesOn.get(street) ?? []), s.id]);
  }
  // Streets meet where their tiles touch a junction in common, or each other.
  const meets = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!meets.has(a)) meets.set(a, new Set());
    if (!meets.has(b)) meets.set(b, new Set());
    meets.get(a)!.add(b); meets.get(b)!.add(a);
  };
  // Each junction's streets: a flood over its tiles, which a wide crossing has several of.
  const seen = new Uint8Array(g.w * g.h);
  for (let i = 0; i < streets.of.length; i++) {
    if (seen[i] || streets.of[i] >= 0 || !g.paved[i]) continue;
    const touching = new Set<number>(), queue = [i];
    seen[i] = 1;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q], x = c % g.w, y = (c - x) / g.w;
      for (const d of DIRS) {
        if (!connects(g, x, y, d)) continue;
        const [dx, dy] = NEIGHBOUR[d];
        const j = (y + dy) * g.w + x + dx;
        if (streets.of[j] >= 0) touching.add(streets.of[j]);
        else if (!seen[j]) { seen[j] = 1; queue.push(j); }
      }
    }
    const list = [...touching];
    for (const a of list) for (const b of list) link(a, b);
  }
  const first = (st: number) => Math.min(...streets.tiles[st]);
  const order = [...homesOn.keys()].sort((a, b) => homesOn.get(b)!.length - homesOn.get(a)!.length || first(a) - first(b));
  const taken = new Set<number>(), out: Neighbourhood[] = [];
  for (const seed of order) {
    if (taken.has(seed)) continue;
    const n: Neighbourhood = { id: first(seed), streets: [], homes: [] };
    const queue = [seed];
    taken.add(seed);
    for (let q = 0; q < queue.length && n.homes.length < NEIGHBOURHOOD_HOMES; q++) {
      const st = queue[q];
      n.streets.push(st);
      n.homes.push(...homesOn.get(st)!);
      const next = [...(meets.get(st) ?? [])].filter((o) => homesOn.has(o) && !taken.has(o)).sort((a, b) => first(a) - first(b));
      for (const o of next) { taken.add(o); queue.push(o); }
    }
    // Streets queued but not reached are free for the next.
    for (const st of queue) if (!n.streets.includes(st)) taken.delete(st);
    out.push(n);
  }
  return out;
}

const manhattan = (a: number, b: number, w: number) => Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));

/** The services a need has unlocked. @see stepLadder */
const openFor = (g: Grid, need: NeedId) => SERVICES_FOR[need].filter((s) => serviceOpen(g, s));

/** The service to open for a need: one the neighbourhood has none of yet, if any. */
function pickService(g: Grid, need: NeedId, here: ReadonlySet<ServiceId>, rand: () => number): ServiceId {
  const all = openFor(g, need);
  const fresh = all.filter((s) => !here.has(s));
  const pool = fresh.length ? fresh : all;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/**
 * One step of the town seeing to itself: every `CHECK_EVERY` seconds, each
 * neighbourhood not waiting opens one thing for its most-wanted need — the
 * need the most of its people lack, if `MIN_DEMAND` of them do — and
 * services with nobody of their kind near for `CLOSE_AFTER` close.
 */
export function stepTown(t: TownServices, g: Grid, net: Network, cover: Coverage, dt: number, hands: TownHands): TownEvent[] {
  for (const [k, w] of t.wait) { if (w - dt <= 0) t.wait.delete(k); else t.wait.set(k, w - dt); }
  t.since += dt;
  if (t.since < CHECK_EVERY) return [];
  const step = t.since;
  t.since = 0;
  const events: TownEvent[] = [];
  const doors = new Map<number, number>();
  for (const p of placesOf(g, net)) if (p.kind === "door" && p.structure !== undefined) doors.set(p.structure, p.y * g.w + p.x);

  // CLOSING: a service with no home of its kind near — as the crow flies for a park off the roads.
  const homes = [...g.structures.values()].filter((s) => !s.build && housedBy(s.def) && residentsIn(s) > 0);
  for (const s of g.structures.values()) {
    const sv = s.build ? null : serviceIn(s);
    if (!sv) continue;
    const who = NEED_KIND[serviceDef(sv)!.need], door = doors.get(s.id);
    const near = homes.some((h) => housedBy(h.def)!.id === who && (door === undefined
      ? Math.max(Math.abs(h.x - s.x), Math.abs(h.y - s.y)) <= RANGE
      : doors.has(h.id) && manhattan(door, doors.get(h.id)!, g.w) <= RANGE));
    if (near) { t.idle.delete(s.id); continue; }
    const idle = (t.idle.get(s.id) ?? 0) + step;
    if (idle < CLOSE_AFTER) { t.idle.set(s.id, idle); continue; }
    t.idle.delete(s.id);
    if (s.shop) { delete s.shop; townChanged(); } else hands.clear(s.id);
    events.push({ kind: "close", service: sv, structure: s.id });
  }

  // OPENING, a neighbourhood at a time.
  for (const n of neighbourhoodsOf(g, streetsOf(g), doors)) {
    if (t.wait.has(n.id)) continue;
    const people = n.homes.map((id) => g.structures.get(id)!).filter((s) => s && residentsIn(s) > 0);
    const want = new Map<NeedId, number>();
    for (const s of people) {
      const have = cover.get(s.id);
      // Only what the town knows how to open yet.
      for (const need of NEEDS[housedBy(s.def)!.id]) if (!have?.has(need) && openFor(g, need).length) want.set(need, (want.get(need) ?? 0) + residentsIn(s));
    }
    const [need, demand] = [...want].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
    if (!need || demand < MIN_DEMAND) continue;
    const lacking = people.filter((s) => NEEDS[housedBy(s.def)!.id].includes(need) && !cover.get(s.id)?.has(need) && doors.has(s.id));
    if (!lacking.length) continue;
    const here = new Set<ServiceId>();
    for (const id of n.homes) { const sv = g.structures.get(id)?.shop; if (sv) here.add(sv as ServiceId); }
    const sv = pickService(g, need, here, hands.rand);
    const at = serviceDef(sv)!.shop ? openShop(g, n, lacking, doors, sv) : openBuilding(g, lacking, doors, sv, hands);
    // Tried and failed: not again straight away.
    t.wait.set(n.id, at === null ? OPEN_GAP / 2 : OPEN_GAP);
    if (at !== null) events.push({ kind: "open", service: sv, structure: at });
  }
  return events;
}

/** Homes among `lacking` within reach of a door. */
const reached = (door: number, lacking: readonly Structure[], doors: ReadonlyMap<number, number>, w: number) =>
  lacking.filter((h) => manhattan(door, doors.get(h.id)!, w) <= RANGE).length;

/** A shop in the ground floor of the house that reaches most of those lacking it: one with no shop yet, on a lot. */
function openShop(g: Grid, n: Neighbourhood, lacking: readonly Structure[], doors: ReadonlyMap<number, number>, sv: ServiceId): number | null {
  let best: Structure | null = null, most = 0;
  for (const id of n.homes) {
    const s = g.structures.get(id);
    if (!s || s.build || s.shop || !isLot(s.def) || !doors.has(id)) continue;
    const k = reached(doors.get(id)!, lacking, doors, g.w);
    if (k > most || (k === most && best && id < best.id)) { best = s; most = k; }
  }
  if (!best || !most) return null;
  best.shop = sv;
  townChanged();
  return best.id;
}

/** A building of its own on the free lot nearest the middle of those lacking it, within reach of most of them. */
function openBuilding(g: Grid, lacking: readonly Structure[], doors: ReadonlyMap<number, number>, sv: ServiceId, hands: TownHands): number | null {
  const cx = lacking.reduce((n, s) => n + s.x, 0) / lacking.length, cy = lacking.reduce((n, s) => n + s.y, 0) / lacking.length;
  const x0 = Math.max(0, Math.min(...lacking.map((s) => s.x)) - 4), x1 = Math.min(g.w - 1, Math.max(...lacking.map((s) => s.x + s.w)) + 4);
  const y0 = Math.max(0, Math.min(...lacking.map((s) => s.y)) - 4), y1 = Math.min(g.h - 1, Math.max(...lacking.map((s) => s.y + s.h)) + 4);
  let best: { x: number; y: number; k: number; d: number } | null = null;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const k = reached(y * g.w + x, lacking, doors, g.w), d = Math.hypot(x - cx, y - cy);
      if (!k || (best && (k < best.k || (k === best.k && d >= best.d)))) continue;
      if (hands.canPlace(sv, x, y)) best = { x, y, k, d };
    }
  }
  return best ? hands.place(sv, best.x, best.y) : null;
}
