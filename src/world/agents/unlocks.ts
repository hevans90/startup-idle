/**
 * World v2 — THE UNLOCK LADDER: which services the town knows how to open
 * yet. Each comes with its kind's headcount (`UNLOCK_AT`), one at a time, at
 * least `UNLOCK_GAP` apart: a jump in hires reveals them in turn, not at once.
 * Paced on the map run's player to about one every five minutes over the
 * first hour and a quarter. @see services-pacing.test
 *
 * KEPT PER MAP, with the map: a new company starts with none. A grid the game
 * never started a ladder for — a test's, the planner's copy — has every
 * service open, so it plans for the town as it will be. @see startLadder
 */
import type { GeneratorId } from "../../state/generators.store";
import { NEED_KIND, NEEDS, SERVICE_IDS, SERVICES_FOR, serviceDef, type NeedId, type ServiceId } from "./needs";

/** Each service's unlock: its kind's headcount. In the order they come. */
export const UNLOCK_AT: Record<ServiceId, number> = {
  takeaway: 4,
  bar: 40,
  cafe: 6,
  coworking: 18,
  bakery: 85,
  kombucha: 28,
  pharmacy: 2,
  club: 135,
  gym: 3,
  vape: 50,
  arcade: 175,
  park: 4,
  cinema: 157,
  doctor: 7,
  climbing: 8,
  dentist: 8,
};
/** Seconds at least between two unlocks. */
export const UNLOCK_GAP = 90;

/** The order a tie goes in: as `UNLOCK_AT` lists them. */
const ORDER = Object.keys(UNLOCK_AT) as ServiceId[];

export type Ladder = {
  open: Set<ServiceId>;
  /** Reached, waiting their turn. */
  queue: ServiceId[];
  /** Seconds since the last unlock. */
  since: number;
  /** A map from before the ladder: open whatever is reached at once, on the first step. */
  catchUp: boolean;
};

const ladders = new WeakMap<object, Ladder>();

/** A map's ladder, if the game started one. */
export const ladderOf = (g: object): Ladder | undefined => ladders.get(g);

/**
 * Start a map's ladder: as saved, or — a map saved before it, or a new one —
 * catching up on its first step to whatever its headcount has reached.
 */
export function startLadder(g: object, saved?: readonly string[]): Ladder {
  const open = (saved ?? []).filter((s): s is ServiceId => !!serviceDef(s));
  const l: Ladder = { open: new Set(open), queue: [], since: UNLOCK_GAP, catchUp: saved === undefined };
  ladders.set(g, l);
  return l;
}

/** Whether a map's town can open a service yet: always, on a map with no ladder. */
export const serviceOpen = (g: object, sv: ServiceId): boolean => ladders.get(g)?.open.has(sv) ?? true;

/** Whether any of a need's services is unlocked. */
export const needOpen = (g: object, n: NeedId): boolean => SERVICES_FOR[n].some((s) => serviceOpen(g, s));
/** Whether a kind wants anything yet: one of its needs has a service unlocked. Unmet needs weigh only then. */
export const wantsAny = (g: object, who: GeneratorId): boolean => NEEDS[who].some((n) => needOpen(g, n));

/** What a map has unlocked, to save; undefined for no ladder. */
export const unlockedOf = (g: object): ServiceId[] | undefined => {
  const l = ladders.get(g);
  return l && SERVICE_IDS.filter((s) => l.open.has(s));
};

/**
 * One step of the ladder: whatever the headcount has reached joins the queue,
 * and the next in it unlocks once `UNLOCK_GAP` has passed since the last.
 * What unlocked, in order.
 */
export function stepLadder(l: Ladder, owned: Partial<Record<GeneratorId, number>>, dt: number): ServiceId[] {
  l.since += dt;
  const reached = ORDER.filter((s) => !l.open.has(s) && !l.queue.includes(s) && (owned[NEED_KIND[serviceDef(s)!.need]] ?? 0) >= UNLOCK_AT[s]);
  if (l.catchUp) {
    l.catchUp = false;
    for (const s of reached) l.open.add(s);
    return reached;
  }
  l.queue.push(...reached);
  if (!l.queue.length || l.since < UNLOCK_GAP) return [];
  const s = l.queue.shift()!;
  l.open.add(s);
  l.since = 0;
  return [s];
}
