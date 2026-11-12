/**
 * World v2 — THE SLOP LOADER: a berth that takes the town's slop away by
 * water. A port with one has a slop inlet on each of its ends, as a
 * processor has two, so a sewer can end there; what comes down the sewer stands
 * in the loader's tank, and a barge that calls at the berth takes a hold of
 * it away — for a charge, by how much it took. It earns nothing: it is a
 * third way out for slop, beside processing it and pouring it in the river,
 * paid for with a berth and a barge's bill. @see FITTINGS, plans/seaports.md §3
 *
 * Live state, like the trade: the tanks are not saved, and start empty.
 */
import type { Grid, Structure } from "../grid";

/** What a loader's tank holds, a slop berth of the port. */
export const LOADER_HOLDS = 30;
/** What a loader takes in a second, a slop berth: as a processor does. */
export const LOADER_RATE = 0.5;
/** What a barge carries away in a call. */
export const BARGE_HOLDS = 20;
/** What a full barge charges, as a share of the port's plain call fee. */
export const BARGE_COST = 0.5;

const tanks = new WeakMap<Grid, Map<number, number>>();
const of = (g: Grid) => { let m = tanks.get(g); if (!m) tanks.set(g, (m = new Map())); return m; };

/** How many of a port's berths are slop loaders. */
export const loaderBerths = (s: Pick<Structure, "fit" | "build">) => (s.build ? 0 : s.fit?.filter((f) => f === "slop").length ?? 0);

/** What stands in a port's loader. */
export const loaderLevel = (g: Grid, id: number) => of(g).get(id) ?? 0;
/** What a port's loader holds when full. */
export const loaderHolds = (s: Pick<Structure, "fit" | "build">) => LOADER_HOLDS * loaderBerths(s);
/** How full it stands, nought to one; nought for a port with none. */
export const loaderFill = (g: Grid, s: Structure) => { const h = loaderHolds(s); return h > 0 ? Math.min(1, loaderLevel(g, s.id) / h) : 0; };

/** What a port's loader can take in `dt` seconds: by its rate, and no more than it has room for. */
export function loaderRoom(g: Grid, s: Structure, dt: number): number {
  const n = loaderBerths(s);
  return n ? Math.max(0, Math.min(LOADER_RATE * n * dt, LOADER_HOLDS * n - loaderLevel(g, s.id))) : 0;
}

/** Slop into a port's loader: what it took. */
export function loadSlop(g: Grid, s: Structure, amount: number): number {
  const into = Math.max(0, Math.min(amount, loaderHolds(s) - loaderLevel(g, s.id)));
  if (into > 0) of(g).set(s.id, loaderLevel(g, s.id) + into);
  return into;
}

/** What a barge calling now would take, and the share of a full hold that is. */
export const bargeLoad = (g: Grid, id: number) => Math.min(BARGE_HOLDS, loaderLevel(g, id));

/** A barge's call: a hold of slop taken away. What it took. */
export function bargeTakes(g: Grid, id: number): number {
  const took = bargeLoad(g, id);
  if (took > 0) of(g).set(id, loaderLevel(g, id) - took);
  return took;
}

/** A port gone, or refitted with no loader: what stood in it, handed back to be put somewhere. */
export function loaderGone(g: Grid, id: number): number {
  const had = loaderLevel(g, id);
  of(g).delete(id);
  return had;
}

/** The ports that hold slop now, by id. */
export const loadersOf = (g: Grid): ReadonlyMap<number, number> => of(g);
