import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { FOUNDERS, type FounderModifiers } from "../game/founders.catalog";
import { useExitsStore } from "./exits.store";
import { useMoneyStore } from "./money.store";
import { useSessionStore } from "./session.store";

/** Neutral (no-op) modifier values — read by every chokepoint when no founder is active. */
export const NEUTRAL: Required<FounderModifiers> = {
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
  globalMoneyMult: 1,
};

type FounderState = Required<FounderModifiers> & {
  selectedFounderId: string | null;
  chooseFounder: (id: string) => void;
  reset: () => void;
};

function deriveModifiers(founderId: string): Required<FounderModifiers> {
  const def = FOUNDERS.find((f) => f.id === founderId);
  if (!def) return NEUTRAL;
  const record = useExitsStore.getState().getExitsForFounder(founderId);
  const mods = def.scalingModifier.compute(record.count, record.totalValuation);
  return { ...NEUTRAL, ...mods };
}

export const useFounderStore = create<FounderState>()(
  persist(
    (set) => ({
      selectedFounderId: null,
      ...NEUTRAL,

      chooseFounder: (id: string) => {
        const def = FOUNDERS.find((f) => f.id === id);
        if (!def) return;
        const mods = deriveModifiers(id);
        set({ selectedFounderId: id, ...mods });
        useMoneyStore.getState().increaseMoney(def.startingCash);
        useSessionStore.getState().incorporate();
      },

      reset: () => set({ selectedFounderId: null, ...NEUTRAL }),
    }),
    {
      name: "founder",
      storage: createJSONStorage(() => localStorage),
      // Persist only the chosen id; re-derive modifiers from catalog + exits on load.
      partialize: (s) => ({ selectedFounderId: s.selectedFounderId }),
      merge: (persisted, current) => {
        const id =
          (persisted as { selectedFounderId?: string | null } | null)
            ?.selectedFounderId ?? null;
        const mods = id ? deriveModifiers(id) : NEUTRAL;
        return { ...current, selectedFounderId: id, ...mods };
      },
    },
  ),
);

// Re-derive flat modifiers whenever exits change for the active founder.
useExitsStore.subscribe((state, prevState) => {
  const { selectedFounderId } = useFounderStore.getState();
  if (!selectedFounderId) return;
  const record = state.exits[selectedFounderId];
  const prevRecord = prevState.exits[selectedFounderId];
  if ((record?.count ?? 0) === (prevRecord?.count ?? 0)) return;
  const mods = deriveModifiers(selectedFounderId);
  useFounderStore.setState(mods);
});
