import {
  IconBriefcase,
  IconCode,
  IconSeeding,
  IconSettings,
  IconTelescope,
  type Icon,
} from "@tabler/icons-react";

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
};

export type FounderDef = {
  id: string;
  name: string;
  tagline: string;
  icon: Icon;
  /** Small starting-cash float — the only up-front grant (cash-clicker is gone). */
  startingCash: number;
  modifiers: FounderModifiers;
  /** Player-facing bullet(s) describing the gradual perk. */
  perks: string[];
};

export const FOUNDERS: FounderDef[] = [
  {
    id: "hacker",
    name: "The Hacker",
    tagline: "Ships product before slides",
    icon: IconCode,
    startingCash: 40,
    modifiers: { innovationLogMult: 1.4 },
    perks: [
      "Innovation compounds ~40% harder — negligible at first, snowballs as it accrues.",
    ],
  },
  {
    id: "bootstrapper",
    name: "The Bootstrapper",
    tagline: "Ramen profitable",
    icon: IconSeeding,
    startingCash: 30,
    modifiers: { costExponentReduction: 0.012 },
    perks: [
      "Hiring scales leaner — barely matters early, a huge edge deep into scaling.",
    ],
  },
  {
    id: "operator",
    name: "The Operator",
    tagline: "Scales the machine",
    icon: IconSettings,
    startingCash: 50,
    modifiers: { managerProgressMult: 1.5, autoBuyMult: 1.5 },
    perks: [
      "Managers tier up 50% faster and automation ramps quicker — an engine that builds all run.",
    ],
  },
  {
    id: "visionary",
    name: "The Visionary",
    tagline: "Sells the dream",
    icon: IconTelescope,
    startingCash: 50,
    modifiers: { valuationAccrualMult: 1.5, mandateCostGrowthReduction: 0.03 },
    perks: [
      "Valuation builds 50% faster and board mandates stay affordable — keep climbing the board flywheel.",
    ],
  },
  {
    id: "hustler",
    name: "The Hustler",
    tagline: "Always be closing",
    icon: IconBriefcase,
    startingCash: 100,
    modifiers: { headcountMoneyPerEmployee: 0.004 },
    perks: [
      "+0.4% money per employee — every hire lifts the whole team, compounding as you grow.",
    ],
  },
];
