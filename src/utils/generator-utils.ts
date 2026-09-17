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
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { computeHireCostMultipliers } from "../game/modifiers";

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

  const genState = useGeneratorStore.getState();
  const m = genState._buildModifiers();
  const employeeCostMult = genState.getEmployeeCostMult(id as GeneratorId);
  const { prestige: hireCostMult, juiceReduction, tlMult } = computeHireCostMultipliers(
    m.teamLeaderEmpGlobalHireCostMult,
    m.teamLeaderEmpRoleHireCostMult[id] ?? 1,
  );

  return totalCost.times(employeeCostMult).times(hireCostMult).times(1 - juiceReduction).times(tlMult);
};

export const getMaxAffordableAmountAndCost = (
  id: string
): { amount: number; cost: Decimal } => {
  const genState = useGeneratorStore.getState();
  const { generators } = genState;
  const m = genState._buildModifiers();
  const employeeCostMult = genState.getEmployeeCostMult(id as GeneratorId);
  const { prestige: hireCostMult, juiceReduction, tlMult } = computeHireCostMultipliers(
    m.teamLeaderEmpGlobalHireCostMult,
    m.teamLeaderEmpRoleHireCostMult[id] ?? 1,
  );
  const juiceHireMult = 1 - juiceReduction;
  const money = useMoneyStore
    .getState()
    .money.div(employeeCostMult)
    .div(hireCostMult)
    .div(juiceHireMult)
    .div(tlMult);
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
    const cost = baseCost.times(amount).times(employeeCostMult).times(hireCostMult).times(juiceHireMult).times(tlMult);
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
    .times(juiceHireMult)
    .times(tlMult);

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
