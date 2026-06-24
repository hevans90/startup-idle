import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { FOUNDERS, type FounderModifiers } from "../game/founders.catalog";
import { useMoneyStore } from "./money.store";
import { useSessionStore } from "./session.store";

/** Neutral (no-op) modifier values — read by every chokepoint when no founder is active. */
const NEUTRAL: Required<FounderModifiers> = {
  costExponentReduction: 0,
  innovationLogMult: 1,
  managerProgressMult: 1,
  valuationAccrualMult: 1,
  mandateCostGrowthReduction: 0,
  headcountMoneyPerEmployee: 0,
  autoBuyMult: 1,
  onlyGenerator: null,
  generatorMoneyMult: {},
  generatorInnovationMult: {},
};

type FounderState = Required<FounderModifiers> & {
  /** null until the player founds their startup; gates the whole game. */
  selectedFounderId: string | null;
  chooseFounder: (id: string) => void;
  reset: () => void;
};

export const useFounderStore = create<FounderState>()(
  persist(
    (set) => ({
      selectedFounderId: null,
      ...NEUTRAL,

      chooseFounder: (id: string) => {
        const def = FOUNDERS.find((f) => f.id === id);
        if (!def) return;
        // Resolve modifiers (neutral defaults + the founder's overrides). The
        // generators store subscribes to this store and re-syncs the buildable
        // roster (e.g. a generator restriction) when it changes.
        set({ selectedFounderId: id, ...NEUTRAL, ...def.modifiers });
        useMoneyStore.getState().increaseMoney(def.startingCash);
        // The company is founded now — start its "incorporated X ago" clock.
        useSessionStore.getState().incorporate();
      },

      reset: () => set({ selectedFounderId: null, ...NEUTRAL }),
    }),
    {
      name: "founder",
      storage: createJSONStorage(() => localStorage),
      // Persist only the chosen id; re-derive modifiers from the catalog on load
      // so tuning the catalog applies to existing saves.
      partialize: (s) => ({ selectedFounderId: s.selectedFounderId }),
      merge: (persisted, current) => {
        const id =
          (persisted as { selectedFounderId?: string | null } | null)
            ?.selectedFounderId ?? null;
        const def = id ? FOUNDERS.find((f) => f.id === id) : undefined;
        return {
          ...current,
          selectedFounderId: id,
          ...NEUTRAL,
          ...(def?.modifiers ?? {}),
        };
      },
    },
  ),
);
