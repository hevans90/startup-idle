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
import { runningAgents, useAgentsStore } from "./agents.store";
import { useGenerationStore } from "./generation.store";
import { QUIET_MODEL, moduleLevel } from "../game/modules";
import { fusionNow } from "../game/fusion";

/** Everything that makes the singularity come faster or slower, multiplied. */
export const singularityMult = () =>
  usePrestigeStore.getState().modifiers.singularityMult * QUIET_MODEL[moduleLevel("quiet-model")] * fusionNow().meterMult;

/** Points a second each agent running adds: ~15 over a strong run's last hour, ramping to sixteen. */
export const RATE_PER_AGENT = 0.0005;
/** Points a second the meter sinks with agents and none running: the throttle pulled right down. */
export const DECAY = 0.002;
/**
 * The share of it a sale keeps, and the floor under that: so much a sale this
 * generation, up to a cap. Tuned so a strong player ascends in about 5 sales,
 * a typical one in about 10, and one who runs half the agents not until they
 * push. @see singularity-cadence.test.ts
 */
export const CARRY = 0.8;
export const FLOOR_PER_SALE = 10;
export const FLOOR_CAP = 90;

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

/** Points a second the meter moves by, with `running` of `owned` agents running: before there are any, it holds. */
export function singularityRate(running: number, mult = 1, owned = running): number {
  return running > 0 ? running * RATE_PER_AGENT * mult : owned > 0 ? -DECAY : 0;
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
        // HOW HARD THE AGENTS ARE RUN, for the behaviour log. @see BehaviourLog
        const { agents } = useAgentsStore.getState(), running = runningAgents();
        if (agents > 0) useGenerationStore.getState().recordRunning(seconds, running < agents, running);
        // The skill tree's AI Hype passives and AGI-Pilled bring it on faster.
        // And the Quiet Model module, and the founder's fused tempers. @see QUIET_MODEL, game/fusion
        const rate = singularityRate(running, singularityMult(), agents);
        const cur = Math.min(100, Math.max(0, get().value));
        const next = Math.min(100, Math.max(0, cur + rate * seconds));
        if (next === cur) return;
        set({ value: next });
        if (next >= 100 && cur < 100 && !get().everCompleted) set({ everCompleted: true });
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
