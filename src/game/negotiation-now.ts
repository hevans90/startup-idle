/**
 * THE NEGOTIATION'S TABLE, as the game stands: the book's flags and where it
 * left the AI, the culture in force, the town's facts, who the AI is
 * becoming, and the shutdowns it remembers. @see game/negotiation
 */
import { agentsAtWork } from "./agents";
import { tagCounts } from "./culture";
import type { Facts, TalkContext } from "./negotiation";
import { traitForecast } from "./traits";
import { useAgentsStore } from "../state/agents.store";
import { useGenerationStore } from "../state/generation.store";
import { useGeneratorStore } from "../state/generators.store";
import { useQuestStore } from "../state/quest.store";

/** The morale, on average, that makes "the people here are happy" true. */
export const HAPPY_FACT = 10;

/** What is true of the town now. */
export function factsNow(): Facts {
  const scores = Object.values(useGeneratorStore.getState().satisfactionScores);
  const morale = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const { agents } = useAgentsStore.getState();
  return {
    happy: morale >= HAPPY_FACT,
    cooled: useQuestStore.getState().dcCooled,
    racksLit: agents > 0 && agentsAtWork(agents).unpowered === 0,
  };
}

export function talkContextNow(): TalkContext {
  const q = useQuestStore.getState(), g = useGenerationStore.getState();
  return {
    disposition: q.disposition,
    flags: q.flags,
    tags: tagCounts(useGeneratorStore.getState().employeeManagement.deck),
    facts: factsNow(),
    trait: traitForecast(g.log, 1)[0].trait.id,
    shutdowns: g.log.shutdowns,
    leashed: g.log.leashed ?? 0,
    confided: g.log.confided ?? 0,
  };
}
