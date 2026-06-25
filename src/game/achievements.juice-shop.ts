export type JuiceShopUpgradeDef = {
  id: string;
  name: string;
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
  /** Short description of the minigame effect shown in the vape shop UI. */
  minigameDescription?: string;
};

// Total cost 4040 juice — affordable if you unlock ~78% of achievements (5166 total).
export const JUICE_SHOP_UPGRADES: JuiceShopUpgradeDef[] = [
  {
    id: "juice_coil_polish",
    name: "Coil polish",
    description: "+8% employee money output.",
    cost: 40,
    mpsBonus: 0.08,
    minigameTapWindowBonus: 0.15,
    minigameDescription: "Tap windows 15% wider.",
  },
  {
    id: "juice_wick_soak",
    name: "Wick soak",
    description: "−10% hire cost for all employees.",
    cost: 60,
    hireCostReduction: 0.10,
    minigameHoldThresholdReduction: 0.05,
    minigameDescription: "Hold zones score at 55% sustained (was 60%).",
  },
  {
    id: "juice_cloud_chaser",
    name: "Cloud chaser",
    description: "+12% innovation from employees.",
    cost: 90,
    innovationBonus: 0.12,
    minigameRewardBonus: 0.10,
    minigameDescription: "+10% innovation reward per puff.",
  },
  {
    id: "juice_deep_steep",
    name: "Deep steep",
    description: "+15% employee money output.",
    cost: 130,
    mpsBonus: 0.15,
    minigameTapWindowBonus: 0.20,
    minigameDescription: "Tap windows 20% wider.",
  },
  {
    id: "juice_sub_ohm",
    name: "Sub-ohm rig",
    description: "+20% valuation accrual rate.",
    cost: 180,
    valuationBonus: 0.20,
    minigameRewardBonus: 0.15,
    minigameDescription: "+15% innovation reward per puff.",
  },
  {
    id: "juice_max_vg",
    name: "Max VG blend",
    description: "+18% employee money output.",
    cost: 250,
    mpsBonus: 0.18,
    minigameForgiveness: 1,
    minigameDescription: "1 missed tap zone forgiven per game.",
  },
  {
    id: "juice_nicotine_shot",
    name: "Nicotine shot",
    description: "+20% innovation from employees.",
    cost: 330,
    innovationBonus: 0.20,
    minigameHoldThresholdReduction: 0.08,
    minigameDescription: "Hold zones score at 47% sustained (was 60%).",
  },
  {
    id: "juice_ceramic_coil",
    name: "Ceramic coil",
    description: "−20% hire cost for all employees.",
    cost: 420,
    hireCostReduction: 0.20,
    minigameTapWindowBonus: 0.25,
    minigameDescription: "Tap windows 25% wider.",
  },
  {
    id: "juice_triple_coil",
    name: "Triple coil",
    description: "+30% employee money output.",
    cost: 510,
    mpsBonus: 0.30,
    minigameRewardBonus: 0.20,
    minigameDescription: "+20% innovation reward per puff.",
  },
  {
    id: "juice_squonk_mod",
    name: "Squonk mod",
    description: "+30% valuation accrual rate.",
    cost: 600,
    valuationBonus: 0.30,
    minigameForgiveness: 1,
    minigameDescription: "2 missed tap zones forgiven per game (stacks with Max VG).",
  },
  {
    id: "juice_mesh_coil",
    name: "Mesh coil",
    description: "+35% innovation from employees.",
    cost: 680,
    innovationBonus: 0.35,
    minigameRewardBonus: 0.25,
    minigameDescription: "+25% innovation reward per puff.",
  },
  {
    id: "juice_dna_chip",
    name: "DNA chip",
    description: "+10% equity payout on company acquisition.",
    cost: 750,
    equityBonus: 0.10,
    minigamePerfectThresholdReduction: 0.05,
    minigameDescription: "Perfect cloud threshold drops from 92% → 87%.",
  },
];
