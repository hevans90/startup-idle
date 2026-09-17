import type { GeneratorId } from "../state/generators.store";
import { SATISFACTION_MAX, SATISFACTION_MIN } from "./satisfaction";

// ─── Skills ───────────────────────────────────────────────────────────────────

export type TeamLeaderSkillId =
  // Overachiever pool
  | "revenue_boost"
  | "overtime"
  | "compounding_rev"
  | "output_focus"
  // Chaos Agent pool
  | "chaos_spark"
  | "crunch_mode"
  | "research_mode"
  | "sat_drain"
  // Quiet Quitter pool
  | "satisfaction_lift"
  | "hire_cost_reduction"
  | "fast_learner"
  | "cost_efficiency"
  // Brown Noser pool
  | "team_morale"
  | "sat_recovery"
  | "valuation_boost"
  | "morale_focus"
  // Thought Leader pool
  | "global_revenue"
  | "big_picture"
  | "compounding_ips"
  | "global_ips"
  // Burnout Risk pool (output_focus shared with Overachiever)
  | "rev_per_sat"
  | "legacy_amplifier"
  | "ips_boost";

export type SkillTable = readonly [number, number, number];

export type EmployeeSkill = {
  id: TeamLeaderSkillId;
  name: string;
  maxLevel: 3;
  descriptions: readonly [string, string, string];
  /** Multiplicative effect: identity = 1. */
  mult?: SkillTable;
  /** Additive offset effect: identity = 0. */
  offset?: SkillTable;
  /** Per-rank compounding rate: effect = 1 + rankRate[lv] × rank. */
  rankRate?: SkillTable;
};

export const EMPLOYEE_SKILLS: Record<TeamLeaderSkillId, EmployeeSkill> = {
  revenue_boost: {
    id: "revenue_boost",
    name: "Hustle Premium",
    maxLevel: 3,
    descriptions: ["+20% rev (role)", "+35% rev (role)", "+55% rev (role)"],
    mult: [1.2, 1.35, 1.55],
  },
  overtime: {
    id: "overtime",
    name: "Compulsive Growth",
    maxLevel: 3,
    descriptions: ["+30% stat speed", "+60% stat speed", "+100% stat speed"],
    mult: [1.3, 1.6, 2.0],
  },
  compounding_rev: {
    id: "compounding_rev",
    name: "Track Record",
    maxLevel: 3,
    descriptions: ["+4% rev per rank", "+8% rev per rank", "+14% rev per rank"],
    rankRate: [0.04, 0.08, 0.14],
  },
  output_focus: {
    id: "output_focus",
    name: "Flow State",
    maxLevel: 3,
    descriptions: [
      "+30% output growth",
      "+60% output growth",
      "+100% output growth",
    ],
    mult: [1.3, 1.6, 2.0],
  },
  chaos_spark: {
    id: "chaos_spark",
    name: "Chaos Spark",
    maxLevel: 3,
    descriptions: [
      "+20% IPS · −5 others' sat",
      "+40% IPS · −10 others' sat",
      "+65% IPS · −15 others' sat",
    ],
    mult: [1.2, 1.4, 1.65],
    offset: [-5, -10, -15],
  },
  crunch_mode: {
    id: "crunch_mode",
    name: "Crunch Mode",
    maxLevel: 3,
    descriptions: [
      "+45% rev · −8 sat (role)",
      "+80% rev · −16 sat (role)",
      "+130% rev · −28 sat (role)",
    ],
    mult: [1.45, 1.8, 2.3],
    offset: [-8, -16, -28],
  },
  research_mode: {
    id: "research_mode",
    name: "Research Mode",
    maxLevel: 3,
    descriptions: [
      "+20% IPS · −5 sat (role)",
      "+38% IPS · −10 sat (role)",
      "+60% IPS · −18 sat (role)",
    ],
    mult: [1.2, 1.38, 1.6],
    offset: [-5, -10, -18],
  },
  sat_drain: {
    id: "sat_drain",
    name: "Office Villain",
    maxLevel: 3,
    descriptions: [
      "−4 sat (role) · +10% global IPS",
      "−8 sat (role) · +20% global IPS",
      "−14 sat (role) · +35% global IPS",
    ],
    mult: [1.1, 1.2, 1.35],
    offset: [-4, -8, -14],
  },
  satisfaction_lift: {
    id: "satisfaction_lift",
    name: "Good Vibes",
    maxLevel: 3,
    descriptions: ["+5 sat target", "+10 sat target", "+18 sat target"],
    offset: [5, 10, 18],
  },
  hire_cost_reduction: {
    id: "hire_cost_reduction",
    name: "Talent Magnet",
    maxLevel: 3,
    descriptions: [
      "−10% hire cost (role)",
      "−20% hire cost (role)",
      "−35% hire cost (role)",
    ],
    mult: [0.9, 0.8, 0.65],
  },
  fast_learner: {
    id: "fast_learner",
    name: "Fast Learner",
    maxLevel: 3,
    descriptions: ["+15% stat speed", "+30% stat speed", "+50% stat speed"],
    mult: [1.15, 1.3, 1.5],
  },
  cost_efficiency: {
    id: "cost_efficiency",
    name: "Lean Operator",
    maxLevel: 3,
    descriptions: [
      "−5% all hire costs",
      "−12% all hire costs",
      "−22% all hire costs",
    ],
    mult: [0.95, 0.88, 0.78],
  },
  team_morale: {
    id: "team_morale",
    name: "Team Builder",
    maxLevel: 3,
    descriptions: [
      "+4 sat (all roles)",
      "+8 sat (all roles)",
      "+14 sat (all roles)",
    ],
    offset: [4, 8, 14],
  },
  sat_recovery: {
    id: "sat_recovery",
    name: "Culture Carrier",
    maxLevel: 3,
    descriptions: [
      "+25% sat drift speed",
      "+55% sat drift speed",
      "+90% sat drift speed",
    ],
    mult: [1.25, 1.55, 1.9],
  },
  valuation_boost: {
    id: "valuation_boost",
    name: "Optics Expert",
    maxLevel: 3,
    descriptions: [
      "+8% valuation rate",
      "+15% valuation rate",
      "+25% valuation rate",
    ],
    mult: [1.08, 1.15, 1.25],
  },
  morale_focus: {
    id: "morale_focus",
    name: "High EQ",
    maxLevel: 3,
    descriptions: [
      "+30% morale growth",
      "+60% morale growth",
      "+100% morale growth",
    ],
    mult: [1.3, 1.6, 2.0],
  },
  global_revenue: {
    id: "global_revenue",
    name: "Thought Leadership",
    maxLevel: 3,
    descriptions: ["+8% global rev", "+15% global rev", "+25% global rev"],
    mult: [1.08, 1.15, 1.25],
  },
  big_picture: {
    id: "big_picture",
    name: "Visionary",
    maxLevel: 3,
    descriptions: [
      "+4% rev & IPS (global)",
      "+8% rev & IPS (global)",
      "+14% rev & IPS (global)",
    ],
    mult: [1.04, 1.08, 1.14],
  },
  compounding_ips: {
    id: "compounding_ips",
    name: "Compound Knowledge",
    maxLevel: 3,
    descriptions: ["+3% IPS per rank", "+6% IPS per rank", "+10% IPS per rank"],
    rankRate: [0.03, 0.06, 0.1],
  },
  global_ips: {
    id: "global_ips",
    name: "Innovation Engine",
    maxLevel: 3,
    descriptions: ["+8% global IPS", "+15% global IPS", "+25% global IPS"],
    mult: [1.08, 1.15, 1.25],
  },
  rev_per_sat: {
    id: "rev_per_sat",
    name: "Engaged Workforce",
    maxLevel: 3,
    descriptions: [
      "+5% rev when sat>0",
      "+12% rev when sat>0",
      "+22% rev when sat>0",
    ],
    mult: [1.05, 1.12, 1.22],
  },
  legacy_amplifier: {
    id: "legacy_amplifier",
    name: "Mentor",
    maxLevel: 3,
    descriptions: [
      "×1.5 legacy on fire",
      "×2.0 legacy on fire",
      "×3.0 legacy on fire",
    ],
    mult: [1.5, 2.0, 3.0],
  },
  ips_boost: {
    id: "ips_boost",
    name: "Deep Focus",
    maxLevel: 3,
    descriptions: ["+15% IPS (role)", "+28% IPS (role)", "+45% IPS (role)"],
    mult: [1.15, 1.28, 1.45],
  },
};

// ─── Skill helpers ─────────────────────────────────────────────────────────────

function lv(level: number): 0 | 1 | 2 {
  return Math.min(Math.max(level - 1, 0), 2) as 0 | 1 | 2;
}

/** Returns the multiplicative skill effect at the given level (1 when level ≤ 0). */
export function skillMult(id: TeamLeaderSkillId, level: number): number {
  const table = EMPLOYEE_SKILLS[id].mult;
  return !table || level <= 0 ? 1 : table[lv(level)];
}

/** Returns the additive offset skill effect at the given level (0 when level ≤ 0). */
export function skillOffset(id: TeamLeaderSkillId, level: number): number {
  const table = EMPLOYEE_SKILLS[id].offset;
  return !table || level <= 0 ? 0 : table[lv(level)];
}

/** Returns the rank-scaling skill effect at the given level (1 when level ≤ 0). */
export function skillRankMult(
  id: TeamLeaderSkillId,
  level: number,
  rank: number,
): number {
  const table = EMPLOYEE_SKILLS[id].rankRate;
  return !table || level <= 0 ? 1 : 1 + table[lv(level)] * rank;
}

// ─── Traits ───────────────────────────────────────────────────────────────────

export type TeamLeaderTraitId =
  | "overachiever"
  | "chaos_agent"
  | "quiet_quitter"
  | "brown_noser"
  | "thought_leader"
  | "burnout_risk";

export type EmployeeTrait = {
  id: TeamLeaderTraitId;
  name: string;
  flavor: string;
  outputBias: number;
  /** Pool of skills this trait can unlock — candidates randomly draw 3 from this list. */
  skills: readonly TeamLeaderSkillId[];
};

export const EMPLOYEE_TRAITS: Record<TeamLeaderTraitId, EmployeeTrait> = {
  overachiever: {
    id: "overachiever",
    name: "Overachiever",
    flavor: "Metrics are their love language.",
    outputBias: 0.7,
    skills: ["revenue_boost", "overtime", "compounding_rev", "output_focus"],
  },
  chaos_agent: {
    id: "chaos_agent",
    name: "Chaos Agent",
    flavor: "Ship first, explain later.",
    outputBias: 0.3,
    skills: ["chaos_spark", "crunch_mode", "research_mode", "sat_drain"],
  },
  quiet_quitter: {
    id: "quiet_quitter",
    name: "Quiet Quitter",
    flavor: "Physically present. Spiritually elsewhere.",
    outputBias: 0.5,
    skills: [
      "satisfaction_lift",
      "hire_cost_reduction",
      "fast_learner",
      "cost_efficiency",
    ],
  },
  brown_noser: {
    id: "brown_noser",
    name: "Brown Noser",
    flavor: "Their calendar is all 1-on-1s.",
    outputBias: 0.35,
    skills: ["team_morale", "sat_recovery", "valuation_boost", "morale_focus"],
  },
  thought_leader: {
    id: "thought_leader",
    name: "Thought Leader",
    flavor: "Posts more than they code.",
    outputBias: 0.5,
    skills: ["global_revenue", "big_picture", "compounding_ips", "global_ips"],
  },
  burnout_risk: {
    id: "burnout_risk",
    name: "Burnout Risk",
    flavor: "Brilliant. For now.",
    outputBias: 0.85,
    skills: ["output_focus", "rev_per_sat", "legacy_amplifier", "ips_boost"],
  },
};

// ─── Name pools ───────────────────────────────────────────────────────────────

const INTERN_NAMES = [
  "Tyler",
  "Madison",
  "Aiden",
  "Jordan",
  "Emma",
  "Jayden",
  "Lily",
  "Noah",
  "Chloe",
  "Liam",
  "Ava",
  "Ethan",
  "Sophia",
  "Mason",
  "Olivia",
  "Logan",
] as const;

const VIBE_NAMES = [
  "Zephyr",
  "Phoenix",
  "Sage",
  "River",
  "Ocean",
  "Blaze",
  "Storm",
  "Pixel",
  "Flux",
  "Neo",
  "Axiom",
  "Riff",
  "Spark",
  "Drift",
  "Echo",
  "Coda",
] as const;

const DEV_NAMES = [
  "Lars",
  "Dmitri",
  "Kenji",
  "Rajesh",
  "Friedrich",
  "Mikael",
  "Takeshi",
  "Björn",
  "Andrei",
  "Sven",
  "Magnus",
  "Priya",
  "Kai",
  "Yuki",
  "Elan",
] as const;

export function getNamePool(role: GeneratorId): readonly string[] {
  if (role === "intern") return INTERN_NAMES;
  if (role === "vibe_coder") return VIBE_NAMES;
  return DEV_NAMES;
}

// ─── Rank system ──────────────────────────────────────────────────────────────

export const RANK_THRESHOLDS = [0, 20, 60, 130, 240, 400] as const;
export const MAX_RANK = RANK_THRESHOLDS.length - 1; // 5

export function rankFromStat(maxStat: number): number {
  let rank = 0;
  for (let i = 1; i < RANK_THRESHOLDS.length; i++) {
    if (maxStat >= RANK_THRESHOLDS[i]) rank = i;
    else break;
  }
  return rank;
}

export function nextRankThreshold(rank: number): number | null {
  return rank < MAX_RANK ? RANK_THRESHOLDS[rank + 1] : null;
}

// ─── Pair synergies ───────────────────────────────────────────────────────────

export type PairSynergy = {
  id: string;
  name: string;
  flavor: string;
  traitA: TeamLeaderTraitId;
  traitB: TeamLeaderTraitId;
  globalRevenueMult?: number;
  globalIpsMult?: number;
  /** Additive offset applied to all roles' satisfaction targets. */
  satOffset?: number;
  /** Added to growth mult for both employees (e.g. 0.20 = +20% faster stats). */
  outputGrowthBonus?: number;
};

export const PAIR_SYNERGIES: PairSynergy[] = [
  {
    id: "competitive_culture",
    name: "Competitive Culture",
    flavor: "Both angling for the same promo.",
    traitA: "overachiever",
    traitB: "overachiever",
    outputGrowthBonus: 0.2,
  },
  {
    id: "productive_chaos",
    name: "Productive Chaos",
    flavor: "The crashes are features now.",
    traitA: "chaos_agent",
    traitB: "overachiever",
    globalIpsMult: 1.3,
  },
  {
    id: "office_politics",
    name: "Office Politics",
    flavor: "HR has given up investigating.",
    traitA: "quiet_quitter",
    traitB: "brown_noser",
    satOffset: 8,
  },
  {
    id: "inspired_direction",
    name: "Inspired Direction",
    flavor: "A Medium post, but it works.",
    traitA: "overachiever",
    traitB: "thought_leader",
    globalRevenueMult: 1.15,
  },
  {
    id: "linkedin_energy",
    name: "LinkedIn Energy",
    flavor: "Three hundred endorsements and counting.",
    traitA: "thought_leader",
    traitB: "brown_noser",
    globalRevenueMult: 1.1,
    satOffset: 6,
  },
  {
    id: "dumpster_fire",
    name: "Dumpster Fire",
    flavor: "Technically still shipping.",
    traitA: "burnout_risk",
    traitB: "chaos_agent",
    globalIpsMult: 1.4,
    satOffset: -15,
  },
  {
    id: "collective_indifference",
    name: "Collective Indifference",
    flavor: "The Slack notifications go unread.",
    traitA: "quiet_quitter",
    traitB: "quiet_quitter",
    satOffset: 8,
    globalRevenueMult: 0.92,
  },
];

export function getActivePairSynergies(
  employees: { traitId: TeamLeaderTraitId }[],
): PairSynergy[] {
  const active: PairSynergy[] = [];
  const seen = new Set<PairSynergy>();
  for (let i = 0; i < employees.length; i++) {
    for (let j = i + 1; j < employees.length; j++) {
      const a = employees[i].traitId;
      const b = employees[j].traitId;
      for (const syn of PAIR_SYNERGIES) {
        if (
          !seen.has(syn) &&
          ((syn.traitA === a && syn.traitB === b) ||
            (syn.traitA === b && syn.traitB === a))
        ) {
          active.push(syn);
          seen.add(syn);
        }
      }
    }
  }
  return active;
}

// ─── Per-employee stat growth ─────────────────────────────────────────────────

/**
 * Pure function: advance one employee's stats by `seconds` of game time.
 *
 * @param emp        - Snapshot of the employee's current stat/skill state.
 * @param satScore   - Current satisfaction score for this employee's role.
 * @param amount     - Number of units deployed for this employee's role.
 * @param pairBonus  - Additive pair-synergy output-growth bonus for this employee (0 if none).
 * @param seconds    - Elapsed game-seconds for this tick.
 * @returns Updated outputStat, moraleStat, rank, and unspentPoints.
 */
export function stepEmployeeStat(
  emp: {
    outputStat: number;
    moraleStat: number;
    rank: number;
    unspentPoints: number;
    skills: Partial<Record<TeamLeaderSkillId, number>>;
    traitId: TeamLeaderTraitId;
  },
  satScore: number,
  amount: number,
  pairBonus: number,
  seconds: number,
): { outputStat: number; moraleStat: number; rank: number; unspentPoints: number } {
  const trait = EMPLOYEE_TRAITS[emp.traitId];

  const baseRate = 0.03 + 0.002 * Math.min(50, amount);
  const overtimeMult = skillMult("overtime", emp.skills.overtime ?? 0);
  const fastLearnerMult = skillMult("fast_learner", emp.skills.fast_learner ?? 0);
  const outputFocusMult = skillMult("output_focus", emp.skills.output_focus ?? 0);
  const moraleFocusMult = skillMult("morale_focus", emp.skills.morale_focus ?? 0);
  const baseMult = overtimeMult * fastLearnerMult * (1 + pairBonus);
  const satRange = SATISFACTION_MAX - SATISFACTION_MIN; // 200
  const satFactor = 0.4 + 0.6 * ((satScore - SATISFACTION_MIN) / satRange);

  const outputGrowth =
    baseRate * trait.outputBias * satFactor * baseMult * outputFocusMult * seconds;
  const moraleGrowth =
    baseRate * (1 - trait.outputBias) * baseMult * moraleFocusMult * seconds;

  const newOutput = emp.outputStat + outputGrowth;
  const newMorale = emp.moraleStat + moraleGrowth;

  const maxStat = Math.max(newOutput, newMorale);
  const newRank = rankFromStat(maxStat);
  const rankGained = Math.max(0, newRank - emp.rank);

  return {
    outputStat: newOutput,
    moraleStat: newMorale,
    rank: newRank,
    unspentPoints: emp.unspentPoints + rankGained,
  };
}

/**
 * Pure function: given the current employee roster, compute per-role satisfaction
 * target offsets from skill effects and pair synergy effects.
 * Called from generators.store tick so it doesn't import from that store.
 */
export function computeTeamLeaderEmpSatOffsets(
  employees: {
    role: GeneratorId;
    skills: Partial<Record<TeamLeaderSkillId, number>>;
    traitId: TeamLeaderTraitId;
  }[],
): Record<GeneratorId, number> {
  const offsets: Record<GeneratorId, number> = {
    intern: 0,
    vibe_coder: 0,
    "10x_dev": 0,
  };

  const allRoles: GeneratorId[] = ["intern", "vibe_coder", "10x_dev"];

  for (const emp of employees) {
    // satisfaction_lift: +N sat target (this role)
    const satLiftLv = emp.skills.satisfaction_lift ?? 0;
    if (satLiftLv > 0) offsets[emp.role] += skillOffset("satisfaction_lift", satLiftLv);

    // chaos_spark: −N sat target (all OTHER roles)
    const chaosLv = emp.skills.chaos_spark ?? 0;
    if (chaosLv > 0) {
      const delta = skillOffset("chaos_spark", chaosLv);
      for (const id of allRoles) {
        if (id !== emp.role) offsets[id] += delta;
      }
    }

    // crunch_mode: −N sat target (this role)
    const crunchLv = emp.skills.crunch_mode ?? 0;
    if (crunchLv > 0) offsets[emp.role] += skillOffset("crunch_mode", crunchLv);

    // research_mode: −N sat target (this role)
    const researchLv = emp.skills.research_mode ?? 0;
    if (researchLv > 0) offsets[emp.role] += skillOffset("research_mode", researchLv);

    // sat_drain: −N sat target (this role)
    const drainLv = emp.skills.sat_drain ?? 0;
    if (drainLv > 0) offsets[emp.role] += skillOffset("sat_drain", drainLv);

    // team_morale: +N sat target (all roles)
    const teamLv = emp.skills.team_morale ?? 0;
    if (teamLv > 0) {
      const lift = skillOffset("team_morale", teamLv);
      for (const id of allRoles) offsets[id] += lift;
    }
  }

  for (const syn of getActivePairSynergies(employees)) {
    if (syn.satOffset) {
      for (const id of allRoles) offsets[id] += syn.satOffset;
    }
  }

  return offsets;
}
