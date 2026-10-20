/**
 * COOLING WATER: the Data Centre, and the AI's own buildings, drink. Each
 * keeps a small TANK, filled by the pipes that open onto it and emptied by
 * what its agents need; the share of its demand it can meet is the share of
 * its agents that run at full power — the rest run at half, as a rack out of
 * reach does. The Data Centre runs `DRY_AGENTS` with no water at all.
 * The rules, pure: what a drinker wants, what its tank holds, how its share
 * moves. @see world/projects/cooling, plans/datacentre-water.md
 */

/** Units of water a second an agent at work drinks. */
export const WATER_PER_AGENT = 0.05;
/** Agents the Data Centre runs at full power with no water. */
export const DRY_AGENTS = 2;
/** A tank holds this many seconds of its demand. */
export const TANK_SECONDS = 30;
/** Demand while the AI trains on the river. */
export const RIVER_COOLING = 0.5;
/** What a compute spire drinks, flat. */
export const SPIRE_WATER = 0.2;
/** Seconds a drinker's share takes to come round to what it is getting. */
export const SHARE_SECONDS = 3;

/** Half steps a pump house lifts water above the water it stands by. @see PUMP */
export const PUMP_HEAD = 8;
/** Most a pump house moves a second, units: about twelve agents' worth. @see pipe-capacity.test */
export const PUMP_RATE = 0.85;
/** What a pump house costs a second while it runs: so much of income, never under a floor. */
export const PUMP_UPKEEP_FLOOR = 5;
export const PUMP_UPKEEP_INCOME = 0.01;
export const pumpUpkeep = (incomePerSecond: number) =>
  Math.max(PUMP_UPKEEP_FLOOR, (Number.isFinite(incomePerSecond) ? Math.max(0, incomePerSecond) : 0) * PUMP_UPKEEP_INCOME);

/** The buildings that drink. */
export const DRINKERS = ["datacentre", "ai-node", "gpu-farm", "compute-spire"] as const;
export type Drinker = (typeof DRINKERS)[number];
export const isDrinker = (def: string): def is Drinker => (DRINKERS as readonly string[]).includes(def);

/** Agents a drinker runs without water. */
export const allowanceOf = (def: Drinker) => (def === "datacentre" ? DRY_AGENTS : 0);

/** Units a second a drinker wants, cooling `agents` of its own, while training on the river or not. */
export function demandOf(def: Drinker, agents: number, river = false): number {
  const base = def === "compute-spire" ? SPIRE_WATER : WATER_PER_AGENT * Math.max(0, agents - allowanceOf(def));
  return base * (river ? RIVER_COOLING : 1);
}

/** What its tank holds, full, for a demand. Never nothing: a pipe can fill it before anything drinks. */
export const tankOf = (demand: number) => Math.max(demand, WATER_PER_AGENT) * TANK_SECONDS;

/**
 * One step of a tank: `demand` drunk for `dt` from `level`. The new level, and
 * the share moved from `share` toward what was met, smoothed over `SHARE_SECONDS`.
 */
export function drink(level: number, share: number, demand: number, dt: number): { level: number; share: number } {
  if (demand <= 0) return { level, share: share + (1 - share) * Math.min(1, dt / SHARE_SECONDS) };
  const want = demand * dt, got = Math.min(level, want);
  const met = got / want;
  return { level: level - got, share: share + (met - share) * Math.min(1, dt / SHARE_SECONDS) };
}

/** Agents of `agents` a drinker cools, at `share`: its allowance always, and its share of the rest. */
export const cooledOf = (def: Drinker, agents: number, share: number) => {
  const free = Math.min(agents, allowanceOf(def));
  return free + share * (agents - free);
};
