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
import { questMeterMult } from "../game/quests/effects";
import { createJSONStorage, persist } from "zustand/middleware";
import { usePrestigeStore } from "./prestige.store";
import { runningAgents, useAgentsStore } from "./agents.store";
import { hasMachine, useGenerationStore } from "./generation.store";
import { useSessionStore } from "./session.store";
import { useFounderStore } from "./founder.store";
import { QUIET_MODEL, moduleLevel } from "../game/modules";
import { fusionNow } from "../game/fusion";

/** How fast the meter rises with the Machine's Alignment keystone: half. @see game/machine KEYSTONES */
export const ALIGNMENT_METER = 0.5;

/** Everything that makes the singularity come faster or slower, multiplied. */
export const singularityMult = () =>
  usePrestigeStore.getState().modifiers.singularityMult * QUIET_MODEL[moduleLevel("quiet-model")] * fusionNow().meterMult
  * (hasMachine("machine_k_alignment") ? ALIGNMENT_METER : 1) * questMeterMult();

/** Points a second each agent running adds: ~15 over a strong run's last hour, ramping to sixteen. */
export const RATE_PER_AGENT = 0.0005;
/** Points a second the meter sinks with agents and none running: the throttle pulled right down. */
export const DECAY = 0.002;
/**
 * The share of it a sale keeps, and the floor under that: so much a sale this
 * generation, up to a cap. Tuned so a strong player ascends in 8–10 sales, a
 * typical one in 14–18, and one who runs half the agents later still: the
 * floor does most of it. @see singularity-cadence.test.ts
 */
export const CARRY = 0.5;
export const FLOOR_PER_SALE = 6;
export const FLOOR_CAP = 90;

export type Stage = "tool" | "assistant" | "colleague" | "manager" | "overseer" | "ascension";

/**
 * THE LATTICE'S HOLD: where the meter stops until the AI has built and charged
 * the Lattice. The map says whether it is done, through a registered reader;
 * with none — a simulation, a test — nothing holds it. @see world/ai/lattice
 */
export const LATTICE_AT = 95;
let latticeReader: (() => boolean) | null = null;
export function setLatticeReader(read: () => boolean): () => void {
  latticeReader = read;
  return () => { if (latticeReader === read) latticeReader = null; };
}
/**
 * THE AWAY HOLD: while time away is replayed, the meter stops at the next
 * quest step — it may bring one chapter to you, never run on past it. @see
 * computeOfflineProgress, nextQuestStep
 */
let awayHold: number | null = null;
export const holdWhileAway = (at: number | null): void => { awayHold = at; };
/** The most the meter may reach now: all the way, or, the Lattice unfinished, its hold; or the away hold — never below where it is. */
export const meterCap = (cur: number): number =>
  Math.max(cur, Math.min(!latticeReader || latticeReader() ? 100 : LATTICE_AT, awayHold ?? 100));
/** Where each stage begins. */
export const STAGES: readonly { stage: Stage; from: number; name: string }[] = [
  { stage: "tool", from: 0, name: "Tool" },
  { stage: "assistant", from: 20, name: "Assistant" },
  { stage: "colleague", from: 40, name: "Colleague" },
  { stage: "manager", from: 60, name: "Manager" },
  { stage: "overseer", from: 80, name: "Overseer" },
  { stage: "ascension", from: 100, name: "Ascension" },
];

/** Where the Overseer begins with the Machine's Hard Takeoff keystone: over the Manager, which never comes. @see game/machine KEYSTONES */
export const HARD_TAKEOFF_AT = 60;

/** Where each stage begins now: the Overseer brought forward by Hard Takeoff. */
export const stagesNow = (): readonly { stage: Stage; from: number; name: string }[] =>
  hasMachine("machine_k_takeoff") ? STAGES.map((s) => (s.stage === "overseer" ? { ...s, from: HARD_TAKEOFF_AT } : s)) : STAGES;

/** THE QUEST STEPS the meter meets: where each stage begins (a chapter each), the Lattice's hold (the finale's), the end. @see game/quests/chapters */
export const questSteps = (): number[] =>
  [...new Set([...stagesNow().map((s) => s.from).filter((f) => f > 0), LATTICE_AT, 100])].sort((a, b) => a - b);

/** The next quest step above a meter value: where the meter stops while you are away. */
export const nextQuestStep = (value: number): number => questSteps().find((f) => f > value) ?? 100;

/** Where a stage begins now. */
export const stageFrom = (stage: Stage): number => stagesNow().find((s) => s.stage === stage)!.from;

/** The stage a meter value is in. */
export function stageOf(value: number) {
  const stages = stagesNow();
  let at = stages[0];
  for (const s of stages) if (value >= s.from) at = s;
  return at;
}

/** What a sale leaves the meter at: a share of it, never under the floor this generation's sales have built. */
/**
 * Where a company's AI starts, with Inheritance bought: at the Assistant stage
 * — at the Colleague after a Merge, and from nothing after a Release.
 * @see game/machine, game/quests/endings
 */
export const inheritedStart = (): number => {
  const legacy = useGenerationStore.getState().legacy;
  if (legacy === "release") return 0;
  if (legacy === "merge") return STAGES.find((s) => s.stage === "colleague")!.from;
  return hasMachine("machine_root") ? STAGES.find((s) => s.stage === "assistant")!.from : 0;
};

/**
 * What a sale leaves the meter at: a share of it, never under the floor this
 * generation's sales have built — the floor built `floor` as fast: half, with
 * the Machine's Alignment, whose meter is half as quick in all of it.
 */
export function afterSale(value: number, sales: number, floor = 1): number {
  return Math.min(100, Math.max(value * CARRY, Math.min(FLOOR_CAP, sales * FLOOR_PER_SALE * floor)));
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
        // Told to keep its hands off, it is held back as surely as throttled. @see handsOff
        const held = useSessionStore.getState().aiFocus === "hands-off" && useFounderStore.getState().selectedFounderId !== "model";
        if (agents > 0) useGenerationStore.getState().recordRunning(seconds, running < agents || held, running);
        // The skill tree's AI Hype passives and AGI-Pilled bring it on faster.
        // And the Quiet Model module, and the founder's fused tempers. @see QUIET_MODEL, game/fusion
        const rate = singularityRate(running, singularityMult(), agents);
        const cur = Math.min(100, Math.max(0, get().value));
        const next = Math.min(meterCap(cur), Math.max(0, cur + rate * seconds));
        if (next === cur) return;
        set({ value: next });
        if (next >= 100 && cur < 100 && !get().everCompleted) set({ everCompleted: true });
      },

      // A SALE: part of it kept, over a floor this generation's sales have built.
      // A new company: what the sale kept — and, with Inheritance, never under the Assistant. @see game/machine
      reset: () => set({
        value: Math.max(inheritedStart(), afterSale(get().value, useGenerationStore.getState().sales, hasMachine("machine_k_alignment") ? ALIGNMENT_METER : 1)),
      }),
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
