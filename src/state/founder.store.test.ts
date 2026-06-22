import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";
import { FOUNDERS } from "../game/founders.catalog";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import {
  getGeneratorCost,
  getUnlockedGeneratorIds,
} from "../utils/generator-utils";
import { useFounderStore } from "./founder.store";
import { useGeneratorStore } from "./generators.store";
import { useInnovationStore } from "./innovation.store";
import { useMoneyStore } from "./money.store";

const setAmount = (id: string, n: number) =>
  useGeneratorStore.setState((s) => ({
    generators: s.generators.map((g) =>
      g.id === id ? { ...g, amount: n } : g,
    ),
  }));
const setInternAmount = (n: number) => setAmount("intern", n);

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

  test("Hustler: $/sec advantage grows with headcount (gradual synergy)", () => {
    const mps = () => useGeneratorStore.getState().getMoneyPerSecond();
    setInternAmount(50);
    const base50 = mps();
    setInternAmount(200);
    const base200 = mps();

    resetAllGameStores();
    useFounderStore.getState().chooseFounder("hustler");
    setInternAmount(50);
    const ratio50 = mps() / base50;
    setInternAmount(200);
    const ratio200 = mps() / base200;

    expect(ratio200).toBeGreaterThan(ratio50); // headcount synergy widens the gap
  });

  test("Agentic Delusionist: only vibe coders buildable, ×3 vibe money", () => {
    useFounderStore.getState().chooseFounder("agentic_delusionist");
    // The Generators UI maps the store's `generators` array directly, so the
    // roster itself (not just getUnlockedGeneratorIds) must be vibe-only.
    expect(useGeneratorStore.getState().generators.map((g) => g.id)).toEqual([
      "vibe_coder",
    ]);
    expect(
      getUnlockedGeneratorIds(useGeneratorStore.getState().generators),
    ).toEqual(["vibe_coder"]);

    // 10 vibe coders × baseProduction 5 = 50 unbuffed; ×3 money + headcount → >150.
    setAmount("vibe_coder", 10);
    expect(useGeneratorStore.getState().getMoneyPerSecond()).toBeGreaterThan(150);
  });
});
