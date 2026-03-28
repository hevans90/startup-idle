import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { decimalReplacer, decimalReviver } from "./_break_infinity.decimals";

const LOCAL_STORAGE_KEY = "valuation";

export type MandateId = "runway" | "talent" | "narrative";

export type MandateDef = {
  id: MandateId;
  name: string;
  description: string;
  /** Cost for level L → L+1 scales with this base */
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
  /** Per level: multiply money from generators */
  moneyMultPerLevel: number;
  /** Per level: multiply innovation from generators */
  innovationMultPerLevel: number;
};

export const MANDATES: MandateDef[] = [
  {
    id: "runway",
    name: "Runway extension",
    description: "+2% employee money output per level",
    baseCost: 15,
    costGrowth: 1.35,
    maxLevel: 25,
    moneyMultPerLevel: 0.02,
    innovationMultPerLevel: 0,
  },
  {
    id: "talent",
    name: "Talent density",
    description: "+1.5% innovation from employees per level",
    baseCost: 25,
    costGrowth: 1.4,
    maxLevel: 25,
    moneyMultPerLevel: 0,
    innovationMultPerLevel: 0.015,
  },
  {
    id: "narrative",
    name: "Market narrative",
    description: "+1% money and +0.5% innovation per level",
    baseCost: 40,
    costGrowth: 1.45,
    maxLevel: 20,
    moneyMultPerLevel: 0.01,
    innovationMultPerLevel: 0.005,
  },
];

type MandateLevels = Record<MandateId, number>;

type ValuationState = {
  valuation: Decimal;
  mandateLevels: MandateLevels;

  increaseValuation: (amount: number) => void;
  getMandateCost: (id: MandateId) => Decimal;
  canAffordMandate: (id: MandateId) => boolean;
  purchaseMandate: (id: MandateId) => void;
  getEconomyMultipliers: () => { money: number; innovation: number };
  reset: () => void;
};

const initialMandateLevels: MandateLevels = {
  runway: 0,
  talent: 0,
  narrative: 0,
};

export const useValuationStore = create<ValuationState>()(
  persist(
    (set, get) => ({
      valuation: new Decimal(0),
      mandateLevels: { ...initialMandateLevels },

      increaseValuation: (amount: number) => {
        if (amount <= 0) return;
        set((s) => ({ valuation: s.valuation.add(amount) }));
      },

      getMandateCost: (id: MandateId) => {
        const def = MANDATES.find((m) => m.id === id)!;
        const level = get().mandateLevels[id];
        if (level >= def.maxLevel) return new Decimal(Infinity);
        return new Decimal(def.baseCost).mul(Decimal.pow(def.costGrowth, level));
      },

      canAffordMandate: (id: MandateId) => {
        const def = MANDATES.find((m) => m.id === id)!;
        const level = get().mandateLevels[id];
        if (level >= def.maxLevel) return false;
        const cost = get().getMandateCost(id);
        return get().valuation.gte(cost);
      },

      purchaseMandate: (id: MandateId) => {
        const s = get();
        if (!s.canAffordMandate(id)) return;
        const cost = s.getMandateCost(id);
        set({
          valuation: s.valuation.sub(cost),
          mandateLevels: {
            ...s.mandateLevels,
            [id]: s.mandateLevels[id] + 1,
          },
        });
      },

      getEconomyMultipliers: () => {
        const { mandateLevels } = get();
        let money = 1;
        let innovation = 1;
        for (const def of MANDATES) {
          const lv = mandateLevels[def.id];
          money += lv * def.moneyMultPerLevel;
          innovation += lv * def.innovationMultPerLevel;
        }
        return { money, innovation };
      },

      reset: () => {
        set({
          valuation: new Decimal(0),
          mandateLevels: { ...initialMandateLevels },
        });
      },
    }),
    {
      name: LOCAL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage, {
        replacer: decimalReplacer,
        reviver: decimalReviver,
      }),
      partialize: (state) => ({
        valuation: state.valuation,
        mandateLevels: state.mandateLevels,
      }),
    }
  )
);
