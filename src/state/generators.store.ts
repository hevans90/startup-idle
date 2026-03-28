import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  getManagerEconomyMultipliers,
  getValuationEconomyMultipliers,
} from "../game/economy-multipliers";
import {
  getGeneratorCost,
  getUnlockedGeneratorIds,
} from "../utils/generator-utils";
import {
  getManagementTierTotal,
  useInnovationStore,
} from "./innovation.store";
import { useMoneyStore } from "./money.store";
import { useValuationStore } from "./valuation.store";
import { syncAvailableUpgrades } from "./upgrades.store";

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

const MAX_MONEY_INNO_LEVEL = 25;
const MAX_COST_LEVEL = 15;
const MAX_AUTO_LEVEL = 5;

const MONEY_MULT_PER_LEVEL = 0.04;
const INNO_MULT_PER_LEVEL = 0.04;
const COST_DISCOUNT_BASE = 0.985;
const AUTO_BUY_PER_LEVEL = 0.035;

type EmployeeManagementData = {
  spentManagementPoints: number;
  perks: Record<GeneratorId, EmployeePerks>;
  autoBuyAcc: Partial<Record<GeneratorId, number>>;
};

type GeneratorState = {
  generators: OwnedGenerator[];
  globalLastTick: number;
  purchaseMode: "single" | "max";
  setPurchaseMode: (mode: "single" | "max") => void;

  employeeManagement: EmployeeManagementData;

  addGenerator: (gen: OwnedGenerator) => void;
  increaseGenerator: (id: string, count?: number) => void;
  tickGenerators: () => void;
  purchaseGenerator: (id: string, amount: number) => void;

  getMoneyPerSecond: () => number;
  getInnovationPerSecond: () => number;

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
        costExponent: saved?.costExponent ?? gen.costExponent,
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

const syncUnlockedGenerators = (): void => {
  const state = useGeneratorStore.getState();
  const unlockedIds = getUnlockedGeneratorIds(state.generators);
  const currentIds = state.generators.map((g) => g.id);

  const newlyUnlocked = unlockedIds.filter((id) => !currentIds.includes(id));

  if (newlyUnlocked.length > 0) {
    const newGenerators = newlyUnlocked.map((id) => {
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

    useGeneratorStore.setState({
      generators: [...state.generators, ...newGenerators],
    });
  }
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

    getAutoBuyRate: (id) => {
      const lv = get().employeeManagement.perks[id].autoBuyLevel;
      if (lv <= 0) return 0;
      return AUTO_BUY_PER_LEVEL * lv;
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
            .times(ticks);
          const innovationIncome = new Decimal(gen.innovationProduction)
            .times(gen.amount)
            .times(gen.innovationMultiplier)
            .times(managerMults.innovationIncome)
            .times(valuationMults.innovation)
            .times(out.innovation)
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

      const mps = get().getMoneyPerSecond();
      const valuationGain =
        Math.pow(Math.max(1, mps), 0.38) * 4e-5 * seconds * managerMults.salesValuation;
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

    getMoneyPerSecond: () => {
      const innovationMultGlobal = useInnovationStore
        .getState()
        .getMultiplier();
      const managerMults = getManagerEconomyMultipliers();
      const valuationMults = getValuationEconomyMultipliers();

      return get().generators.reduce((sum, gen) => {
        if (gen.amount === 0) return sum;

        const out = get().getEmployeeOutputMults(gen.id);
        const perSecond =
          (innovationMultGlobal.toNumber() *
            managerMults.employeeMoney *
            valuationMults.money *
            gen.baseProduction *
            gen.amount *
            gen.multiplier *
            out.money) /
          (gen.interval / 1000);

        return sum + perSecond;
      }, 0);
    },
    getInnovationPerSecond: () => {
      const managerMults = getManagerEconomyMultipliers();
      const valuationMults = getValuationEconomyMultipliers();

      return get().generators.reduce((sum, gen) => {
        if (gen.amount === 0) return sum;

        const out = get().getEmployeeOutputMults(gen.id);
        const perSecond =
          (managerMults.innovationIncome *
            valuationMults.innovation *
            gen.innovationProduction *
            gen.amount *
            gen.innovationMultiplier *
            out.innovation) /
          (gen.interval / 1000);

        return sum + perSecond;
      }, 0);
    },

    setPurchaseMode: (purchaseMode) => set({ purchaseMode }),

    reset: () => {
      localStorage.removeItem(EMPLOYEE_MGMT_STORAGE_KEY);
      useGeneratorStore.persist.clearStorage();
      set({
        generators: reconcileGeneratorsFromSavedArray([]),
        globalLastTick: Date.now(),
        employeeManagement: defaultEmployeeManagement(),
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
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<{
          generators: OwnedGenerator[];
          employeeManagement: EmployeeManagementData;
        }> | null;
        if (!p) return current;
        return {
          ...current,
          generators: p.generators
            ? reconcileGeneratorsFromSavedArray(p.generators)
            : current.generators,
          employeeManagement: p.employeeManagement
            ? normalizeEmployeeManagement(p.employeeManagement)
            : current.employeeManagement,
        };
      },
    }
  )
);
