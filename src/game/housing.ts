/**
 * How many employees the map has room for.
 *
 * THE ONE PLACE THE CITY TOUCHES THE ECONOMY. Housing supplements hiring rather
 * than replacing it: the cost curve, the upgrades, the perks and the team
 * leaders all work exactly as they did — but an employee needs somewhere to
 * live, so the map sets a CEILING and the existing economy fills it.
 *
 * That choice is what keeps this small. Replacing hiring would have meant
 * rebalancing the whole curve and teaching offline auto-buy to place buildings;
 * a ceiling means auto-buy simply stops when it is full, which is the behaviour
 * it already has when money runs out.
 *
 * THE WORLD PUSHES, THE ECONOMY READS. This module deliberately imports nothing
 * from `src/world` at runtime: the generator store calls into here on every
 * hire, and reaching the other way would drag the whole map engine — Pixi
 * included, through `world.store` — into every test that buys an employee. The
 * same inversion `employee-satisfaction-read` uses, for the same reason.
 * @see setHousingReader
 */
import type { GeneratorId } from "../state/generators.store";
import type { Grid } from "../world/grid";

/**
 * Employees a building of each tier houses.
 *
 * Tiers come from the kit ids — `kit:intern.t0`, `.t1`, `.t2`, `.landmark` —
 * so the map gets a second axis for free: build wider, or build better on the
 * ground you have. @see kitDefs
 */
const SLOTS_BY_TIER: Record<string, number> = {
  t0: 2,
  t1: 5,
  t2: 12,
  landmark: 30,
};

/** Nobody lives anywhere, which is where a new company starts. */
export const NO_HOUSING: Record<GeneratorId, number> = {
  intern: 0,
  vibe_coder: 0,
  "10x_dev": 0,
};

/**
 * NO MAP MEANS NO CEILING, and that default is load-bearing.
 *
 * The world is still its own route; the rest of the game runs without it. If
 * the absence of a map read as "no beds" then not opening World v2 would brick
 * hiring outright. So the gate exists only once something has registered a way
 * to answer it — and when the world becomes part of the game, it always will.
 */
const UNLIMITED: Record<GeneratorId, number> = {
  intern: Infinity,
  vibe_coder: Infinity,
  "10x_dev": Infinity,
};

let capacityFn: () => Record<GeneratorId, number> = () => UNLIMITED;

/**
 * Tell the economy how to ask the map for beds, and get back a function that
 * stops it — so a torn-down world does not leave the game gated by a map that
 * is no longer there.
 */
export function setHousingReader(
  read: () => Record<GeneratorId, number>,
): () => void {
  capacityFn = read;
  return () => { capacityFn = () => UNLIMITED; };
}

/**
 * Which generator a structure houses, and how many — or null if it is not
 * housing at all.
 *
 * Off the kit id, because that is where the district already lives:
 * `kit:vibe_coder.t1` is five vibe coders. A def this cannot read houses
 * nobody rather than throwing; a map may name a building from a later build.
 */
export function housedBy(defId: string): { id: GeneratorId; slots: number } | null {
  const m = /^kit:(intern|vibe_coder|10x_dev)\.(t0|t1|t2|landmark)$/.exec(defId);
  if (!m) return null;
  return { id: m[1] as GeneratorId, slots: SLOTS_BY_TIER[m[2]] ?? 0 };
}

/** Beds on this map, per generator. */
export function housingCapacity(grid: Grid): Record<GeneratorId, number> {
  const out = { ...NO_HOUSING };
  for (const s of grid.structures.values()) {
    const h = housedBy(s.def);
    if (h) out[h.id] += h.slots;
  }
  return out;
}

/** Beds as the registered reader sees them. @see setHousingReader */
export const liveCapacity = (): Record<GeneratorId, number> => capacityFn();

/**
 * How many more of this generator there is room for, never below zero.
 *
 * Zero is the honest answer when a player has demolished their way under their
 * own headcount — the employees already hired stay, and nobody new arrives
 * until there is somewhere to put them.
 */
export function roomFor(id: GeneratorId, owned: number): number {
  const beds = capacityFn()[id] ?? 0;
  return Math.max(0, beds - owned);
}

/**
 * Beds a new company starts with OFF the map, before it has built anything:
 * enough interns to earn the price of the first house. Without them a company
 * with no beds could hire nobody, so earned nothing, so could build nothing.
 */
export const STARTER_REMOTE_BEDS: Partial<Record<GeneratorId, number>> = { intern: 2 };

/**
 * The beds a company has off its map when the map is founded: its starter
 * crew, or everyone it already employs if that is more.
 *
 * EVERYONE ALREADY HIRED, so a company that grew before it had a map is not
 * suddenly unable to hire one more until it has housed hundreds: the people it
 * has live elsewhere, and only growth from here needs a roof on the map.
 */
export function foundingRemoteBeds(owned: Partial<Record<GeneratorId, number>>): Record<GeneratorId, number> {
  const out = { ...NO_HOUSING };
  for (const id of Object.keys(out) as GeneratorId[]) {
    out[id] = Math.max(owned[id] ?? 0, STARTER_REMOTE_BEDS[id] ?? 0);
  }
  return out;
}

/** Two sets of beds, added. */
export function addBeds(a: Record<GeneratorId, number>, b: Partial<Record<string, number>>): Record<GeneratorId, number> {
  const out = { ...a };
  for (const id of Object.keys(out) as GeneratorId[]) out[id] += b[id] ?? 0;
  return out;
}
