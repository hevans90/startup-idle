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
  /** Number of company exits (prestiges) completed. */
  exits: number;
  /** Skill-tree nodes currently allocated. */
  allocatedNodes: number;
  /** Sum of all board mandate levels. */
  totalMandateLevels: number;
  /** Number of vape shop upgrades purchased. */
  juiceUpgradeCount: number;
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
  // ─── Employees ──────────────────────────────────────────────────────────────
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
    id: "intern_empire",
    name: "Intern empire",
    description: "Have at least 1,000 interns.",
    juiceReward: 80,
    check: (c) => c.internCount >= 1000,
  },
  {
    id: "first_vibe",
    name: "Good vibes",
    description: "Hire your first vibe coder.",
    juiceReward: 15,
    check: (c) => c.vibeCoderCount >= 1,
  },
  {
    id: "first_vibe_squad",
    name: "Vibe squad",
    description: "Have at least 10 vibe coders.",
    juiceReward: 28,
    check: (c) => c.vibeCoderCount >= 10,
  },
  {
    id: "vibe_army",
    name: "Vibe army",
    description: "Have at least 100 vibe coders.",
    juiceReward: 100,
    check: (c) => c.vibeCoderCount >= 100,
  },
  {
    id: "vibe_nation",
    name: "Vibe nation",
    description: "Have at least 1,000 vibe coders.",
    juiceReward: 200,
    isHidden: true,
    check: (c) => c.vibeCoderCount >= 1000,
  },
  {
    id: "first_10x",
    name: "10x energy",
    description: "Hire your first 10x developer.",
    juiceReward: 40,
    check: (c) => c.dev10xCount >= 1,
  },
  {
    id: "dev10_squad",
    name: "10x squad",
    description: "Have at least 10 10x developers.",
    juiceReward: 65,
    check: (c) => c.dev10xCount >= 10,
  },
  {
    id: "dev_empire",
    name: "Dev empire",
    description: "Have at least 100 10x developers.",
    juiceReward: 150,
    check: (c) => c.dev10xCount >= 100,
  },
  {
    id: "dev_army",
    name: "Dev army",
    description: "Have at least 1,000 10x developers.",
    juiceReward: 300,
    isHidden: true,
    check: (c) => c.dev10xCount >= 1000,
  },

  // ─── Money ──────────────────────────────────────────────────────────────────
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
    id: "cash_empire",
    name: "Cash empire",
    description: "Hold at least $1,000,000,000.",
    juiceReward: 60,
    check: (c) => c.money >= 1e9,
  },
  {
    id: "cash_titan",
    name: "Cash titan",
    description: "Hold at least $1,000,000,000,000.",
    juiceReward: 80,
    check: (c) => c.money >= 1e12,
  },
  {
    id: "cash_deity",
    name: "Cash deity",
    description: "You broke the concept of money.",
    juiceReward: 250,
    isHidden: true,
    check: (c) => c.money >= 1e18,
  },

  // ─── Revenue ────────────────────────────────────────────────────────────────
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
    id: "velocity_god",
    name: "Revenue god",
    description: "Reach $1,000,000/sec from employees.",
    juiceReward: 100,
    check: (c) => c.mps >= 1_000_000,
  },
  {
    id: "velocity_insane",
    name: "Number go brrr",
    description: "Reach $1,000,000,000/sec. Brrr.",
    juiceReward: 200,
    isHidden: true,
    check: (c) => c.mps >= 1_000_000_000,
  },

  // ─── Innovation ─────────────────────────────────────────────────────────────
  {
    id: "innovation_spark",
    name: "Innovation spark",
    description: "Accumulate 10 innovation.",
    juiceReward: 10,
    check: (c) => c.innovation >= 10,
  },
  {
    id: "innovation_engine",
    name: "Innovation engine",
    description: "Accumulate 1,000 innovation.",
    juiceReward: 35,
    check: (c) => c.innovation >= 1000,
  },
  {
    id: "innovation_titan",
    name: "Innovation titan",
    description: "Accumulate 100,000 innovation.",
    juiceReward: 80,
    check: (c) => c.innovation >= 100_000,
  },
  {
    id: "innovation_god",
    name: "Innovation god",
    description: "Are you even human?",
    juiceReward: 200,
    isHidden: true,
    check: (c) => c.innovation >= 10_000_000,
  },

  // ─── Valuation ──────────────────────────────────────────────────────────────
  {
    id: "valuation_seed",
    name: "Paper value",
    description: "Reach valuation of 1.",
    juiceReward: 10,
    check: (c) => c.valuation >= 1,
  },
  {
    id: "unicorn",
    name: "Unicorn",
    description: "Reach a valuation of 1,000.",
    juiceReward: 45,
    check: (c) => c.valuation >= 1000,
  },
  {
    id: "decacorn",
    name: "Decacorn",
    description: "Reach a valuation of 10,000.",
    juiceReward: 90,
    check: (c) => c.valuation >= 10_000,
  },
  {
    id: "centacorn",
    name: "Centacorn",
    description: "Reach a valuation of 100,000.",
    juiceReward: 150,
    check: (c) => c.valuation >= 100_000,
  },
  {
    id: "megacorn",
    name: "Megacorn",
    description: "Reach a valuation of 1,000,000.",
    juiceReward: 250,
    isHidden: true,
    check: (c) => c.valuation >= 1_000_000,
  },

  // ─── Management ─────────────────────────────────────────────────────────────
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
    id: "tier_god",
    name: "Management deity",
    description: "Reach 50 combined manager tiers.",
    juiceReward: 100,
    check: (c) => c.managerTierTotal >= 50,
  },

  // ─── Upgrades ───────────────────────────────────────────────────────────────
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
    id: "upgrade_master",
    name: "Upgrade master",
    description: "Purchase 50 employee upgrades.",
    juiceReward: 70,
    check: (c) => c.purchasedUpgradeCount >= 50,
  },

  // ─── AI singularity ─────────────────────────────────────────────────────────
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

  // ─── Prestige ───────────────────────────────────────────────────────────────
  {
    id: "first_exit",
    name: "IPO",
    description: "Sell your first company.",
    juiceReward: 80,
    check: (c) => c.exits >= 1,
  },
  {
    id: "serial_founder",
    name: "Serial founder",
    description: "Sell 3 companies.",
    juiceReward: 160,
    check: (c) => c.exits >= 3,
  },
  {
    id: "startup_legend",
    name: "Startup legend",
    description: "Sell 10 companies. A dynasty.",
    juiceReward: 350,
    isHidden: true,
    check: (c) => c.exits >= 10,
  },

  // ─── Skill tree ─────────────────────────────────────────────────────────────
  {
    id: "tree_sprout",
    name: "First node",
    description: "Allocate your first skill tree node.",
    juiceReward: 60,
    check: (c) => c.allocatedNodes >= 1,
  },
  {
    id: "tree_pioneer",
    name: "Tree pioneer",
    description: "Allocate 10 skill tree nodes.",
    juiceReward: 100,
    check: (c) => c.allocatedNodes >= 10,
  },
  {
    id: "tree_architect",
    name: "Tree architect",
    description: "Allocate 50 skill tree nodes.",
    juiceReward: 200,
    check: (c) => c.allocatedNodes >= 50,
  },
  {
    id: "tree_grandmaster",
    name: "Tree grandmaster",
    description: "Allocate 100 skill tree nodes.",
    juiceReward: 350,
    isHidden: true,
    check: (c) => c.allocatedNodes >= 100,
  },

  // ─── Board mandates ─────────────────────────────────────────────────────────
  {
    id: "mandate_believer",
    name: "Mandate believer",
    description: "Purchase your first board mandate level.",
    juiceReward: 50,
    check: (c) => c.totalMandateLevels >= 1,
  },
  {
    id: "mandate_tycoon",
    name: "Mandate tycoon",
    description: "Accumulate 10 total board mandate levels.",
    juiceReward: 120,
    check: (c) => c.totalMandateLevels >= 10,
  },
  {
    id: "mandate_mogul",
    name: "Mandate mogul",
    description: "Accumulate 30 total board mandate levels.",
    juiceReward: 200,
    isHidden: true,
    check: (c) => c.totalMandateLevels >= 30,
  },

  // ─── Vape shop ──────────────────────────────────────────────────────────────
  {
    id: "vape_collector",
    name: "Full rig",
    description: "Purchase every vape upgrade.",
    juiceReward: 200,
    isHidden: true,
    check: (c) => c.juiceUpgradeCount >= 12,
  },
];
