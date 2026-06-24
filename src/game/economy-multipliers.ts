import { useInnovationStore } from "../state/innovation.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useValuationStore } from "../state/valuation.store";

const NEUTRAL_MANAGER_MULTS = {
  innovationIncome: 1,
  employeeMoney: 1,
  salesValuation: 1,
};

export type ManagerEconomyMultipliers = {
  /** Agile — scales innovation income from generators */
  innovationIncome: number;
  /** Corpo — scales money from generators (and manual click via MPS) */
  employeeMoney: number;
  /** Sales — scales passive valuation gain */
  salesValuation: number;
};

/**
 * Composed multipliers from manager tiers. Inactive until the managers unlock is purchased.
 */
export function getManagerEconomyMultipliers(): ManagerEconomyMultipliers {
  // Skill-tree "Bootstrapped": managers contribute nothing.
  if (usePrestigeStore.getState().modifiers.disableManagers) {
    return { ...NEUTRAL_MANAGER_MULTS };
  }
  const { unlocks, managers } = useInnovationStore.getState();
  if (!unlocks.managers?.unlocked) {
    return { ...NEUTRAL_MANAGER_MULTS };
  }
  return {
    innovationIncome: managers.agile.bonusMultiplier.toNumber(),
    employeeMoney: managers.corpo.bonusMultiplier.toNumber(),
    salesValuation: managers.sales.bonusMultiplier.toNumber(),
  };
}

/** Permanent global bonuses purchased with valuation (board mandates). */
export function getValuationEconomyMultipliers(): {
  money: number;
  innovation: number;
} {
  return useValuationStore.getState().getEconomyMultipliers();
}
