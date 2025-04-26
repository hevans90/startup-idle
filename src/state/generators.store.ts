import Decimal from "break_infinity.js";
import { create } from "zustand";
import {
  getGeneratorCost,
  getUnlockedGeneratorIds,
} from "../utils/generator-utils";
import { useInnovationStore } from "./innovation.store";
import { useMoneyStore } from "./money.store";
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

type GeneratorState = {
  generators: OwnedGenerator[];
  globalLastTick: number;
  purchaseMode: "single" | "max";
  setPurchaseMode: (mode: "single" | "max") => void;

  addGenerator: (gen: OwnedGenerator) => void;
  increaseGenerator: (id: string, count?: number) => void;
  tickGenerators: () => void;
  purchaseGenerator: (id: string, amount: number) => void;

  getMoneyPerSecond: () => number;
  getInnovationPerSecond: () => number;

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

export type GeneratorId = "intern" | "vibe_coder" | "10x_dev";

const LOCAL_STORAGE_KEY = "generators";

const loadGenerators = (): OwnedGenerator[] => {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  let savedData: OwnedGenerator[] = [];

  try {
    savedData = saved ? JSON.parse(saved) : [];
  } catch {
    savedData = [];
  }

  const ownedMap = Object.fromEntries(savedData.map((g) => [g.id, g]));

  const unlockedIds = getUnlockedGeneratorIds(savedData);

  const result = GENERATOR_TYPES.filter((gen) =>
    unlockedIds.includes(gen.id)
  ).map((gen) => {
    const saved = ownedMap[gen.id];
    return {
      ...gen,
      amount: saved?.amount ?? 0,
      multiplier: saved?.multiplier ?? 1,
      costMultiplier: saved?.costMultiplier ?? 1,
      lastTick: saved?.lastTick ?? Date.now(),
      innovationMultiplier: saved?.innovationMultiplier ?? 1,
    } satisfies OwnedGenerator;
  });

  return result;
};

const saveGenerators = (generators: OwnedGenerator[]) =>
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(generators));

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

    saveGenerators([...state.generators, ...newGenerators]);
  }
};

export const useGeneratorStore = create<GeneratorState>((set, get) => {
  const initialGenerators = loadGenerators(); // Load initial state from localStorage

  const persist = (
    updater: (state: GeneratorState) => Partial<GeneratorState>
  ) => {
    const nextState = updater(get());
    if (nextState.generators) {
      saveGenerators(nextState.generators);
    }
    set(nextState);
  };

  return {
    purchaseMode: "single",
    generators: initialGenerators,
    globalLastTick: Date.now(),

    addGenerator: (gen) =>
      persist((state) => {
        const exists = state.generators.find((g) => g.id === gen.id);
        if (exists) return state;
        return { generators: [...state.generators, gen] };
      }),

    increaseGenerator: (id, count = 1) =>
      persist((state) => ({
        generators: state.generators.map((gen) =>
          gen.id === id ? { ...gen, amount: gen.amount + count } : gen
        ),
      })),

    tickGenerators: () => {
      const now = Date.now();
      const globalTickInterval = now - get().globalLastTick;
      if (globalTickInterval < 1000) return;

      set({ globalLastTick: now });

      const updatedGenerators = get().generators.map((gen) => {
        if (gen.amount === 0) return gen;
        const ticks = Math.floor(globalTickInterval / gen.interval);
        if (ticks > 0) {
          const income = new Decimal(gen.baseProduction)
            .times(gen.amount)
            .times(gen.multiplier)
            .times(ticks);
          const innovationIncome = new Decimal(gen.innovationProduction)
            .times(gen.amount)
            .times(gen.innovationMultiplier)
            .times(ticks);
          useMoneyStore.getState().increaseMoney(income.toNumber());
          useInnovationStore
            .getState()
            .increaseInnovation(innovationIncome.toNumber());
          return { ...gen, lastTick: now };
        }
        return gen;
      });

      saveGenerators(updatedGenerators);
      set({ generators: updatedGenerators });
      syncUnlockedGenerators();
      syncAvailableUpgrades();
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
      return get().generators.reduce((sum, gen) => {
        if (gen.amount === 0) return sum;

        const perSecond =
          (gen.baseProduction * gen.amount * gen.multiplier) /
          (gen.interval / 1000); // Fixed money per second calculation

        return sum + perSecond;
      }, 0);
    },
    getInnovationPerSecond: () => {
      return get().generators.reduce((sum, gen) => {
        if (gen.amount === 0) return sum;

        const perSecond =
          (gen.innovationProduction * gen.amount * gen.innovationMultiplier) /
          (gen.interval / 1000); // Fixed money per second calculation

        return sum + perSecond;
      }, 0);
    },

    setPurchaseMode: (purchaseMode) => set({ purchaseMode }),

    reset: () => {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      set({ generators: [], globalLastTick: Date.now() });
    },
  };
});
