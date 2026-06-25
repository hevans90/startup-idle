import {
  IconBriefcase,
  IconCode,
  IconGhost,
  IconRobot,
  IconSeeding,
  IconTelescope,
  type Icon,
} from "@tabler/icons-react";
import type { GeneratorId } from "../state/generators.store";

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
   * If absent the founder is always unlocked. Otherwise the player must
   * satisfy this condition before they can pick this founder.
   */
  unlockCondition?: UnlockCondition;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const pct = (n: number, decimals = 0) => `${(n * 100).toFixed(decimals)}%`;
const x = (n: number, decimals = 2) => `×${n.toFixed(decimals)}`;

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
      perExitDescription: "each exit: ×2 all money output",
      compute: (exits) => ({
        globalMoneyMult: Math.pow(2, exits),
      }),
    },
    perks: (exits) => [
      "$5 starting cash. No other bonuses.",
      exits === 0
        ? "Complete a run to unlock Compounding Grind"
        : `Compounding Grind: ${x(Math.pow(2, exits), 0)} all money (×2 per exit)`,
    ],
  },

  // ── The Bootstrapper (1 exit) ────────────────────────────────────────────────
  {
    id: "bootstrapper",
    name: "The Bootstrapper",
    tagline: "Ramen profitable",
    unlockCondition: {
      label: "Complete 1 exit",
      check: (exits) => exits >= 1,
    },
    icon: IconSeeding,
    startingCash: 30,
    scalingModifier: {
      label: "Scar Tissue",
      perExitDescription: "each exit: −0.012 all generator cost exponents",
      compute: (exits) => ({
        costExponentReduction: 0.02 + exits * 0.012,
        autoBuyMult: 1.4,
      }),
    },
    perks: (exits) => [
      `−${(0.02 + exits * 0.012).toFixed(3)} generator cost exponent${exits > 0 ? ` (base −0.020 + exits)` : ""}`,
      "+40% auto-buy rate",
    ],
  },

  // ── The Hacker (2 exits) ─────────────────────────────────────────────────────
  {
    id: "hacker",
    name: "The Hacker",
    tagline: "Ships product before slides",
    unlockCondition: {
      label: "Complete 2 exits",
      check: (exits) => exits >= 2,
    },
    icon: IconCode,
    startingCash: 40,
    scalingModifier: {
      label: "Stack Overflow",
      perExitDescription:
        "each exit: +15% innovation curve, +20% vibe-coder innovation",
      compute: (exits) => ({
        innovationLogMult: 1.4 + exits * 0.15,
        generatorInnovationMult: { vibe_coder: 1.5 + exits * 0.2 },
      }),
    },
    perks: (exits) => [
      `Innovation multiplier curve ${x(1.4 + exits * 0.15)}${exits > 0 ? ` (+${exits * 15}% from exits)` : ""}`,
      `Vibe coders: ${pct(1.5 + exits * 0.2 - 1)} innovation`,
    ],
  },

  // ── The Visionary (3 exits + $5k) ───────────────────────────────────────────
  {
    id: "visionary",
    name: "The Visionary",
    tagline: "Sells the dream",
    unlockCondition: {
      label: "3 exits · best exit at 5,000+ valuation",
      check: (exits, best) => exits >= 3 && best >= 5_000,
    },
    icon: IconTelescope,
    startingCash: 50,
    scalingModifier: {
      label: "Track Record",
      perExitDescription: "each exit: ×1.25 valuation accrual rate",
      compute: (exits) => ({
        valuationAccrualMult: 1.35 * Math.pow(1.25, exits),
        mandateCostGrowthReduction: 0.025,
      }),
    },
    perks: (exits) => [
      `Valuation/sec ${x(1.35 * Math.pow(1.25, exits))}${exits > 0 ? ` (compounds ×1.25 per exit)` : ""}`,
      "−0.025 board-mandate cost growth",
    ],
  },

  // ── The Hustler (5 exits + $50k) ─────────────────────────────────────────────
  {
    id: "hustler",
    name: "The Hustler",
    tagline: "Always be closing",
    unlockCondition: {
      label: "5 exits · best exit at 50,000+ valuation",
      check: (exits, best) => exits >= 5 && best >= 50_000,
    },
    icon: IconBriefcase,
    startingCash: 100,
    scalingModifier: {
      label: "Network Deepens",
      perExitDescription: "each exit: +0.5%/employee money bonus",
      compute: (exits) => ({
        headcountMoneyPerEmployee: 0.007 + exits * 0.005,
        autoBuyMult: 1.3,
      }),
    },
    perks: (exits) => [
      `+${pct(0.007 + exits * 0.005)} money per employee owned${exits > 0 ? ` (was +0.7%)` : ""}`,
      "+30% auto-buy rate",
    ],
  },

  // ── The Agentic Delusionist (8 exits + $500k) ───────────────────────────────
  {
    id: "agentic_delusionist",
    name: "The Agentic Delusionist",
    tagline: "The agents will figure it out",
    unlockCondition: {
      label: "8 exits · best exit at 500,000+ valuation",
      check: (exits, best) => exits >= 8 && best >= 500_000,
    },
    icon: IconRobot,
    startingCash: 150,
    scalingModifier: {
      label: "AGI Proximity",
      perExitDescription:
        "each exit: +100% vibe-coder money, +75% vibe-coder innovation",
      compute: (exits) => ({
        onlyGenerator: "vibe_coder",
        generatorMoneyMult: { vibe_coder: 3 + exits * 1.0 },
        generatorInnovationMult: { vibe_coder: 2.5 + exits * 0.75 },
        headcountMoneyPerEmployee: 0.006,
      }),
    },
    perks: (exits) => [
      "Only vibe coders — interns & 10x devs disabled",
      `Vibe coders: ${pct(3 + exits * 1.0 - 1)} money${exits > 0 ? ` (base +200%)` : ""}`,
      `Vibe coders: ${pct(2.5 + exits * 0.75 - 1)} innovation${exits > 0 ? ` (base +150%)` : ""}`,
      "+0.6% money per employee owned",
    ],
  },

];
