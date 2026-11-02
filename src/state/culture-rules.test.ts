import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";

import { agentBonus, agentCost, agentsARack } from "../game/agents";
import { ascensionWeights, inheritTrait, shutDown } from "../game/ascension";
import { emptyDeck, FREEZE_HALVES, HAPPY_AT, SURGE_SECONDS, type CardId } from "../game/culture";
import { setSlopSpilling } from "../game/slop";
import { resetRunStores } from "../simulation/reset-game-stores";
import { DAY_SECONDS } from "../world/daylight";
import { useAgentsStore } from "./agents.store";
import { singularityMult } from "./ai-singularity.store";
import { useGenerationStore } from "./generation.store";
import { GENERATOR_TYPES, useGeneratorStore, type GeneratorId } from "./generators.store";
import { useTrainingStore } from "./training.store";

/** These cards slotted, at these ranks. */
const slot = (cards: Partial<Record<CardId, number>>) =>
  useGeneratorStore.setState((s) => ({
    employeeManagement: { ...s.employeeManagement, deck: { ...emptyDeck(), slots: 9, ranks: cards, slotted: Object.keys(cards) as CardId[] } },
  }));
const g = () => useGeneratorStore.getState();
/** `amount` of a kind on the payroll, hired or not before. */
const own = (id: GeneratorId, amount: number) =>
  useGeneratorStore.setState((s) => {
    const had = s.generators.find((x) => x.id === id);
    const gen = { ...s.generators[0], ...GENERATOR_TYPES.find((x) => x.id === id)!, ...had, amount };
    return { generators: had ? s.generators.map((x) => (x.id === id ? gen : x)) : [...s.generators, gen] };
  });

/** A noon, and a midnight. */
const NOON = DAY_SECONDS * 1000 * 10.5, MIDNIGHT = DAY_SECONDS * 1000 * 10;

describe("the culture deck's rules, in the economy", () => {
  beforeEach(() => { resetRunStores(); setSlopSpilling(false); });
  afterEach(() => { setSystemTime(); setSlopSpilling(false); resetRunStores(); });

  test("Crunch Week's: money ×2 while it is light", () => {
    slot({ crunch: 3 });
    setSystemTime(NOON);
    const day = g().getEmployeeOutputMults("intern").money;
    setSystemTime(MIDNIGHT);
    expect(day / g().getEmployeeOutputMults("intern").money).toBeCloseTo(2, 9);
  });

  test("the Four-Day Week's: attendance ×1.5 while morale is over +20", () => {
    slot({ fourday: 3 });
    const sad = g().getEmployeeOutputMults("intern").money;
    useGeneratorStore.setState((s) => ({ satisfactionScores: { ...s.satisfactionScores, intern: HAPPY_AT + 1 } }));
    expect(g().getEmployeeOutputMults("intern").money / sad).toBeCloseTo(1.5, 9);
  });

  test("Mentorship's: interns earn what vibe coders do", () => {
    const before = g().getEmployeeOutputMults("intern").money;
    slot({ mentorship: 3 });
    expect(g().getEmployeeOutputMults("intern").money / before).toBeCloseTo(5, 9);
  });

  test("Hackathon Culture's and Vibes Only's: innovation for clean sewers, or for spills", () => {
    const base = g().getEmployeeOutputMults("vibe_coder").innovation;
    slot({ hackathon: 3, vibesonly: 3 });
    // Hackathon's own ×3 at rank 2, two Chaos's ×1.5, and a rule.
    expect(g().getEmployeeOutputMults("vibe_coder").innovation / base).toBeCloseTo(3 * 1.5 * 2, 9);
    setSlopSpilling(true);
    expect(g().getEmployeeOutputMults("vibe_coder").innovation / base).toBeCloseTo(3 * 1.5 * 3, 9);
  });

  test("Hire Freeze's: the price halves again every ten minutes it holds", () => {
    setSystemTime(1_000_000);
    slot({ freeze: 3 });
    expect(g().getEmployeeCostMult("intern")).toBeCloseTo(0.33, 9);
    setSystemTime(1_000_000 + FREEZE_HALVES * 2000);
    expect(g().getEmployeeCostMult("intern")).toBeCloseTo(0.33 / 4, 9);
    // Out of force, and back: from the start again.
    slot({ freeze: 2 });
    expect(g().getEmployeeCostMult("intern")).toBeCloseTo(0.33, 9);
  });

  test("Always Be Hiring's: auto-buy faster the more there are", () => {
    own("intern", 2000);
    slot({ pipeline: 2 });
    const r2 = g().getAutoBuyRate("intern");
    slot({ pipeline: 3 });
    expect(g().getAutoBuyRate("intern") - r2).toBeCloseTo(2 * (r2 / 3), 9);
  });

  test("Hire to Fire's: a vibe coder free with every ten interns", () => {
    own("intern", 1);
    own("vibe_coder", 0);
    slot({ hiretofire: 3 });
    g().increaseGenerator("intern", 25);
    expect(g().generators.find((x) => x.id === "vibe_coder")!.amount).toBe(2);
  });
});

describe("the AI families, in their systems", () => {
  beforeEach(() => resetRunStores());
  afterEach(() => { setSystemTime(); resetRunStores(); });

  test("Agentic: the agents' boost, a rack's agents, and the meter faster", () => {
    const boost = agentBonus(10) - 1, rack = agentsARack(), meter = singularityMult(), price = agentCost(3);
    slot({ autonomous: 2, swarm: 2 });
    // Autonomous's ×3 and the set of two's ×1.25; Swarm's +4 and the set's +1.
    expect((agentBonus(10) - 1) / boost).toBeCloseTo(3 * 1.25, 9);
    expect(agentsARack() - rack).toBe(4 + 1);
    expect(singularityMult() / meter).toBeCloseTo(1.5 * 1.5, 9);
    slot({ autonomous: 1, swarm: 1, selfimprove: 1 });
    expect(agentCost(3) / price).toBeCloseTo(0.5, 9);
  });

  test("Self-Improving: training faster, and a finished run a surge — every card a rank up, a while", () => {
    const run = useTrainingStore.getState().seconds();
    slot({ selfimprove: 3 });
    expect(run / useTrainingStore.getState().seconds()).toBeCloseTo(3, 9);
    g().surgeDeck(1000);
    expect(g().employeeManagement.deck.surgeUntil).toBe(1000 + SURGE_SECONDS * 1000);
  });

  test("Safety: the meter slower; Red Team keeps the agents through a shutdown, Kill Switch banks Weights", () => {
    const meter = singularityMult();
    slot({ redteam: 3, killswitch: 3 });
    expect(singularityMult() / meter).toBeCloseTo(0.4 * 0.8, 9); // Red Team's, and the set of two's
    useAgentsStore.setState({ agents: 7 });
    const weights = useGenerationStore.getState().weights, banked = Math.round(ascensionWeights() * 0.5);
    shutDown(0);
    expect(useAgentsStore.getState().agents).toBe(7);
    expect(useGenerationStore.getState().weights - weights).toBe(banked);
    // The dark: Kill Switch's none at rank 2, then halved by the set of two.
    expect(useAgentsStore.getState().darkUntil).toBe(0);
  });

  test("Constitution: no mutation at Ascension, and Weights the more", () => {
    useGenerationStore.setState({ equity: 1e12, peakAgents: 50 });
    const log = useGenerationStore.getState().log, weights = ascensionWeights();
    expect(inheritTrait(log, () => 0).mutated).toBe(true);
    slot({ constitution: 3 });
    expect(inheritTrait(log, () => 0).mutated).toBe(false);
    expect(ascensionWeights() / weights).toBeCloseTo(2, 1);
  });
});
