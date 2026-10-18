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

export const FIXTURE_MONEY = 1e6;
export const FIXTURE_INTERNS = 40;
export const FIXTURE_AGENTS = 16;
export const FIXTURE_METER = 45;

export function seedFixtureCompany(): void {
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
