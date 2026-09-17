/**
 * Single source of truth for every game modifier.
 *
 * `computeModifiers(ctx)` reads from all stores that contribute multipliers
 * and returns a flat `GameModifiers` snapshot. Every tick, every display
 * getter, and every cost function should derive their numbers from this
 * object — never inline-read the contributing stores themselves.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ Sources → modifiers.ts → generators.store / generator-utils / acquisition│
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { useFounderStore } from "../state/founder.store";
import { useInnovationStore } from "../state/innovation.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";
import { useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import {
  internSatisfactionIpsMultiplier,
  internSatisfactionValuationMultiplier,
  satisfactionRevenueMultiplier,
  type SatisfactionScores,
} from "./satisfaction";
import { type PrestigeModifiers } from "./skill-tree";
import {
  getActivePairSynergies,
  skillMult,
  skillRankMult,
} from "./team-leaders.catalog";

// ─── Type ─────────────────────────────────────────────────────────────────────

export type GameModifiers = {
  // ── Innovation log-curve (applies to all generator output) ───────────────
  innovationCurve: number;

  // ── Manager tier bonuses ──────────────────────────────────────────────────
  /** Corpo manager → money output */
  managerMoney: number;
  /** Agile manager → innovation output */
  managerInnovation: number;
  /** Sales manager → valuation accrual */
  managerSalesValuation: number;

  // ── Board mandate bonuses ─────────────────────────────────────────────────
  mandateMoney: number;
  mandateInnovation: number;

  // ── Vape juice shop bonuses ───────────────────────────────────────────────
  juiceMoney: number;
  juiceInnovation: number;
  juiceValuation: number;
  /** Additive hire-cost fraction reduction, already clamped to [0, 0.9]. */
  juiceHireCostReduction: number;
  /** Additive equity payout bonus fraction. */
  juiceEquityBonus: number;

  // ── Founder bonuses ───────────────────────────────────────────────────────
  founderGlobalMoney: number;
  founderValuation: number;
  /** Per-generator money override (e.g. Agentic Delusionist vibe_coder boost). */
  founderMoney: Record<string, number>;
  /** Per-generator innovation override (e.g. Hacker vibe_coder boost). */
  founderInnovation: Record<string, number>;
  founderAutoBuy: number;
  /**
   * Additive headcount-synergy rate from the founder (combined with
   * `prestigeHeadcountRate` in the derived `headcountMoney` field below).
   */
  founderHeadcountRate: number;

  // ── Skill-tree (prestige) bonuses ─────────────────────────────────────────
  prestigeMoney: number;
  prestigeInnovation: number;
  prestigeValuation: number;
  prestigeEmployeeOutput: number;
  /** AGI-Pilled keystone: intern-only output scalar. */
  prestigeInternOutput: number;
  /** Lean cluster / Ramen / Bootstrapped keystones: hire-cost scalar (≤ 1). */
  prestigeHireCost: number;
  prestigeEquity: number;
  prestigeAutoBuy: number;
  prestigeManagerSpeed: number;
  /**
   * Additive headcount-synergy rate from the skill tree (combined with
   * `founderHeadcountRate` in the derived `headcountMoney` field below).
   */
  prestigeHeadcountRate: number;
  /** 996: rate at which satisfaction scores move toward their target. */
  prestigeSatisfactionGain: number;
  /** Bootstrapped keystone: managers don't tick and contribute no bonuses. */
  managersDisabled: boolean;
  /** Crunch Mode keystone: all satisfaction effects are zero. */
  satisfactionNeutralized: boolean;
  /** Enshittify keystone: scale factor applied to positive satisfaction scores. */
  satisfactionPositiveMult: number;

  // ── Derived (require context from generators.store) ───────────────────────

  /**
   * Combined headcount-synergy multiplier:
   * `1 + (founderHeadcountRate + prestigeHeadcountRate) × totalEmployees`
   */
  headcountMoney: number;
  /** Global innovation boost from intern satisfaction (≥ 1, no penalty). */
  internIpsMult: number;
  /** Intern satisfaction effect on valuation (penalty when negative score). */
  internValuationMult: number;
  /**
   * Per-generator satisfaction revenue multiplier.
   * Key is `GeneratorId`; value already accounts for neutralization/scaling.
   */
  satisfactionRevenue: Record<string, number>;
  /**
   * Effective satisfaction scores after applying prestige keystones
   * (neutralization + positive-side scaling). Exposed so callers don't need
   * to re-read prestige — e.g. for the AI singularity tick.
   */
  effectiveScores: Record<string, number>;

  // ── TEAM LEADER bonuses ──────────────────────────────────────────────────
  /** Per-role revenue mult from team leader skills (revenue_boost). */
  teamLeaderEmpRoleRevenue: Record<string, number>;
  /** Per-role IPS mult from team leader skills (ips_boost). */
  teamLeaderEmpRoleIps: Record<string, number>;
  /** Global revenue mult from thought_leader skill + pair synergies. */
  teamLeaderEmpGlobalRevenue: number;
  /** Global IPS mult from chaos_spark skill + pair synergies. */
  teamLeaderEmpGlobalIps: number;
  /** Legacy run bonuses from fired team leaders (additive fraction, already converted to multiplier). */
  teamLeaderLegacyRevenue: Record<string, number>;
  teamLeaderLegacyIps: Record<string, number>;
  /** Per-role hire cost multiplier from hire_cost_reduction + cost_efficiency skills. */
  teamLeaderEmpRoleHireCostMult: Record<string, number>;
  /** Global hire cost multiplier from cost_efficiency skill (stacked across all employees). */
  teamLeaderEmpGlobalHireCostMult: number;
  /** Valuation accrual rate multiplier from valuation_boost skill. */
  teamLeaderEmpValuationMult: number;
};

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * Values that live in `generators.store` (would create a circular import if we
 * read them directly here). Callers pass this context in.
 */
export type ModifierContext = {
  totalEmployees: number;
  emUnlocked: boolean;
  /** Raw (un-modified) satisfaction scores from the generators store. */
  rawScores: SatisfactionScores;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pure function: apply prestige keystones to a raw satisfaction score.
 * Used by both `computeModifiers` and `generators.store.getEffectiveSatisfaction`
 * so the logic is never duplicated.
 */
export function applyEffectiveSatisfaction(
  raw: number,
  prestige: Pick<
    PrestigeModifiers,
    "satisfactionNeutralized" | "satisfactionPositiveMult"
  >,
): number {
  if (prestige.satisfactionNeutralized) return 0;
  if (prestige.satisfactionPositiveMult !== 1 && raw > 0) {
    return raw * prestige.satisfactionPositiveMult;
  }
  return raw;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Snapshot every game modifier from every contributing system.
 *
 * Call once per tick (or once per display update) and pass the result to all
 * downstream calculations. This is the ONLY place that knows which stores
 * contribute to which stats.
 */
export function computeModifiers(ctx: ModifierContext): GameModifiers {
  const prestige = usePrestigeStore.getState().modifiers;
  const founder = useFounderStore.getState();
  const vape = useVapeAchievementsStore.getState();
  const innovState = useInnovationStore.getState();

  const managersActive =
    !prestige.disableManagers &&
    (innovState.unlocks.managers?.unlocked ?? false);

  const mandates = useValuationStore.getState().getEconomyMultipliers();

  // Compute effective satisfaction scores once; all downstream fields use them.
  const effectiveScores: Record<string, number> = {};
  for (const [id, raw] of Object.entries(ctx.rawScores)) {
    effectiveScores[id] = ctx.emUnlocked
      ? applyEffectiveSatisfaction(raw as number, prestige)
      : 0;
  }

  const internEffective = effectiveScores["intern"] ?? 0;

  // Team leaders: skills + pair synergies → per-role and global bonuses.
  const tlStore = useTeamLeadersEmployeesStore.getState();
  const teamLeaders = ctx.emUnlocked ? tlStore.employees : [];
  const keyLegacies = tlStore.legacies;

  const tlRoleRevenue: Record<string, number> = {
    intern: 1,
    vibe_coder: 1,
    "10x_dev": 1,
  };
  const tlRoleIps: Record<string, number> = {
    intern: 1,
    vibe_coder: 1,
    "10x_dev": 1,
  };
  const tlRoleHireCostMult: Record<string, number> = {
    intern: 1,
    vibe_coder: 1,
    "10x_dev": 1,
  };
  let tlGlobalRevenue = 1;
  let tlGlobalIps = 1;
  let tlGlobalHireCostMult = 1;
  let tlValuationMult = 1;

  for (const emp of teamLeaders) {
    const role = emp.role;

    // ── Revenue ────────────────────────────────────────────────────────────────

    const revLv = emp.skills.revenue_boost ?? 0;
    if (revLv > 0) tlRoleRevenue[role] *= skillMult("revenue_boost", revLv);

    // crunch_mode: role rev boost (sat penalty handled in computeTeamLeaderEmpSatOffsets)
    const crunchLv = emp.skills.crunch_mode ?? 0;
    if (crunchLv > 0) tlRoleRevenue[role] *= skillMult("crunch_mode", crunchLv);

    const gRevLv = emp.skills.global_revenue ?? 0;
    if (gRevLv > 0) tlGlobalRevenue *= skillMult("global_revenue", gRevLv);

    // big_picture: global rev + global IPS
    const bpLv = emp.skills.big_picture ?? 0;
    if (bpLv > 0) {
      const bpM = skillMult("big_picture", bpLv);
      tlGlobalRevenue *= bpM;
      tlGlobalIps *= bpM;
    }

    // compounding_rev: per-rank role rev
    const cRevLv = emp.skills.compounding_rev ?? 0;
    if (cRevLv > 0)
      tlRoleRevenue[role] *= skillRankMult("compounding_rev", cRevLv, emp.rank);

    // rev_per_sat: role rev boost when effective sat > 0
    const rpsLv = emp.skills.rev_per_sat ?? 0;
    if (rpsLv > 0 && (effectiveScores[role] ?? 0) > 0) {
      tlRoleRevenue[role] *= skillMult("rev_per_sat", rpsLv);
    }

    // ── IPS ────────────────────────────────────────────────────────────────────

    const ipsLv = emp.skills.ips_boost ?? 0;
    if (ipsLv > 0) tlRoleIps[role] *= skillMult("ips_boost", ipsLv);

    // research_mode: role IPS boost (sat penalty handled in computeTeamLeaderEmpSatOffsets)
    const researchLv = emp.skills.research_mode ?? 0;
    if (researchLv > 0) tlRoleIps[role] *= skillMult("research_mode", researchLv);

    // compounding_ips: per-rank role IPS
    const cIpsLv = emp.skills.compounding_ips ?? 0;
    if (cIpsLv > 0) tlRoleIps[role] *= skillRankMult("compounding_ips", cIpsLv, emp.rank);

    // chaos_spark: global IPS (sat penalty handled in computeTeamLeaderEmpSatOffsets)
    const chaosLv = emp.skills.chaos_spark ?? 0;
    if (chaosLv > 0) tlGlobalIps *= skillMult("chaos_spark", chaosLv);

    // global_ips: clean global IPS, no sat penalty
    const gIpsLv = emp.skills.global_ips ?? 0;
    if (gIpsLv > 0) tlGlobalIps *= skillMult("global_ips", gIpsLv);

    // sat_drain: global IPS bonus (sat penalty handled in computeTeamLeaderEmpSatOffsets)
    const drainLv = emp.skills.sat_drain ?? 0;
    if (drainLv > 0) tlGlobalIps *= skillMult("sat_drain", drainLv);

    // ── Economy ────────────────────────────────────────────────────────────────

    const hcrLv = emp.skills.hire_cost_reduction ?? 0;
    if (hcrLv > 0) tlRoleHireCostMult[role] *= skillMult("hire_cost_reduction", hcrLv);

    const ceLv = emp.skills.cost_efficiency ?? 0;
    if (ceLv > 0) tlGlobalHireCostMult *= skillMult("cost_efficiency", ceLv);

    const vbLv = emp.skills.valuation_boost ?? 0;
    if (vbLv > 0) tlValuationMult *= skillMult("valuation_boost", vbLv);

  }

  const pairSynergies = getActivePairSynergies(teamLeaders);
  for (const syn of pairSynergies) {
    if (syn.globalRevenueMult) tlGlobalRevenue *= syn.globalRevenueMult;
    if (syn.globalIpsMult) tlGlobalIps *= syn.globalIpsMult;
  }

  const teamLeaderLegacyRevenue: Record<string, number> = {
    intern: 1,
    vibe_coder: 1,
    "10x_dev": 1,
  };
  const teamLeaderLegacyIps: Record<string, number> = {
    intern: 1,
    vibe_coder: 1,
    "10x_dev": 1,
  };
  for (const leg of keyLegacies) {
    teamLeaderLegacyRevenue[leg.role] =
      (teamLeaderLegacyRevenue[leg.role] ?? 1) * (1 + leg.revenueMult);
    teamLeaderLegacyIps[leg.role] = (teamLeaderLegacyIps[leg.role] ?? 1) * (1 + leg.ipsMult);
  }

  return {
    // Innovation log-curve
    innovationCurve: innovState.getMultiplier().toNumber(),

    // Manager bonuses
    managerMoney: managersActive
      ? innovState.managers.corpo.bonusMultiplier.toNumber()
      : 1,
    managerInnovation: managersActive
      ? innovState.managers.agile.bonusMultiplier.toNumber()
      : 1,
    managerSalesValuation: managersActive
      ? innovState.managers.sales.bonusMultiplier.toNumber()
      : 1,

    // Board mandates
    mandateMoney: mandates.money,
    mandateInnovation: mandates.innovation,

    // Vape juice
    juiceMoney: 1 + vape.juiceMpsMultBonus,
    juiceInnovation: 1 + vape.juiceInnovationMultBonus,
    juiceValuation: 1 + vape.juiceValuationMultBonus,
    juiceHireCostReduction: Math.min(0.9, vape.juiceHireCostReduction),
    juiceEquityBonus: vape.juiceEquityMultBonus,

    // Founder
    founderGlobalMoney: founder.globalMoneyMult,
    founderValuation: founder.valuationAccrualMult,
    founderMoney: { ...founder.generatorMoneyMult },
    founderInnovation: { ...founder.generatorInnovationMult },
    founderAutoBuy: founder.autoBuyMult,
    founderHeadcountRate: founder.headcountMoneyPerEmployee,

    // Prestige
    prestigeMoney: prestige.moneyMult,
    prestigeInnovation: prestige.innovationMult,
    prestigeValuation: prestige.valuationMult,
    prestigeEmployeeOutput: prestige.employeeOutputMult,
    prestigeInternOutput: prestige.internOutputMult,
    prestigeHireCost: prestige.hireCostMult,
    prestigeEquity: prestige.equityMult,
    prestigeAutoBuy: prestige.autoBuyMult,
    prestigeManagerSpeed: prestige.managerSpeedMult,
    prestigeHeadcountRate: prestige.headcountPerEmployee,
    prestigeSatisfactionGain: prestige.satisfactionGainMult,
    managersDisabled: prestige.disableManagers,
    satisfactionNeutralized: prestige.satisfactionNeutralized,
    satisfactionPositiveMult: prestige.satisfactionPositiveMult,

    // Derived from context
    headcountMoney:
      1 +
      (founder.headcountMoneyPerEmployee + prestige.headcountPerEmployee) *
        ctx.totalEmployees,
    internIpsMult: ctx.emUnlocked
      ? internSatisfactionIpsMultiplier(internEffective)
      : 1,
    internValuationMult: ctx.emUnlocked
      ? internSatisfactionValuationMultiplier(internEffective)
      : 1,
    satisfactionRevenue: Object.fromEntries(
      Object.keys(ctx.rawScores).map((id) => [
        id,
        ctx.emUnlocked
          ? satisfactionRevenueMultiplier(effectiveScores[id] ?? 0)
          : 1,
      ]),
    ),
    effectiveScores,
    teamLeaderEmpRoleRevenue: tlRoleRevenue,
    teamLeaderEmpRoleIps: tlRoleIps,
    teamLeaderEmpGlobalRevenue: tlGlobalRevenue,
    teamLeaderEmpGlobalIps: tlGlobalIps,
    teamLeaderLegacyRevenue,
    teamLeaderLegacyIps,
    teamLeaderEmpRoleHireCostMult: tlRoleHireCostMult,
    teamLeaderEmpGlobalHireCostMult: tlGlobalHireCostMult,
    teamLeaderEmpValuationMult: tlValuationMult,
  };
}

// ─── Focused helpers (used by acquisition.ts and generator-utils.ts) ─────────

/**
 * The two multipliers that scale the equity payout.
 * Isolated so `acquisition.ts` doesn't need to call `computeModifiers` with a
 * full context just to read two fields.
 */
export function computeEquityMultipliers(): {
  prestige: number;
  juice: number;
} {
  return {
    prestige: usePrestigeStore.getState().modifiers.equityMult,
    juice: useVapeAchievementsStore.getState().juiceEquityMultBonus,
  };
}

/**
 * The multipliers that scale hire cost.
 * Used by `generator-utils.ts` which already has generator-store context.
 * Pass `roleId` to include per-role team leader hire cost reduction.
 */
export function computeHireCostMultipliers(
  tlGlobalMult: number,
  tlRoleMult: number,
): {
  prestige: number;
  juiceReduction: number;
  tlMult: number;
} {
  return {
    prestige: usePrestigeStore.getState().modifiers.hireCostMult,
    juiceReduction: Math.min(
      0.9,
      useVapeAchievementsStore.getState().juiceHireCostReduction,
    ),
    tlMult: tlGlobalMult * tlRoleMult,
  };
}

// ─── Narrow helpers (for callers that only need a single domain) ──────────────

export type ManagerEconomyMultipliers = {
  innovationIncome: number;
  employeeMoney: number;
  salesValuation: number;
};

export function getManagerEconomyMultipliers(): ManagerEconomyMultipliers {
  const prestige = usePrestigeStore.getState().modifiers;
  const innovState = useInnovationStore.getState();
  const managersActive =
    !prestige.disableManagers &&
    (innovState.unlocks.managers?.unlocked ?? false);
  return {
    innovationIncome: managersActive
      ? innovState.managers.agile.bonusMultiplier.toNumber()
      : 1,
    employeeMoney: managersActive
      ? innovState.managers.corpo.bonusMultiplier.toNumber()
      : 1,
    salesValuation: managersActive
      ? innovState.managers.sales.bonusMultiplier.toNumber()
      : 1,
  };
}

export function getValuationEconomyMultipliers(): {
  money: number;
  innovation: number;
} {
  return useValuationStore.getState().getEconomyMultipliers();
}
