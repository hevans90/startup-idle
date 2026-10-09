/**
 * What a building costs to put down.
 *
 * The map is the other half of the loop: what stands on it earns, and changing
 * it costs. Without a price, placing housing is a click and the only question
 * is where — with one, it is a decision about when.
 *
 * PRICED OFF THE TIER, not off a table. The kit ids already carry the district
 * and the tier (`kit:intern.t0`), and `housedBy` already reads them — so the
 * price follows the beds, and a building that houses six times as many costs
 * more than six times as much. That is what stops "always build the biggest"
 * being the only move: bigger is better per cell of ground, and worse per
 * pound, so which one is right depends on whether you are short of money or
 * short of frontage.
 */
import Decimal from "break_infinity.js";

import { housedBy } from "./housing";
import { structureDef } from "../world/structures/def";
import { useGeneratorStore } from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";
import { getGeneratorCost } from "../utils/generator-utils";

/** What the smallest housing costs. Everything else is priced from here. */
const BASE = 25;

/**
 * How much dearer a bed gets in a bigger building.
 *
 * Above one, so the big ones are a premium for the ground they save rather
 * than a strictly better deal. @see buildCost
 */
const PER_BED = 1.35;

/**
 * The price of one building, or null if it is not something the game sells.
 *
 * Null rather than zero: "free" and "not for sale" are different answers, and
 * the caller has to be able to tell them apart before it charges anybody.
 */
export function buildCost(defId: string): Decimal | null {
  const port = structureDef(defId)?.port;
  if (port) {
    const floor = new Decimal(PORT_PER_CALL_A_MINUTE * callsAMinute(port)).round();
    const live = new Decimal(safeIncome()).times(PORT_INCOME_SECONDS_PER_CALL * callsAMinute(port)).round();
    return Decimal.max(floor, live);
  }
  const h = housedBy(defId);
  if (!h || h.slots <= 0) return null;
  const floor = new Decimal(BASE).times(Decimal.pow(PER_BED, h.slots));
  // SCALED BY WHAT THE PEOPLE IT HOUSES COST TO HIRE: a share of the next
  // hire's price a bed, more a bed the bigger the building.
  const tier = /\.(t0|t1|t2|landmark)$/.exec(defId)?.[1] ?? "t0";
  const live = getGeneratorCost(h.id, 1).times(h.slots * BED_SHARE * (TIER_PREMIUM[tier] ?? 1));
  return Decimal.max(floor, live);
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
/** More a bed in a bigger building: the ground it saves is the premium. */
const TIER_PREMIUM: Record<string, number> = { t0: 1, t1: 1.1, t2: 1.25, landmark: 1.5 };
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
  if (!canAfford(price) || !price) return false;
  useMoneyStore.getState().spendMoney(price.toNumber());
  return true;
}
