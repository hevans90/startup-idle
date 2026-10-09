/**
 * World v2 — NEW HIRES ARRIVING, and moving in.
 *
 * Housing is zoned, Caesar's way: the player marks out LOTS for each kind of
 * employee, and nobody lives on one until somebody arrives to. Hiring is an
 * offer accepted; the hire then has to GET here — from where a road comes in
 * off the map, to a lot of their kind with room on it — and until they have,
 * they are at no desk and produce nothing. @see awaitingArrival, attendance
 *
 * EACH KIND COMES ITS OWN WAY:
 *  - INTERNS BY BUS. Not a bus each: a bus waits at the edge of the map for a
 *    busload, or until the first of them has waited long enough, then drives
 *    a round of the lots they are going to — fullest first, so a street fills
 *    a house at a time rather than a bed in each — stopping at each to let
 *    them off, and drives away off the map.
 *  - VIBE CODERS BY CAR, one each, a little apart.
 *  - 10X DEVS BY LIMOUSINE.
 *
 * THE CONDITIONS, which are what keeps a hire from arriving:
 *  - a lot of their kind with a bed free — counting the people already on
 *    their way to it, so two buses never race for one bed;
 *  - and a road to it from the edge of the map, since that is how they come.
 * Missing either, they wait, off the map, and the beds bar says why.
 *
 * Live state like the town's, not saved: a ride under way when the page goes
 * is settled on the next load, everyone in it moved straight in.
 * @see settleHousing
 */
import { housedBy, residentsIn } from "../../game/housing";
import type { GeneratorId } from "../../state/generators.store";
import type { Grid, Structure } from "../grid";
import type { Network } from "../roads/network";
import type { Place } from "./roads";
import { sendOnJob, type Mover, type Town } from "./town";

/** How each kind of employee comes. */
export const VEHICLE: Record<GeneratorId, "bus" | "car" | "limo"> = {
  intern: "bus",
  vibe_coder: "car",
  "10x_dev": "limo",
};

/** Seats on a bus, and the longest the first intern waits for it to fill. */
export const BUS_SEATS = 12;
export const BUS_WAIT = 6;
/** Seconds between one car, or one limousine, and the next. */
const CAR_GAP = 1.2;
const LIMO_GAP = 2.5;
/** Seconds a bus stands at a stop, letting people off. */
const DWELL = 1.4;

/** Who is in a vehicle, and where each of them is going: stops, in order. */
export type Ride = { who: GeneratorId; drops: { structure: number; n: number }[] };

/** How a kind of employee's arrivals stand, for the beds bar. */
export type ArrivalStatus = {
  /** On the road now. */
  riding: number;
  /** Hired, and not yet sent for. */
  waiting: number;
  /** Why they are waiting, if it is not just their turn. */
  blocked?: "no-lot" | "no-road";
};

export type Arrivals = {
  /** Rides under way, by the mover carrying them. */
  rides: Map<number, Ride>;
  /** Seconds the first waiting intern has waited for a bus. */
  waited: number;
  /** Seconds before the next car, or limousine, may set off. */
  until: Partial<Record<GeneratorId, number>>;
  /** Housing whose residents changed since the last look, for the renderer and the save. */
  moved: number[];
  status: Partial<Record<GeneratorId, ArrivalStatus>>;
  /** Seconds since whoever was waiting was last looked at. */
  clock: number;
};

export const createArrivals = (): Arrivals => ({ rides: new Map(), waited: 0, until: {}, moved: [], status: {}, clock: 0 });

/** Seconds between looks at who is waiting: planning a round is not a per-frame job. */
const LOOK_EVERY = 0.25;

/** People of a kind on the road to each building. */
function inbound(a: Arrivals, who: GeneratorId): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of a.rides.values()) {
    if (r.who !== who) continue;
    for (const d of r.drops) out.set(d.structure, (out.get(d.structure) ?? 0) + d.n);
  }
  return out;
}

const riding = (a: Arrivals, who: GeneratorId) => {
  let n = 0;
  for (const r of a.rides.values()) if (r.who === who) for (const d of r.drops) n += d.n;
  return n;
};

/** Move people into a building, as many as it has room for. Returns how many did. */
function moveIn(a: Arrivals, s: Structure | undefined, who: GeneratorId, n: number): number {
  const h = s && housedBy(s.def);
  if (!s || !h || h.id !== who) return 0;
  const here = residentsIn(s);
  const add = Math.max(0, Math.min(n, h.slots - here));
  if (add > 0) { s.residents = here + add; a.moved.push(s.id); }
  return add;
}

/**
 * Where a vehicle of new arrivals goes: its lots, as stops, and how many get
 * off at each. Lots already part-full first, so houses fill one at a time;
 * then the nearest the way in. Null if there is nowhere with room.
 */
function planStops(
  g: Grid, places: readonly Place[], who: GeneratorId, seats: number, coming: Map<number, number>, gate: Place,
): { structure: number; n: number; door: Place }[] {
  const lots: { s: Structure; free: number; door: Place }[] = [];
  for (const s of g.structures.values()) {
    const h = housedBy(s.def);
    if (!h || h.id !== who || s.build) continue;
    const free = h.slots - residentsIn(s) - (coming.get(s.id) ?? 0);
    const door = places.find((p) => p.kind === "door" && p.structure === s.id && p.net === gate.net);
    if (free > 0 && door) lots.push({ s, free, door });
  }
  lots.sort((p, q) => (residentsIn(q.s) > 0 ? 1 : 0) - (residentsIn(p.s) > 0 ? 1 : 0)
    || dist(p.door, gate) - dist(q.door, gate) || p.s.id - q.s.id);
  const stops: { structure: number; n: number; door: Place }[] = [];
  let left = seats;
  for (const l of lots) {
    if (left <= 0) break;
    const n = Math.min(left, l.free);
    stops.push({ structure: l.s.id, n, door: l.door });
    left -= n;
  }
  // A ROUND, not a list: each next stop the nearest from the last.
  const round: typeof stops = [];
  let at: { x: number; y: number } = gate;
  while (stops.length) {
    let k = 0;
    for (let j = 1; j < stops.length; j++) if (dist(stops[j].door, at) < dist(stops[k].door, at)) k = j;
    const [next] = stops.splice(k, 1);
    round.push(next);
    at = next.door;
  }
  return round;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The way in off the map nearest a place, on its network. */
const gatewayNear = (places: readonly Place[], to: { x: number; y: number }, net?: number) =>
  places.filter((p) => p.kind === "gateway" && (net === undefined || p.net === net))
    .sort((p, q) => dist(p, to) - dist(q, to))[0] ?? null;

/**
 * One frame of arrivals: whoever reached a stop moved in, vehicles sent on to
 * the next stop or away, and new ones sent for whoever is waiting.
 *
 * `owned` is who is employed; `remote` who lives off the map and is never
 * coming. Everyone else should live here, and is sent for. Run before
 * `stepWorks`, which clears the arrivals it is handed.
 */
export function stepArrivals(
  a: Arrivals, g: Grid, _net: Network, town: Town,
  owned: Partial<Record<GeneratorId, number>>, remote: Partial<Record<string, number>>, dt: number,
): void {
  const places = town.places;
  const placeOf = (structure: number) => places.find((p) => p.kind === "door" && p.structure === structure);

  // ARRIVED: off at this stop, and on to the next, or away.
  const seen = new Set<number>();
  for (const m of town.arrived) {
    seen.add(m.id);
    if (m.job?.role !== "arrive") continue;
    const ride = a.rides.get(m.id);
    a.rides.delete(m.id);
    if (!ride) continue;
    const drop = ride.drops.shift();
    if (drop) moveIn(a, g.structures.get(drop.structure), ride.who, drop.n);
    const here = placeOf(m.job.site);
    if (!here) continue;
    const next = ride.drops[0];
    const nextDoor = next && placeOf(next.structure);
    if (next && nextDoor) {
      const on = sendOnJob(town, g, m.kind, here, nextDoor, { site: next.structure, role: "arrive" });
      if (on) { on.wait = DWELL; on.colour = m.colour; a.rides.set(on.id, ride); }
    } else if (m.kind === "bus") {
      // Empty: back the way it came, or the nearest way off the map.
      const out = gatewayNear(places, here, here.net);
      const on = out && sendOnJob(town, g, "bus", here, out, { site: m.job.site, role: "leave" });
      if (on) { on.wait = DWELL; on.colour = m.colour; }
    }
    // A car or a limousine parks, and is gone.
  }
  // LOST: a ride whose vehicle is off the road — the road taken up under it.
  // Its passengers are waiting again, and will be sent for again.
  const live = new Set(town.movers.map((m: Mover) => m.id));
  for (const id of [...a.rides.keys()]) if (!live.has(id) && !seen.has(id)) a.rides.delete(id);

  // SENDING FOR whoever is waiting, a few times a second.
  a.clock += dt;
  if (a.clock < LOOK_EVERY) return;
  dt = a.clock;
  a.clock = 0;
  a.status = {};
  for (const who of Object.keys(VEHICLE) as GeneratorId[]) {
    const residents = [...g.structures.values()].reduce(
      (n, s) => n + (housedBy(s.def)?.id === who ? residentsIn(s) : 0), 0);
    const onRoad = riding(a, who);
    const waiting = Math.max(0, (owned[who] ?? 0) - (remote[who] ?? 0) - residents - onRoad);
    const status: ArrivalStatus = { riding: onRoad, waiting };
    if (waiting > 0 || onRoad > 0) a.status[who] = status;
    if (who === "intern" && waiting === 0) a.waited = 0;
    if (waiting <= 0) continue;

    // Somewhere with room, and the way in to it.
    const coming = inbound(a, who);
    const anyLot = [...g.structures.values()].some((s) => {
      const h = housedBy(s.def);
      return h?.id === who && h.slots - residentsIn(s) - (coming.get(s.id) ?? 0) > 0;
    });
    if (!anyLot) { status.blocked = "no-lot"; continue; }
    const gates = places.filter((p) => p.kind === "gateway");
    let plan: ReturnType<typeof planStops> = [], gate: Place | null = null;
    const vehicle = VEHICLE[who];
    const seats = vehicle === "bus" ? Math.min(BUS_SEATS, waiting) : 1;
    for (const gw of gates) {
      const p = planStops(g, places, who, seats, coming, gw);
      if (p.length) {
        // The way in nearest its first stop, on the same roads.
        gate = gatewayNear(places, p[0].door, gw.net) ?? gw;
        plan = planStops(g, places, who, seats, coming, gate);
        break;
      }
    }
    if (!plan.length || !gate) { status.blocked = "no-road"; continue; }

    // WHEN: a bus once it is full or has waited long enough; a car or a
    // limousine as soon as the last has had a moment's start.
    if (vehicle === "bus") {
      a.waited += dt;
      if (waiting < BUS_SEATS && a.waited < BUS_WAIT) continue;
    } else {
      a.until[who] = (a.until[who] ?? 0) - dt;
      if ((a.until[who] ?? 0) > 0) continue;
    }
    const first = plan[0];
    const m = sendOnJob(town, g, vehicle, gate, first.door, { site: first.structure, role: "arrive" });
    if (!m) continue;
    a.rides.set(m.id, { who, drops: plan.map(({ structure, n }) => ({ structure, n })) });
    if (vehicle === "bus") a.waited = 0;
    else a.until[who] = vehicle === "limo" ? LIMO_GAP : CAR_GAP;
    status.riding += plan.reduce((n, d) => n + d.n, 0);
    status.waiting -= plan.reduce((n, d) => n + d.n, 0);
  }
}

/**
 * EVERYONE HOME, at once: the people who should live on the map moved in
 * straight away, as many as there are beds for, fullest first — and any
 * beyond the people there are, moved out. For a map loaded after time away,
 * when whoever was on their way has long since arrived; and for housing from
 * before lots, which counted as full whoever lived there. Returns the
 * buildings changed.
 */
export function settleHousing(
  g: Grid, owned: Partial<Record<GeneratorId, number>>, remote: Partial<Record<string, number>>,
): number[] {
  const changed = new Set<number>();
  for (const who of Object.keys(VEHICLE) as GeneratorId[]) {
    const homes = [...g.structures.values()].filter((s) => housedBy(s.def)?.id === who && !s.build);
    // Lived-in before empty, then oldest first: who stays, and where the rest go.
    homes.sort((p, q) => (residentsIn(q) > 0 ? 1 : 0) - (residentsIn(p) > 0 ? 1 : 0) || p.id - q.id);
    let left = Math.max(0, (owned[who] ?? 0) - (remote[who] ?? 0));
    for (const s of homes) {
      const n = Math.min(left, housedBy(s.def)!.slots);
      if (s.residents !== n) { s.residents = n; changed.add(s.id); }
      left -= n;
    }
  }
  return [...changed];
}
