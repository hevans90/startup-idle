import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { vibeSingularityAccrualRatePerSecond } from "../game/satisfaction";

type AiSingularityState = {
  value: number;
  tick: (seconds: number, vibeScore: number, employeeManagementUnlocked: boolean) => void;
  reset: () => void;
};

const KEY = "ai-singularity";

export const useAiSingularityStore = create<AiSingularityState>()(
  persist(
    (set, get) => ({
      value: 0,

      tick: (seconds, vibeScore, employeeManagementUnlocked) => {
        if (!employeeManagementUnlocked || vibeScore >= 0) return;
        const rate = vibeSingularityAccrualRatePerSecond(vibeScore);
        const cur = Math.min(100, Math.max(0, get().value));
        if (cur >= 100) {
          set({ value: 100 });
          return;
        }
        set({ value: Math.min(100, cur + rate * seconds) });
      },

      reset: () => {
        set({ value: 0 });
        useAiSingularityStore.persist.clearStorage();
      },
    }),
    {
      name: KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ value: s.value }),
      merge: (persisted, current) => {
        const p = persisted as { state?: { value?: number } } | null | undefined;
        const raw = p?.state?.value;
        const value =
          typeof raw === "number" && Number.isFinite(raw)
            ? Math.min(100, Math.max(0, raw))
            : current.value;
        return { ...current, value };
      },
    }
  )
);
