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
import { useGeneratorStore } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
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
  for (const [id, n] of Object.entries(BIGTOWN_STAFF)) useGeneratorStore.getState().increaseGenerator(id as never, n);
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

export function seedFixtureCompany(): void {
  if (startFixture() === "bigtown") { seedBigTown(); return; }
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
