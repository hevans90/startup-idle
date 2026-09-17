import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SATISFACTION_MIN } from "../game/satisfaction";

const LOCAL_STORAGE_KEY = "slop-pit";

/** Vibe coder headcount required before the pit appears and starts filling. */
export const SLOP_PIT_UNLOCK_COUNT = 50;

const FILL_RATE_PER_CODER = 0.002; // % per second per vibe coder
const PENALTY_THRESHOLD = 0.5;     // fill fraction below which no penalty applies
const PENALTY_AT_FULL = 0.15;      // money mult at 100% fill (85% income lost)
const DRAIN_SATISFACTION_HIT = -40;

type SlopPitState = {
  fill: number; // 0–100 (percent full)

  getMoneyPenaltyMult: () => number;
  tick: (vibeCoderCount: number, seconds: number) => void;
  drain: () => void;
  reset: () => void;
};

export const useSlopPitStore = create<SlopPitState>()(
  persist(
    (set, get) => ({
      fill: 0,

      getMoneyPenaltyMult: () => {
        const pct = get().fill / 100;
        if (pct <= PENALTY_THRESHOLD) return 1;
        const t = (pct - PENALTY_THRESHOLD) / (1 - PENALTY_THRESHOLD);
        return 1 - t * (1 - PENALTY_AT_FULL);
      },

      tick: (vibeCoderCount, seconds) => {
        if (vibeCoderCount < SLOP_PIT_UNLOCK_COUNT) return;
        const ratePerSecond = vibeCoderCount * FILL_RATE_PER_CODER;
        set((s) => ({ fill: Math.min(100, s.fill + ratePerSecond * seconds) }));
      },

      drain: () => {
        set({ fill: 0 });
        import("./generators.store").then(({ useGeneratorStore }) => {
          useGeneratorStore.setState((s) => ({
            satisfactionScores: {
              ...s.satisfactionScores,
              vibe_coder: Math.max(
                SATISFACTION_MIN,
                s.satisfactionScores.vibe_coder + DRAIN_SATISFACTION_HIT,
              ),
            },
          }));
        });
      },

      reset: () => set({ fill: 0 }),
    }),
    {
      name: LOCAL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ fill: s.fill }),
    },
  ),
);
