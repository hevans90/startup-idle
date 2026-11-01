import { describe } from "./wording";

export type JuiceShopUpgradeDef = {
  id: string;
  name: string;
  /** Its effect line, made from its numbers. @see game/wording */
  description: string;
  cost: number;
  mpsBonus?: number;
  innovationBonus?: number;
  /** Hire cost reduction as a fraction (0.1 = −10%). Stacks additively. */
  hireCostReduction?: number;
  /** Valuation accrual multiplier bonus as a fraction (0.2 = +20%). */
  valuationBonus?: number;
  /** Equity payout bonus as a fraction (0.1 = +10%). */
  equityBonus?: number;

  // ── Minigame effects ──────────────────────────────────────────────────────
  /** Multiplies tap zone width during generation (0.15 = 15% wider windows). */
  minigameTapWindowBonus?: number;
  /** Reduces hold-zone score threshold below 0.60 (0.05 → threshold becomes 0.55). */
  minigameHoldThresholdReduction?: number;
  /** Additive bonus on final innovation boost (0.10 = +10%). */
  minigameRewardBonus?: number;
  /** Number of missed tap zones forgiven per game. Stacks as integer. */
  minigameForgiveness?: number;
  /** Lowers the 0.92 "perfect" score threshold (0.05 → perfect at 0.87). */
  minigamePerfectThresholdReduction?: number;
  /** Its mini-game effect line, made from its numbers. */
  minigameDescription?: string;
};

// Total cost 4040 juice — affordable if you unlock ~78% of achievements (5166 total).
type Raw = Omit<JuiceShopUpgradeDef, "description" | "minigameDescription">;

const points = (n: number) => Math.round(n * 100);

/** Its two effect lines, from its numbers: the company's, and the mini-game's. */
const withLines = (u: Raw): JuiceShopUpgradeDef => {
  const game = [
    u.minigameTapWindowBonus && `Tap windows +${points(u.minigameTapWindowBonus)}%`,
    u.minigameHoldThresholdReduction && `Hold zones pass ${points(u.minigameHoldThresholdReduction)} points lower`,
    u.minigameRewardBonus && `Innovation per puff +${points(u.minigameRewardBonus)}%`,
    u.minigameForgiveness && `Missed taps forgiven +${u.minigameForgiveness}`,
    u.minigamePerfectThresholdReduction && `Perfect cloud ${points(u.minigamePerfectThresholdReduction)} points lower`,
  ].filter(Boolean).join(" · ");
  return {
    ...u,
    description: describe({
      money: 1 + (u.mpsBonus ?? 0), innovation: 1 + (u.innovationBonus ?? 0), valuation: 1 + (u.valuationBonus ?? 0),
      equity: 1 + (u.equityBonus ?? 0), hires: 1 - (u.hireCostReduction ?? 0),
    }),
    ...(game ? { minigameDescription: game } : {}),
  };
};

export const JUICE_SHOP_UPGRADES: JuiceShopUpgradeDef[] = ([
  {
    id: "juice_coil_polish",
    name: "Coil polish",
    cost: 40,
    mpsBonus: 0.08,
    minigameTapWindowBonus: 0.15,
  },
  {
    id: "juice_wick_soak",
    name: "Wick soak",
    cost: 60,
    hireCostReduction: 0.1,
    minigameHoldThresholdReduction: 0.05,
  },
  {
    id: "juice_cloud_chaser",
    name: "Cloud chaser",
    cost: 90,
    innovationBonus: 0.12,
    minigameRewardBonus: 0.1,
  },
  {
    id: "juice_deep_steep",
    name: "Deep steep",
    cost: 130,
    mpsBonus: 0.15,
    minigameTapWindowBonus: 0.2,
  },
  {
    id: "juice_sub_ohm",
    name: "Sub-ohm rig",
    cost: 180,
    valuationBonus: 0.2,
    minigameRewardBonus: 0.15,
  },
  {
    id: "juice_max_vg",
    name: "Max VG blend",
    cost: 250,
    mpsBonus: 0.18,
    minigameForgiveness: 1,
  },
  {
    id: "juice_nicotine_shot",
    name: "Nicotine shot",
    cost: 330,
    innovationBonus: 0.2,
    minigameHoldThresholdReduction: 0.08,
  },
  {
    id: "juice_ceramic_coil",
    name: "Ceramic coil",
    cost: 420,
    hireCostReduction: 0.2,
    minigameTapWindowBonus: 0.25,
  },
  {
    id: "juice_triple_coil",
    name: "Triple coil",
    cost: 510,
    mpsBonus: 0.3,
    minigameRewardBonus: 0.2,
  },
  {
    id: "juice_squonk_mod",
    name: "Squonk mod",
    cost: 600,
    valuationBonus: 0.3,
    minigameForgiveness: 1,
  },
  {
    id: "juice_mesh_coil",
    name: "Mesh coil",
    cost: 680,
    innovationBonus: 0.35,
    minigameRewardBonus: 0.25,
  },
  {
    id: "juice_dna_chip",
    name: "DNA chip",
    cost: 750,
    equityBonus: 0.1,
    minigamePerfectThresholdReduction: 0.05,
  },
] satisfies Raw[]).map(withLines);
