import {
  GENERATOR_TYPES,
  type GeneratorId,
  type OwnedGenerator,
} from "../state/generators.store";

export function makeOwnedGenerator(
  id: GeneratorId,
  amount: number,
  opts?: { multiplier?: number }
): OwnedGenerator {
  const base = GENERATOR_TYPES.find((g) => g.id === id)!;
  return {
    ...base,
    amount,
    lastTick: Date.now(),
    multiplier: opts?.multiplier ?? 1,
    costMultiplier: 1,
    innovationMultiplier: 1,
  };
}
