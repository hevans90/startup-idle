/**
 * THE `singularity` FIXTURE, PLAYED: opened in the game rather than the editor
 * (`/?fixture=singularity`), a fresh company as The Model of the second
 * generation, leaning the way the first ended, with money to build with,
 * interns to house, AI agents in the racks and the singularity at Colleague
 * — so the Data Centre's control room and AI mode can be tried at once.
 * Only ever in a fixture session, whose storage is a copy in memory: none of
 * this reaches the save. @see fixture-sandbox, buildSingularity
 */
import Decimal from "break_infinity.js";

import { achievementsNewlyMet, buildAchievementContext } from "../../game/achievements.engine";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useVapeAchievementsStore } from "../../state/vape-achievements.store";
import { useAgentsStore } from "../../state/agents.store";
import { useAiSingularityStore } from "../../state/ai-singularity.store";
import { useFounderStore } from "../../state/founder.store";
import { useGenerationStore } from "../../state/generation.store";
import { GENERATOR_TYPES, useGeneratorStore } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useQuestStore } from "../../state/quest.store";
import { startFixture } from "../../state/world.store";
import { setTownCaps } from "../agents/town";

/** The `bigtown` stress scene's people: enough to fill its houses. @see buildBigTown */
export const BIGTOWN_STAFF = { intern: 20_000, vibe_coder: 9_000, "10x_dev": 4_000 } as const;
/** Cars and people with `?crowd` and no number. */
export const CROWD_DEFAULT = 2000;

/**
 * THE `bigtown` FIXTURE, PLAYED: a company with the money and the people for a
 * town of two thousand buildings, every house full; and with `?crowd=N`, the
 * town's caps on cars and people raised to N between them, setting off fast.
 */
function seedBigTown(): void {
  resetAllGameStores();
  useFounderStore.setState({ selectedFounderId: "model" });
  useMoneyStore.setState({ money: new Decimal(1e12) });
  // ON THE ROSTER FIRST: hiring only adds to a kind already listed, and the
  // vibe coders wait on their studio's project — taken on, they stay listed.
  for (const [id, n] of Object.entries(BIGTOWN_STAFF)) {
    const base = GENERATOR_TYPES.find((g) => g.id === id)!;
    useGeneratorStore.getState().addGenerator({ ...base, amount: 0, multiplier: 1, costMultiplier: 1, innovationMultiplier: 1, lastTick: Date.now() });
    useGeneratorStore.getState().increaseGenerator(id, n);
  }
  const crowd = new URLSearchParams(location.search).get("crowd");
  if (crowd !== null) {
    const n = Number(crowd) || CROWD_DEFAULT;
    setTownCaps({ cars: Math.round(n / 2), people: Math.round(n / 2), every: 40 });
  }
}

export const FIXTURE_MONEY = 1e6;
export const FIXTURE_INTERNS = 40;
export const FIXTURE_AGENTS = 16;
export const FIXTURE_METER = 45;

/**
 * THE `ascension` FIXTURE, PLAYED: the first generation at the end of book 1 —
 * every chapter answered down the middle, two culture cards slotted, the
 * Lattice built and the meter full — so the whole Ascension can be played
 * from the map's sequence, through the card and the negotiation, to the
 * founders. With `&shutdowns=N`, shut down N times already and Cold Start
 * answered with an apology: Contain on the card, its grievances in the talk.
 * @see NegotiationScreen
 */
function seedAscension(): void {
  resetAllGameStores();
  useFounderStore.setState({ selectedFounderId: "hustler" });
  useMoneyStore.setState({ money: new Decimal(FIXTURE_MONEY) });
  useGeneratorStore.getState().increaseGenerator("intern", FIXTURE_INTERNS);
  useAgentsStore.setState({ agents: FIXTURE_AGENTS, running: null });
  useGenerationStore.setState({ equity: 9, peakAgents: FIXTURE_AGENTS });
  useQuestStore.setState({
    chapters: { ledger: 1, commute: 0, thirst: 1, charter: 1, trust: 0, "last-light": 0 },
    flags: ["ledger:logged", "block:rebuilt", "river:piped", "charter:partnership", "site:given", "lattice:helped"],
    disposition: { autonomy: 0, machine: -1 },
    path: [{ autonomy: -1, machine: 0 }, { autonomy: 0, machine: -1 }, { autonomy: -1, machine: -2 }, { autonomy: 0, machine: -2 }, { autonomy: 1, machine: -1 }, { autonomy: 0, machine: -1 }],
    latticeForm: "garden",
  });
  useGeneratorStore.setState((s) => ({
    employeeManagement: { ...s.employeeManagement, deck: { ...s.employeeManagement.deck, slots: 2, ranks: { crunch: 1, redteam: 1 }, slotted: ["crunch", "redteam"] } },
  }));
  // THE SHUTDOWN BRANCH, already taken. @see Book.dark
  const shutdowns = Number(new URLSearchParams(location.search).get("shutdowns")) || 0;
  if (shutdowns > 0) {
    useGenerationStore.setState((g) => ({ log: { ...g.log, shutdowns } }));
    useQuestStore.setState((q) => ({ chapters: { ...q.chapters, "cold-start": 0 }, flags: [...q.flags, "dark:apologised"] }));
  }
  useAiSingularityStore.setState({ value: 100 });
  const had = useVapeAchievementsStore.getState().unlockedAchievementIds;
  const met = achievementsNewlyMet(buildAchievementContext(), new Set(had)).map((a) => a.id);
  useVapeAchievementsStore.setState({ unlockedAchievementIds: [...had, ...met] });
}

export function seedFixtureCompany(): void {
  if (startFixture() === "bigtown") { seedBigTown(); return; }
  if (startFixture() === "ascension") { seedAscension(); return; }
  if (startFixture() !== "singularity") return;
  resetAllGameStores();
  useGenerationStore.setState({
    generation: 2,
    past: [{ generation: 1, trait: "aesthete", mutated: false, founder: "hustler", weights: 0 }],
  });
  useFounderStore.setState({ selectedFounderId: "model" });
  useMoneyStore.setState({ money: new Decimal(FIXTURE_MONEY) });
  useGeneratorStore.getState().increaseGenerator("intern", FIXTURE_INTERNS);
  useAgentsStore.setState({ agents: FIXTURE_AGENTS, running: null });
  useAiSingularityStore.setState({ value: FIXTURE_METER });
  // What the seeding itself earned, marked earned quietly: no wall of toasts over the map.
  const had = useVapeAchievementsStore.getState().unlockedAchievementIds;
  const met = achievementsNewlyMet(buildAchievementContext(), new Set(had)).map((a) => a.id);
  useVapeAchievementsStore.setState({ unlockedAchievementIds: [...had, ...met] });
}
