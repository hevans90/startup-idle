import { describe, expect, jest, test } from "bun:test";

import { resetAllGameStores } from "../simulation/reset-game-stores";
import { advanceGameplayOneSecond } from "../simulation/run-sim";
import { makeOwnedGenerator } from "../simulation/store-fixtures";
import { useGeneratorStore } from "./generators.store";
import { useMoneyStore } from "./money.store";
import { useSlopPitStore } from "./slop-pit.store";

describe("income with the slop pit full", () => {
  test("is shown as it is earned: the pit's cut is in the rate", () => {
    resetAllGameStores();
    useGeneratorStore.setState({ generators: [makeOwnedGenerator("intern", 40)] });
    const clear = useGeneratorStore.getState().getMoneyPerSecond();
    useSlopPitStore.setState({ fill: 100 });
    const full = useGeneratorStore.getState().getMoneyPerSecond();
    expect(full).toBeCloseTo(clear * useSlopPitStore.getState().getMoneyPenaltyMult(), 6);
    const before = useMoneyStore.getState().money.toNumber();
    const tick = jest.advanceTimersByTime.bind(jest);
    for (let k = 0; k < 20; k++) advanceGameplayOneSecond(tick);
    const earned = useMoneyStore.getState().money.toNumber() - before;
    expect(earned / 20).toBeGreaterThan(full * 0.8);
    expect(earned / 20).toBeLessThan(full * 1.2);
  });
});
