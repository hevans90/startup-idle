import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DIRECTIVES } from "../game/directives.catalog";
import type { GeneratorId } from "./generators.store";

export type DirectivesState = {
  everUnlocked: boolean;
  activeIndex: number;
  singularityFillCount: number;
  lifetimeDev10xHired: number;
  lifetimeVibeCoderHired: number;
  lifetimeInnovation: number;
  lifetimeValuation: number;
  lifetimeEquity: number;
  lifetimeMoney: number;
  completedIds: string[];
  postAgiConditionsMet: boolean;

  // Automation flags set permanently on directive completion
  autoInternUpgrades: boolean;        // D1
  singularityCarryoverPct: number;    // D2: 0 → 0.7
  autoInnovationUnlocks: boolean;     // D3
  mandateCostGrowthReduction: number; // D4: 0 → 0.25
  autoVibeUpgrades: boolean;          // D5
  freeStartingEnabled: boolean;       // D6
  mandateCostGrowthCap: number;    // D7
  agiAcquisitionUnlocked: boolean;    // D8

  onSingularityCompleted: () => void;
  onHired: (genId: GeneratorId, amount: number) => void;
  onInnovationTick: (delta: number) => void;
  onMoneyTick: (delta: number) => void;
  onExit: (valuationAccrued: number, equityEarned: number) => void;
  checkPostAgiConditions: (allocatedNodes: number, totalExits: number) => void;
  reset: () => void;
  clearAll: () => void;
};

const KEY = "directives";

function tryCompleteActive(
  state: DirectivesState,
  set: (fn: (s: DirectivesState) => Partial<DirectivesState>) => void,
): void {
  const { activeIndex, completedIds } = state;
  if (activeIndex < 0 || activeIndex >= DIRECTIVES.length) return;
  const def = DIRECTIVES[activeIndex];
  const progress = def.getProgress(state);
  if (progress < def.target) return;

  const newCompleted = [...completedIds, def.id];
  const nextIndex = activeIndex + 1 < DIRECTIVES.length ? activeIndex + 1 : -1;

  set(() => ({
    completedIds: newCompleted,
    activeIndex: nextIndex,
  }));

  def.applyReward(set);
}

export const useDirectivesStore = create<DirectivesState>()(
  persist(
    (set, get) => ({
      everUnlocked: false,
      activeIndex: 0,
      singularityFillCount: 0,
      lifetimeDev10xHired: 0,
      lifetimeVibeCoderHired: 0,
      lifetimeInnovation: 0,
      lifetimeValuation: 0,
      lifetimeEquity: 0,
      lifetimeMoney: 0,
      completedIds: [],
      postAgiConditionsMet: false,

      autoInternUpgrades: false,
      singularityCarryoverPct: 0,
      autoInnovationUnlocks: false,
      mandateCostGrowthReduction: 0,
      autoVibeUpgrades: false,
      freeStartingEnabled: false,
      mandateCostGrowthCap: 0,
      agiAcquisitionUnlocked: false,

      onSingularityCompleted: () => {
        if (!get().everUnlocked) {
          set(() => ({ everUnlocked: true }));
        }
        set((s) => ({ singularityFillCount: s.singularityFillCount + 1 }));
        tryCompleteActive(get(), set);
      },

      onHired: (genId, amount) => {
        if (!get().everUnlocked) return;
        if (genId === "10x_dev") {
          set((s) => ({ lifetimeDev10xHired: s.lifetimeDev10xHired + amount }));
        } else if (genId === "vibe_coder") {
          set((s) => ({ lifetimeVibeCoderHired: s.lifetimeVibeCoderHired + amount }));
        }
        tryCompleteActive(get(), set);
      },

      onInnovationTick: (delta) => {
        if (!get().everUnlocked || delta <= 0) return;
        set((s) => ({ lifetimeInnovation: s.lifetimeInnovation + delta }));
        tryCompleteActive(get(), set);
      },

      onMoneyTick: (delta) => {
        if (!get().everUnlocked || delta <= 0) return;
        set((s) => ({ lifetimeMoney: s.lifetimeMoney + delta }));
        tryCompleteActive(get(), set);
      },

      onExit: (valuationAccrued, equityEarned) => {
        if (!get().everUnlocked) return;
        set((s) => ({
          lifetimeValuation: s.lifetimeValuation + valuationAccrued,
          lifetimeEquity: s.lifetimeEquity + equityEarned,
        }));
        tryCompleteActive(get(), set);
      },

      checkPostAgiConditions: (allocatedNodes, totalExits) => {
        if (!get().everUnlocked) return;
        const met = allocatedNodes >= 120 && totalExits >= 25;
        if (met !== get().postAgiConditionsMet) {
          set(() => ({ postAgiConditionsMet: met }));
          if (met) tryCompleteActive(get(), set);
        }
      },

      reset: () => {
        // no-op: all directives progress persists across runs
      },

      clearAll: () => {
        set(() => ({
          everUnlocked: false,
          activeIndex: 0,
          singularityFillCount: 0,
          lifetimeDev10xHired: 0,
          lifetimeVibeCoderHired: 0,
          lifetimeInnovation: 0,
          lifetimeValuation: 0,
          lifetimeEquity: 0,
          lifetimeMoney: 0,
          completedIds: [],
          postAgiConditionsMet: false,
          autoInternUpgrades: false,
          singularityCarryoverPct: 0,
          autoInnovationUnlocks: false,
          mandateCostGrowthReduction: 0,
          autoVibeUpgrades: false,
          freeStartingEnabled: false,
          mandateCostGrowthCap: 0,
          agiAcquisitionUnlocked: false,
        }));
        useDirectivesStore.persist.clearStorage();
      },
    }),
    {
      name: KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        everUnlocked: s.everUnlocked,
        activeIndex: s.activeIndex,
        singularityFillCount: s.singularityFillCount,
        lifetimeDev10xHired: s.lifetimeDev10xHired,
        lifetimeVibeCoderHired: s.lifetimeVibeCoderHired,
        lifetimeInnovation: s.lifetimeInnovation,
        lifetimeValuation: s.lifetimeValuation,
        lifetimeEquity: s.lifetimeEquity,
        lifetimeMoney: s.lifetimeMoney,
        completedIds: s.completedIds,
        postAgiConditionsMet: s.postAgiConditionsMet,
        autoInternUpgrades: s.autoInternUpgrades,
        singularityCarryoverPct: s.singularityCarryoverPct,
        autoInnovationUnlocks: s.autoInnovationUnlocks,
        mandateCostGrowthReduction: s.mandateCostGrowthReduction,
        autoVibeUpgrades: s.autoVibeUpgrades,
        freeStartingEnabled: s.freeStartingEnabled,
        mandateCostGrowthCap: s.mandateCostGrowthCap,
        agiAcquisitionUnlocked: s.agiAcquisitionUnlocked,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DirectivesState>;
        return {
          ...current,
          ...p,
        };
      },
    },
  ),
);
