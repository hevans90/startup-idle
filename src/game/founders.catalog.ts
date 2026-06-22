import {
  IconBriefcase,
  IconCode,
  IconRobot,
  IconSeeding,
  IconSettings,
  IconTelescope,
  type Icon,
} from "@tabler/icons-react";
import type { GeneratorId } from "../state/generators.store";

/**
 * Founder modifiers bend a progression curve GRADUALLY (small early, compounding
 * over the run) — not front-loaded handouts. Every field is optional; omitted =
 * the neutral default in `founder.store.ts`, and each is read at a single
 * existing chokepoint.
 */
export type FounderModifiers = {
  /** Subtract from every generator's cost-growth exponent (leaner scaling). */
  costExponentReduction?: number; // default 0
  /** Scales the log term of the global innovation multiplier (steeper curve). */
  innovationLogMult?: number; // default 1
  /** Multiplies manager tier-progress gain (faster tiers all run). */
  managerProgressMult?: number; // default 1
  /** Multiplies valuation/sec accrual. */
  valuationAccrualMult?: number; // default 1
  /** Subtract from board-mandate cost growth (mandates stay affordable). */
  mandateCostGrowthReduction?: number; // default 0
  /** +k × total employees to money output (headcount synergy). */
  headcountMoneyPerEmployee?: number; // default 0
  /** Multiplies the auto-buy rate. */
  autoBuyMult?: number; // default 1
  /** Restrict the buildable roster to ONLY this generator (others disabled). */
  onlyGenerator?: GeneratorId | null; // default null
  /** Per-generator money-output multiplier (e.g. { vibe_coder: 3 }). */
  generatorMoneyMult?: Partial<Record<GeneratorId, number>>; // default {}
  /** Per-generator innovation-output multiplier. */
  generatorInnovationMult?: Partial<Record<GeneratorId, number>>; // default {}
};

export type FounderDef = {
  id: string;
  name: string;
  tagline: string;
  icon: Icon;
  /** Small starting-cash float — the only up-front grant (cash-clicker is gone). */
  startingCash: number;
  modifiers: FounderModifiers;
  /** Player-facing numeric effect bullet(s) — no flavour. */
  perks: string[];
};

export const FOUNDERS: FounderDef[] = [
  {
    id: "hacker",
    name: "The Hacker",
    tagline: "Ships product before slides",
    icon: IconCode,
    startingCash: 40,
    modifiers: {
      innovationLogMult: 1.4,
      generatorInnovationMult: { vibe_coder: 1.5 },
    },
    perks: [
      "+40% innovation multiplier scaling",
      "Vibe coders: +50% innovation",
    ],
  },
  {
    id: "bootstrapper",
    name: "The Bootstrapper",
    tagline: "Ramen profitable",
    icon: IconSeeding,
    startingCash: 30,
    modifiers: {
      costExponentReduction: 0.012,
      autoBuyMult: 1.3,
      generatorMoneyMult: { intern: 1.5 },
    },
    perks: [
      "−0.012 employee cost-growth exponent",
      "Interns: +50% money",
      "+30% auto-buy rate",
    ],
  },
  {
    id: "operator",
    name: "The Operator",
    tagline: "Scales the machine",
    icon: IconSettings,
    startingCash: 50,
    modifiers: {
      managerProgressMult: 1.5,
      autoBuyMult: 1.5,
      mandateCostGrowthReduction: 0.02,
    },
    perks: [
      "+50% manager tier progression",
      "+50% auto-buy rate",
      "−0.02 board-mandate cost growth",
    ],
  },
  {
    id: "visionary",
    name: "The Visionary",
    tagline: "Sells the dream",
    icon: IconTelescope,
    startingCash: 50,
    modifiers: {
      valuationAccrualMult: 1.5,
      mandateCostGrowthReduction: 0.03,
      innovationLogMult: 1.15,
    },
    perks: [
      "+50% valuation per second",
      "−0.03 board-mandate cost growth",
      "+15% innovation multiplier scaling",
    ],
  },
  {
    id: "hustler",
    name: "The Hustler",
    tagline: "Always be closing",
    icon: IconBriefcase,
    startingCash: 100,
    modifiers: {
      headcountMoneyPerEmployee: 0.004,
      generatorMoneyMult: { intern: 1.5 },
      costExponentReduction: 0.008,
    },
    perks: [
      "+0.4% money per employee owned",
      "Interns: +50% money",
      "−0.008 employee cost-growth exponent",
    ],
  },
  {
    id: "agentic_delusionist",
    name: "The Agentic Delusionist",
    tagline: "The agents will figure it out",
    icon: IconRobot,
    startingCash: 150,
    modifiers: {
      onlyGenerator: "vibe_coder",
      generatorMoneyMult: { vibe_coder: 3 },
      generatorInnovationMult: { vibe_coder: 2.5 },
      headcountMoneyPerEmployee: 0.006,
    },
    perks: [
      "Only vibe coders — interns & 10x devs disabled",
      "Vibe coders: +200% money",
      "Vibe coders: +150% innovation",
      "+0.6% money per employee owned",
    ],
  },
];
