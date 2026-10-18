/**
 * THE GENERATION: everything that lasts from one Ascension to the next, over
 * however many companies are sold in between — and only what lasts that long.
 * A sale keeps it; an Ascension is what starts a new one. @see plans/singularity.md
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type GenerationState = {
  /** Which generation this is: the first is 1. */
  generation: number;
  /** Companies sold this generation. @see singularityFloor */
  sales: number;
  /** A company sold: one more this generation. */
  recordSale: () => void;
};

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set) => ({
      generation: 1,
      sales: 0,
      recordSale: () => set((s) => ({ sales: s.sales + 1 })),
    }),
    {
      name: "generation",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ generation: s.generation, sales: s.sales }),
    },
  ),
);
