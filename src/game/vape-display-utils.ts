import Decimal from "break_infinity.js";
import { JUICE_SHOP_UPGRADES } from "./achievements.juice-shop";

export function nextUnpurchasedJuiceShopMinCost(
  purchasedIds: ReadonlySet<string>,
): number {
  const left = JUICE_SHOP_UPGRADES.filter((u) => !purchasedIds.has(u.id));
  if (left.length === 0) return 100;
  return Math.min(...left.map((u) => u.cost));
}

/** Display fill 0–1: juice vs dynamic capacity (plan: max of floor, next shop cost, lifetime earned, current juice). */
export function vapeTankFillRatio(
  juice: Decimal,
  lifetimeEarnedFromAchievements: Decimal,
  purchasedUpgradeIds: string[],
): number {
  const purchased = new Set(purchasedUpgradeIds);
  const nextCost = nextUnpurchasedJuiceShopMinCost(purchased);
  const cap = Math.max(
    100,
    nextCost,
    lifetimeEarnedFromAchievements.toNumber(),
    juice.toNumber(),
  );
  if (cap <= 0) return 0;
  return Math.min(1, juice.toNumber() / cap);
}
