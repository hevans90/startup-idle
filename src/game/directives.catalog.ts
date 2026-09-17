import type { DirectivesState } from "../state/directives.store";

export type DirectiveDef = {
  id: string;
  name: string;
  flavour: string;
  objectiveLabel: string;
  target: number;
  getProgress: (state: DirectivesState) => number;
  rewardLabel: string;
  applyReward: (set: (fn: (s: DirectivesState) => Partial<DirectivesState>) => void) => void;
};

export const DIRECTIVES: DirectiveDef[] = [
  {
    id: "neural_bootstrap",
    name: "Neural Bootstrap",
    flavour: "10x developers are a myth. Hire 300 of them to confirm.",
    objectiveLabel: "10x devs hired (cumulative)",
    target: 300,
    getProgress: (s) => s.lifetimeDev10xHired,
    rewardLabel: "Intern upgrades auto-apply each run",
    applyReward: (set) => set(() => ({ autoInternUpgrades: true })),
  },
  {
    id: "synthetic_persistence",
    name: "Synthetic Persistence",
    flavour: "The machine dreams in git commits. Let it dream again.",
    objectiveLabel: "Singularity fills (separate runs)",
    target: 8,
    getProgress: (s) => s.singularityFillCount,
    rewardLabel: "Singularity resets to 70% on exit instead of 0%",
    applyReward: (set) => set(() => ({ singularityCarryoverPct: 0.7 })),
  },
  {
    id: "recursive_improvement",
    name: "Recursive Improvement",
    flavour: "Innovation for innovation's sake. The recursion stops when the server bill arrives.",
    objectiveLabel: "Lifetime innovation accumulated",
    target: 10_000_000_000,
    getProgress: (s) => s.lifetimeInnovation,
    rewardLabel: "Innovation unlocks (managers + EM) trigger automatically",
    applyReward: (set) => set(() => ({ autoInnovationUnlocks: true })),
  },
  {
    id: "market_domination",
    name: "Market Domination",
    flavour: "Five million in valuation. Still less than a Series A. Impressive.",
    objectiveLabel: "Lifetime valuation accrued ($M)",
    target: 5_000_000,
    getProgress: (s) => s.lifetimeValuation,
    rewardLabel: "Board mandate cost growth −25% permanently",
    applyReward: (set) => set(() => ({ mandateCostGrowthReduction: 0.25 })),
  },
  {
    id: "exit_velocity",
    name: "Exit Velocity",
    flavour: "You've sold so many companies your accountant has PTSD.",
    objectiveLabel: "Equity earned (cumulative from unlock)",
    target: 300,
    getProgress: (s) => s.lifetimeEquity,
    rewardLabel: "Vibe coder upgrades auto-apply as conditions are met",
    applyReward: (set) => set(() => ({ autoVibeUpgrades: true })),
  },
  {
    id: "compound_growth",
    name: "Compound Growth",
    flavour: "$500 trillion. That's not a company, that's a financial district.",
    objectiveLabel: "Lifetime money earned ($)",
    target: 5e14,
    getProgress: (s) => s.lifetimeMoney,
    rewardLabel: "New runs start with free interns and vibe coders based on exit count",
    applyReward: (set) => set(() => ({ freeStartingEnabled: true })),
  },
  {
    id: "total_integration",
    name: "Total Integration",
    flavour: "5,000 vibe coders vibrating in unison. The office sounds like a data center.",
    objectiveLabel: "Vibe coders hired (cumulative)",
    target: 5_000,
    getProgress: (s) => s.lifetimeVibeCoderHired,
    rewardLabel: "Board mandate cost growth capped at 1.1 — buy dozens more levels immediately",
    applyReward: (set) => set(() => ({ mandateCostGrowthCap: 1.1 })),
  },
  {
    id: "post_agi_transition",
    name: "Post-AGI Transition",
    flavour: "120 nodes and 25 exits. The skill tree is now just your LinkedIn.",
    objectiveLabel: "120 skill nodes active + 25 total exits",
    target: 1,
    getProgress: (s) => (s.postAgiConditionsMet ? 1 : 0),
    rewardLabel: "AGI Acquisition available: 5× equity payout option",
    applyReward: (set) => set(() => ({ agiAcquisitionUnlocked: true })),
  },
];
