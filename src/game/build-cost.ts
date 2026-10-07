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
import { useMoneyStore } from "../state/money.store";

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
  if (port) return new Decimal(PORT_PER_CALL_A_MINUTE * callsAMinute(port)).round();
  const h = housedBy(defId);
  if (!h || h.slots <= 0) return null;
  return new Decimal(BASE).times(Decimal.pow(PER_BED, h.slots));
}

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
