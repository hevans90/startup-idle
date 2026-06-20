export type JuiceShopUpgradeDef = {
  id: string;
  name: string;
  description: string;
  cost: number;
  mpsBonus?: number;
  innovationBonus?: number;
};

export const JUICE_SHOP_UPGRADES: JuiceShopUpgradeDef[] = [
  {
    id: "juice_coil_polish",
    name: "Coil polish",
    description: "+2% employee money output (permanent).",
    cost: 45,
    mpsBonus: 0.02,
  },
  {
    id: "juice_wick_soak",
    name: "Wick soak",
    description: "+1.5% innovation from employees (permanent).",
    cost: 70,
    innovationBonus: 0.015,
  },
  {
    id: "juice_cloud_chaser",
    name: "Cloud chaser",
    description: "+3% employee money output (permanent).",
    cost: 200,
    mpsBonus: 0.03,
  },
  {
    id: "juice_deep_steep",
    name: "Deep steep",
    description: "+4% innovation from employees (permanent).",
    cost: 320,
    innovationBonus: 0.04,
  },
  {
    id: "juice_sub_ohm",
    name: "Sub-ohm rig",
    description: "+6% employee money output (permanent).",
    cost: 600,
    mpsBonus: 0.06,
  },
  {
    id: "juice_max_vg",
    name: "Max VG blend",
    description: "+8% employee money output (permanent).",
    cost: 1500,
    mpsBonus: 0.08,
  },
];
