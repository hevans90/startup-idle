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
import { termEffects } from "./term-deal";
import { useInnovationStore } from "../state/innovation.store";
import { usePrestigeStore } from "../state/prestige.store";
import { fusionNow } from "./fusion";
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";
import { useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import {
  internSatisfactionIpsMultiplier,
  satisfactionRevenueMultiplier,
  type SatisfactionScores,
} from "./satisfaction";
import { type PrestigeModifiers } from "./skill-tree";
import { leadersNow } from "./leader-economy";
import type { GeneratorId } from "../state/generators.store";

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
  /** Interns' morale on the company's innovation: ×0.8 to ×1.2. */
  internIpsMult: number;
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
  /** Each kind's output from its leader, as felt across the kind. @see leadersNow */
  teamLeaderEmpRoleRevenue: Record<string, number>;
  /** Each kind's innovation from its leader. */
  teamLeaderEmpRoleIps: Record<string, number>;
  /** Company-wide revenue from leaders: none since leaders lead one kind each (kept as 1). */
  teamLeaderEmpGlobalRevenue: number;
  /** Company-wide innovation from leaders: likewise 1. */
  teamLeaderEmpGlobalIps: number;
  /** Legacy run bonuses from fired team leaders (additive fraction, already converted to multiplier). */
  teamLeaderLegacyRevenue: Record<string, number>;
  teamLeaderLegacyIps: Record<string, number>;
  /** Each kind's hire price from its leader. */
  teamLeaderEmpRoleHireCostMult: Record<string, number>;
  /** Company-wide hire price from leaders: 1. */
  teamLeaderEmpGlobalHireCostMult: number;
  /** Valuation from leaders: 1. */
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
  /** Each kind's headcount, for what its leader's team is of it. @see leadersNow */
  owned?: Partial<Record<GeneratorId, number>>;
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
  // MORALE IS FELT FROM THE START: not waiting on employee management. @see game/satisfaction
  const effectiveScores: Record<string, number> = {};
  for (const [id, raw] of Object.entries(ctx.rawScores)) {
    effectiveScores[id] = applyEffectiveSatisfaction(raw as number, prestige);
  }

  const internEffective = effectiveScores["intern"] ?? 0;

  // LEADERS: each kind's, as felt across the kind — once the Talent Agency
  // has opened them. @see leadersNow, game/leaders
  const tlStore = useTeamLeadersEmployeesStore.getState();
  const keyLegacies = tlStore.legacies;
  const led = innovState.unlocks.leaders?.unlocked && ctx.owned
    ? leadersNow(ctx.owned, (id) => satisfactionRevenueMultiplier(effectiveScores[id] ?? 0)).of
    : {};
  const tlRoleRevenue: Record<string, number> = {}, tlRoleIps: Record<string, number> = {}, tlRoleHireCostMult: Record<string, number> = {};
  for (const id of ["intern", "vibe_coder", "10x_dev"] as GeneratorId[]) {
    tlRoleRevenue[id] = led[id]?.output ?? 1;
    tlRoleIps[id] = led[id]?.innovation ?? 1;
    tlRoleHireCostMult[id] = led[id]?.hireCost ?? 1;
  }
  const tlGlobalRevenue = 1, tlGlobalIps = 1, tlGlobalHireCostMult = 1, tlValuationMult = 1;

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
    internIpsMult: internSatisfactionIpsMultiplier(internEffective),
    satisfactionRevenue: Object.fromEntries(
      Object.keys(ctx.rawScores).map((id) => [
        id,
        satisfactionRevenueMultiplier(effectiveScores[id] ?? 0),
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
    // The skill tree, HR fused into the founder, and the term sheet's option pool. @see game/fusion, term-deal
    prestige: usePrestigeStore.getState().modifiers.hireCostMult * fusionNow().hireCostMult * termEffects().hireCostMult,
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
