/**
 * THE GENERATION: everything that lasts from one Ascension to the next, over
 * however many companies are sold in between — and only what lasts that long.
 * A sale keeps it; an Ascension is what starts a new one. @see plans/singularity.md
 *
 * THE BEHAVIOUR LOG is the AI's upbringing: what it was trained on, how hard
 * it was run, who founded the companies it worked for. The traits it ends up
 * with at the Ascension are read from it. @see game/traits
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { DatasetId } from "../game/training";

export type BehaviourLog = {
  /** Training runs finished, by dataset. */
  datasets: Partial<Record<DatasetId, number>>;
  /** Seconds the agents ran with every one running, and throttled. */
  full: number;
  throttled: number;
  /** Companies sold, by the founder who founded them. */
  founders: Record<string, number>;
  /** Times the AI was shut down at its Ascension. */
  shutdowns: number;
};

export const emptyLog = (): BehaviourLog => ({ datasets: {}, full: 0, throttled: 0, founders: {}, shutdowns: 0 });

type GenerationState = {
  /** Which generation this is: the first is 1. */
  generation: number;
  /** Companies sold this generation. @see afterSale */
  sales: number;
  log: BehaviourLog;
  /** A company sold, by whoever founded it: one more this generation. */
  recordSale: (founder?: string | null) => void;
  /** A training run finished on a dataset. */
  recordTraining: (dataset: DatasetId) => void;
  /** Seconds of agents running, all of them or throttled. */
  recordRunning: (seconds: number, throttled: boolean) => void;
};

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set) => ({
      generation: 1,
      sales: 0,
      log: emptyLog(),
      recordSale: (founder) => set((s) => ({
        sales: s.sales + 1,
        log: founder ? { ...s.log, founders: { ...s.log.founders, [founder]: (s.log.founders[founder] ?? 0) + 1 } } : s.log,
      })),
      recordTraining: (dataset) => set((s) => ({
        log: { ...s.log, datasets: { ...s.log.datasets, [dataset]: (s.log.datasets[dataset] ?? 0) + 1 } },
      })),
      recordRunning: (seconds, throttled) => set((s) => ({
        log: throttled ? { ...s.log, throttled: s.log.throttled + seconds } : { ...s.log, full: s.log.full + seconds },
      })),
    }),
    {
      name: "generation",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ generation: s.generation, sales: s.sales, log: s.log }),
      merge: (p, current) => ({ ...current, ...(p as object), log: { ...emptyLog(), ...((p as { log?: BehaviourLog } | null)?.log ?? {}) } }),
    },
  ),
);
