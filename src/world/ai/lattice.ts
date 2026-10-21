/**
 * World v2 — THE LATTICE: the last thing the company's AI builds. At
 * `LATTICE_AT` the meter holds until it is done: put up in its district by
 * the Data Centre, then CHARGED over `LATTICE_SECONDS` — only while the Data
 * Centre and the Lattice are both cooled and `LATTICE_AGENTS` are running.
 * So the last stretch is something the player watches, and can help (more
 * agents, water to it) or stall (the throttle, refusing its drone, "Hands
 * off"). It drinks a gravity run's worth itself. @see plans/ai-takeover.md §4.1
 */
import { useSessionStore } from "../../state/session.store";
import { tankFor } from "../projects/cooling";
import type { Grid, Structure } from "../grid";
import { SHORT } from "./cooling-ai";

/** Agents that must be running for it to charge; seconds it takes. */
export const LATTICE_AGENTS = 24;
export const LATTICE_SECONDS = 180;

/** The Lattice on the map, standing, or null. */
export const latticeOf = (g: Grid): Structure | null => {
  for (const s of g.structures.values()) if (s.def === "lattice" && !s.build) return s;
  return null;
};

/** Whether a drinker is cooled: its share met. */
const cooled = (s: Structure | null | undefined) => !!s && (tankFor(s.id)?.share ?? 0) >= SHORT;

/** What it needs to charge, each met or not. */
export function latticeNeeds(g: Grid, running: number): { built: boolean; dc: boolean; agents: boolean; water: boolean } {
  const lat = latticeOf(g);
  const dc = [...g.structures.values()].find((s) => s.def === "datacentre" && !s.build);
  return { built: !!lat, dc: cooled(dc), agents: running >= LATTICE_AGENTS, water: cooled(lat) };
}

/** How far it is charged, 0–1; and whether it is done. */
export const latticeCharge = (): number => useSessionStore.getState().aiLattice ?? 0;
export const latticeDone = (): boolean => latticeCharge() >= 1;

/**
 * A step of charging. Whether it finished this step. Kept up between calls and
 * written to the store a hundredth at a time: the store is saved on every write.
 */
let owed = 0;
export function stepLattice(g: Grid, running: number, dt: number): boolean {
  const was = latticeCharge();
  if (was >= 1) return false;
  const n = latticeNeeds(g, running);
  if (!n.built || !n.dc || !n.agents || !n.water) return false;
  owed += dt / LATTICE_SECONDS;
  const next = Math.min(1, was + owed);
  if (next < 1 && Math.floor(next * 100) === Math.floor(was * 100)) return false;
  owed = 0;
  useSessionStore.getState().setAiLattice(next);
  return next >= 1;
}
