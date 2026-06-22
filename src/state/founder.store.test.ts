import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";
import { FOUNDERS } from "../game/founders.catalog";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import { getGeneratorCost } from "../utils/generator-utils";
import { useFounderStore } from "./founder.store";
import { useGeneratorStore } from "./generators.store";
import { useInnovationStore } from "./innovation.store";
import { useMoneyStore } from "./money.store";

const setInternAmount = (n: number) =>
  useGeneratorStore.setState((s) => ({
    generators: s.generators.map((g) =>
      g.id === "intern" ? { ...g, amount: n } : g,
    ),
  }));

beforeEach(() => resetAllGameStores());

describe("founder.store", () => {
  test("chooseFounder sets id + modifiers and grants starting cash", () => {
    const hustler = FOUNDERS.find((f) => f.id === "hustler")!;
    useFounderStore.getState().chooseFounder("hustler");

    expect(useFounderStore.getState().selectedFounderId).toBe("hustler");
    expect(useFounderStore.getState().headcountMoneyPerEmployee).toBe(
      hustler.modifiers.headcountMoneyPerEmployee,
    );
    expect(useMoneyStore.getState().money.toNumber()).toBe(hustler.startingCash);
  });

  test("reset clears the founder and restores neutral modifiers", () => {
    useFounderStore.getState().chooseFounder("hacker");
    useFounderStore.getState().reset();
    expect(useFounderStore.getState().selectedFounderId).toBeNull();
    expect(useFounderStore.getState().innovationLogMult).toBe(1);
  });

  test("unknown id is a no-op", () => {
    useFounderStore.getState().chooseFounder("nope");
    expect(useFounderStore.getState().selectedFounderId).toBeNull();
    expect(useMoneyStore.getState().money.toNumber()).toBe(0);
  });

  // --- the point of the redesign: bonuses are GRADUAL, not flat/front-loaded ---

  test("Hacker: innovation multiplier matches baseline at 0 but pulls ahead as it accrues", () => {
    useInnovationStore.setState({ innovation: new Decimal(1e6) });
    const baseline = useInnovationStore.getState().getMultiplier().toNumber();

    useFounderStore.getState().chooseFounder("hacker");
    const boosted = useInnovationStore.getState().getMultiplier().toNumber();
    expect(boosted).toBeGreaterThan(baseline);

    useInnovationStore.setState({ innovation: new Decimal(0) });
    expect(useInnovationStore.getState().getMultiplier().toNumber()).toBeCloseTo(1);
  });

  test("Bootstrapper: 1st hire ~unchanged, but deep hires get cheaper", () => {
    const baseFirst = getGeneratorCost("intern", 1).toNumber();
    setInternAmount(100);
    const baseDeep = getGeneratorCost("intern", 1).toNumber();

    resetAllGameStores();
    useFounderStore.getState().chooseFounder("bootstrapper");
    const founderFirst = getGeneratorCost("intern", 1).toNumber();
    setInternAmount(100);
    const founderDeep = getGeneratorCost("intern", 1).toNumber();

    expect(founderFirst).toBeCloseTo(baseFirst); // exponent^0 = 1: no early effect
    expect(founderDeep).toBeLessThan(baseDeep); // compounds at scale
  });

  test("Hustler: $/sec gap over baseline widens with headcount", () => {
    setInternAmount(100);
    const baseline = useGeneratorStore.getState().getMoneyPerSecond();

    resetAllGameStores();
    useFounderStore.getState().chooseFounder("hustler");
    setInternAmount(100);
    const boosted = useGeneratorStore.getState().getMoneyPerSecond();

    expect(boosted).toBeGreaterThan(baseline);
    expect(boosted / baseline).toBeCloseTo(1.4, 1); // +0.4%/employee × 100
  });
});
