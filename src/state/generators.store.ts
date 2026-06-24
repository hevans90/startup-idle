import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { setEmployeeSatisfactionReaders } from "../game/employee-satisfaction-read";
import {
  getManagerEconomyMultipliers,
  getValuationEconomyMultipliers,
} from "../game/economy-multipliers";
import {
  defaultSatisfactionScores,
  internSatisfactionIpsMultiplier,
  internSatisfactionValuationMultiplier,
  satisfactionRevenueMultiplier,
  SATISFACTION_MAX,
  SATISFACTION_MIN,
  stepSatisfactionScores,
  type SatisfactionScores,
} from "../game/satisfaction";
import {
  getGeneratorCost,
  getUnlockedGeneratorIds,
} from "../utils/generator-utils";
import {
  getManagementTierTotal,
  useInnovationStore,
} from "./innovation.store";
import { useFounderStore } from "./founder.store";
import { usePrestigeStore } from "./prestige.store";
import { useMoneyStore } from "./money.store";
import { useValuationStore } from "./valuation.store";
import { useAiSingularityStore } from "./ai-singularity.store";
import { syncAvailableUpgrades } from "./upgrades.store";
import { useVapeAchievementsStore } from "./vape-achievements.store";

export type UnlockCondition = {
  requiredId: GeneratorId;
  requiredAmount: number;
};

export type Generator = {
  id: GeneratorId;
  name: string;
  cost: number;
  costExponent: number;
  baseProduction: number;
  interval: number;
  unlockConditions?: UnlockCondition[];
  innovationProduction: number;
};

export type OwnedGenerator = Generator & {
  amount: number; // amount owned
  lastTick: number; // timestamp of last tick
  multiplier: number; // persistent multiplier from upgrades
  costMultiplier: number; // persistent multiplier from upgrades
  innovationMultiplier: number; // persistent multiplier from upgrades
};

export type EmployeePerks = {
  moneyLevel: number;
  innovationLevel: number;
  costLevel: number;
  autoBuyLevel: number;
};

export type EmployeePerkBranch = "money" | "innovation" | "cost" | "auto";

export type GeneratorId = "intern" | "vibe_coder" | "10x_dev";

/** Per-hire ratio must stay above 1 or costs tend to 0 at high counts; upgrades clamp to this floor. */
export const MIN_GENERATOR_COST_EXPONENT = 1.02;

const MAX_MONEY_INNO_LEVEL = 25;
const MAX_COST_LEVEL = 15;
const MAX_AUTO_LEVEL = 5;

const MONEY_MULT_PER_LEVEL = 0.2;
const INNO_MULT_PER_LEVEL = 0.2;
/** Per −Cost level; stronger than legacy 0.985 so tier spend meaningfully cuts hire price. */
const COST_DISCOUNT_BASE = 0.968;
const AUTO_BUY_PER_LEVEL = 0.175;

type EmployeeManagementData = {
  spentManagementPoints: number;
  perks: Record<GeneratorId, EmployeePerks>;
  autoBuyAcc: Partial<Record<GeneratorId, number>>;
};

/** A full, human-readable breakdown of a per-second resource (money / innovation). */
export type ResourceBreakdown = {
  total: number;
  /** Multipliers applied to every employee's output. */
  globals: { label: string; mult: number }[];
  /** Per-employee-type contribution + its own multipliers. */
  perGenerator: {
    id: GeneratorId;
    name: string;
    amount: number;
    perUnit: number;
    total: number;
    factors: { label: string; mult: number }[];
  }[];
};

/**
 * Where valuation/sec comes from: a revenue "engine" (a sub-linear function of
 * $/sec) scaled by board/morale/founder multipliers. Not per-generator, so it
 * has its own shape rather than reusing {@link ResourceBreakdown}.
 */
export type ValuationBreakdown = {
  /** Valuation accrued per second (the engine after all multipliers). */
  total: number;
  /** Engine output before the multiplier factors. */
  base: number;
  /** The $/sec feeding the engine. */
  mps: number;
  /** Multipliers applied to the engine (managers / morale / founder). */
  factors: { label: string; mult: number }[];
};

type GeneratorState = {
  generators: OwnedGenerator[];
  globalLastTick: number;
  purchaseMode: "single" | "max";
  setPurchaseMode: (mode: "single" | "max") => void;

  employeeManagement: EmployeeManagementData;
  satisfactionScores: SatisfactionScores;
  /** A role's satisfaction score after skill-tree keystones (Crunch Mode → 0,
   * Enshittify → positive side scaled). All satisfaction multipliers read this. */
  getEffectiveSatisfaction: (id: GeneratorId) => number;

  addGenerator: (gen: OwnedGenerator) => void;
  increaseGenerator: (id: string, count?: number) => void;
  tickGenerators: () => void;
  purchaseGenerator: (id: string, amount: number) => void;

  getMoneyPerSecond: () => number;
  /** $/sec for `units` of one generator, with the full multiplier chain. */
  getGeneratorMoneyPerSecond: (id: GeneratorId, units: number) => number;
  /** Full per-employee + global breakdown of $/sec (for the money popover). */
  getMoneyBreakdown: () => ResourceBreakdown;
  getInnovationPerSecond: () => number;
  /** Innovation/sec for `units` of one generator, with the full multiplier chain. */
  getGeneratorInnovationPerSecond: (id: GeneratorId, units: number) => number;
  /** Full per-employee + global breakdown of innovation/sec. */
  getInnovationBreakdown: () => ResourceBreakdown;
  /** Valuation accrued per second (drives the board/mandate economy). */
  getValuationPerSecond: () => number;
  /** Full breakdown of valuation/sec (for the valuation popover). */
  getValuationBreakdown: () => ValuationBreakdown;

  getEmployeePerks: (id: GeneratorId) => EmployeePerks;
  getEmployeeOutputMults: (id: GeneratorId) => { money: number; innovation: number };
  getEmployeeCostMult: (id: GeneratorId) => number;
  getAutoBuyRate: (id: GeneratorId) => number;
  getAvailableManagementPoints: () => number;
  getEmployeePerkNextCost: (
    id: GeneratorId,
    branch: EmployeePerkBranch
  ) => number;
  canPurchaseEmployeePerk: (id: GeneratorId, branch: EmployeePerkBranch) => boolean;
  purchaseEmployeePerk: (id: GeneratorId, branch: EmployeePerkBranch) => void;
  /** Returns management points spent on this role’s perks (sum of historical purchase costs). */
  getManagementPointsSpentOnRow: (id: GeneratorId) => number;
  refundEmployeeManagementRow: (id: GeneratorId) => void;

  reset: () => void;
};

export const GENERATOR_TYPES: Generator[] = [
  {
    id: "intern",
    name: "intern",
    baseProduction: 1,
    interval: 1000,
    cost: 5,
    costExponent: 1.1,
    innovationProduction: 1e-7,
  },
  {
    id: "vibe_coder",
    name: "vibe coder",
    baseProduction: 5,
    interval: 1000,
    cost: 100,
    costExponent: 1.2,
    unlockConditions: [{ requiredId: "intern", requiredAmount: 10 }],
    innovationProduction: 1e-6,
  },
  {
    id: "10x_dev",
    name: "10x dev",
    baseProduction: 100,
    interval: 1000,
    cost: 1000,
    costExponent: 10,
    unlockConditions: [{ requiredId: "vibe_coder", requiredAmount: 10 }],
    innovationProduction: 1e-3,
  },
];

const GENERATOR_PERSIST_KEY = "generators";
/** Legacy split save; read once for migration into the persist blob. */
const EMPLOYEE_MGMT_STORAGE_KEY = "employeeManagement";
const MAX_CATCH_UP_MS = 7 * 24 * 60 * 60 * 1000;

function clampPersistedScore(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(SATISFACTION_MAX, Math.max(SATISFACTION_MIN, n));
}

const defaultEmployeePerks = (): EmployeePerks => ({
  moneyLevel: 0,
  innovationLevel: 0,
  costLevel: 0,
  autoBuyLevel: 0,
});

const mergeEmployeePerks = (
  partial?: Partial<Record<GeneratorId, EmployeePerks>>
): Record<GeneratorId, EmployeePerks> => ({
  intern: { ...defaultEmployeePerks(), ...partial?.intern },
  vibe_coder: { ...defaultEmployeePerks(), ...partial?.vibe_coder },
  "10x_dev": { ...defaultEmployeePerks(), ...partial?.["10x_dev"] },
});

const defaultEmployeeManagement = (): EmployeeManagementData => ({
  spentManagementPoints: 0,
  perks: mergeEmployeePerks(),
  autoBuyAcc: {},
});

const parseEmployeeManagementJson = (raw: string | null): EmployeeManagementData => {
  if (!raw) return defaultEmployeeManagement();
  try {
    const parsed = JSON.parse(raw) as {
      spentManagementPoints?: number;
      perks?: Partial<Record<GeneratorId, Partial<EmployeePerks>>>;
      autoBuyAcc?: Partial<Record<GeneratorId, number>>;
    };
    const perksIn = parsed.perks ?? {};
    const merged: Partial<Record<GeneratorId, EmployeePerks>> = {};
    for (const id of ["intern", "vibe_coder", "10x_dev"] as GeneratorId[]) {
      merged[id] = { ...defaultEmployeePerks(), ...perksIn[id] };
    }
    return {
      spentManagementPoints: parsed.spentManagementPoints ?? 0,
      perks: mergeEmployeePerks(merged),
      autoBuyAcc: parsed.autoBuyAcc ?? {},
    };
  } catch {
    return defaultEmployeeManagement();
  }
};

const normalizeEmployeeManagement = (
  value: unknown
): EmployeeManagementData => {
  if (!value || typeof value !== "object") return defaultEmployeeManagement();
  return parseEmployeeManagementJson(JSON.stringify(value));
};

const reconcileGeneratorsFromSavedArray = (
  savedData: OwnedGenerator[]
): OwnedGenerator[] => {
  const ownedMap = Object.fromEntries(savedData.map((g) => [g.id, g]));
  const unlockedIds = getUnlockedGeneratorIds(savedData);

  return GENERATOR_TYPES.filter((gen) => unlockedIds.includes(gen.id)).map(
    (gen) => {
      const saved = ownedMap[gen.id];
      return {
        ...gen,
        amount: saved?.amount ?? 0,
        multiplier: saved?.multiplier ?? 1,
        costExponent: Math.max(
          MIN_GENERATOR_COST_EXPONENT,
          saved?.costExponent ?? gen.costExponent
        ),
        costMultiplier: saved?.costMultiplier ?? 1,
        lastTick: saved?.lastTick ?? Date.now(),
        innovationMultiplier: saved?.innovationMultiplier ?? 1,
      } satisfies OwnedGenerator;
    }
  );
};

const readLegacyEmployeeManagementFromStorage = (): EmployeeManagementData => {
  return parseEmployeeManagementJson(
    localStorage.getItem(EMPLOYEE_MGMT_STORAGE_KEY)
  );
};

const generatorStateStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name);
    if (!raw) {
      const emOnly = localStorage.getItem(EMPLOYEE_MGMT_STORAGE_KEY);
      if (!emOnly) return null;
      return JSON.stringify({
        state: {
          generators: reconcileGeneratorsFromSavedArray([]),
          employeeManagement: parseEmployeeManagementJson(emOnly),
        },
        version: 0,
      });
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "state" in (parsed as object)
      ) {
        return raw;
      }
      if (Array.isArray(parsed)) {
        const em = readLegacyEmployeeManagementFromStorage();
        return JSON.stringify({
          state: {
            generators: reconcileGeneratorsFromSavedArray(
              parsed as OwnedGenerator[]
            ),
            employeeManagement: em,
          },
          version: 0,
        });
      }
    } catch {
      return null;
    }
    return raw;
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

export const syncUnlockedGenerators = (): void => {
  const state = useGeneratorStore.getState();
  const unlockedIds = getUnlockedGeneratorIds(state.generators);
  const byId = new Map(state.generators.map((g) => [g.id, g]));

  // Reconcile the roster to exactly the unlocked set: keep existing entries,
  // add newly-unlocked ones, and DROP any that are no longer buildable (e.g. a
  // founder restriction like the Agentic Delusionist's vibe-coders-only). In
  // normal play unlocks are monotonic so nothing is ever dropped.
  const next: OwnedGenerator[] = unlockedIds.map((id) => {
    const existing = byId.get(id);
    if (existing) return existing;
    const base = GENERATOR_TYPES.find((g) => g.id === id)!;
    return {
      ...base,
      amount: 0,
      multiplier: 1,
      costMultiplier: 1,
      innovationMultiplier: 1,
      lastTick: Date.now(),
    } satisfies OwnedGenerator;
  });

  const unchanged =
    next.length === state.generators.length &&
    next.every((g, i) => g.id === state.generators[i].id);
  if (!unchanged) useGeneratorStore.setState({ generators: next });
};

function employeePerkPurchaseCost(
  branch: EmployeePerkBranch,
  currentLevel: number
): number {
  if (branch === "money" || branch === "innovation") {
    if (currentLevel >= MAX_MONEY_INNO_LEVEL) return 0;
    return 2 + Math.floor(currentLevel / 6);
  }
  if (branch === "cost") {
    if (currentLevel >= MAX_COST_LEVEL) return 0;
    return 3 + Math.floor(currentLevel / 4);
  }
  if (branch === "auto") {
    if (currentLevel >= MAX_AUTO_LEVEL) return 0;
    return 6 + currentLevel * 3;
  }
  return 0;
}

function totalManagementPointsSpentOnPerks(p: EmployeePerks): number {
  let sum = 0;
  for (let i = 0; i < p.moneyLevel; i++) {
    sum += employeePerkPurchaseCost("money", i);
  }
  for (let i = 0; i < p.innovationLevel; i++) {
    sum += employeePerkPurchaseCost("innovation", i);
  }
  for (let i = 0; i < p.costLevel; i++) {
    sum += employeePerkPurchaseCost("cost", i);
  }
  for (let i = 0; i < p.autoBuyLevel; i++) {
    sum += employeePerkPurchaseCost("auto", i);
  }
  return sum;
}

export const useGeneratorStore = create<GeneratorState>()(
  persist(
    (set, get) => {
  const runAutoBuy = (
    em: EmployeeManagementData,
    seconds: number
  ): EmployeeManagementData => {
    const acc = { ...em.autoBuyAcc };

    for (const gen of get().generators) {
      const rate = get().getAutoBuyRate(gen.id);
      if (rate <= 0 || gen.amount === 0) continue;

      let frac = (acc[gen.id] ?? 0) + rate * seconds;
      const maxIter = 500;
      let iter = 0;
      while (frac >= 1 && iter < maxIter) {
        const cost = getGeneratorCost(gen.id, 1);
        const money = useMoneyStore.getState().money;
        if (money.lt(cost)) break;
        useMoneyStore.getState().spendMoney(cost.toNumber());
        get().increaseGenerator(gen.id, 1);
        frac -= 1;
        iter += 1;
      }
      acc[gen.id] = frac;
    }

    return { ...em, autoBuyAcc: acc };
  };

  return {
    purchaseMode: "single",
    generators: reconcileGeneratorsFromSavedArray([]),
    globalLastTick: Date.now(),
    employeeManagement: defaultEmployeeManagement(),
    satisfactionScores: defaultSatisfactionScores(),

    getEmployeePerks: (id) => get().employeeManagement.perks[id],

    getEmployeeOutputMults: (id) => {
      const p = get().employeeManagement.perks[id];
      return {
        money: 1 + p.moneyLevel * MONEY_MULT_PER_LEVEL,
        innovation: 1 + p.innovationLevel * INNO_MULT_PER_LEVEL,
      };
    },

    getEmployeeCostMult: (id) => {
      const lv = get().employeeManagement.perks[id].costLevel;
      return Math.pow(COST_DISCOUNT_BASE, lv);
    },

    getEffectiveSatisfaction: (id) => {
      const m = usePrestigeStore.getState().modifiers;
      if (m.satisfactionNeutralized) return 0; // Crunch Mode: fully off
      const s = get().satisfactionScores[id];
      // Enshittify: halve only the positive side (penalties stay); the helpers
      // are linear in score on the positive branch, so scaling the score scales
      // exactly the bonus.
      return m.satisfactionPositiveMult !== 1 && s > 0
        ? s * m.satisfactionPositiveMult
        : s;
    },

    getAutoBuyRate: (id) => {
      const lv = get().employeeManagement.perks[id].autoBuyLevel;
      if (lv <= 0) return 0;
      // Founder "Operator" + skill-tree automation modifiers.
      return (
        AUTO_BUY_PER_LEVEL *
        lv *
        useFounderStore.getState().autoBuyMult *
        usePrestigeStore.getState().modifiers.autoBuyMult
      );
    },

    getAvailableManagementPoints: () => {
      if (!useInnovationStore.getState().unlocks.employeeManagement?.unlocked) {
        return 0;
      }
      const total = getManagementTierTotal();
      return Math.max(0, total - get().employeeManagement.spentManagementPoints);
    },

    getEmployeePerkNextCost: (id, branch) => {
      const p = get().employeeManagement.perks[id];
      const level =
        branch === "money"
          ? p.moneyLevel
          : branch === "innovation"
            ? p.innovationLevel
            : branch === "cost"
              ? p.costLevel
              : p.autoBuyLevel;
      return employeePerkPurchaseCost(branch, level);
    },

    canPurchaseEmployeePerk: (id, branch) => {
      const cost = get().getEmployeePerkNextCost(id, branch);
      if (cost <= 0) return false;
      return get().getAvailableManagementPoints() >= cost;
    },

    purchaseEmployeePerk: (id, branch) => {
      if (!useInnovationStore.getState().unlocks.employeeManagement?.unlocked) {
        return;
      }
      if (!get().canPurchaseEmployeePerk(id, branch)) return;

      const cost = get().getEmployeePerkNextCost(id, branch);
      set((state) => {
        const perks = { ...state.employeeManagement.perks };
        const cur = { ...perks[id] };
        if (branch === "money") cur.moneyLevel += 1;
        else if (branch === "innovation") cur.innovationLevel += 1;
        else if (branch === "cost") cur.costLevel += 1;
        else cur.autoBuyLevel += 1;
        perks[id] = cur;
        return {
          employeeManagement: {
            ...state.employeeManagement,
            spentManagementPoints: state.employeeManagement.spentManagementPoints + cost,
            perks,
          },
        };
      });
    },

    getManagementPointsSpentOnRow: (id) =>
      totalManagementPointsSpentOnPerks(get().employeeManagement.perks[id]),

    refundEmployeeManagementRow: (id) => {
      if (!useInnovationStore.getState().unlocks.employeeManagement?.unlocked) {
        return;
      }
      const refund = totalManagementPointsSpentOnPerks(
        get().employeeManagement.perks[id]
      );
      if (refund <= 0) return;

      set((state) => {
        const perks = { ...state.employeeManagement.perks };
        perks[id] = defaultEmployeePerks();
        const autoBuyAcc = { ...state.employeeManagement.autoBuyAcc };
        delete autoBuyAcc[id];
        return {
          employeeManagement: {
            ...state.employeeManagement,
            spentManagementPoints: Math.max(
              0,
              state.employeeManagement.spentManagementPoints - refund
            ),
            perks,
            autoBuyAcc,
          },
        };
      });
    },

    addGenerator: (gen) =>
      set((state) => {
        const exists = state.generators.find((g) => g.id === gen.id);
        if (exists) return {};
        return { generators: [...state.generators, gen] };
      }),

    increaseGenerator: (id, count = 1) =>
      set((state) => ({
        generators: state.generators.map((gen) =>
          gen.id === id ? { ...gen, amount: gen.amount + count } : gen
        ),
      })),

    tickGenerators: () => {
      const now = Date.now();
      const rawInterval = now - get().globalLastTick;
      const globalTickInterval = Math.min(rawInterval, MAX_CATCH_UP_MS);
      if (globalTickInterval < 1000) return;

      const innovationMultGlobal = useInnovationStore
        .getState()
        .getMultiplier();
      const managerMults = getManagerEconomyMultipliers();
      const valuationMults = getValuationEconomyMultipliers();

      set({ globalLastTick: now });

      const seconds = globalTickInterval / 1000;

      // Skill-tree modifiers for this whole tick (hoisted; reused below).
      const prestige = usePrestigeStore.getState().modifiers;
      const emUnlocked =
        useInnovationStore.getState().unlocks.employeeManagement?.unlocked ?? false;
      // Raw satisfaction still evolves normally; the skill-tree keystones
      // (Crunch Mode / Enshittify) are applied at READ time via
      // getEffectiveSatisfaction, so every multiplier below honours them.
      if (emUnlocked) {
        const perks = get().employeeManagement.perks;
        const amounts: Record<GeneratorId, number> = {
          intern: 0,
          vibe_coder: 0,
          "10x_dev": 0,
        };
        for (const g of get().generators) {
          amounts[g.id] = g.amount;
        }
        set({
          satisfactionScores: stepSatisfactionScores(
            get().satisfactionScores,
            perks,
            amounts,
            // 996 slows how fast satisfaction moves toward its target.
            seconds * prestige.satisfactionGainMult
          ),
        });
        // Effective vibe → Crunch Mode (0) drives no singularity.
        useAiSingularityStore
          .getState()
          .tick(seconds, get().getEffectiveSatisfaction("vibe_coder"), emUnlocked);
      }

      const internIpsMult = emUnlocked
        ? internSatisfactionIpsMultiplier(get().getEffectiveSatisfaction("intern"))
        : 1;

      const revenueMultFor = (id: GeneratorId) =>
        emUnlocked
          ? satisfactionRevenueMultiplier(get().getEffectiveSatisfaction(id))
          : 1;

      const juiceMps = 1 + useVapeAchievementsStore.getState().juiceMpsMultBonus;
      const juiceIps = 1 + useVapeAchievementsStore.getState().juiceInnovationMultBonus;

      // Founder + skill-tree modifiers: headcount synergy + output scaling.
      const founder = useFounderStore.getState();
      const totalEmployees = get().generators.reduce((n, g) => n + g.amount, 0);
      const headcountMoneyMult =
        1 +
        (founder.headcountMoneyPerEmployee + prestige.headcountPerEmployee) *
          totalEmployees;

      const updatedGenerators = get().generators.map((gen) => {
        if (gen.amount === 0) return gen;
        const ticks = Math.floor(globalTickInterval / gen.interval);
        if (ticks > 0) {
          const out = get().getEmployeeOutputMults(gen.id);
          const income = new Decimal(gen.baseProduction)
            .times(innovationMultGlobal)
            .times(managerMults.employeeMoney)
            .times(valuationMults.money)
            .times(gen.amount)
            .times(gen.multiplier)
            .times(out.money)
            .times(revenueMultFor(gen.id))
            .times(juiceMps)
            .times(headcountMoneyMult)
            .times(founder.generatorMoneyMult[gen.id] ?? 1)
            .times(prestige.moneyMult)
            .times(prestige.employeeOutputMult)
            .times(gen.id === "intern" ? prestige.internOutputMult : 1)
            .times(ticks);
          const innovationIncome = new Decimal(gen.innovationProduction)
            .times(innovationMultGlobal)
            .times(gen.amount)
            .times(gen.innovationMultiplier)
            .times(managerMults.innovationIncome)
            .times(valuationMults.innovation)
            .times(out.innovation)
            .times(internIpsMult)
            .times(juiceIps)
            .times(founder.generatorInnovationMult[gen.id] ?? 1)
            .times(prestige.innovationMult)
            .times(prestige.employeeOutputMult)
            .times(gen.id === "intern" ? prestige.internOutputMult : 1)
            .times(ticks);
          useMoneyStore.getState().increaseMoney(income.toNumber());
          useInnovationStore
            .getState()
            .increaseInnovation(innovationIncome.toNumber());
          return { ...gen, lastTick: now };
        }
        return gen;
      });

      set({ generators: updatedGenerators });
      syncUnlockedGenerators();
      syncAvailableUpgrades();

      let em = get().employeeManagement;
      em = runAutoBuy(em, seconds);
      set({ employeeManagement: em });
      syncUnlockedGenerators();
      syncAvailableUpgrades();

      // Same formula as getValuationBreakdown (single source of truth), times
      // the elapsed seconds, so the toolbar's valuation/sec matches accrual.
      const valuationGain = get().getValuationPerSecond() * seconds;
      if (valuationGain > 0) {
        useValuationStore.getState().increaseValuation(valuationGain);
      }
    },

    purchaseGenerator: (id: string, amount = 1) => {
      const cost = getGeneratorCost(id, amount);
      const moneyState = useMoneyStore.getState();

      if (moneyState.money.gte(cost)) {
        moneyState.spendMoney(cost.toNumber());
        get().increaseGenerator(id, amount);
        syncUnlockedGenerators();
        syncAvailableUpgrades();
      }
    },

    getGeneratorMoneyPerSecond: (id, units) => {
      const gen = get().generators.find((g) => g.id === id);
      if (!gen || units <= 0) return 0;
      const innovationMultGlobal = useInnovationStore
        .getState()
        .getMultiplier()
        .toNumber();
      const managerMults = getManagerEconomyMultipliers();
      const valuationMults = getValuationEconomyMultipliers();
      const emUnlocked =
        useInnovationStore.getState().unlocks.employeeManagement?.unlocked ??
        false;
      const revenueMult = emUnlocked
        ? satisfactionRevenueMultiplier(get().getEffectiveSatisfaction(id))
        : 1;
      const out = get().getEmployeeOutputMults(id);
      const juiceMps = 1 + useVapeAchievementsStore.getState().juiceMpsMultBonus;
      // Founder + skill-tree modifiers: headcount synergy + money scaling.
      const founder = useFounderStore.getState();
      const prestige = usePrestigeStore.getState().modifiers;
      const totalEmployees = get().generators.reduce((n, g) => n + g.amount, 0);
      const headcountMoneyMult =
        1 +
        (founder.headcountMoneyPerEmployee + prestige.headcountPerEmployee) *
          totalEmployees;

      return (
        ((innovationMultGlobal *
          managerMults.employeeMoney *
          valuationMults.money *
          gen.baseProduction *
          units *
          gen.multiplier *
          out.money *
          revenueMult *
          (founder.generatorMoneyMult[id] ?? 1)) /
          (gen.interval / 1000)) *
        juiceMps *
        headcountMoneyMult *
        prestige.moneyMult *
        prestige.employeeOutputMult *
        (id === "intern" ? prestige.internOutputMult : 1)
      );
    },
    // Sum each generator's full-chain output (single source of truth: the
    // employee-tab popovers and this getter stay in lockstep).
    getMoneyPerSecond: () =>
      get().generators.reduce(
        (sum, gen) =>
          sum + get().getGeneratorMoneyPerSecond(gen.id, gen.amount),
        0,
      ),

    getMoneyBreakdown: () => {
      const innovationMult = useInnovationStore
        .getState()
        .getMultiplier()
        .toNumber();
      const managerMults = getManagerEconomyMultipliers();
      const valuationMults = getValuationEconomyMultipliers();
      const emUnlocked =
        useInnovationStore.getState().unlocks.employeeManagement?.unlocked ??
        false;
      const juiceMps = 1 + useVapeAchievementsStore.getState().juiceMpsMultBonus;
      const founder = useFounderStore.getState();
      const prestige = usePrestigeStore.getState().modifiers;
      const totalEmployees = get().generators.reduce((n, g) => n + g.amount, 0);
      const headcountMult =
        1 +
        (founder.headcountMoneyPerEmployee + prestige.headcountPerEmployee) *
          totalEmployees;

      const globals = [
        { label: "Innovation", mult: innovationMult },
        { label: "Managers", mult: managerMults.employeeMoney },
        { label: "Board mandates", mult: valuationMults.money },
        { label: "Vape juice", mult: juiceMps },
        { label: "Headcount synergy", mult: headcountMult },
        { label: "Skill tree", mult: prestige.moneyMult * prestige.employeeOutputMult },
      ];

      const perGenerator = get()
        .generators.filter((g) => g.amount > 0)
        .map((gen) => {
          const out = get().getEmployeeOutputMults(gen.id);
          const revenueMult = emUnlocked
            ? satisfactionRevenueMultiplier(get().getEffectiveSatisfaction(gen.id))
            : 1;
          return {
            id: gen.id,
            name: gen.name,
            amount: gen.amount,
            perUnit: get().getGeneratorMoneyPerSecond(gen.id, 1),
            total: get().getGeneratorMoneyPerSecond(gen.id, gen.amount),
            factors: [
              { label: "upgrades", mult: gen.multiplier },
              { label: "perks", mult: out.money },
              { label: "satisfaction", mult: revenueMult },
              { label: "founder", mult: founder.generatorMoneyMult[gen.id] ?? 1 },
            ],
          };
        });

      return { total: get().getMoneyPerSecond(), globals, perGenerator };
    },

    getGeneratorInnovationPerSecond: (id, units) => {
      const gen = get().generators.find((g) => g.id === id);
      if (!gen || units <= 0) return 0;
      const innovationMultGlobal = useInnovationStore
        .getState()
        .getMultiplier()
        .toNumber();
      const managerMults = getManagerEconomyMultipliers();
      const valuationMults = getValuationEconomyMultipliers();
      const emUnlocked =
        useInnovationStore.getState().unlocks.employeeManagement?.unlocked ??
        false;
      const internIpsMult = emUnlocked
        ? internSatisfactionIpsMultiplier(get().getEffectiveSatisfaction("intern"))
        : 1;
      const out = get().getEmployeeOutputMults(id);
      const juiceIps =
        1 + useVapeAchievementsStore.getState().juiceInnovationMultBonus;
      const founder = useFounderStore.getState();
      const prestige = usePrestigeStore.getState().modifiers;

      return (
        ((innovationMultGlobal *
          managerMults.innovationIncome *
          valuationMults.innovation *
          gen.innovationProduction *
          units *
          gen.innovationMultiplier *
          out.innovation *
          internIpsMult *
          (founder.generatorInnovationMult[id] ?? 1)) /
          (gen.interval / 1000)) *
        juiceIps *
        prestige.innovationMult *
        prestige.employeeOutputMult *
        (id === "intern" ? prestige.internOutputMult : 1)
      );
    },
    getInnovationPerSecond: () =>
      get().generators.reduce(
        (sum, gen) =>
          sum + get().getGeneratorInnovationPerSecond(gen.id, gen.amount),
        0,
      ),

    getInnovationBreakdown: () => {
      const innovationMult = useInnovationStore
        .getState()
        .getMultiplier()
        .toNumber();
      const managerMults = getManagerEconomyMultipliers();
      const valuationMults = getValuationEconomyMultipliers();
      const emUnlocked =
        useInnovationStore.getState().unlocks.employeeManagement?.unlocked ??
        false;
      const internIpsMult = emUnlocked
        ? internSatisfactionIpsMultiplier(get().getEffectiveSatisfaction("intern"))
        : 1;
      const juiceIps =
        1 + useVapeAchievementsStore.getState().juiceInnovationMultBonus;
      const founder = useFounderStore.getState();
      const prestige = usePrestigeStore.getState().modifiers;

      const globals = [
        { label: "Innovation curve", mult: innovationMult },
        { label: "Managers", mult: managerMults.innovationIncome },
        { label: "Board mandates", mult: valuationMults.innovation },
        { label: "Vape juice", mult: juiceIps },
        { label: "Intern morale", mult: internIpsMult },
        { label: "Skill tree", mult: prestige.innovationMult * prestige.employeeOutputMult },
      ];

      const perGenerator = get()
        .generators.filter((g) => g.amount > 0)
        .map((gen) => {
          const out = get().getEmployeeOutputMults(gen.id);
          return {
            id: gen.id,
            name: gen.name,
            amount: gen.amount,
            perUnit: get().getGeneratorInnovationPerSecond(gen.id, 1),
            total: get().getGeneratorInnovationPerSecond(gen.id, gen.amount),
            factors: [
              { label: "upgrades", mult: gen.innovationMultiplier },
              { label: "perks", mult: out.innovation },
              {
                label: "founder",
                mult: founder.generatorInnovationMult[gen.id] ?? 1,
              },
            ],
          };
        });

      return { total: get().getInnovationPerSecond(), globals, perGenerator };
    },

    getValuationBreakdown: () => {
      const mps = get().getMoneyPerSecond();
      const managerMults = getManagerEconomyMultipliers();
      const emUnlocked =
        useInnovationStore.getState().unlocks.employeeManagement?.unlocked ??
        false;
      const internValMult = emUnlocked
        ? internSatisfactionValuationMultiplier(get().getEffectiveSatisfaction("intern"))
        : 1;
      const founderMult = useFounderStore.getState().valuationAccrualMult;
      const prestigeMult = usePrestigeStore.getState().modifiers.valuationMult;

      // Mirror of the accrual in tickGenerators: a sub-linear function of $/sec,
      // scaled by board (sales), intern morale, founder, and skill-tree modifiers.
      const base = Math.pow(Math.max(1, mps), 0.38) * 4e-5;
      const factors = [
        { label: "Sales managers", mult: managerMults.salesValuation },
        { label: "Intern morale", mult: internValMult },
        { label: "Founder", mult: founderMult },
        { label: "Skill tree", mult: prestigeMult },
      ];
      const total = factors.reduce((m, f) => m * f.mult, base);
      return { total, base, mps, factors };
    },
    getValuationPerSecond: () => get().getValuationBreakdown().total,

    setPurchaseMode: (purchaseMode) => set({ purchaseMode }),

    reset: () => {
      localStorage.removeItem(EMPLOYEE_MGMT_STORAGE_KEY);
      useGeneratorStore.persist.clearStorage();
      set({
        generators: reconcileGeneratorsFromSavedArray([]),
        globalLastTick: Date.now(),
        employeeManagement: defaultEmployeeManagement(),
        satisfactionScores: defaultSatisfactionScores(),
      });
    },
  };
    },
    {
      name: GENERATOR_PERSIST_KEY,
      storage: createJSONStorage(() => generatorStateStorage),
      partialize: (state) => ({
        generators: state.generators,
        employeeManagement: state.employeeManagement,
        satisfactionScores: state.satisfactionScores,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<{
          generators: OwnedGenerator[];
          employeeManagement: EmployeeManagementData;
          satisfactionScores: SatisfactionScores;
        }> | null;
        if (!p) return current;
        const mergedScores = p.satisfactionScores
          ? {
              intern: clampPersistedScore(p.satisfactionScores.intern),
              vibe_coder: clampPersistedScore(p.satisfactionScores.vibe_coder),
              "10x_dev": clampPersistedScore(p.satisfactionScores["10x_dev"]),
            }
          : current.satisfactionScores;
        return {
          ...current,
          generators: p.generators
            ? reconcileGeneratorsFromSavedArray(p.generators)
            : current.generators,
          employeeManagement: p.employeeManagement
            ? normalizeEmployeeManagement(p.employeeManagement)
            : current.employeeManagement,
          satisfactionScores: mergedScores,
        };
      },
    }
  )
);

setEmployeeSatisfactionReaders({
  internScore: () => useGeneratorStore.getState().getEffectiveSatisfaction("intern"),
  employeeManagementUnlocked: () =>
    useInnovationStore.getState().unlocks.employeeManagement?.unlocked ?? false,
});

// Re-sync the buildable roster whenever the chosen founder changes (e.g. the
// Agentic Delusionist restricting it to vibe coders, or a reset clearing it).
// One-directional dependency (generators → founder) avoids an import cycle.
useFounderStore.subscribe(() => syncUnlockedGenerators());
