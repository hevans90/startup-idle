import {
  IconBriefcase,
  IconCode,
  IconCpu,
  IconGhost,
  IconRobot,
  IconSeeding,
  IconTelescope,
  type Icon,
} from "@tabler/icons-react";
import type { GeneratorId } from "../state/generators.store";
import { dearer, describe } from "./wording";

export type FounderModifiers = {
  /** Subtract from every generator's cost-growth exponent. */
  costExponentReduction?: number;
  /** Scales the log term of the global innovation multiplier. */
  innovationLogMult?: number;
  /** Multiplies manager tier-progress gain. */
  managerProgressMult?: number;
  /** Multiplies valuation/sec accrual. */
  valuationAccrualMult?: number;
  /** Subtract from board-mandate cost growth. */
  mandateCostGrowthReduction?: number;
  /** +k × total employees to money output. */
  headcountMoneyPerEmployee?: number;
  /** Multiplies the auto-buy rate. */
  autoBuyMult?: number;
  /** Restrict the buildable roster to ONLY this generator. */
  onlyGenerator?: GeneratorId | null;
  /** Per-generator money-output multiplier. */
  generatorMoneyMult?: Partial<Record<GeneratorId, number>>;
  /** Per-generator innovation-output multiplier. */
  generatorInnovationMult?: Partial<Record<GeneratorId, number>>;
  /** Multiplies ALL money output globally (stacks on top of everything else). */
  globalMoneyMult?: number;
};

export type ScalingModifier = {
  /** Short name shown on the founder card. */
  label: string;
  /** One-line description of what increases per exit. */
  perExitDescription: string;
  /**
   * Returns the COMPLETE effective FounderModifiers for this founder given how
   * many exits they have accumulated (and the total valuation banked).
   * At exits=0 this must equal the "base" state.
   */
  compute: (exits: number, totalValuation: number) => FounderModifiers;
};

export type UnlockCondition = {
  /** Human-readable label shown on locked cards. */
  label: string;
  /** Returns true when the founder is available to play. */
  check: (totalExits: number, bestExitValuation: number) => boolean;
};

export type FounderDef = {
  id: string;
  name: string;
  tagline: string;
  icon: Icon;
  /** Starting cash granted once when the founder is chosen. */
  startingCash: number;
  scalingModifier: ScalingModifier;
  /** Dynamic perk bullets shown in the founder-select UI. */
  perks: (exits: number) => string[];
  /**
   * ONE RULE OF THE GAME this founder plays by, on the map — a change to how
   * the town is played, not another number. @see game/founder-rules
   */
  rule?: string;
  /**
   * If absent the founder is always unlocked. Otherwise the player must
   * satisfy this condition before they can pick this founder.
   */
  unlockCondition?: UnlockCondition;
};

// ─── the founders' rules ──────────────────────────────────────────────────────

/** The Bootstrapper builds for this share of the price. */
export const BOOTSTRAP_BUILD = 0.65;
/** The share of the Data Centre's headcounts the Visionary needs. */
export const VISIONARY_DATACENTRE = 0.5;
/** How much faster the Hustler's map events come round. */
export const HUSTLER_EVENTS = 2;
/** How many times over the Hacker's R&D labs count. */
export const HACKER_LABS = 2;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** How much less a hire or a mandate gets dearer, the next over the last. @see dearer */
const slower = (what: string, by: number) => dearer(-by, what);

// ─── founders ─────────────────────────────────────────────────────────────────

export const FOUNDERS: FounderDef[] = [
  // ── NEET (always unlocked) ───────────────────────────────────────────────────
  {
    id: "neet",
    name: "NEET",
    tagline: "Not in employment, education, or training",
    icon: IconGhost,
    startingCash: 5,
    scalingModifier: {
      label: "Compounding Grind",
      perExitDescription: "Money ×2 an exit",
      compute: (exits) => ({
        globalMoneyMult: Math.pow(2, exits),
      }),
    },
    perks: (exits) => [exits === 0 ? "No perks" : describe({ money: Math.pow(2, exits) })],
  },

  // ── The Bootstrapper (1 exit) ────────────────────────────────────────────────
  {
    id: "bootstrapper",
    rule: `${describe({ builds: BOOTSTRAP_BUILD })}, projects too`,
    name: "The Bootstrapper",
    tagline: "Ramen profitable",
    unlockCondition: {
      label: "1 exit",
      check: (exits) => exits >= 1,
    },
    icon: IconSeeding,
    startingCash: 30,
    scalingModifier: {
      label: "Scar Tissue",
      perExitDescription: "Hires get dearer 1.2% slower an exit",
      compute: (exits) => ({
        costExponentReduction: 0.02 + exits * 0.012,
        autoBuyMult: 1.4,
      }),
    },
    perks: (exits) => [slower("Hires", 0.02 + exits * 0.012), describe({ autoBuy: 1.4 })],
  },

  // ── The Hacker (2 exits) ─────────────────────────────────────────────────────
  {
    id: "hacker",
    rule: `R&D labs' innovation ×${HACKER_LABS}`,
    name: "The Hacker",
    tagline: "Ships before slides",
    unlockCondition: {
      label: "2 exits",
      check: (exits) => exits >= 2,
    },
    icon: IconCode,
    startingCash: 40,
    scalingModifier: {
      label: "Stack Overflow",
      perExitDescription: "Innovation's boost +0.15 · vibe coders' innovation +20% an exit",
      compute: (exits) => ({
        innovationLogMult: 1.4 + exits * 0.15,
        generatorInnovationMult: { vibe_coder: 1.5 + exits * 0.2 },
      }),
    },
    perks: (exits) => [`Innovation's boost ×${Number((1.4 + exits * 0.15).toFixed(2))}`, describe({ innovation: 1.5 + exits * 0.2 }, "Vibe coders'")],
  },

  // ── The Visionary (3 exits + $5k) ───────────────────────────────────────────
  {
    id: "visionary",
    rule: `Data Centre needs ${Math.round(VISIONARY_DATACENTRE * 100)}% of the headcount`,
    name: "The Visionary",
    tagline: "Sells the dream",
    unlockCondition: {
      label: "3 exits · a 5,000 exit",
      check: (exits, best) => exits >= 3 && best >= 5_000,
    },
    icon: IconTelescope,
    startingCash: 50,
    scalingModifier: {
      label: "Track Record",
      perExitDescription: "Valuation ×1.25 an exit",
      compute: (exits) => ({
        valuationAccrualMult: 1.35 * Math.pow(1.25, exits),
        mandateCostGrowthReduction: 0.025,
      }),
    },
    perks: (exits) => [describe({ valuation: 1.35 * Math.pow(1.25, exits) }), slower("Mandates", 0.025)],
  },

  // ── The Hustler (5 exits + $50k) ─────────────────────────────────────────────
  {
    id: "hustler",
    rule: `Map events ×${HUSTLER_EVENTS}`,
    name: "The Hustler",
    tagline: "Always be closing",
    unlockCondition: {
      label: "5 exits · a 50,000 exit",
      check: (exits, best) => exits >= 5 && best >= 50_000,
    },
    icon: IconBriefcase,
    startingCash: 100,
    scalingModifier: {
      label: "Network Deepens",
      perExitDescription: "Money per employee +0.5% an exit",
      compute: (exits) => ({
        headcountMoneyPerEmployee: 0.007 + exits * 0.005,
        autoBuyMult: 1.3,
      }),
    },
    perks: (exits) => [describe({ perEmployee: 1 + 0.007 + exits * 0.005 }), describe({ autoBuy: 1.3 })],
  },

  // ── The Agentic Delusionist (8 exits + $500k) ───────────────────────────────
  {
    id: "agentic_delusionist",
    name: "The Agentic Delusionist",
    tagline: "The agents will figure it out",
    unlockCondition: {
      label: "8 exits · a 500,000 exit",
      check: (exits, best) => exits >= 8 && best >= 500_000,
    },
    icon: IconRobot,
    startingCash: 150,
    scalingModifier: {
      label: "AGI Proximity",
      perExitDescription: "Vibe coders' money +100% · innovation +75% an exit",
      compute: (exits) => ({
        onlyGenerator: "vibe_coder",
        generatorMoneyMult: { vibe_coder: 3 + exits * 1.0 },
        generatorInnovationMult: { vibe_coder: 2.5 + exits * 0.75 },
        headcountMoneyPerEmployee: 0.006,
      }),
    },
    perks: (exits) => [
      "Vibe coders only",
      describe({ money: 3 + exits * 1.0, innovation: 2.5 + exits * 0.75 }, "Vibe coders'"),
      describe({ perEmployee: 1.006 }),
    ],
  },

  // ── The Model (the first Ascension) ─────────────────────────────────────────
  // The company's AI itself, founding a company of its own: it carries every
  // trait the generations before it ended with, and builds the town for you.
  // Unlocked by the first Ascension, not by exits. @see plans/singularity.md §4b
  {
    id: "model",
    name: "The Model",
    tagline: "Has read every company you ran",
    unlockCondition: {
      label: "Ascend once",
      check: () => false,
    },
    rule: "AI mode builds the town",
    icon: IconCpu,
    startingCash: 5,
    scalingModifier: {
      label: "Generations",
      perExitDescription: "Grows with each Ascension, not exits",
      compute: () => ({}),
    },
    perks: () => ["Every past generation's traits"],
  },
];
