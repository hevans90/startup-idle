/**
 * World v2 — THE DRINKERS' TANKS, on the map: who drinks, how many agents
 * each is cooling, what is in its tank and what share of its demand it meets.
 * Runtime only — tanks start full, so a reload never blinks the power.
 *
 * WHO COOLS WHOM: the agents running fill the powered slots in order — the
 * racks in the Data Centre's reach first, which the Data Centre cools, then
 * the AI nodes and GPU farms in reach, which cool their own. Out of reach an
 * agent is at half already and drinks nothing. @see game/cooling, racks
 */
import { agentsARack } from "../../game/agents";
import { cooledOf, demandOf, drink, isDrinker, tankOf, type Drinker } from "../../game/cooling";
import type { Grid, Structure } from "../grid";
import { powered } from "./racks";
import { notable } from "../../game/machine";

export type Tank = { level: number; share: number; capacity: number; demand: number; agents: number; def: Drinker };

const tanks = new Map<number, Tank>();
let hot = 0, spireShare = 0;

/** Agents a building holds: a rack and an AI node a rack's worth, a GPU farm two. */
const slotsOf = (s: Structure) => (s.def === "rack" || s.def === "ai-node" ? agentsARack() : s.def === "gpu-farm" ? 2 * agentsARack() : 0);

/** How many of `running` each drinker is cooling. */
export function assignAgents(g: Grid, running: number): Map<number, number> {
  const out = new Map<number, number>();
  const all = [...g.structures.values()].filter((s) => !s.build);
  const dc = all.find((s) => s.def === "datacentre");
  let left = Math.max(0, running);
  // The racks in reach first: the Data Centre's to cool.
  if (dc) {
    let rackSlots = 0;
    for (const s of all) if (s.def === "rack" && powered(g, s)) rackSlots += slotsOf(s);
    const n = Math.min(left, rackSlots);
    out.set(dc.id, n);
    left -= n;
  }
  // Then the AI's own, each its own.
  for (const s of all) {
    if ((s.def !== "ai-node" && s.def !== "gpu-farm") || !powered(g, s)) continue;
    const n = Math.min(left, slotsOf(s));
    out.set(s.id, n);
    left -= n;
  }
  return out;
}

/**
 * One frame of drinking: each drinker's demand from the agents it cools,
 * drunk from its tank. `river` while the AI trains on the river.
 */
export function stepCooling(g: Grid, running: number, river: boolean, dt: number): void {
  const agents = assignAgents(g, running);
  // THE COOLANT LOOP: every tank shares its water, each filled to the same
  // share of what it holds — a surplus at one tops up a shortage at another.
  // @see game/machine "coolant"
  if (notable("coolant") && tanks.size > 1) {
    let level = 0, capacity = 0;
    for (const t of tanks.values()) { level += t.level; capacity += t.capacity; }
    if (capacity > 0) for (const t of tanks.values()) t.level = t.capacity * (level / capacity);
  }
  const live = new Set<number>();
  hot = 0;
  let spires = 0;
  for (const s of g.structures.values()) {
    if (s.build || !isDrinker(s.def)) continue;
    live.add(s.id);
    const n = agents.get(s.id) ?? 0;
    const demand = demandOf(s.def, n, river);
    const capacity = tankOf(demand);
    const t = tanks.get(s.id) ?? { level: capacity, share: 1, capacity, demand, agents: n, def: s.def };
    const next = drink(Math.min(t.level, capacity), t.share, demand, dt);
    Object.assign(t, next, { capacity, demand, agents: n, def: s.def });
    tanks.set(s.id, t);
    if (s.def === "compute-spire") spires += t.share;
    else hot += n - cooledOf(s.def, n, t.share);
  }
  for (const id of tanks.keys()) if (!live.has(id)) tanks.delete(id);
  spireShare = spires;
}

/**
 * Water into a drinker's tank from a pipe: as much of `amount` as there is
 * room for. What it took. @see runPipes
 */
export function fillTank(id: number, amount: number): number {
  const t = tanks.get(id);
  if (!t || amount <= 0) return 0;
  const take = Math.min(amount, t.capacity - t.level);
  t.level += take;
  return take;
}

/** Room left in a drinker's tank, for a pipe to fill; a drinker not seen yet has a whole tank's. */
export const tankRoom = (id: number) => {
  const t = tanks.get(id);
  return t ? Math.max(0, t.capacity - t.level) : 0;
};

/** Agents at work who are not cooled: they run at half. */
export const hotAgents = () => hot;
/** The compute spires standing, each counted by how well it is cooled. */
export const cooledSpires = () => spireShare;
/** Every drinker's tank, for the panel and the map. */
export const tankFor = (id: number): Tank | undefined => tanks.get(id);
export const allTanks = (): ReadonlyMap<number, Tank> => tanks;

/** A new company, or a map loaded: every tank forgotten, to start full. */
export function resetCooling(): void {
  tanks.clear();
  hot = 0; spireShare = 0;
}

