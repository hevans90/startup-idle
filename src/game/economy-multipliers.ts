import { useInnovationStore } from "../state/innovation.store";
import { useValuationStore } from "../state/valuation.store";

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
  const { unlocks, managers } = useInnovationStore.getState();
  if (!unlocks.managers?.unlocked) {
    return { innovationIncome: 1, employeeMoney: 1, salesValuation: 1 };
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
