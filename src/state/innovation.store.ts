import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { decimalReplacer, decimalReviver } from "./_break_infinity.decimals";

type InnovationState = {
  innovation: Decimal;
  increaseInnovation: (increment: number) => void;
  spendInnovation: (decrement: number) => void;

  reset: () => void;
};

const LOCAL_STORAGE_KEY = "innovation";

export const useInnovationStore = create<InnovationState>()(
  persist(
    (set) => ({
      innovation: new Decimal(0),
      increaseInnovation: (increment: number) => {
        set((state) => {
          const newMoney = state.innovation.add(increment);
          return { innovation: newMoney };
        });
      },
      spendInnovation: (decrement: number) => {
        set((state) => {
          const newInnovation = state.innovation.subtract(decrement);
          return { innovation: newInnovation };
        });
      },
      reset: () => {
        set({ innovation: new Decimal(0) });
      },
    }),
    {
      name: LOCAL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage, {
        replacer: decimalReplacer,
        reviver: decimalReviver,
      }),
    }
  )
);
