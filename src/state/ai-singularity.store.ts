/**
 * THE SINGULARITY: how far the company's AI has got past needing it, 0 to
 * 100. It rises with every AI agent RUNNING — throttle them at the Data Centre
 * and it rises slower — and sinks slowly when nothing is pushing it. A sale
 * keeps part of it, more the more companies this generation has sold, so it
 * builds over several companies toward the Ascension. @see plans/singularity.md
 *
 * Its STAGES — Tool, Assistant, Colleague, Manager, Overseer — are what the
 * rest of the game reads: what the AI does on the map, what it says, how the
 * town looks. @see stageOf
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { usePrestigeStore } from "./prestige.store";
import { runningAgents } from "./agents.store";
import { useGenerationStore } from "./generation.store";

/** Points a second each agent running adds: ~30 over a strong run's hour and a half with fifteen. */
export const RATE_PER_AGENT = 0.00037;
/** Points a second the meter sinks with no agent running. */
export const DECAY = 0.002;
/** The share of it a sale keeps, and the floor under that: so much a sale this generation, up to a cap. */
export const CARRY = 0.4;
export const FLOOR_PER_SALE = 5;
export const FLOOR_CAP = 60;

export type Stage = "tool" | "assistant" | "colleague" | "manager" | "overseer" | "ascension";
/** Where each stage begins. */
export const STAGES: readonly { stage: Stage; from: number; name: string }[] = [
  { stage: "tool", from: 0, name: "Tool" },
  { stage: "assistant", from: 20, name: "Assistant" },
  { stage: "colleague", from: 40, name: "Colleague" },
  { stage: "manager", from: 60, name: "Manager" },
  { stage: "overseer", from: 80, name: "Overseer" },
  { stage: "ascension", from: 100, name: "Ascension" },
];

/** The stage a meter value is in. */
export function stageOf(value: number) {
  let at = STAGES[0];
  for (const s of STAGES) if (value >= s.from) at = s;
  return at;
}

/** What a sale leaves the meter at: a share of it, never under the floor this generation's sales have built. */
export function afterSale(value: number, sales: number): number {
  return Math.min(100, Math.max(value * CARRY, Math.min(FLOOR_CAP, sales * FLOOR_PER_SALE)));
}

/** Points a second the meter moves by, with `running` agents running. */
export function singularityRate(running: number, mult = 1): number {
  return running > 0 ? running * RATE_PER_AGENT * mult : -DECAY;
}

type AiSingularityState = {
  value: number;
  everCompleted: boolean;
  tick: (seconds: number) => void;
  reset: () => void;
};

const KEY = "ai-singularity";

export const useAiSingularityStore = create<AiSingularityState>()(
  persist(
    (set, get) => ({
      value: 0,
      everCompleted: false,

      tick: (seconds) => {
        // The skill tree's AI Hype passives and AGI-Pilled bring it on faster.
        const rate = singularityRate(runningAgents(), usePrestigeStore.getState().modifiers.singularityMult);
        const cur = Math.min(100, Math.max(0, get().value));
        const next = Math.min(100, Math.max(0, cur + rate * seconds));
        if (next === cur) return;
        set({ value: next });
        if (next >= 100 && cur < 100) {
          if (!get().everCompleted) set({ everCompleted: true });
          // Lazy import avoids a circular dep at module load time.
          import("./directives.store").then(({ useDirectivesStore }) => {
            useDirectivesStore.getState().onSingularityCompleted();
          });
        }
      },

      // A SALE: part of it kept, over a floor this generation's sales have built.
      reset: () => set({ value: afterSale(get().value, useGenerationStore.getState().sales) }),
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
