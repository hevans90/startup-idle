import Decimal from "break_infinity.js";
import { create } from "zustand";
import { getGeneratorCost } from "../utils/generator-utils";
import { useMoneyStore } from "./money.store";

export type Generator = {
  id: string;
  name: string;
  cost: number;
  costExponent: number;
  baseProduction: number; // money per tick
  interval: number; // milliseconds between productions
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
};

const LOCAL_STORAGE_KEY = "generators";

function loadGenerators(): OwnedGenerator[] {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!saved)
    return GENERATOR_TYPES.map((gen) => ({
      ...gen,
      amount: 0,
      multiplier: 1,
      lastTick: Date.now(),
    }));

  try {
    const parsed = JSON.parse(saved);
    return GENERATOR_TYPES.map((gen) => {
      const savedGen = parsed.find((g: OwnedGenerator) => g.id === gen.id);
      return {
        ...gen,
        amount: savedGen?.amount ?? 0,
        multiplier: savedGen?.multiplier ?? 1,
        lastTick: savedGen?.lastTick ?? Date.now(),
      };
    });
  } catch (e) {
    console.error("Failed to parse saved generators:", e);
    return GENERATOR_TYPES.map((gen) => ({
      ...gen,
      amount: 0,
      multiplier: 1,
      lastTick: Date.now(),
    }));
  }
}

function saveGenerators(generators: OwnedGenerator[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(generators));
}

export const GENERATOR_TYPES: Generator[] = [
  {
    id: "intern",
    name: "Intern",
    baseProduction: 1,
    interval: 5000,
    cost: 20,
    costExponent: 1.05,
  },
];

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
        generators: state.generators.map((gen) =>
          gen.id === id ? { ...gen, amount: gen.amount + count } : gen
        ),
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
    },
    purchaseGenerator: (id: string, amount = 1) => {
      const cost = getGeneratorCost(id, amount);
      const moneyState = useMoneyStore.getState();

      if (moneyState.money.gte(cost)) {
        moneyState.spendMoney(cost.toNumber());
        get().increaseGenerator(id, amount);
      }
    },
  };
});
