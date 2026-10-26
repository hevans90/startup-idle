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

/** Each category by a role of the console's: one class right in both themes. (Written out whole, for Tailwind to find.) */
export const CAT_STYLE: Record<
  SkillCategory,
  { border: string; bg: string; text: string; dimText: string }
> = {
  revenue: { border: "border-money-line", bg: "bg-money-soft", text: "text-money", dimText: "text-money" },
  ips: { border: "border-innovation-line", bg: "bg-innovation-soft", text: "text-innovation", dimText: "text-innovation" },
  global: { border: "border-ai-line", bg: "bg-ai-soft", text: "text-ai", dimText: "text-ai" },
  satisfaction: { border: "border-good-line", bg: "bg-good-soft", text: "text-good", dimText: "text-good" },
  growth: { border: "border-warn-line", bg: "bg-warn-soft", text: "text-warn", dimText: "text-warn" },
  economy: { border: "border-valuation-line", bg: "bg-valuation-soft", text: "text-valuation", dimText: "text-valuation" },
  legacy: { border: "border-weights-line", bg: "bg-weights-soft", text: "text-weights", dimText: "text-weights" },
};

export const TRAIT_COLORS: Record<TeamLeaderTraitId, string> = {
  overachiever:   "text-info",
  chaos_agent:    "text-bad",
  quiet_quitter:  "text-fg-muted",
  brown_noser:    "text-warn",
  thought_leader: "text-ai",
  burnout_risk:   "text-juice",
};
