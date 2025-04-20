// Returns how many generators you can afford
import Decimal from "break_infinity.js";
import {
  GENERATOR_TYPES,
  GeneratorId,
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
  const costMultiplier = new Decimal(generator.costMultiplier);
  const currentAmount = new Decimal(generator.amount);

  const totalCost = baseCost
    .times(costMultiplier)
    .times(exponent.pow(currentAmount))
    .times(exponent.pow(amount).minus(1))
    .div(exponent.minus(1));

  return totalCost;
};

export const getMaxAffordableAmountAndCost = (
  id: string
): { amount: number; cost: Decimal } => {
  const { generators } = useGeneratorStore.getState();
  const money = useMoneyStore.getState().money;
  const generator = generators.find((g) => g.id === id);
  if (!generator)
    return {
      amount: 0,
      cost: new Decimal(0),
    };

  const baseCost = new Decimal(generator.cost);
  const exponent = new Decimal(generator.costExponent);
  const costMultiplier = new Decimal(generator.costMultiplier);
  const currentAmount = new Decimal(generator.amount);

  if (exponent.eq(1)) {
    // Linear cost: total = baseCost * n
    const amount = money.div(baseCost).floor().toNumber();
    const cost = baseCost.times(amount);
    return { amount, cost };
  }

  // General case
  const affordableExponent = money
    .times(exponent.minus(1))
    .div(baseCost.times(costMultiplier).times(exponent.pow(currentAmount)))
    .plus(1);

  if (affordableExponent.lte(1)) {
    return {
      amount: 0,
      cost: new Decimal(0),
    };
  }

  const amount = Math.floor(
    Decimal.log(affordableExponent, generator.costExponent)
  );

  // Total cost formula for geometric progression:
  // total = baseCost * multiplier * (e^current * (e^n - 1)) / (e - 1)
  const totalCost = baseCost
    .times(costMultiplier)
    .times(
      exponent
        .pow(currentAmount)
        .times(exponent.pow(amount).minus(1))
        .div(exponent.minus(1))
    );

  return { amount, cost: totalCost };
};

export const getUnlockedGeneratorIds = (
  generators: OwnedGenerator[]
): GeneratorId[] => {
  const ownedMap = Object.fromEntries(generators.map((g) => [g.id, g.amount]));
  const unlocked: GeneratorId[] = [];

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
