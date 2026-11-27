import Decimal from "break_infinity.js";
import {
  buildAdjacency,
  frontierPath,
  nodeById,
  resolvePrestigeModifiers,
  SKILL_TREE,
  type BonusStat,
} from "../game/skill-tree";
import { useExitsStore } from "../state/exits.store";
import { useFounderStore } from "../state/founder.store";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { ManagerKeyValues, useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import {
  syncAvailableUpgrades,
  useUpgradeStore,
} from "../state/upgrades.store";
import {
  MANDATES,
  useValuationStore,
  type MandateId,
} from "../state/valuation.store";
import {
  getGeneratorCost,
  getMaxAffordableAmountAndCost,
} from "../utils/generator-utils";
import { resetAllGameStores } from "./reset-game-stores";
import { advanceGameplayOneSecond } from "./run-sim";

/**
 * Headless balance simulator.
 *
 * Drives the REAL stores (same tick, same multiplier chokepoints as the game),
 * so it answers "what does this build/founder/tuning actually produce?" without
 * playing. Intended for A/B-ing balance changes: retune a number, re-run, diff.
 *
 * ── What it models ────────────────────────────────────────────────────────────
 * A single run, from a fresh reset, played by a greedy virtual player. Each
 * simulated second it:
 *   1. ticks the game,
 *   2. (optionally) buys 10x devs whenever affordable,
 *   3. repeatedly buys the cheapest affordable action (generator or upgrade),
 *   4. unlocks Managers / Employee Management and assigns managers,
 *   5. buys the cheapest affordable board mandate,
 *   6. spends management points on employee perks per `perkPolicy`.
 *
 * ── Limitations (read before trusting a number) ───────────────────────────────
 * • ONE run only. `founderExits` is an INPUT, not something the sim accumulates
 *   — it does not model the prestige loop, so it cannot tell you how long it
 *   takes to *reach* a given exit count.
 * • The virtual player is greedy, not optimal. A human who deliberately saves
 *   for a specific purchase will beat it; `perkPolicy` in particular is a crude
 *   stand-in for real perk decisions.
 * • The economy is hyper-exponential, so absolute figures at a fixed horizon
 *   swing wildly with small input changes. Trust it for COMPARISONS between
 *   runs at identical settings; treat absolutes as order-of-magnitude only.
 * • Requires fake timers — hence the injected `advanceTimersByTime`, matching
 *   {@link simulateCoreUpgradeRun}'s convention.
 */

const ADJACENCY = buildAdjacency(SKILL_TREE);
const NODES = nodeById(SKILL_TREE);

/** Rough value weighting used only to pad an allocation out to `size` nodes. */
const FILL_WEIGHT: Record<BonusStat, number> = {
  money: 1.0,
  employeeOutput: 1.1,
  valuation: 0.7,
  innovation: 0.5,
  headcount: 3.0,
  hireCost: 0.6,
  managerSpeed: 0.2,
  autoBuy: 0.1,
  equity: 0.05,
  singularity: 0.0,
  satisfactionGain: 0.05,
};

const fillValue = (id: string): number => {
  const node = NODES.get(id);
  if (!node?.grants) return 0.01;
  let v = 0;
  for (const g of node.grants) {
    const w = FILL_WEIGHT[g.stat] ?? 0;
    if (g.kind === "pct") v += w * (g.stat === "hireCost" ? -g.value : g.value);
    else v += w * (g.value >= 1 ? (g.value - 1) * 100 : -(1 - g.value) * 100);
  }
  return v;
};

/**
 * Build a connected skill-tree allocation that reaches every id in `targets`
 * (cheapest route from the root), then pads to `size` nodes with the
 * highest-value reachable nodes. Keystones are never added by the padding, so
 * the allocation contains exactly the keystones you asked for.
 *
 * `size` maps to Equity via the escalating `nodeCost` — 130 nodes ≈ 10k Equity.
 */
export function allocationFor(targets: string[], size = 130): string[] {
  const allocated = new Set<string>(["core"]);
  for (const t of targets) {
    if (allocated.has(t)) continue;
    for (const n of frontierPath(SKILL_TREE, allocated, t, ADJACENCY)) {
      allocated.add(n);
    }
  }
  const wantedKeystones = new Set(
    targets.filter((t) => NODES.get(t)?.kind === "keystone"),
  );
  while (allocated.size < size) {
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const id of NODES.keys()) {
      if (allocated.has(id)) continue;
      const node = NODES.get(id);
      if (node?.kind === "keystone" && !wantedKeystones.has(id)) continue;
      let reachable = false;
      for (const nb of ADJACENCY.get(id) ?? []) {
        if (allocated.has(nb)) {
          reachable = true;
          break;
        }
      }
      if (!reachable) continue;
      const score = fillValue(id);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (!best) break;
    allocated.add(best);
  }
  return [...allocated];
}

/** How the virtual player spends management points on employee perks. */
export type PerkPolicy = "none" | "money" | "innovation" | "balanced";

export type BalanceSimOptions = {
  /** Allocated skill-tree node ids — see {@link allocationFor}. */
  allocated?: string[];
  founderId?: string | null;
  /** Exits banked *as that founder*, which drives its scaling modifier. */
  founderExits?: number;
  /** Simulated seconds to run (default 2 hours). */
  seconds?: number;
  perkPolicy?: PerkPolicy;
  /** Buy 10x devs whenever affordable (models a dev-count-targeting player). */
  prioritise10xDevs?: boolean;
};

export type BalanceSimResult = {
  /** Total valuation accrued — what the Equity payout is derived from. */
  accruedValuation: number;
  moneyPerSecond: number;
  innovation: number;
  employees: Record<GeneratorId, number>;
  /** Fraction of $/sec produced by each role (sums to ~1). */
  moneyShare: Record<GeneratorId, number>;
  upgradesPurchased: number;
  managerTiers: number;
  mandateLevels: number;
  /** Highest 10x dev count reached (they never decrease within a run). */
  peak10xDevs: number;
};

const cheapestUnboughtUpgrade = () => {
  const owned = new Set(useUpgradeStore.getState().unlockedUpgradeIds);
  return useUpgradeStore
    .getState()
    .availableUpgrades.filter((u) => !owned.has(u.id))
    .sort((a, b) => a.cost - b.cost)[0];
};

/** Buy the cheapest affordable action repeatedly, bounded so one second can't spin. */
function spendMoney(): void {
  for (let guard = 0; guard < 80; guard++) {
    syncAvailableUpgrades();
    const upgrade = cheapestUnboughtUpgrade();
    const upgradeCost = upgrade ? upgrade.cost : Infinity;

    let cheapestGen: { id: GeneratorId; cost: number } | null = null;
    for (const gen of useGeneratorStore.getState().generators) {
      const cost = getGeneratorCost(gen.id, 1).toNumber();
      if (!cheapestGen || cost < cheapestGen.cost) {
        cheapestGen = { id: gen.id as GeneratorId, cost };
      }
    }

    const money = useMoneyStore.getState().money;
    const canBuyUpgrade = upgrade != null && money.gte(upgradeCost);
    const canBuyGen = cheapestGen != null && money.gte(cheapestGen.cost);
    if (!canBuyUpgrade && !canBuyGen) break;

    if (canBuyGen && (!canBuyUpgrade || cheapestGen!.cost <= upgradeCost)) {
      const { amount } = getMaxAffordableAmountAndCost(cheapestGen!.id);
      useGeneratorStore
        .getState()
        .purchaseGenerator(cheapestGen!.id, Math.min(Math.max(1, amount), 250));
    } else if (upgrade) {
      useUpgradeStore.getState().unlockUpgrade(upgrade.id);
    }
  }
}

/** Unlock Managers / Employee Management, then keep manager assignment balanced. */
function spendInnovation(): void {
  const store = () => useInnovationStore.getState();
  if (!store().unlocks.managers.unlocked && store().innovation.gte(1)) {
    store().unlock("managers");
  }
  if (
    !store().unlocks.employeeManagement.unlocked &&
    store().innovation.gte(5)
  ) {
    store().unlock("employeeManagement");
  }
  if (!store().unlocks.managers.unlocked) return;

  store().setAssignment(1);
  for (let guard = 0; guard < 40; guard++) {
    const managers = store().managers;
    const key = [...ManagerKeyValues].sort(
      (a, b) => managers[a].assignment.toNumber() - managers[b].assignment.toNumber(),
    )[0];
    const cost = new Decimal(1.5).pow(managers[key].assignment);
    if (store().innovation.lt(cost)) break;
    const before = store().managers[key].assignment.toNumber();
    store().assignManager(key);
    if (store().managers[key].assignment.toNumber() <= before) break;
  }
}

/** Board mandates persist across prestige, so the player always buys them. */
function spendValuation(): void {
  for (let guard = 0; guard < 20; guard++) {
    let cheapest: MandateId | null = null;
    let cheapestCost = Infinity;
    for (const def of MANDATES) {
      const cost = useValuationStore.getState().getMandateCost(def.id).toNumber();
      if (cost < cheapestCost) {
        cheapestCost = cost;
        cheapest = def.id;
      }
    }
    if (!cheapest || !useValuationStore.getState().canAffordMandate(cheapest)) break;
    useValuationStore.getState().purchaseMandate(cheapest);
  }
}

function spendManagementPoints(policy: PerkPolicy): void {
  if (policy === "none") return;
  const gs = useGeneratorStore.getState();
  for (let guard = 0; guard < 40; guard++) {
    if (gs.getAvailableManagementPoints() <= 0) break;
    let bought = false;
    for (const id of ["intern", "vibe_coder", "10x_dev"] as GeneratorId[]) {
      const perks = gs.getEmployeePerks(id);
      const branch =
        policy === "money"
          ? "money"
          : policy === "innovation"
            ? "innovation"
            : perks.innovationLevel <= perks.moneyLevel
              ? "innovation"
              : "money";
      if (gs.canPurchaseEmployeePerk(id, branch)) {
        gs.purchaseEmployeePerk(id, branch);
        bought = true;
      } else if (gs.canPurchaseEmployeePerk(id, "cost")) {
        gs.purchaseEmployeePerk(id, "cost");
        bought = true;
      }
    }
    if (!bought) break;
  }
}

/**
 * Run one simulated game. `advanceTimersByTime` must advance fake timers (pass
 * `jest.advanceTimersByTime.bind(jest)` from a `bun:test` file).
 */
export function runBalanceSim(
  advanceTimersByTime: (ms: number) => void,
  options: BalanceSimOptions = {},
): BalanceSimResult {
  const seconds = options.seconds ?? 7200;
  const perkPolicy = options.perkPolicy ?? "balanced";

  resetAllGameStores();

  const allocated = options.allocated ?? [];
  usePrestigeStore.setState({
    allocated,
    modifiers: resolvePrestigeModifiers(allocated),
  });
  const modifiers = usePrestigeStore.getState().modifiers;

  if (options.founderId) {
    if (options.founderExits && options.founderExits > 0) {
      // Seed the monotonic per-founder exit count so chooseFounder derives the
      // scaled modifiers (NEET's 2^exits money, Hustler's money/employee, ...).
      useExitsStore.setState({
        exits: {
          [options.founderId]: {
            count: options.founderExits,
            totalValuation: 1e12,
          },
        },
        bestExitValuation: 1e12,
      });
    }
    useFounderStore.getState().chooseFounder(options.founderId);
  }
  if (modifiers.freeStartingLevels > 0) {
    useGeneratorStore
      .getState()
      .increaseGenerator("intern", modifiers.freeStartingLevels);
  }

  const now = Date.now();
  useGeneratorStore.setState({ globalLastTick: now });
  useInnovationStore.setState({ globalLastTick: now });
  // Enough to afford the first intern, mirroring simulateCoreUpgradeRun.
  useMoneyStore
    .getState()
    .increaseMoney(Math.max(10, getGeneratorCost("intern", 1).toNumber()));

  let peak10xDevs = 0;
  const devCount = () =>
    useGeneratorStore.getState().generators.find((g) => g.id === "10x_dev")
      ?.amount ?? 0;

  for (let s = 0; s < seconds; s++) {
    advanceGameplayOneSecond(advanceTimersByTime);
    if (options.prioritise10xDevs) {
      const dev = useGeneratorStore
        .getState()
        .generators.find((g) => g.id === "10x_dev");
      if (dev) {
        const { amount } = getMaxAffordableAmountAndCost("10x_dev");
        if (amount > 0) {
          useGeneratorStore.getState().purchaseGenerator("10x_dev", amount);
        }
      }
    }
    spendMoney();
    spendInnovation();
    spendValuation();
    spendManagementPoints(perkPolicy);
    peak10xDevs = Math.max(peak10xDevs, devCount());
  }

  const gs = useGeneratorStore.getState();
  const breakdown = gs.getMoneyBreakdown();
  const perRole: Record<GeneratorId, number> = {
    intern: 0,
    vibe_coder: 0,
    "10x_dev": 0,
  };
  for (const g of breakdown.perGenerator) perRole[g.id] = g.total;
  const totalMps = breakdown.total || 1;
  const amountOf = (id: GeneratorId) =>
    gs.generators.find((g) => g.id === id)?.amount ?? 0;

  return {
    accruedValuation: useValuationStore.getState().accruedThisRun.toNumber(),
    moneyPerSecond: gs.getMoneyPerSecond(),
    innovation: useInnovationStore.getState().innovation.toNumber(),
    employees: {
      intern: amountOf("intern"),
      vibe_coder: amountOf("vibe_coder"),
      "10x_dev": amountOf("10x_dev"),
    },
    moneyShare: {
      intern: perRole.intern / totalMps,
      vibe_coder: perRole.vibe_coder / totalMps,
      "10x_dev": perRole["10x_dev"] / totalMps,
    },
    upgradesPurchased: useUpgradeStore.getState().unlockedUpgradeIds.length,
    managerTiers: ManagerKeyValues.reduce(
      (n, k) =>
        n + useInnovationStore.getState().managers[k].tier.floor().toNumber(),
      0,
    ),
    mandateLevels: Object.values(
      useValuationStore.getState().mandateLevels,
    ).reduce((a, b) => a + b, 0),
    peak10xDevs,
  };
}
