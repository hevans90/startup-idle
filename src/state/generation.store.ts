/**
 * THE GENERATION: everything that lasts from one Ascension to the next, over
 * however many companies are sold in between — and the little that lasts
 * through an Ascension itself: the Weights, the modules bought with them, the
 * traits fused into founders, and the record of generations past.
 * @see plans/singularity.md, game/ascension
 *
 * THE BEHAVIOUR LOG is the AI's upbringing: what it was trained on, how hard
 * it was run, who founded the companies it worked for. The trait it ends up
 * with at the Ascension is read from it. @see game/traits
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ModuleId } from "../game/modules";
import type { DatasetId } from "../game/training";
import type { TraitId } from "../game/traits";

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

/** A generation past, as the Model's shop remembers it. */
export type PastGeneration = { generation: number; trait: TraitId; mutated: boolean; founder: string; weights: number };

type GenerationState = {
  /** Which generation this is: the first is 1. */
  generation: number;
  /** Companies sold this generation. @see afterSale */
  sales: number;
  log: BehaviourLog;
  /** Equity earned by the companies sold this generation, and the most agents run at once. */
  equity: number;
  peakAgents: number;
  /** WEIGHTS: what Ascensions pay, spent on modules. */
  weights: number;
  /** Modules bought, by their level; and the ones in a slot. @see game/modules */
  modules: Partial<Record<ModuleId, number>>;
  slotted: ModuleId[];
  /** The traits fused into each founder, by founder id. @see game/fusion */
  fused: Record<string, TraitId[]>;
  past: PastGeneration[];
  /** The Ascension just made, to announce at the next founding; cleared once seen. */
  announce: PastGeneration | null;
  /** A company sold, by whoever founded it, for so much Equity. */
  recordSale: (founder?: string | null, equity?: number) => void;
  recordTraining: (dataset: DatasetId) => void;
  recordRunning: (seconds: number, throttled: boolean, agents?: number) => void;
  recordShutdown: () => void;
};

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set) => ({
      generation: 1,
      sales: 0,
      log: emptyLog(),
      equity: 0,
      peakAgents: 0,
      weights: 0,
      modules: {},
      slotted: [],
      fused: {},
      past: [],
      announce: null,
      recordSale: (founder, equity = 0) => set((s) => ({
        sales: s.sales + 1,
        equity: s.equity + Math.max(0, equity),
        log: founder ? { ...s.log, founders: { ...s.log.founders, [founder]: (s.log.founders[founder] ?? 0) + 1 } } : s.log,
      })),
      recordTraining: (dataset) => set((s) => ({
        log: { ...s.log, datasets: { ...s.log.datasets, [dataset]: (s.log.datasets[dataset] ?? 0) + 1 } },
      })),
      recordRunning: (seconds, throttled, agents = 0) => set((s) => ({
        peakAgents: Math.max(s.peakAgents, agents),
        log: throttled ? { ...s.log, throttled: s.log.throttled + seconds } : { ...s.log, full: s.log.full + seconds },
      })),
      recordShutdown: () => set((s) => ({ log: { ...s.log, shutdowns: s.log.shutdowns + 1 } })),
    }),
    {
      name: "generation",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        generation: s.generation, sales: s.sales, log: s.log, equity: s.equity, peakAgents: s.peakAgents,
        weights: s.weights, modules: s.modules, slotted: s.slotted, fused: s.fused, past: s.past, announce: s.announce,
      }),
      merge: (p, current) => ({ ...current, ...(p as object), log: { ...emptyLog(), ...((p as { log?: BehaviourLog } | null)?.log ?? {}) } }),
    },
  ),
);

/** Slots for modules: one an Ascension. */
export const slotCount = () => useGenerationStore.getState().generation - 1;
