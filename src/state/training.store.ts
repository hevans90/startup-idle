/**
 * THE TRAINING RUN under way, if there is one: what it is trained on, and
 * when it ends. Kept with the run. When it ends the singularity jumps and the
 * behaviour log is told. @see game/training
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { addMorale } from "../game/morale";
import { TRAINING_SECONDS, dataset, trainingCost, PEOPLE_MORALE, type DatasetId } from "../game/training";
import { useAiSingularityStore } from "./ai-singularity.store";
import { useGenerationStore } from "./generation.store";
import { useGeneratorStore } from "./generators.store";
import { useInnovationStore } from "./innovation.store";

type TrainingState = {
  current: { dataset: DatasetId; endsAt: number } | null;
  /** Why a run cannot start now, or null if it can. */
  blocked: () => "running" | "innovation" | null;
  /** What the next run costs, in innovation. */
  cost: () => number;
  /** Start a run on a dataset. Whether it started. */
  start: (id: DatasetId, now?: number) => boolean;
  /** Finish the run if its time is up: the jump, and the log. */
  tick: (now?: number) => void;
  reset: () => void;
};

const runsSoFar = () => Object.values(useGenerationStore.getState().log.datasets).reduce((n, k) => n + (k ?? 0), 0);

export const useTrainingStore = create<TrainingState>()(
  persist(
    (set, get) => ({
      current: null,
      cost: () => trainingCost(useGeneratorStore.getState().getInnovationPerSecond(), runsSoFar()),
      blocked: () => {
        if (get().current) return "running";
        if (useInnovationStore.getState().innovation.lt(get().cost())) return "innovation";
        return null;
      },
      start: (id, now = Date.now()) => {
        if (get().blocked() || !dataset(id)) return false;
        useInnovationStore.getState().spendInnovation(get().cost());
        set({ current: { dataset: id, endsAt: now + TRAINING_SECONDS * 1000 } });
        // THE PEOPLE: their satisfaction leant on for the run. @see addMorale
        if (id === "people") {
          for (const who of ["intern", "vibe_coder", "10x_dev"] as const) addMorale(who, PEOPLE_MORALE, TRAINING_SECONDS, now);
        }
        return true;
      },
      tick: (now = Date.now()) => {
        const c = get().current;
        if (!c || now < c.endsAt) return;
        set({ current: null });
        const d = dataset(c.dataset);
        if (d) useAiSingularityStore.setState((s) => ({ value: Math.min(100, s.value + d.jump) }));
        useGenerationStore.getState().recordTraining(c.dataset);
      },
      reset: () => set({ current: null }),
    }),
    {
      name: "training",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ current: s.current }),
    },
  ),
);

/** The dataset being trained on now, or null. */
export function training(now = Date.now()): DatasetId | null {
  const c = useTrainingStore.getState().current;
  return c && now < c.endsAt ? c.dataset : null;
}
