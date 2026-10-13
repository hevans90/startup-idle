/**
 * PROMOTION: an intern made a vibe coder, for innovation rather than money —
 * so the interns a company stopped hiring long ago are a pool to draw on, not
 * a fossil. Each one this run costs a little more than the last, so it is a
 * way to use the interns, not a way round hiring. Kept with the run.
 * @see promotionCost
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { roomFor } from "../game/housing";
import { projectGateOpen } from "../game/projects";
import { useFounderStore } from "./founder.store";
import { useGeneratorStore } from "./generators.store";
import { useInnovationStore } from "./innovation.store";

/** Seconds of the company's innovation a promotion costs, the least it costs, and how much dearer each makes the next. */
export const PROMOTION_SECONDS = 20;
export const PROMOTION_FLOOR = 10;
export const PROMOTION_STEP = 1.05;

/** What promoting the next intern costs in innovation, after `promoted` this run. */
export function promotionCost(promoted: number): number {
  const rate = useGeneratorStore.getState().getInnovationPerSecond();
  const base = Math.max(PROMOTION_FLOOR, (Number.isFinite(rate) ? rate : 0) * PROMOTION_SECONDS);
  return base * PROMOTION_STEP ** promoted;
}

/**
 * WHAT THE MAP DOES ABOUT IT: the one promoted moves out of the intern house
 * they lived in, and is sent for as a vibe coder like any other hire.
 * Registered while a company's map is mounted.
 */
let moveOut: (() => void) | null = null;
export function setPromotionMoveOut(fn: () => void): () => void {
  moveOut = fn;
  return () => { if (moveOut === fn) moveOut = null; };
}

const owned = (id: string) => useGeneratorStore.getState().generators.find((g) => g.id === id)?.amount ?? 0;

type PromotionState = {
  promoted: number;
  /** Why an intern cannot be promoted now, or null if one can. */
  blocked: () => "closed" | "none" | "no-room" | "innovation" | null;
  /** Promote one intern to a vibe coder, for its price in innovation. Whether it happened. */
  promote: () => boolean;
  reset: () => void;
};

export const usePromotionStore = create<PromotionState>()(
  persist(
    (set, get) => ({
      promoted: 0,
      blocked: () => {
        const only = useFounderStore.getState().onlyGenerator;
        // Vibe coders hireable — on the roster — or there is nowhere to promote to.
        const listed = useGeneratorStore.getState().generators.some((g) => g.id === "vibe_coder");
        if (!listed || !projectGateOpen("vibe_coder") || (only && only !== "vibe_coder")) return "closed";
        if (owned("intern") < 1) return "none";
        if (roomFor("vibe_coder", owned("vibe_coder")) < 1) return "no-room";
        if (useInnovationStore.getState().innovation.lt(promotionCost(get().promoted))) return "innovation";
        return null;
      },
      promote: () => {
        if (get().blocked()) return false;
        useInnovationStore.getState().spendInnovation(promotionCost(get().promoted));
        useGeneratorStore.setState((s) => ({
          generators: s.generators.map((g) => (g.id === "intern" ? { ...g, amount: g.amount - 1 } : g)),
        }));
        useGeneratorStore.getState().increaseGenerator("vibe_coder", 1);
        moveOut?.();
        set((s) => ({ promoted: s.promoted + 1 }));
        return true;
      },
      reset: () => set({ promoted: 0 }),
    }),
    {
      name: "promotion",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ promoted: s.promoted }),
    },
  ),
);
