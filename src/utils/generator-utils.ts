// Returns how many generators you can afford
import Decimal from "break_infinity.js";
import {
  GENERATOR_TYPES,
  OwnedGenerator,
  useGeneratorStore,
} from "../state/generators.store";
import { useMoneyStore } from "../state/money.store";

export const getGeneratorCost = (id: string, amount: number = 1): Decimal => {
  const { generators } = useGeneratorStore.getState();
  const generator = generators.find((g) => g.id === id);
  if (!generator) return new Decimal(0);

  const baseCost = new Decimal(generator.cost);
  const exponent = new Decimal(generator.costExponent);
  const currentAmount = new Decimal(generator.amount);

  const totalCost = baseCost
    .times(exponent.pow(currentAmount))
    .times(exponent.pow(amount).minus(1))
    .div(exponent.minus(1));

  return totalCost;
};

export const getMaxAffordableAmount = (id: string): number => {
  const { generators } = useGeneratorStore.getState();
  const money = useMoneyStore.getState().money;
  const generator = generators.find((g) => g.id === id);
  if (!generator) return 0;

  const baseCost = new Decimal(generator.cost);
  const exponent = new Decimal(generator.costExponent);
  const currentAmount = new Decimal(generator.amount);

  if (exponent.eq(1)) {
    // Linear case (rare but possible)
    return money.div(baseCost).floor().toNumber();
  }

  // Solving for n: totalCost = baseCost * (e^currentAmount) * (e^n - 1) / (e - 1)
  // Rearranged:
  const affordableExponent = money
    .times(exponent.minus(1))
    .div(baseCost.times(exponent.pow(currentAmount)))
    .plus(1);

  if (affordableExponent.lte(1)) return 0;

  const max = Decimal.log(affordableExponent, generator.costExponent);

  return Math.floor(max);
};

export const getUnlockedGeneratorIds = (
  generators: OwnedGenerator[]
): string[] => {
  const ownedMap = Object.fromEntries(generators.map((g) => [g.id, g.amount]));
  const unlocked: string[] = [];

  for (const gen of GENERATOR_TYPES) {
    const conditions = gen.unlockConditions ?? [];
    const satisfied = conditions.every((cond) => {
      const owned = ownedMap[cond.requiredId] ?? 0;
      return owned >= cond.requiredAmount;
    });

    if (conditions.length === 0 || satisfied) {
      unlocked.push(gen.id);
    }
  }

  return unlocked;
};
