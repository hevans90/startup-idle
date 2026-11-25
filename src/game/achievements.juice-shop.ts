import { describe } from "./wording";

export type JuiceShopUpgradeDef = {
  id: string;
  name: string;
  /** Its effect line, made from its numbers. @see game/wording */
  description: string;
  /** The juice its vessel holds. */
  cost: number;
  mpsBonus?: number;
  innovationBonus?: number;
  /** Hire cost reduction as a fraction (0.1 = −10%). Stacks additively. */
  hireCostReduction?: number;
  /** Valuation accrual multiplier bonus as a fraction (0.2 = +20%). */
  valuationBonus?: number;
  /** Equity payout bonus as a fraction (0.1 = +10%). */
  equityBonus?: number;
};

/** THE STILL'S BRANCHES, left to right. */
export const JUICE_BRANCHES = ["money", "hires", "innovation", "valuation", "equity"] as const;
export type JuiceBranch = (typeof JUICE_BRANCHES)[number];

type Raw = Omit<JuiceShopUpgradeDef, "description">;

/** Its effect line, from its numbers. */
const withLines = (u: Raw): JuiceShopUpgradeDef => {
  return {
    ...u,
    description: describe({
      money: 1 + (u.mpsBonus ?? 0), innovation: 1 + (u.innovationBonus ?? 0), valuation: 1 + (u.valuationBonus ?? 0),
      equity: 1 + (u.equityBonus ?? 0), hires: 1 - (u.hireCostReduction ?? 0),
    }),
  };
};

/**
 * EACH BRANCH'S UPGRADES, from the flask down: one is poured into through the one above it, so that must be full
 * first. All of them come to about twice what every achievement pays, so they compete.
 */
export const JUICE_TREE: Record<JuiceBranch, readonly JuiceShopUpgradeDef[]> = {
  money: ([
    { id: "juice_coil_polish", name: "Coil polish", cost: 40, mpsBonus: 0.08 },
    { id: "juice_deep_steep", name: "Deep steep", cost: 130, mpsBonus: 0.15 },
    { id: "juice_max_vg", name: "Max VG blend", cost: 250, mpsBonus: 0.18 },
    { id: "juice_triple_coil", name: "Triple coil", cost: 510, mpsBonus: 0.3 },
    { id: "juice_dripper", name: "Rebuildable dripper", cost: 1100, mpsBonus: 0.5 },
  ] satisfies Raw[]).map(withLines),
  hires: ([
    { id: "juice_wick_soak", name: "Wick soak", cost: 60, hireCostReduction: 0.1 },
    { id: "juice_ceramic_coil", name: "Ceramic coil", cost: 420, hireCostReduction: 0.2 },
    { id: "juice_sample_rack", name: "Sample rack", cost: 640, hireCostReduction: 0.08 },
    { id: "juice_loyalty_card", name: "Loyalty card", cost: 900, hireCostReduction: 0.08 },
    { id: "juice_free_refills", name: "Free refills", cost: 1300, hireCostReduction: 0.09 },
  ] satisfies Raw[]).map(withLines),
  innovation: ([
    { id: "juice_cloud_chaser", name: "Cloud chaser", cost: 90, innovationBonus: 0.12 },
    { id: "juice_nicotine_shot", name: "Nicotine shot", cost: 330, innovationBonus: 0.2 },
    { id: "juice_mesh_coil", name: "Mesh coil", cost: 680, innovationBonus: 0.35 },
    { id: "juice_temp_control", name: "Temperature control", cost: 900, innovationBonus: 0.45 },
    { id: "juice_salt_nic", name: "Salt nic", cost: 1200, innovationBonus: 0.6 },
  ] satisfies Raw[]).map(withLines),
  valuation: ([
    { id: "juice_sub_ohm", name: "Sub-ohm rig", cost: 180, valuationBonus: 0.2 },
    { id: "juice_squonk_mod", name: "Squonk mod", cost: 600, valuationBonus: 0.3 },
    { id: "juice_gold_drip_tip", name: "Gold drip tip", cost: 750, valuationBonus: 0.35 },
    { id: "juice_limited_run", name: "Limited run", cost: 950, valuationBonus: 0.45 },
    { id: "juice_flagship_store", name: "Flagship store", cost: 1250, valuationBonus: 0.6 },
  ] satisfies Raw[]).map(withLines),
  equity: ([
    { id: "juice_dna_chip", name: "DNA chip", cost: 750, equityBonus: 0.1 },
    { id: "juice_patent_pod", name: "Patent pod", cost: 850, equityBonus: 0.12 },
    { id: "juice_white_label", name: "White label", cost: 1000, equityBonus: 0.14 },
    { id: "juice_franchise", name: "Franchise deal", cost: 1200, equityBonus: 0.16 },
    { id: "juice_big_tobacco", name: "Big Tobacco call", cost: 1400, equityBonus: 0.2 },
  ] satisfies Raw[]).map(withLines),
};

export const JUICE_SHOP_UPGRADES: readonly JuiceShopUpgradeDef[] = JUICE_BRANCHES.flatMap((b) => JUICE_TREE[b]);

const PLACE = new Map(JUICE_BRANCHES.flatMap((b) => JUICE_TREE[b].map((def, k) => [def.id, { def, above: JUICE_TREE[b][k - 1] ?? null, below: JUICE_TREE[b].slice(k + 1) }] as const)));
/** An upgrade, the one above it, and all those below. */
export const juicePlace = (id: string) => PLACE.get(id);

/** The juice in each upgrade's vessel, by id. */
export type JuiceFills = Readonly<Record<string, number>>;
export const isFull = (fills: JuiceFills, u: JuiceShopUpgradeDef) => (fills[u.id] ?? 0) >= u.cost;

/** Why an upgrade cannot be poured into, or null. */
export function pourBlock(fills: JuiceFills, id: string): "unknown" | "full" | "above" | null {
  const at = juicePlace(id);
  if (!at) return "unknown";
  if (isFull(fills, at.def)) return "full";
  return at.above && !isFull(fills, at.above) ? "above" : null;
}
/** Why it cannot be drained, or null: what is below it must be drained first. */
export function drainBlock(fills: JuiceFills, id: string): "unknown" | "empty" | "below" | null {
  const at = juicePlace(id);
  if (!at) return "unknown";
  if (!(fills[id] > 0)) return "empty";
  return at.below.some((u) => fills[u.id] > 0) ? "below" : null;
}

/** What the full vessels come to. */
export function juiceBonuses(fills: JuiceFills) {
  const sum = { juiceMpsMultBonus: 0, juiceInnovationMultBonus: 0, juiceValuationMultBonus: 0, juiceHireCostReduction: 0, juiceEquityMultBonus: 0 };
  for (const u of JUICE_SHOP_UPGRADES) {
    if (!isFull(fills, u)) continue;
    sum.juiceMpsMultBonus += u.mpsBonus ?? 0;
    sum.juiceInnovationMultBonus += u.innovationBonus ?? 0;
    sum.juiceValuationMultBonus += u.valuationBonus ?? 0;
    sum.juiceHireCostReduction += u.hireCostReduction ?? 0;
    sum.juiceEquityMultBonus += u.equityBonus ?? 0;
  }
  return sum;
}
