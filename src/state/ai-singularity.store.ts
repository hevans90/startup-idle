import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { vibeSingularityAccrualRatePerSecond } from "../game/satisfaction";
import { usePrestigeStore } from "./prestige.store";

type AiSingularityState = {
  value: number;
  everCompleted: boolean;
  tick: (seconds: number, vibeScore: number, employeeManagementUnlocked: boolean) => void;
  reset: () => void;
};

const KEY = "ai-singularity";

export const useAiSingularityStore = create<AiSingularityState>()(
  persist(
    (set, get) => ({
      value: 0,
      everCompleted: false,

      tick: (seconds, vibeScore, employeeManagementUnlocked) => {
        if (!employeeManagementUnlocked || vibeScore >= 0) return;
        // Skill-tree "AI hype" passives accelerate the singularity.
        const rate =
          vibeSingularityAccrualRatePerSecond(vibeScore) *
          usePrestigeStore.getState().modifiers.singularityMult;
        const cur = Math.min(100, Math.max(0, get().value));
        if (cur >= 100) {
          set({ value: 100 });
          return;
        }
        const next = Math.min(100, cur + rate * seconds);
        set({ value: next });
        if (next >= 100 && cur < 100) {
          if (!get().everCompleted) set({ everCompleted: true });
          // Lazy import avoids a circular dep at module load time.
          import("./directives.store").then(({ useDirectivesStore }) => {
            useDirectivesStore.getState().onSingularityCompleted();
          });
        }
      },

      reset: () => {
        import("./directives.store").then(({ useDirectivesStore }) => {
          const pct = useDirectivesStore.getState().singularityCarryoverPct;
          const carry = pct > 0 ? Math.min(100, get().value * pct) : 0;
          set({ value: carry });
          if (carry === 0) useAiSingularityStore.persist.clearStorage();
        });
      },
    }),
    {
      name: KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ value: s.value, everCompleted: s.everCompleted }),
      merge: (persisted, current) => {
        const p = persisted as { value?: number; everCompleted?: boolean } | null | undefined;
        const raw = p?.value;
        const value =
          typeof raw === "number" && Number.isFinite(raw)
            ? Math.min(100, Math.max(0, raw))
            : current.value;
        return { ...current, value, everCompleted: p?.everCompleted ?? false };
      },
    }
  )
);
