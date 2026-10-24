/**
 * What a building costs to put down.
 *
 * The map is the other half of the loop: what stands on it earns, and changing
 * it costs. Without a price, placing housing is a click and the only question
 * is where — with one, it is a decision about when.
 *
 * HOUSING IS ONE LOT A KIND, priced off the beds it holds and what the people
 * in them cost to hire; it grows from there, served by cafés, parks and gyms.
 * @see world/agents/services
 */
import Decimal from "break_infinity.js";

import { housedBy } from "./housing";
import { isAiBuilding, structureDef } from "../world/structures/def";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import { getGeneratorCost } from "../utils/generator-utils";
import { labsBuilt } from "./projects";
import { racksBuilt } from "./agents";
import { founderIs } from "./founder-rules";
import { fusionNow } from "./fusion";
import { BOOTSTRAP_BUILD } from "./founders.catalog";
import { aiActing } from "../world/ai/district";
import { keystone } from "./machine";

/** The least a lot costs, whatever the hire prices. */
const LOT_FLOOR = 15;

/**
 * The price of one building, or null if it is not something the game sells.
 *
 * Null rather than zero: "free" and "not for sale" are different answers, and
 * the caller has to be able to tell them apart before it charges anybody.
 */
export function buildCost(defId: string): Decimal | null {
  const listed = listPrice(defId);
  // WHAT THE FOUNDER'S FUSED TRAITS DO TO PRICES. @see game/fusion
  const price = listed && listed.times(fusedPriceMult(defId)).round();
  // THE BOOTSTRAPPER builds for less. @see BOOTSTRAP_BUILD
  return price && founderIs("bootstrapper") ? price.times(BOOTSTRAP_BUILD).round() : price;
}

/** What the founder's fused traits multiply a building's price by. */
function fusedPriceMult(defId: string): number {
  const f = fusionNow();
  if (SERVICE_PRICE[defId]) return f.servicesCostMult;
  if (OFFICE_FOR[defId]) return f.officeCostMult;
  if (defId === "rack") return f.rackCostMult;
  if (housedBy(defId)) return f.lotCostMult;
  return 1;
}

/** The price before any founder's rule. */
function listPrice(defId: string): Decimal | null {
  // THE AI'S OWN: put up for nothing, by itself. @see AI_BUILDINGS
  if (isAiBuilding(defId)) return new Decimal(0);
  // A SERVICE: seconds of income, never under a floor.
  const service = SERVICE_PRICE[defId];
  if (service) return Decimal.max(new Decimal(service.floor), new Decimal(safeIncome()).times(service.seconds)).round();
  // AN R&D LAB: a minute of income, half as much again for each one standing.
  if (defId === "lab") {
    return Decimal.max(new Decimal(LAB_FLOOR), new Decimal(safeIncome()).times(LAB_SECONDS)).times(LAB_STEP ** labsBuilt()).round();
  }
  // AN AI RACK: seconds of income, a little dearer for each standing. @see game/agents
  if (defId === "rack") {
    return Decimal.max(new Decimal(RACK_FLOOR), new Decimal(safeIncome()).times(RACK_SECONDS)).times(RACK_STEP ** racksBuilt()).round();
  }
  // A PUMP HOUSE: seconds of income, never under a floor. @see PUMP
  if (defId === "pump") return Decimal.max(new Decimal(PUMP_FLOOR), new Decimal(safeIncome()).times(PUMP_SECONDS)).round();
  // A FLOOD WALL: cheap, a tile at a time.
  if (defId === "levee") return Decimal.max(new Decimal(LEVEE_FLOOR), new Decimal(safeIncome()).times(LEVEE_SECONDS)).round();
  // AN OFFICE: so many hires' worth of the people who will work there.
  const office = OFFICE_FOR[defId];
  if (office) {
    return Decimal.max(new Decimal(office.floor), getGeneratorCost(office.who, 1).times(OFFICE_HIRES));
  }
  const port = structureDef(defId)?.port;
  if (port) {
    const floor = new Decimal(PORT_PER_CALL_A_MINUTE * callsAMinute(port)).round();
    const live = new Decimal(safeIncome()).times(PORT_INCOME_SECONDS_PER_CALL * callsAMinute(port)).round();
    return Decimal.max(floor, live).round();
  }
  const h = housedBy(defId);
  if (!h || h.slots <= 0) return null;
  // ONE LOT A KIND IS FOR SALE: the smallest. The bigger ones are what a lot
  // GROWS into, served by cafés, parks and gyms — not something to buy.
  // @see world/agents/services
  if (!/\.t0$/.test(defId)) return null;
  const floor = new Decimal(LOT_FLOOR);
  // SCALED BY WHAT THE PEOPLE IT HOUSES COST TO HIRE: a share of the next
  // hire's price a bed.
  const live = getGeneratorCost(h.id, 1).times(h.slots * BED_SHARE);
  return Decimal.max(floor, live).round();
}

/**
 * PRICES FOLLOW THE ECONOMY. A fixed price is a wall early in a run and a
 * rounding error late in one — hire prices and income grow by orders of
 * magnitude — so each price is the larger of a FLOOR (the fixed price it
 * always had, so a new company still feels it) and a share of the economy:
 *  - housing, a share of the hire price of the people it is for: the beds are
 *    part of the cost of hiring them;
 *  - a seaport, seconds of income for each boat a minute it turns round.
 */
const BED_SHARE = 0.25;
/** Cafés, parks and gyms: seconds of income, never under a floor. @see world/agents/services */
const SERVICE_PRICE: Record<string, { seconds: number; floor: number }> = {
  cafe: { seconds: 4, floor: 150 },
  park: { seconds: 8, floor: 400 },
  gym: { seconds: 16, floor: 2000 },
};
/** A pump house: seconds of income, never under a floor. */
const PUMP_SECONDS = 15;
const PUMP_FLOOR = 25_000;
/** An AI rack: seconds of income, never under a floor, and dearer by this for each one standing. */
const RACK_SECONDS = 20;
const RACK_FLOOR = 100_000;
const RACK_STEP = 1.15;
/** An R&D lab: seconds of income, never under a floor, and dearer by this for each one built. */
const LAB_SECONDS = 60;
const LAB_FLOOR = 100_000;
const LAB_STEP = 1.5;
/** A tile of flood wall: half a second of income, never under a floor. */
const LEVEE_SECONDS = 0.5;
const LEVEE_FLOOR = 20;
/** An office costs this many of the next hire's price, never under a floor. */
const OFFICE_HIRES = 4;
const OFFICE_FOR: Record<string, { who: GeneratorId; floor: number }> = {
  "office-intern": { who: "intern", floor: 150 },
  "office-vibe": { who: "vibe_coder", floor: 2500 },
  "office-10x": { who: "10x_dev", floor: 50_000 },
};

/** Seconds of income a seaport costs, per boat a minute: 30 s, 80 s, 180 s by tier. */
const PORT_INCOME_SECONDS_PER_CALL = 10;

const safeIncome = () => {
  const n = useGeneratorStore.getState().getMoneyPerSecond();
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * A SEAPORT IS PRICED OFF WHAT IT HANDLES: the boats a minute it can turn
 * round, every berth busy. So a tier that takes six times the traffic costs
 * six times as much — the same deal at every size, and the choice is about
 * the ground on the bank, not the price per boat:
 *
 *   tier 1 — 1 berth, 20 s a call —  3 a minute —  240
 *   tier 2 — 2 berths, 15 s       —  8 a minute —  640
 *   tier 3 — 3 berths, 10 s       — 18 a minute — 1440
 */
const PORT_PER_CALL_A_MINUTE = 80;
const callsAMinute = (p: { berths: number; dockSeconds: number }) => (p.berths * 60) / p.dockSeconds;

/**
 * WHAT A PORT IS PAID FOR A CALL: a boat that lay its time alongside and cast
 * off. Seconds of the company's income, more at a bigger port, and never
 * under a floor — so a port earns its keep at any size of company, and pays
 * itself back in ten to twenty minutes of steady trade.
 *
 *   tier 1 — 0.5 s of income a call, at least 4 —  3 calls a minute
 *   tier 2 — 0.75 s,                 at least 8 —  8 a minute
 *   tier 3 — 1 s,                    at least 16 — 18 a minute
 *
 * Null for anything that is not a port.
 */
export function portCallFee(defId: string, income = safeIncome()): number | null {
  const port = structureDef(defId)?.port;
  if (!port) return null;
  const tier = Math.min(3, Math.max(1, port.berths));
  const live = Number.isFinite(income) && income > 0 ? income * CALL_SECONDS[tier] : 0;
  return Math.max(CALL_FLOOR[tier], live);
}
const CALL_SECONDS: Record<number, number> = { 1: 0.5, 2: 0.75, 3: 1 };
const CALL_FLOOR: Record<number, number> = { 1: 4, 2: 8, 3: 16 };

/**
 * WHAT ROAD COSTS: so many tiles, each the larger of a little money and a
 * quarter of a second of income — cheap, so a town is laid out for where
 * things should go and not for what the road costs, but not nothing, so it is
 * not painted everywhere.
 */
export function roadCost(tiles: number): Decimal {
  const each = Math.max(ROAD_FLOOR, safeIncome() * ROAD_INCOME_SECONDS);
  return new Decimal(Math.round(each * tiles));
}
const ROAD_FLOOR = 2;
const ROAD_INCOME_SECONDS = 0.25;

/** WHAT PIPE COSTS: as road, a tile at a time, at twice the price — it is dug in. @see the Pipe tool */
export function pipeCost(tiles: number): Decimal {
  return roadCost(tiles).times(PIPE_PER_ROAD);
}
export const PIPE_PER_ROAD = 2;
/** What widening a main's bore costs, for its tiles not yet widened: twice laying them. */
export function boreCost(tiles: number): Decimal {
  return pipeCost(tiles).times(BORE_PER_PIPE);
}
export const BORE_PER_PIPE = 2;

/**
 * What upgrading one building into another costs, or null if it is not sold:
 * the DIFFERENCE between the two prices, so a port built a tier at a time
 * costs exactly what building the top tier outright would have. Never less
 * than nothing.
 */
export function upgradeCost(fromId: string, toId: string): Decimal | null {
  const to = buildCost(toId);
  if (!to) return null;
  const from = buildCost(fromId) ?? new Decimal(0);
  return Decimal.max(to.minus(from), 0);
}

/** Whether the player could afford this, without charging them. */
export function canAfford(price: Decimal | null): boolean {
  if (!price) return false;
  return useMoneyStore.getState().money.gte(price);
}

/**
 * Charge for a building, and say whether it went through.
 *
 * CHECKS AND CHARGES TOGETHER so a caller cannot spend without placing or
 * place without spending — the same trap the hiring gate has, where the money
 * moves before the thing arrives. A false answer means nothing was taken.
 */
export function spendForBuild(price: Decimal | null): boolean {
  // HARD TAKEOFF: what the AI builds is paid in compute. @see game/machine KEYSTONES
  if (price && aiActing() && keystone("takeoff")) return true;
  if (!canAfford(price) || !price) return false;
  useMoneyStore.getState().spendMoney(price.toNumber());
  return true;
}
