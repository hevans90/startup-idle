import Decimal from "break_infinity.js";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { decimalReplacer, decimalReviver } from "./_break_infinity.decimals";

const LOCAL_STORAGE_KEY = "innovation";

const unlockInitialState = {
  managers: { unlocked: false, cost: new Decimal(1) },
  // valuationGamba: false,
};

type UnlockKeys = keyof typeof unlockInitialState;

type InnovationState = {
  innovation: Decimal;
  getMultiplier: () => Decimal;

  // Innovation controls
  increaseInnovation: (increment: number) => void;
  spendInnovation: (decrement: number) => void;
  reset: () => void;

  // Unlockables
  unlocks: Record<UnlockKeys, { unlocked: boolean; cost: Decimal }>;
  canUnlock: (key: UnlockKeys) => boolean;
  unlock: (key: UnlockKeys) => void;
};

export const useInnovationStore = create<InnovationState>()(
  persist(
    (set, get) => ({
      innovation: new Decimal(0),
      unlocks: { ...unlockInitialState },

      getMultiplier: () => {
        const { innovation } = get();
        return new Decimal(Decimal.log10(innovation.add(1)) + 1);
      },

      increaseInnovation: (increment: number) => {
        set((state) => ({
          innovation: state.innovation.add(increment),
        }));
      },

      spendInnovation: (decrement: number) => {
        set((state) => ({
          innovation: state.innovation.sub(decrement),
        }));
      },

      reset: () => {
        set({
          innovation: new Decimal(0),
          unlocks: { ...unlockInitialState },
        });
      },

      canUnlock: (key) => {
        const { innovation, unlocks } = get();
        return (
          !unlocks[key].unlocked &&
          innovation.greaterThanOrEqualTo(unlocks[key].cost)
        );
      },

      unlock: (key) => {
        const { canUnlock, spendInnovation, unlocks } = get();
        if (canUnlock(key)) {
          spendInnovation(unlocks[key].cost.toNumber());
          set((state) => ({
            unlocks: {
              ...state.unlocks,
              [key]: { unlocked: true, cost: unlocks[key].cost },
            },
          }));
        }
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
