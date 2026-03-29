import type { GeneratorId } from "../state/generators.store";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import {
  syncAvailableUpgrades,
  type Upgrade,
  UPGRADES_CORE,
  useUpgradeStore,
} from "../state/upgrades.store";
import { getGeneratorCost } from "../utils/generator-utils";
import { advanceGameplayOneSecond } from "./run-sim";
import { resetAllGameStores } from "./reset-game-stores";

export type CorePurchaseRecord = {
  id: string;
  cost: number;
  secondsAtPurchase: number;
};

export type EmployeePurchaseRecord = {
  id: GeneratorId;
  cost: number;
  secondsAtPurchase: number;
  amountAfter: number;
};

type NextAction =
  | { kind: "gen"; id: GeneratorId; cost: number }
  | { kind: "upgrade"; id: string; cost: number };

/** Highest employee count required per role to unlock every upgrade in the list. */
export function maxUnlockCounts(upgrades: Upgrade[]): Record<GeneratorId, number> {
  const m: Record<GeneratorId, number> = {
    intern: 0,
    vibe_coder: 0,
    "10x_dev": 0,
  };
  for (const u of upgrades) {
    for (const c of u.unlockConditions) {
      const id = c.requiredId;
      m[id] = Math.max(m[id], c.requiredAmount);
    }
  }
  return m;
}

function betterAction(a: NextAction, b: NextAction): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost;
  if (a.kind === b.kind) return false;
  return a.kind === "gen" && b.kind === "upgrade";
}

function cheapestNextAction(coreIds: Set<string>): NextAction | null {
  syncAvailableUpgrades();
  const unlockedUpgrades = new Set(useUpgradeStore.getState().unlockedUpgradeIds);

  let best: NextAction | null = null;
  const consider = (c: NextAction) => {
    if (!best || betterAction(c, best)) best = c;
  };

  for (const u of useUpgradeStore.getState().availableUpgrades) {
    if (!coreIds.has(u.id) || unlockedUpgrades.has(u.id)) continue;
    consider({ kind: "upgrade", id: u.id, cost: u.cost });
  }

  for (const g of useGeneratorStore.getState().generators) {
    const id = g.id as GeneratorId;
    const cost = getGeneratorCost(id, 1).toNumber();
    consider({ kind: "gen", id, cost });
  }

  return best;
}

export type SimulateCoreRunOptions = {
  maxSimulatedSeconds?: number;
  /**
   * The live game can sit at $0 with 0 interns forever. Grant exactly this much starting cash
   * so the first `purchaseGenerator("intern", 1)` is possible (default: next-intern hire cost).
   */
  startingMoney?: number;
};

/**
 * From a reset save, ticks gameplay forward and alternates between {@link useGeneratorStore.purchaseGenerator}
 * and {@link useUpgradeStore.unlockUpgrade}. Each step waits until the **globally cheapest** next action
 * is affordable (generator +1 or available core upgrade), with ties broken in favor of hiring.
 * Buys every {@link UPGRADES_CORE} upgrade without pre-seeding max employee counts.
 */
export function simulateCoreUpgradeRun(
  advanceTimersByTime: (ms: number) => void,
  options?: SimulateCoreRunOptions
): {
  totalSeconds: number;
  purchases: CorePurchaseRecord[];
  employeePurchases: EmployeePurchaseRecord[];
} {
  const maxSim = options?.maxSimulatedSeconds ?? 86400 * 14;
  const coreIds = new Set(UPGRADES_CORE.map((u) => u.id));

  resetAllGameStores();

  const now = Date.now();
  useGeneratorStore.setState({ globalLastTick: now });
  useInnovationStore.setState({ globalLastTick: now });

  syncAvailableUpgrades();

  const firstInternCost = getGeneratorCost("intern", 1).toNumber();
  const starting =
    options?.startingMoney !== undefined ? options.startingMoney : firstInternCost;
  if (starting > 0) {
    useMoneyStore.getState().increaseMoney(starting);
  }

  const purchases: CorePurchaseRecord[] = [];
  const employeePurchases: EmployeePurchaseRecord[] = [];
  let totalSeconds = 0;

  const coreComplete = (): boolean => {
    const ids = useUpgradeStore.getState().unlockedUpgradeIds;
    return UPGRADES_CORE.every((u) => ids.includes(u.id));
  };

  while (!coreComplete()) {
    const next = cheapestNextAction(coreIds);
    if (!next) {
      const missing = UPGRADES_CORE.filter(
        (u) => !useUpgradeStore.getState().unlockedUpgradeIds.includes(u.id)
      );
      throw new Error(
        `No next action but core incomplete: missing ${missing.map((u) => u.id).join(", ")}`
      );
    }

    while (
      useMoneyStore.getState().money.toNumber() < next.cost &&
      totalSeconds < maxSim
    ) {
      advanceGameplayOneSecond(advanceTimersByTime);
      totalSeconds++;
    }

    if (useMoneyStore.getState().money.toNumber() < next.cost) {
      throw new Error(
        `Timeout on ${next.kind} ${next.id}: need ${next.cost}, have ${useMoneyStore.getState().money.toNumber()}, after ${totalSeconds}s`
      );
    }

    if (next.kind === "gen") {
      useGeneratorStore.getState().purchaseGenerator(next.id, 1);
      const g = useGeneratorStore
        .getState()
        .generators.find((x) => x.id === next.id)!;
      employeePurchases.push({
        id: next.id,
        cost: next.cost,
        secondsAtPurchase: totalSeconds,
        amountAfter: g.amount,
      });
    } else {
      useUpgradeStore.getState().unlockUpgrade(next.id);
      purchases.push({
        id: next.id,
        cost: next.cost,
        secondsAtPurchase: totalSeconds,
      });
    }
  }

  return { totalSeconds, purchases, employeePurchases };
}
