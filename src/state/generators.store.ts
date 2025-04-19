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

export const useGeneratorStore = create<GeneratorState>((set, get) => ({
  generators: [],
  addGenerator: (gen) =>
    set((state) => ({ generators: [...state.generators, gen] })),
  increaseGenerator: (id, count = 1) =>
    set((state) => ({
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
}));
