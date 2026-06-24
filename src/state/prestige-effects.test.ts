import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";
import {
  resolvePrestigeModifiers,
  SKILL_TREE,
  type BonusStat,
  type KeystoneSpecial,
} from "../game/skill-tree";
import { equityForAccrued } from "../game/acquisition";
import { getManagerEconomyMultipliers } from "../game/economy-multipliers";
import { getGeneratorCost } from "../utils/generator-utils";
import { resetRunStores } from "../simulation/reset-game-stores";
import { useAiSingularityStore } from "./ai-singularity.store";
import { useGeneratorStore } from "./generators.store";
import { useInnovationStore } from "./innovation.store";
import { usePrestigeStore } from "./prestige.store";

const keystoneWith = (special: KeystoneSpecial) =>
  SKILL_TREE.nodes.find((n) => n.special === special)!;

/** Apply a node's modifiers directly (bypasses allocation rules — we're testing
 * the economic effect at the chokepoints, not the allocation gating). */
const applyNodes = (ids: string[]) =>
  usePrestigeStore.setState({
    allocated: ids,
    modifiers: resolvePrestigeModifiers(ids),
  });

/** A node whose grants include a positive `pct` for `stat` (largest first). */
const biggestPctNode = (stat: BonusStat) =>
  SKILL_TREE.nodes
    .filter((n) => n.grants?.some((g) => g.stat === stat && g.kind === "pct"))
    .sort(
      (a, b) =>
        (b.grants!.find((g) => g.stat === stat)!.value) -
        (a.grants!.find((g) => g.stat === stat)!.value),
    )[0];

describe("prestige modifiers are wired to the economy", () => {
  beforeEach(() => {
    // Clean slate each test, free of cross-file leaks (a leaked founder could
    // restrict the roster; leaked generator/innovation state could skew numbers).
    // Neutral modifiers FIRST so the run reset doesn't grant Acqui-hire levels.
    applyNodes([]);
    resetRunStores();
  });

  test("a money node raises a generator's $/sec", () => {
    const gid = useGeneratorStore.getState().generators[0].id;
    const base = useGeneratorStore.getState().getGeneratorMoneyPerSecond(gid, 10);
    expect(base).toBeGreaterThan(0);

    applyNodes([biggestPctNode("money").id]);
    const boosted = useGeneratorStore.getState().getGeneratorMoneyPerSecond(gid, 10);
    expect(boosted).toBeGreaterThan(base);
  });

  test("an innovation node raises a generator's innovation/sec", () => {
    const gid = useGeneratorStore.getState().generators[0].id;
    const base = useGeneratorStore
      .getState()
      .getGeneratorInnovationPerSecond(gid, 10);
    applyNodes([biggestPctNode("innovation").id]);
    const boosted = useGeneratorStore
      .getState()
      .getGeneratorInnovationPerSecond(gid, 10);
    if (base > 0) expect(boosted).toBeGreaterThan(base);
  });

  test("a hire-cost node makes a generator cheaper", () => {
    const gid = useGeneratorStore.getState().generators[0].id;
    const base = getGeneratorCost(gid, 1);
    const cheaper = SKILL_TREE.nodes.find((n) =>
      n.grants?.some((g) => g.stat === "hireCost" && g.value < 0),
    )!;
    applyNodes([cheaper.id]);
    expect(getGeneratorCost(gid, 1).lt(base)).toBe(true);
  });

  test("an equity node increases the acquisition payout", () => {
    const accrued = new Decimal(1_000_000);
    const base = equityForAccrued(accrued);
    applyNodes([biggestPctNode("equity").id]);
    expect(equityForAccrued(accrued).gte(base)).toBe(true);
    // the biggest single equity node is the +25% notable → strictly more here
    expect(equityForAccrued(accrued).gt(base)).toBe(true);
  });

  test("AGI-Pilled cripples intern output", () => {
    const gid = "intern";
    const base = useGeneratorStore.getState().getGeneratorMoneyPerSecond(gid, 10);
    expect(base).toBeGreaterThan(0);
    applyNodes([keystoneWith("internsCrippled").id]);
    const crippled = useGeneratorStore.getState().getGeneratorMoneyPerSecond(gid, 10);
    expect(crippled).toBeLessThan(base);
  });

  test("Permanent Acqui-hire grants free intern levels on a run reset", () => {
    applyNodes([keystoneWith("freeStartingLevels").id]);
    resetRunStores(); // simulate starting a new company (prestige preserved)
    const intern = useGeneratorStore.getState().generators.find((g) => g.id === "intern")!;
    expect(intern.amount).toBeGreaterThan(0);
    // cleanup: clear the keystone and the granted levels for later tests/files
    applyNodes([]);
    resetRunStores();
    expect(
      useGeneratorStore.getState().generators.find((g) => g.id === "intern")!.amount,
    ).toBe(0);
  });

  test("Enshittify halves positive satisfaction; Crunch zeroes it; penalties kept", () => {
    const eff = (id: "intern" | "vibe_coder") =>
      useGeneratorStore.getState().getEffectiveSatisfaction(id);
    useGeneratorStore.setState({
      satisfactionScores: { intern: 80, vibe_coder: -40, "10x_dev": 0 },
    });

    applyNodes([]); // baseline
    expect(eff("intern")).toBe(80);

    applyNodes([keystoneWith("dampSatisfaction").id]); // Enshittify
    expect(eff("intern")).toBe(40); // +80 bonus halved
    expect(eff("vibe_coder")).toBe(-40); // penalty untouched

    applyNodes([keystoneWith("neutralizeSatisfaction").id]); // Crunch Mode
    expect(eff("intern")).toBe(0);
    expect(eff("vibe_coder")).toBe(0);
  });

  test("a valuation node raises valuation/sec", () => {
    const base = useGeneratorStore.getState().getValuationPerSecond();
    applyNodes([biggestPctNode("valuation").id]);
    expect(useGeneratorStore.getState().getValuationPerSecond()).toBeGreaterThan(base);
  });

  test("an employee-output node raises a generator's $/sec", () => {
    const base = useGeneratorStore.getState().getGeneratorMoneyPerSecond("intern", 10);
    applyNodes([biggestPctNode("employeeOutput").id]);
    expect(
      useGeneratorStore.getState().getGeneratorMoneyPerSecond("intern", 10),
    ).toBeGreaterThan(base);
  });

  test("a headcount node scales $/sec with owned employees", () => {
    useGeneratorStore.setState((s) => ({
      generators: s.generators.map((g) =>
        g.id === "intern" ? { ...g, amount: 50 } : g,
      ),
    }));
    const base = useGeneratorStore.getState().getGeneratorMoneyPerSecond("intern", 10);
    applyNodes([biggestPctNode("headcount").id]);
    expect(
      useGeneratorStore.getState().getGeneratorMoneyPerSecond("intern", 10),
    ).toBeGreaterThan(base);
  });

  test("an automation node raises the auto-buy rate", () => {
    useGeneratorStore.setState((s) => ({
      employeeManagement: {
        ...s.employeeManagement,
        perks: {
          ...s.employeeManagement.perks,
          intern: { ...s.employeeManagement.perks.intern, autoBuyLevel: 3 },
        },
      },
    }));
    const base = useGeneratorStore.getState().getAutoBuyRate("intern");
    expect(base).toBeGreaterThan(0);
    applyNodes([biggestPctNode("autoBuy").id]);
    expect(useGeneratorStore.getState().getAutoBuyRate("intern")).toBeGreaterThan(base);
  });

  test("a singularity node speeds AI-singularity accrual", () => {
    const run = () => {
      useAiSingularityStore.setState({ value: 0 });
      useAiSingularityStore.getState().tick(1, -100, true);
      return useAiSingularityStore.getState().value;
    };
    applyNodes([]);
    const base = run();
    expect(base).toBeGreaterThan(0);
    applyNodes([biggestPctNode("singularity").id]);
    expect(run()).toBeGreaterThan(base);
  });

  test("a manager-speed node accrues manager progress faster", () => {
    useInnovationStore.setState((s) => ({
      unlocks: { ...s.unlocks, managers: { ...s.unlocks.managers!, unlocked: true } },
      managers: {
        ...s.managers,
        agile: { ...s.managers.agile, assignment: new Decimal(1) },
      },
    }));
    const runOnce = () => {
      useInnovationStore.setState((s) => ({
        globalLastTick: Date.now() - 300, // > one MANGER_TICK_INTERVAL (200ms)
        managers: {
          ...s.managers,
          agile: { ...s.managers.agile, progress: new Decimal(0) },
        },
      }));
      useInnovationStore.getState().tickManagers();
      return useInnovationStore.getState().managers.agile.progress.toNumber();
    };
    applyNodes([]);
    const base = runOnce();
    expect(base).toBeGreaterThan(0);
    applyNodes([biggestPctNode("managerSpeed").id]);
    expect(runOnce()).toBeGreaterThan(base);
  });

  test("996's satisfaction-gain penalty slows satisfaction growth", () => {
    useInnovationStore.setState((s) => ({
      unlocks: {
        ...s.unlocks,
        employeeManagement: { ...s.unlocks.employeeManagement!, unlocked: true },
      },
    }));
    const stepOnce = () => {
      useGeneratorStore.setState((s) => ({
        satisfactionScores: { intern: 0, vibe_coder: 0, "10x_dev": 0 },
        globalLastTick: Date.now() - 1000,
        employeeManagement: {
          ...s.employeeManagement,
          perks: {
            ...s.employeeManagement.perks,
            // high innovation perk → a strongly positive satisfaction target
            intern: { ...s.employeeManagement.perks.intern, innovationLevel: 10 },
          },
        },
      }));
      useGeneratorStore.getState().tickGenerators();
      return useGeneratorStore.getState().satisfactionScores.intern;
    };
    applyNodes([]);
    const base = stepOnce();
    expect(base).toBeGreaterThan(0);
    applyNodes([biggestPctNode("satisfactionGain").id]); // 996
    expect(stepOnce()).toBeLessThan(base);
  });

  test("Bootstrapped neutralises active manager multipliers", () => {
    useInnovationStore.setState((s) => ({
      unlocks: { ...s.unlocks, managers: { ...s.unlocks.managers!, unlocked: true } },
      managers: {
        ...s.managers,
        agile: { ...s.managers.agile, bonusMultiplier: new Decimal(2) },
      },
    }));
    applyNodes([]);
    expect(getManagerEconomyMultipliers().innovationIncome).toBeCloseTo(2);
    applyNodes([keystoneWith("disableManagers").id]);
    const m = getManagerEconomyMultipliers();
    expect(m.innovationIncome).toBe(1);
    expect(m.employeeMoney).toBe(1);
    expect(m.salesValuation).toBe(1);
  });

  test("nothing allocated leaves the economy untouched", () => {
    const gid = useGeneratorStore.getState().generators[0].id;
    applyNodes([]);
    const a = useGeneratorStore.getState().getGeneratorMoneyPerSecond(gid, 10);
    const costA = getGeneratorCost(gid, 1);
    // re-apply empty (idempotent neutral)
    applyNodes([]);
    expect(useGeneratorStore.getState().getGeneratorMoneyPerSecond(gid, 10)).toBe(a);
    expect(getGeneratorCost(gid, 1).eq(costA)).toBe(true);
  });
});
