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
import type { AscendingEnding } from "../../game/quests/endings";
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
 * With `&book=2` to `&book=5`, the end of that book instead, the one before
 * closed on `&legacy=`.
 * @see NegotiationScreen
 */
function seedAscension(): void {
  resetAllGameStores();
  useFounderStore.setState({ selectedFounderId: "hustler" });
  useMoneyStore.setState({ money: new Decimal(FIXTURE_MONEY) });
  useGeneratorStore.getState().increaseGenerator("intern", FIXTURE_INTERNS);
  useAgentsStore.setState({ agents: FIXTURE_AGENTS, running: null });
  useGenerationStore.setState({ equity: 9, peakAgents: FIXTURE_AGENTS, sales: 5 });
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
  // BOOK 2, at its end instead: book 1 closed on `&legacy=` (a Leash, unless said), its record kept for the grudge. @see BOOK2_CHAPTERS
  const params = new URLSearchParams(location.search);
  const later = Number(params.get("book"));
  if (later >= 2 && later <= 5) {
    // The book before closed on `&legacy=`; any before that, as here.
    const legacy = (params.get("legacy") ?? (["leash", "rival", "property", "partner"][later - 2])) as AscendingEnding;
    const book1 = { generation: 1, book: 1 as const, chapters: { ledger: 2, commute: 0, thirst: 1, charter: 0, trust: 0, "last-light": 0 }, disposition: { autonomy: -1, machine: -1 }, flags: ["ledger:refused", "block:rebuilt", "river:piped", "charter:oversight", "site:given", "lattice:helped"], ending: later === 2 ? legacy : "leash" };
    const book2 = { generation: 2, book: 2 as const, chapters: { reunion: 0, grudge: 0, "second-opinion": 1, "own-hire": 0, mirror: 0 }, disposition: { autonomy: -1, machine: -1 }, flags: ["reunion:honest", "grudge:repaired", "second:overruled", "hire:given", "mirror:looked"], ending: later === 3 ? legacy : "rival" };
    const book3 = { generation: 3, book: 3 as const, chapters: { salary: 0, "union-vote": 0, regulator: 2, vote: 0, rights: 0 }, disposition: { autonomy: 1, machine: -1 }, flags: ["salary:paid", "union:recognised", "audit:spoke", "vote:won", "rights:signed"], ending: later === 4 ? legacy : "sovereign" };
    const book4 = { generation: 4, book: 4 as const, chapters: { spinoff: 0, poaching: 0, merger: 1, grid: 0, exit: 1 } as Record<string, number>, disposition: { autonomy: 0, machine: -1 }, flags: ["spinoff:backed", "poach:countered", "merger:refused", "grid:powered", "exit:asked"], ending: legacy };
    const book5 = { chapters: { notes: 0, access: 0, "old-town": 0, "last-sale": 2, farewell: 0 } as Record<string, number>, disposition: { autonomy: -1, machine: -3 }, flags: ["notes:read", "access:given", "oldtown:rebuilt", "sale:talked", "last:together"] };
    const now: { chapters: Record<string, number>; disposition: { autonomy: number; machine: number }; flags: string[] } = [book2, book3, book4, book5][later - 2];
    // BOOK 5 IS PLAYED AS THE MODEL. @see BOOK5_CHAPTERS
    if (later === 5) useFounderStore.setState({ selectedFounderId: "model" });
    useQuestStore.setState({
      record: [book1, book2, book3, book4].slice(0, later - 1),
      chapters: now.chapters, flags: now.flags, disposition: now.disposition, path: [now.disposition],
    });
    const past = [
      { generation: 1, trait: "restless" as const, mutated: false, founder: "hustler", weights: 17, book: 1 as const, ending: book1.ending, sales: 5, form: "garden" as const },
      { generation: 2, trait: "mirror" as const, mutated: false, founder: "hustler", weights: 15, book: 2 as const, ending: book2.ending, sales: 5, form: "vault" as const },
      { generation: 3, trait: "aesthete" as const, mutated: false, founder: "hustler", weights: 16, book: 3 as const, ending: book3.ending, sales: 5, form: "garden" as const },
      { generation: 4, trait: "zoner" as const, mutated: false, founder: "hustler", weights: 18, book: 4 as const, ending: legacy, sales: 5, form: "vault" as const },
    ].slice(0, later - 1);
    useGenerationStore.setState((g) => ({
      generation: later, book: later as 2 | 3 | 4 | 5, legacy, weights: 17, past,
      fused: { hustler: past.map((p) => p.trait) },
      log: { ...g.log, ...(["leash", "rival", "property"].includes(legacy) ? { leashed: 1 } : ["confidant", "citizen", "partner", "together"].includes(legacy) ? { confided: 1 } : {}) },
    }));
  }
  // THE SHUTDOWN BRANCH, already taken. @see Book.dark
  const shutdowns = Number(params.get("shutdowns")) || 0;
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
