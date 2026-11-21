/**
 * World v2 — WHAT A CONTRACTOR BUILDS: everything the player puts up that is
 * not one of the company's own projects. An office, the lab, a rack, a slop
 * processor, a length of flood wall is a SITE as a project is — set out, dug,
 * piled, poured, framed and clad, its materials brought a lorry-load at a
 * time and paid for as each is sent — but quick, and by a gang that is the
 * contractor's: nobody leaves a desk for it. @see works stepWorks,
 * plans/built-not-bought.md
 */
import type { Build } from "../grid";
import { serviceOf } from "../agents/needs";
import { isAiBuilding } from "../structures/def";

/** A contract: seconds its gang takes with everything on site, how many loads it is brought in, and how many are in the gang. */
export type Contract = { seconds: number; loads: number; gang: number; /** Its materials come with its gang, on their own van: paid for as any load is, and there at once — nothing so small waits for a lorry from the map's edge. */ carried?: boolean };

const OFFICE: Contract = { seconds: 60, loads: 4, gang: 5 };
/** By what is built. Quick: seconds, where a project is minutes. */
export const CONTRACTS: Readonly<Record<string, Contract>> = {
  "office-intern": OFFICE, "office-vibe": OFFICE, "office-10x": OFFICE,
  lab: { seconds: 90, loads: 5, gang: 6 },
  rack: { seconds: 18, loads: 2, gang: 3, carried: true },
  refinery: { seconds: 60, loads: 4, gang: 5 }, dataplant: { seconds: 60, loads: 4, gang: 5 }, contentfarm: { seconds: 45, loads: 3, gang: 4 },
  levee: { seconds: 14, loads: 1, gang: 3, carried: true },
  // A PORT: its quay piled, filled and poured before a ship can lie at it. (Grown a tier, it is at once, as it was.)
  seaport: { seconds: 80, loads: 5, gang: 6 },
};

/**
 * WHAT IS NOBODY'S TO PAY FOR and goes up all the same: a service the town opens for itself, a building the Machine
 * puts up for itself. Sites as any other, their loads free.
 */
export const TOWNS: Contract = { seconds: 36, loads: 3, gang: 4 };
export const MACHINES: Contract = { seconds: 40, loads: 3, gang: 4 };

/** What builds a structure of this kind, if a contractor does. */
export const contractFor = (def: string): Contract | null =>
  CONTRACTS[def] ?? (serviceOf(def) ? TOWNS : isAiBuilding(def) ? MACHINES : null);

/** A fresh build record for a contract costing `cost` in all: paid a load at a time, none of it now. */
export const contractBuild = (def: string, cost: number, now: number): Build | null => {
  const c = contractFor(def);
  return c ? { done: 0, need: c.seconds * c.gang, delivered: 0, deliveries: c.loads, cost, priority: 2, updatedAt: now } : null;
};
