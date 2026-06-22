import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";
import { useInnovationStore } from "./innovation.store";

/** Write a raw localStorage payload and rehydrate the store from it. */
async function hydrateWith(innovationValue: unknown) {
  localStorage.setItem(
    "innovation",
    JSON.stringify({
      state: { innovation: innovationValue },
      version: 0,
    }),
  );
  await useInnovationStore.persist.rehydrate();
}

describe("innovation store hydration is crash-proof", () => {
  beforeEach(() => {
    localStorage.clear();
    useInnovationStore.setState({ innovation: new Decimal(0) });
  });

  test("a properly-tagged Decimal still rehydrates", async () => {
    await hydrateWith({ type: "decimal", mantissa: 4.2, exponent: 1 });
    const innovation = useInnovationStore.getState().innovation;
    expect(innovation).toBeInstanceOf(Decimal);
    expect(innovation.toNumber()).toBeCloseTo(42, 5);
  });

  test("a legacy raw number is coerced (was: n.add is not a function)", async () => {
    await hydrateWith(42);
    const innovation = useInnovationStore.getState().innovation;
    expect(innovation).toBeInstanceOf(Decimal);
    expect(innovation.toNumber()).toBe(42);
    // The exact crash site no longer throws.
    expect(() => useInnovationStore.getState().getMultiplier()).not.toThrow();
  });

  test("a {mantissa,exponent} missing the type tag is coerced", async () => {
    await hydrateWith({ mantissa: 1, exponent: 3 });
    const innovation = useInnovationStore.getState().innovation;
    expect(innovation).toBeInstanceOf(Decimal);
    expect(innovation.toNumber()).toBe(1000);
  });

  test("garbage falls back to 0 rather than crashing", async () => {
    await hydrateWith("totally not a number");
    expect(useInnovationStore.getState().innovation).toBeInstanceOf(Decimal);
    expect(() => useInnovationStore.getState().getMultiplier()).not.toThrow();
  });
});
