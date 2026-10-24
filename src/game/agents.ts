/**
 * AI AGENTS — the late game's own kind of worker, opened by the Data Centre.
 *
 * Not people: they are not hired with money, need no bed, walk nowhere and
 * have no mood. They are SPUN UP for INNOVATION — which the late game piles up
 * and otherwise only spends on managers, so an agent is a choice between the
 * two — and they run in RACKS on the map, a few to a rack. Each one makes
 * everybody's work go further: income, all of it, a few percent an agent.
 *
 * POWER is where the racks stand: within reach of the Data Centre an agent
 * runs flat out, further off at half. So a rack is a placement decision, not
 * a bed count. @see world/projects/racks
 *
 * THE ECONOMY'S SIDE, pure: prices, room and the multiplier, from how many
 * agents there are and what the map says about its racks. With no map (a
 * simulation, a test) every agent is at full power and there is room for all.
 */
import { projectReading } from "./projects";
import { fusionNow } from "./fusion";
import { moduleLevel } from "./modules";
import { skillOf } from "../state/training.store";
import { keystone } from "./machine";

/** Income each agent at full power adds, as a share. */
export const AGENT_BOOST = 0.04;
/** What each compute spire adds to every agent's boost, and the most that count. */
export const SPIRE_BOOST = 0.1;
export const MAX_SPIRES = 3;
/** Agents a rack runs. */
export const AGENTS_A_RACK = 4;
/** What an agent in a rack out of the Data Centre's reach is worth. */
export const UNPOWERED_SHARE = 0.5;
/** Tiles from the Data Centre a rack is powered within. */
export const RACK_RANGE = 10;
/** The first agent's price in innovation, and how much dearer each after it is. */
export const AGENT_BASE_COST = 2;
export const AGENT_COST_GROWTH = 1.25;

/** What the next agent costs, in innovation, with `owned` already running. */
export const agentCost = (owned: number): number => AGENT_BASE_COST * Math.pow(AGENT_COST_GROWTH, owned) * fusionNow().agentCostMult;

/** Agents a rack runs: four, and more for a Hivemind fused in, the Rack Density module, and an AI trained on itself. @see game/fusion, game/modules, game/training */
export const agentsARack = (): number =>
  AGENTS_A_RACK + fusionNow().agentsPerRack + moduleLevel("rack-density") + (skillOf("itself") >= 1 ? 1 : 0);

/** Whether agents can be spun up at all: the Data Centre stands, or there is no map to ask. */
export function agentsOpen(): boolean {
  const r = projectReading();
  return !r || r.built.has("datacentre");
}

/** Agents a map's racks can run: all of them with no map. */
export function rackRoom(): number {
  const r = projectReading()?.racks;
  return r ? r.powered + r.unpowered : Infinity;
}

/** How many of `agents` run at full power, and how many at half: the powered racks fill first. */
export function agentsAtWork(agents: number): { powered: number; unpowered: number } {
  const r = projectReading()?.racks;
  if (!r) return { powered: agents, unpowered: 0 };
  const powered = Math.min(agents, r.powered);
  return { powered, unpowered: Math.min(agents - powered, r.unpowered) };
}

/** What the agents running multiply income by. */
/** What the Machine's Air Gap keystone multiplies every agent's boost by. @see game/machine KEYSTONES */
export const AIR_GAP_BOOST = 2;

export function agentBonus(agents: number): number {
  const { powered, unpowered } = agentsAtWork(agents);
  // Compute spires the AI put up add to every agent's boost. @see SPIRE_BOOST
  const spires = Math.min(MAX_SPIRES, projectReading()?.spires ?? 0);
  // AIR-GAPPED, every agent's boost twice over. @see AIR_GAP_BOOST
  const gap = keystone("airgap") ? AIR_GAP_BOOST : 1;
  return 1 + AGENT_BOOST * fusionNow().agentBoostMult * gap * (1 + SPIRE_BOOST * spires) * (powered + UNPOWERED_SHARE * unpowered);
}

/** How many racks stand, from the agents they can run. */
export function racksBuilt(): number {
  const r = projectReading()?.racks;
  return r ? Math.round((r.powered + r.unpowered) / agentsARack()) : 0;
}
