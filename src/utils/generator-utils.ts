// Returns how many generators you can afford
import Decimal from "break_infinity.js";
import { dev10xSatisfactionExponentDelta } from "../game/satisfaction";
import {
  GENERATOR_TYPES,
  GeneratorId,
  MIN_GENERATOR_COST_EXPONENT,
  OwnedGenerator,
  useGeneratorStore,
} from "../state/generators.store";
import { useFounderStore } from "../state/founder.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";

function effectiveCostExponent(generator: OwnedGenerator, id: string): number {
  let raw = generator.costExponent;
  if (
    id === "10x_dev" &&
    useInnovationStore.getState().unlocks.employeeManagement?.unlocked
  ) {
    const score = useGeneratorStore.getState().getEffectiveSatisfaction("10x_dev");
    raw += dev10xSatisfactionExponentDelta(score);
  }
  // Founder "Bootstrapper": leaner cost scaling (compounds at high counts).
  raw -= useFounderStore.getState().costExponentReduction;
  return Math.max(MIN_GENERATOR_COST_EXPONENT, raw);
}

export const getGeneratorCost = (id: string, amount: number = 1): Decimal => {
  const { generators } = useGeneratorStore.getState();
  const generator = generators.find((g) => g.id === id);
  if (!generator) return new Decimal(0);

  const baseCost = new Decimal(generator.cost);
  const exponent = new Decimal(effectiveCostExponent(generator, id));
  const costMultiplier = new Decimal(generator.costMultiplier);
  const currentAmount = new Decimal(generator.amount);

  const totalCost = baseCost
    .times(costMultiplier)
    .times(exponent.pow(currentAmount))
    .times(exponent.pow(amount).minus(1))
    .div(exponent.minus(1));

  const employeeCostMult = useGeneratorStore
    .getState()
    .getEmployeeCostMult(id as GeneratorId);
  // Skill-tree "lean" passives make hires cheaper (hireCostMult < 1).
  const hireCostMult = usePrestigeStore.getState().modifiers.hireCostMult;
  // Vape shop hire-cost reduction (additive fraction, clamped so cost stays >= 10% of base).
  const juiceHireReduction = Math.min(
    0.9,
    useVapeAchievementsStore.getState().juiceHireCostReduction,
  );

  return totalCost.times(employeeCostMult).times(hireCostMult).times(1 - juiceHireReduction);
};

export const getMaxAffordableAmountAndCost = (
  id: string
): { amount: number; cost: Decimal } => {
  const { generators } = useGeneratorStore.getState();
  const employeeCostMult = useGeneratorStore
    .getState()
    .getEmployeeCostMult(id as GeneratorId);
  const hireCostMult = usePrestigeStore.getState().modifiers.hireCostMult;
  const juiceHireReduction = Math.min(
    0.9,
    useVapeAchievementsStore.getState().juiceHireCostReduction,
  );
  const juiceHireMult = 1 - juiceHireReduction;
  const money = useMoneyStore
    .getState()
    .money.div(employeeCostMult)
    .div(hireCostMult)
    .div(juiceHireMult);
  const generator = generators.find((g) => g.id === id);
  if (!generator)
    return {
      amount: 0,
      cost: new Decimal(0),
    };

  const baseCost = new Decimal(generator.cost);
  const exponent = new Decimal(effectiveCostExponent(generator, generator.id));
  const costMultiplier = new Decimal(generator.costMultiplier);
  const currentAmount = new Decimal(generator.amount);

  if (exponent.eq(1)) {
    // Linear cost: total = baseCost * n
    const amount = money.div(baseCost).floor().toNumber();
    const cost = baseCost.times(amount).times(employeeCostMult).times(hireCostMult).times(juiceHireMult);
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
    Decimal.log(affordableExponent, exponent.toNumber())
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
    )
    .times(employeeCostMult)
    .times(hireCostMult)
    .times(juiceHireMult);

  return { amount, cost: totalCost };
};

export const getUnlockedGeneratorIds = (
  generators: OwnedGenerator[]
): GeneratorId[] => {
  // Founder "Agentic Delusionist": only one generator is buildable at all.
  const only = useFounderStore.getState().onlyGenerator;
  if (only) return [only];

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
