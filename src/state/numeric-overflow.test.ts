import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";
import { neetMoneyMult } from "../game/founders.catalog";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import { makeOwnedGenerator } from "../simulation/store-fixtures";
import { useFounderStore } from "./founder.store";
import { useGeneratorStore } from "./generators.store";
import { useInnovationStore } from "./innovation.store";
import { useMoneyStore } from "./money.store";
import { useValuationStore } from "./valuation.store";

const finite = (d: Decimal) =>
  Number.isFinite(d.mantissa) && Number.isFinite(d.exponent);

beforeEach(() => resetAllGameStores());

describe("numeric overflow cannot corrupt a save", () => {
  test("stores refuse non-finite amounts", () => {
    useMoneyStore.getState().increaseMoney(Infinity);
    useInnovationStore.getState().increaseInnovation(Infinity);
    useValuationStore.getState().increaseValuation(Infinity);
    useValuationStore.getState().increaseValuation(NaN);

    expect(useMoneyStore.getState().money.toNumber()).toBe(0);
    expect(useInnovationStore.getState().innovation.toNumber()).toBe(0);
    expect(useValuationStore.getState().accruedThisRun.toNumber()).toBe(0);
    expect(finite(useValuationStore.getState().accruedThisRun)).toBe(true);
  });

  test("Decimal amounts beyond the native ceiling are kept intact", () => {
    // Previously this round-tripped through `.toNumber()` and became Infinity.
    useMoneyStore.getState().increaseMoney(new Decimal("1e400"));
    const money = useMoneyStore.getState().money;
    expect(finite(money)).toBe(true);
    expect(money.gt(new Decimal("1e399"))).toBe(true);
  });

  test("NEET's 2^exits multiplier never overflows to Infinity", () => {
    expect(neetMoneyMult(3)).toBe(8); // unchanged in normal play
    expect(Number.isFinite(neetMoneyMult(1024))).toBe(true);
    expect(Number.isFinite(neetMoneyMult(100_000))).toBe(true);
  });

  test("accrual survives a multiplier chain past the native ceiling", () => {
    useGeneratorStore.setState({
      generators: [makeOwnedGenerator("intern", 1000)],
    });
    // Large enough that the full money chain exceeds a double.
    useFounderStore.setState({ globalMoneyMult: 1e308 });

    const decimalMps = useGeneratorStore.getState().getMoneyPerSecondDecimal();
    const nativeMps = useGeneratorStore.getState().getMoneyPerSecond();

    // The Decimal source of truth holds it; the native view saturates.
    expect(finite(decimalMps)).toBe(true);
    expect(decimalMps.gt(new Decimal("1e308"))).toBe(true);
    expect(Number.isFinite(nativeMps)).toBe(false);

    // Accrual must still be finite and positive — this is what used to poison
    // accruedThisRun (and the Equity payout derived from it).
    const gain = useGeneratorStore.getState().getValuationPerSecondDecimal();
    expect(finite(gain)).toBe(true);
    expect(gain.gt(0)).toBe(true);

    useValuationStore.getState().increaseValuation(gain);
    const accrued = useValuationStore.getState().accruedThisRun;
    expect(finite(accrued)).toBe(true);
    expect(accrued.gt(0)).toBe(true);
  });
});
