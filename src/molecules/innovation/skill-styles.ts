import type { TeamLeaderSkillId, TeamLeaderTraitId } from "../../game/team-leaders.catalog";

export type SkillCategory =
  | "revenue"
  | "ips"
  | "global"
  | "satisfaction"
  | "growth"
  | "economy"
  | "legacy";

export const SKILL_CAT: Record<TeamLeaderSkillId, SkillCategory> = {
  revenue_boost:       "revenue",
  crunch_mode:         "revenue",
  compounding_rev:     "revenue",
  rev_per_sat:         "revenue",
  ips_boost:           "ips",
  research_mode:       "ips",
  compounding_ips:     "ips",
  chaos_spark:         "global",
  global_ips:          "global",
  sat_drain:           "global",
  big_picture:         "global",
  global_revenue:      "global",
  satisfaction_lift:   "satisfaction",
  team_morale:         "satisfaction",
  sat_recovery:        "satisfaction",
  overtime:            "growth",
  fast_learner:        "growth",
  output_focus:        "growth",
  morale_focus:        "growth",
  hire_cost_reduction: "economy",
  cost_efficiency:     "economy",
  valuation_boost:     "economy",
  legacy_amplifier:    "legacy",
};

export const CAT_STYLE: Record<
  SkillCategory,
  { border: string; bg: string; text: string; dimText: string }
> = {
  revenue: {
    border:  "border-emerald-700/60 dark:border-emerald-600/50",
    bg:      "bg-emerald-950/40 dark:bg-emerald-900/20",
    text:    "text-emerald-400",
    dimText: "text-emerald-600 dark:text-emerald-500",
  },
  ips: {
    border:  "border-blue-700/60 dark:border-blue-600/50",
    bg:      "bg-blue-950/40 dark:bg-blue-900/20",
    text:    "text-blue-400",
    dimText: "text-blue-600 dark:text-blue-500",
  },
  global: {
    border:  "border-purple-700/60 dark:border-purple-600/50",
    bg:      "bg-purple-950/40 dark:bg-purple-900/20",
    text:    "text-purple-400",
    dimText: "text-purple-600 dark:text-purple-500",
  },
  satisfaction: {
    border:  "border-amber-700/60 dark:border-amber-600/50",
    bg:      "bg-amber-950/40 dark:bg-amber-900/20",
    text:    "text-amber-400",
    dimText: "text-amber-600 dark:text-amber-500",
  },
  growth: {
    border:  "border-orange-700/60 dark:border-orange-600/50",
    bg:      "bg-orange-950/40 dark:bg-orange-900/20",
    text:    "text-orange-400",
    dimText: "text-orange-600 dark:text-orange-500",
  },
  economy: {
    border:  "border-teal-700/60 dark:border-teal-600/50",
    bg:      "bg-teal-950/40 dark:bg-teal-900/20",
    text:    "text-teal-400",
    dimText: "text-teal-600 dark:text-teal-500",
  },
  legacy: {
    border:  "border-rose-700/60 dark:border-rose-600/50",
    bg:      "bg-rose-950/40 dark:bg-rose-900/20",
    text:    "text-rose-400",
    dimText: "text-rose-600 dark:text-rose-500",
  },
};

export const TRAIT_COLORS: Record<TeamLeaderTraitId, string> = {
  overachiever:   "text-blue-500 dark:text-blue-400",
  chaos_agent:    "text-red-500 dark:text-red-400",
  quiet_quitter:  "text-slate-500 dark:text-slate-400",
  brown_noser:    "text-yellow-500 dark:text-yellow-400",
  thought_leader: "text-purple-500 dark:text-purple-400",
  burnout_risk:   "text-orange-500 dark:text-orange-400",
};
