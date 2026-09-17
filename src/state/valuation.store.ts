import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  coerceDecimal,
  decimalReplacer,
  decimalReviver,
} from "./_break_infinity.decimals";
import { useDirectivesStore } from "./directives.store";
import { useFounderStore } from "./founder.store";

const LOCAL_STORAGE_KEY = "valuation";

export type MandateId =
  | "runway"
  | "talent"
  | "narrative"
  | "board_synergy"
  | "acquihire_premium"
  | "culture_capital";

export type MandateDef = {
  id: MandateId;
  name: string;
  description: string;
  baseCost: number;
  costGrowth: number;
  /** Per level: multiply money from generators */
  moneyMultPerLevel: number;
  /** Per level: multiply innovation from generators */
  innovationMultPerLevel: number;
  /**
   * Per level: multiplicative amplifier applied to all OTHER mandate bonuses.
   * Only read from the board_synergy mandate; does not self-compound.
   */
  synergyMultPerLevel?: number;
  /**
   * Per level: additive bonus to the equity multiplier at acquisition.
   * e.g. 0.03 at level 10 → +30% equity payout.
   */
  equityBoostPerLevel?: number;
  /**
   * Per level: multiplier on satisfaction drift speed (how fast scores return
   * to their target). e.g. 0.05 at level 10 → +50% faster recovery.
   */
  satisfactionGainPerLevel?: number;
};

export const MANDATES: MandateDef[] = [
  {
    id: "runway",
    name: "Runway extension",
    description: "+2% money output",
    baseCost: 15,
    costGrowth: 1.35,
    moneyMultPerLevel: 0.02,
    innovationMultPerLevel: 0,
  },
  {
    id: "talent",
    name: "Talent density",
    description: "+1.5% innovation rate",
    baseCost: 25,
    costGrowth: 1.4,
    moneyMultPerLevel: 0,
    innovationMultPerLevel: 0.015,
  },
  {
    id: "narrative",
    name: "Market narrative",
    description: "+1% money output and +0.5% innovation rate",
    baseCost: 40,
    costGrowth: 1.45,
    moneyMultPerLevel: 0.01,
    innovationMultPerLevel: 0.005,
  },
  {
    id: "board_synergy",
    name: "Board synergy",
    description: "+4% to all other mandate bonuses per level",
    baseCost: 200,
    costGrowth: 1.5,
    moneyMultPerLevel: 0,
    innovationMultPerLevel: 0,
    synergyMultPerLevel: 0.04,
  },
  {
    id: "acquihire_premium",
    name: "Acqui-hire premium",
    description: "+3% equity payout per level at each acquisition",
    baseCost: 150,
    costGrowth: 1.45,
    moneyMultPerLevel: 0,
    innovationMultPerLevel: 0,
    equityBoostPerLevel: 0.03,
  },
  {
    id: "culture_capital",
    name: "Culture capital",
    description: "+10% satisfaction recovery speed per level",
    baseCost: 100,
    costGrowth: 1.4,
    moneyMultPerLevel: 0,
    innovationMultPerLevel: 0,
    satisfactionGainPerLevel: 0.10,
  },
];

type MandateLevels = Record<MandateId, number>;

type ValuationState = {
  valuation: Decimal;
  /** Total valuation accrued this run — only ever goes up (spending mandates
   * doesn't reduce it). Drives the acquisition (prestige) Equity payout. */
  accruedThisRun: Decimal;
  mandateLevels: MandateLevels;

  increaseValuation: (amount: number) => void;
  getMandateCost: (id: MandateId) => Decimal;
  canAffordMandate: (id: MandateId) => boolean;
  purchaseMandate: (id: MandateId) => void;
  getEconomyMultipliers: () => { money: number; innovation: number; equityBoost: number; satisfactionGain: number };
  /** Run reset (acquisition): clears valuation + accrual but KEEPS mandate
   * levels — board mandates are a permanent investment, like the skill tree. */
  reset: () => void;
  /** Full wipe only: also clears purchased mandate levels. */
  clearMandates: () => void;
};

const initialMandateLevels: MandateLevels = {
  runway: 0,
  talent: 0,
  narrative: 0,
  board_synergy: 0,
  acquihire_premium: 0,
  culture_capital: 0,
};

export const useValuationStore = create<ValuationState>()(
  persist(
    (set, get) => ({
      valuation: new Decimal(0),
      accruedThisRun: new Decimal(0),
      mandateLevels: { ...initialMandateLevels },

      increaseValuation: (amount: number) => {
        if (amount <= 0) return;
        set((s) => ({
          valuation: s.valuation.add(amount),
          accruedThisRun: s.accruedThisRun.add(amount),
        }));
      },

      getMandateCost: (id: MandateId) => {
        const def = MANDATES.find((m) => m.id === id)!;
        const level = get().mandateLevels[id];
        const founderReduction = useFounderStore.getState().mandateCostGrowthReduction;
        const dir = useDirectivesStore.getState();
        // D4: multiplicative 25% reduction on cost growth.
        const afterD4 = def.costGrowth * (1 - dir.mandateCostGrowthReduction) - founderReduction;
        // D7: hard cap — buying dozens of levels becomes practical without becoming free.
        const cap = dir.mandateCostGrowthCap > 0 ? dir.mandateCostGrowthCap : Infinity;
        const growth = Math.min(cap, Math.max(1.01, afterD4));
        return new Decimal(def.baseCost).mul(Decimal.pow(growth, level));
      },

      canAffordMandate: (id: MandateId) => {
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
        let equityBoost = 1;
        let satisfactionGain = 1;

        // Compute synergy multiplier separately (must not self-compound).
        const synergyDef = MANDATES.find((m) => m.synergyMultPerLevel);
        const synergyMult = synergyDef
          ? 1 + mandateLevels[synergyDef.id] * (synergyDef.synergyMultPerLevel ?? 0)
          : 1;

        for (const def of MANDATES) {
          const lv = mandateLevels[def.id];
          if (def.synergyMultPerLevel) continue; // skip synergy itself
          if (def.equityBoostPerLevel) {
            equityBoost += lv * def.equityBoostPerLevel;
            continue;
          }
          if (def.satisfactionGainPerLevel) {
            satisfactionGain += lv * def.satisfactionGainPerLevel;
            continue;
          }
          money += lv * def.moneyMultPerLevel;
          innovation += lv * def.innovationMultPerLevel;
        }

        return {
          money: 1 + (money - 1) * synergyMult,
          innovation: 1 + (innovation - 1) * synergyMult,
          equityBoost,
          satisfactionGain,
        };
      },

      reset: () => {
        // Run reset: valuation + accrual go to 0, but mandate levels persist
        // across acquisitions (they're a permanent investment like the tree).
        set({
          valuation: new Decimal(0),
          accruedThisRun: new Decimal(0),
        });
      },

      clearMandates: () => set({ mandateLevels: { ...initialMandateLevels } }),
    }),
    {
      name: LOCAL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage, {
        replacer: decimalReplacer,
        reviver: decimalReviver,
      }),
      partialize: (state) => ({
        valuation: state.valuation,
        accruedThisRun: state.accruedThisRun,
        mandateLevels: state.mandateLevels,
      }),
      // Guarantee Decimals regardless of the persisted shape (same crash class
      // as the innovation/money stores).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ValuationState>;
        return {
          ...current,
          ...p,
          valuation: coerceDecimal(p.valuation, current.valuation),
          accruedThisRun: coerceDecimal(
            p.accruedThisRun,
            current.accruedThisRun,
          ),
          // Deep-merge so new MandateId keys added after a save was written
          // default to 0 rather than being missing (which would NaN-poison
          // every economy multiplier that reads the missing key).
          mandateLevels: {
            ...initialMandateLevels,
            ...(p.mandateLevels ?? {}),
          },
        };
      },
    },
  ),
);
