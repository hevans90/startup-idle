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

describe("the tab's features, opened by projects", () => {
  beforeEach(() => {
    localStorage.clear();
    useInnovationStore.getState().reset();
  });

  test("the HQ opens managers and employee management together; other grants open nothing here", () => {
    const s = () => useInnovationStore.getState();
    s().grantFeatures("services");
    s().grantFeatures(undefined);
    expect(s().unlocks.managers.unlocked).toBe(false);
    s().grantFeatures("managers");
    expect(s().unlocks.managers.unlocked).toBe(true);
    expect(s().unlocks.employeeManagement.unlocked).toBe(true);
    expect(s().innovation.toNumber()).toBe(0);
  });

  test("an old save is refunded what it paid, once, and keeps what it opened", async () => {
    const dec = (n: number) => ({ type: "decimal", mantissa: n, exponent: 0 });
    localStorage.setItem("innovation", JSON.stringify({
      state: {
        innovation: { type: "decimal", mantissa: 1, exponent: 1 },
        unlocks: { managers: { unlocked: true, cost: dec(1) }, employeeManagement: { unlocked: false, cost: dec(5) } },
      },
      version: 0,
    }));
    await useInnovationStore.persist.rehydrate();
    const s = useInnovationStore.getState();
    // 10 had, plus the 1 paid for managers; employee management was never bought.
    expect(s.innovation.toNumber()).toBeCloseTo(11);
    expect(s.unlocks.managers).toEqual({ unlocked: true, cost: new Decimal(0) });
    expect(s.unlocks.employeeManagement.unlocked).toBe(false);
  });
});
