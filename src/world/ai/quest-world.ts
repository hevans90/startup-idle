/**
 * World v2 — WHAT THE ARC SEES: the map and the company as its objectives
 * measure them, once a second. And the family odds its requests lean by, read
 * from the trait the AI is becoming. @see state/quest.store, game/quests
 */
import type { QuestWorld } from "../../game/quests/objectives";
import { isDrinker } from "../../game/cooling";
import { TRAITS, traitForecast, type Family } from "../../game/traits";
import { runningAgents, useAgentsStore } from "../../state/agents.store";
import { stagesNow, useAiSingularityStore, type Stage } from "../../state/ai-singularity.store";
import { useGenerationStore } from "../../state/generation.store";
import { setFamilyLean, useQuestStore } from "../../state/quest.store";
import type { Grid } from "../grid";
import { tankFor } from "../projects/cooling";
import { SHORT } from "./cooling-ai";

export function questWorld(g: Grid): QuestWorld {
  const counts: Record<string, number> = {};
  let drinkers = 0, met = 0, dc = 0;
  for (const s of g.structures.values()) {
    if (s.build) continue;
    counts[s.def] = (counts[s.def] ?? 0) + 1;
    if (!isDrinker(s.def)) continue;
    const share = tankFor(s.id)?.share ?? 0;
    drinkers++;
    if (share >= SHORT) met++;
    if (s.def === "datacentre") dc = Math.max(dc, share);
  }
  const q = useQuestStore.getState();
  return {
    meter: useAiSingularityStore.getState().value,
    stageFrom: Object.fromEntries(stagesNow().map((s) => [s.stage, s.from])) as Record<Stage, number>,
    agents: useAgentsStore.getState().agents,
    running: runningAgents(),
    dcCooled: dc,
    covered: drinkers ? met / drinkers : 1,
    counts,
    block: !!q.block,
    keep: q.keep !== null,
    site: !!q.site,
  };
}

// THE REQUESTS' LEAN: each family's odds of being what the AI becomes.
setFamilyLean(() => {
  const out: Partial<Record<Family, number>> = {};
  for (const { trait, odds } of traitForecast(useGenerationStore.getState().log, TRAITS.length)) out[trait.family] = (out[trait.family] ?? 0) + odds;
  return out;
});
