export type AchievementContext = {
  internCount: number;
  vibeCoderCount: number;
  dev10xCount: number;
  money: number;
  mps: number;
  innovation: number;
  valuation: number;
  managersUnlocked: boolean;
  employeeManagementUnlocked: boolean;
  purchasedUpgradeCount: number;
  /** Sum of manager tiers across all manager tracks. */
  managerTierTotal: number;
  /** AI singularity progress, 0–100. */
  aiSingularity: number;
};

export type AchievementDef = {
  id: string;
  name: string;
  description: string;
  juiceReward: number;
  isHidden?: boolean;
  check: (ctx: AchievementContext) => boolean;
};

export const ACHIEVEMENT_CATALOG: AchievementDef[] = [
  {
    id: "first_intern",
    name: "First hire",
    description: "Hire your first intern.",
    juiceReward: 5,
    check: (c) => c.internCount >= 1,
  },
  {
    id: "intern_squad",
    name: "Intern squad",
    description: "Have at least 10 interns.",
    juiceReward: 12,
    check: (c) => c.internCount >= 10,
  },
  {
    id: "intern_army",
    name: "Intern army",
    description: "Have at least 100 interns.",
    juiceReward: 35,
    check: (c) => c.internCount >= 100,
  },
  {
    id: "first_vibe",
    name: "Good vibes",
    description: "Hire your first vibe coder.",
    juiceReward: 15,
    check: (c) => c.vibeCoderCount >= 1,
  },
  {
    id: "first_10x",
    name: "10x energy",
    description: "Hire your first 10x developer.",
    juiceReward: 40,
    check: (c) => c.dev10xCount >= 1,
  },
  {
    id: "cash_stack",
    name: "Cash stack",
    description: "Hold at least $1,000.",
    juiceReward: 8,
    check: (c) => c.money >= 1000,
  },
  {
    id: "cash_mountain",
    name: "Cash mountain",
    description: "Hold at least $1,000,000.",
    juiceReward: 25,
    check: (c) => c.money >= 1e6,
  },
  {
    id: "velocity",
    name: "Velocity",
    description: "Reach $100/sec from employees.",
    juiceReward: 20,
    check: (c) => c.mps >= 100,
  },
  {
    id: "velocity_apex",
    name: "Apex revenue",
    description: "Reach $10,000/sec from employees.",
    juiceReward: 50,
    check: (c) => c.mps >= 10_000,
  },
  {
    id: "innovation_spark",
    name: "Innovation spark",
    description: "Accumulate 10 innovation.",
    juiceReward: 10,
    check: (c) => c.innovation >= 10,
  },
  {
    id: "valuation_seed",
    name: "Paper value",
    description: "Reach valuation of 1.",
    juiceReward: 10,
    check: (c) => c.valuation >= 1,
  },
  {
    id: "managers_online",
    name: "Management layer",
    description: "Unlock Managers.",
    juiceReward: 18,
    check: (c) => c.managersUnlocked,
  },
  {
    id: "hr_expansion",
    name: "HR expansion",
    description: "Unlock Employee Management.",
    juiceReward: 30,
    check: (c) => c.employeeManagementUnlocked,
  },
  {
    id: "upgrade_dabbler",
    name: "Upgrade dabbler",
    description: "Purchase 5 employee upgrades.",
    juiceReward: 15,
    check: (c) => c.purchasedUpgradeCount >= 5,
  },
  {
    id: "upgrade_enthusiast",
    name: "Upgrade enthusiast",
    description: "Purchase 20 employee upgrades.",
    juiceReward: 40,
    check: (c) => c.purchasedUpgradeCount >= 20,
  },
  {
    id: "cash_empire",
    name: "Cash empire",
    description: "Hold at least $1,000,000,000.",
    juiceReward: 60,
    check: (c) => c.money >= 1e9,
  },
  {
    id: "first_vibe_squad",
    name: "Vibe squad",
    description: "Have at least 10 vibe coders.",
    juiceReward: 28,
    check: (c) => c.vibeCoderCount >= 10,
  },
  {
    id: "dev10_squad",
    name: "10x squad",
    description: "Have at least 10 10x developers.",
    juiceReward: 65,
    check: (c) => c.dev10xCount >= 10,
  },
  {
    id: "innovation_engine",
    name: "Innovation engine",
    description: "Accumulate 1,000 innovation.",
    juiceReward: 35,
    check: (c) => c.innovation >= 1000,
  },
  {
    id: "unicorn",
    name: "Unicorn",
    description: "Reach a valuation of 1,000.",
    juiceReward: 45,
    check: (c) => c.valuation >= 1000,
  },
  {
    id: "tier_climber",
    name: "Tier climber",
    description: "Reach 5 combined manager tiers.",
    juiceReward: 25,
    check: (c) => c.managerTierTotal >= 5,
  },
  {
    id: "tier_titan",
    name: "Tier titan",
    description: "Reach 25 combined manager tiers.",
    juiceReward: 55,
    check: (c) => c.managerTierTotal >= 25,
  },
  {
    id: "singularity_stirs",
    name: "It stirs",
    description: "The AI singularity reaches 1%.",
    juiceReward: 30,
    check: (c) => c.aiSingularity >= 1,
  },
  {
    id: "singularity_breach",
    name: "Containment breach",
    description: "The AI singularity reaches 50%.",
    juiceReward: 70,
    check: (c) => c.aiSingularity >= 50,
  },
  {
    id: "singularity_complete",
    name: "Singularity",
    description: "The AI singularity reaches 100%.",
    juiceReward: 150,
    check: (c) => c.aiSingularity >= 100,
  },
  {
    id: "hidden_whale",
    name: "Whale alert",
    description: "Hold at least $1e12. Shh.",
    juiceReward: 100,
    isHidden: true,
    check: (c) => c.money >= 1e12,
  },
];
