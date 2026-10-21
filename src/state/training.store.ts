/**
 * THE TRAINING RUN under way, if there is one: what it is trained on, and
 * when it ends; and THE SKILLS the AI has learned this company, a level a
 * dataset. Kept with the run, and cleared at a sale: a new company is a new
 * upbringing. When a run ends the skill goes up, the singularity jumps and
 * the behaviour log is told. @see game/training
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { MAX_SKILL, TRAINING_SECONDS, dataset, type DatasetId } from "../game/training";
import { useAiSingularityStore } from "./ai-singularity.store";
import { PRE_TRAINED, moduleLevel } from "../game/modules";
import { fusionNow } from "../game/fusion";
import { useGenerationStore } from "./generation.store";

type TrainingState = {
  current: { dataset: DatasetId; endsAt: number } | null;
  /** Levels learned this company, by dataset. */
  skills: Partial<Record<DatasetId, number>>;
  /** Why a run cannot start now, or null if it can. */
  blocked: () => "running" | null;
  /** How long the next run lasts, seconds. */
  seconds: () => number;
  /** Start a run on a dataset. Whether it started. */
  start: (id: DatasetId, now?: number) => boolean;
  /** Finish the run if its time is up: the skill, the jump, and the log. */
  tick: (now?: number) => void;
  reset: () => void;
};

export const useTrainingStore = create<TrainingState>()(
  persist(
    (set, get) => ({
      current: null,
      skills: {},
      // Shorter with the Pre-trained module and Ego fused in.
      seconds: () => TRAINING_SECONDS * PRE_TRAINED[moduleLevel("pre-trained")] * fusionNow().trainingTimeMult,
      blocked: () => (get().current ? "running" : null),
      start: (id, now = Date.now()) => {
        if (get().blocked() || !dataset(id)) return false;
        set({ current: { dataset: id, endsAt: now + get().seconds() * 1000 } });
        return true;
      },
      tick: (now = Date.now()) => {
        const c = get().current;
        if (!c || now < c.endsAt) return;
        set((s) => ({ current: null, skills: { ...s.skills, [c.dataset]: Math.min(MAX_SKILL, (s.skills[c.dataset] ?? 0) + 1) } }));
        const d = dataset(c.dataset);
        if (d) useAiSingularityStore.setState((s) => ({ value: Math.min(100, s.value + d.jump * fusionNow().trainingJumpMult) }));
        useGenerationStore.getState().recordTraining(c.dataset);
      },
      reset: () => set({ current: null, skills: {} }),
    }),
    {
      name: "training",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ current: s.current, skills: s.skills }),
    },
  ),
);

/** The dataset being trained on now, or null. */
export function training(now = Date.now()): DatasetId | null {
  const c = useTrainingStore.getState().current;
  return c && now < c.endsAt ? c.dataset : null;
}

/** The level of a dataset's skill the AI has learned this company, 0–3. */
export const skillOf = (id: DatasetId): number => useTrainingStore.getState().skills?.[id] ?? 0;
