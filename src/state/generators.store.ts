import Decimal from "break_infinity.js";
import { create } from "zustand";
import {
  getGeneratorCost,
  getUnlockedGeneratorIds,
} from "../utils/generator-utils";
import { useMoneyStore } from "./money.store";

export type UnlockCondition = {
  requiredId: string;
  requiredAmount: number;
};

export type Generator = {
  id: string;
  name: string;
  cost: number;
  costExponent: number;
  baseProduction: number;
  interval: number;
  unlockConditions?: UnlockCondition[];
};

export type OwnedGenerator = Generator & {
  amount: number; // amount owned
  lastTick: number; // timestamp of last tick
  multiplier: number; // persistent multiplier from upgrades
};

type GeneratorState = {
  generators: OwnedGenerator[];
  addGenerator: (gen: OwnedGenerator) => void;
  increaseGenerator: (id: string, count?: number) => void;
  tickGenerators: () => void;
  purchaseGenerator: (id: string, amount: number) => void;

  getMoneyPerSecond: () => number;

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
  },
  {
    id: "vibe_coder",
    name: "vibe coder",
    baseProduction: 5,
    interval: 1000,
    cost: 100,
    costExponent: 1.2,
    unlockConditions: [{ requiredId: "intern", requiredAmount: 20 }],
  },
];

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
      lastTick: saved?.lastTick ?? Date.now(),
    };
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
        lastTick: Date.now(),
      };
    });

    useGeneratorStore.setState({
      generators: [...state.generators, ...newGenerators],
    });

    saveGenerators([...state.generators, ...newGenerators]);
  }
};

export const useGeneratorStore = create<GeneratorState>((set, get) => {
  const initialGenerators = loadGenerators();

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
    generators: initialGenerators,
    addGenerator: (gen) =>
      persist((state) => {
        const exists = state.generators.find((g) => g.id === gen.id);
        if (exists) return state;
        return { generators: [...state.generators, gen] };
      }),
    increaseGenerator: (id, count = 1) =>
      persist((state) => ({
        generators: state.generators.map((gen) => {
          if (gen.id === id) {
            const wasZero = gen.amount === 0;
            return {
              ...gen,
              amount: gen.amount + count,
              lastTick: wasZero ? Date.now() : gen.lastTick,
            };
          }
          return gen;
        }),
      })),
    tickGenerators: () => {
      const now = Date.now();
      const updatedGenerators = get().generators.map((gen) => {
        if (now - gen.lastTick >= gen.interval && gen.amount > 0) {
          const ticks = Math.floor((now - gen.lastTick) / gen.interval);
          const income = new Decimal(gen.baseProduction)
            .times(gen.amount)
            .times(gen.multiplier)
            .times(ticks);
          useMoneyStore.getState().increaseMoney(income.toNumber());
          return { ...gen, lastTick: gen.lastTick + ticks * gen.interval };
        }
        return gen;
      });

      saveGenerators(updatedGenerators);
      set({ generators: updatedGenerators });
      syncUnlockedGenerators();
    },
    purchaseGenerator: (id: string, amount = 1) => {
      const cost = getGeneratorCost(id, amount);
      const moneyState = useMoneyStore.getState();

      if (moneyState.money.gte(cost)) {
        moneyState.spendMoney(cost.toNumber());
        get().increaseGenerator(id, amount);
      }
    },
    getMoneyPerSecond: () => {
      return get().generators.reduce((sum, gen) => {
        if (gen.amount === 0) return sum;

        const perSecond =
          (gen.baseProduction * gen.amount * gen.multiplier * 1000) /
          gen.interval;

        return sum + perSecond;
      }, 0);
    },
    reset: () => {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      set({ generators: [] });
    },
  };
});
