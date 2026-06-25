import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ExitRecord = {
  /** Number of acquisitions completed with this founder. */
  count: number;
  /** Sum of accrued valuations at exit (raw number for display/scaling). */
  totalValuation: number;
};

export type ExitsState = {
  exits: Record<string, ExitRecord>;
  /** Best (highest) valuation achieved in any single exit across all founders. */
  bestExitValuation: number;
  recordExit: (founderId: string, valuation: number) => void;
  getExitsForFounder: (founderId: string) => ExitRecord;
  /** Full wipe — only call from clearAll flows. */
  clearAll: () => void;
};

const EMPTY_RECORD: ExitRecord = { count: 0, totalValuation: 0 };

export const useExitsStore = create<ExitsState>()(
  persist(
    (set, get) => ({
      exits: {},
      bestExitValuation: 0,

      recordExit: (founderId, valuation) => {
        set((s) => {
          const prev = s.exits[founderId] ?? EMPTY_RECORD;
          return {
            exits: {
              ...s.exits,
              [founderId]: {
                count: prev.count + 1,
                totalValuation: prev.totalValuation + valuation,
              },
            },
            bestExitValuation: Math.max(s.bestExitValuation, valuation),
          };
        });
      },

      getExitsForFounder: (founderId) =>
        get().exits[founderId] ?? EMPTY_RECORD,

      clearAll: () => {
        set({ exits: {}, bestExitValuation: 0 });
        useExitsStore.persist.clearStorage();
      },
    }),
    {
      name: "founder-exits",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ exits: s.exits, bestExitValuation: s.bestExitValuation }),
      merge: (persisted, current) => {
        const p = persisted as {
          exits?: Record<string, ExitRecord>;
          bestExitValuation?: number;
        } | null;
        return {
          ...current,
          exits: p?.exits ?? {},
          bestExitValuation: p?.bestExitValuation ?? 0,
        };
      },
    },
  ),
);
