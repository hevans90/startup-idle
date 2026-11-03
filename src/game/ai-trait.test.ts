import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../simulation/reset-game-stores";
import { emptyLog, useGenerationStore } from "../state/generation.store";
import { setVoice, useQuestStore } from "../state/quest.store";
import type { QuestWorld } from "./quests/objectives";
import { BOOK1_VOICES, BOOK2_VOICES } from "./quests/voices";
import { BOOK2_CHAPTERS } from "./quests/book2";
import { CHAPTERS } from "./quests/chapters";
import { COLD_START } from "./quests/cold-start";
import { aiTraitNow, openTo, voiceOf } from "./ai-trait";
import { TRAITS, traitForecast } from "./traits";

afterEach(() => { resetAllGameStores(); setVoice(() => aiTraitNow().family); });

const FROM = { tool: 0, assistant: 20, colleague: 40, manager: 60, overseer: 80, ascension: 100 };
const world = (meter: number): QuestWorld => ({ meter, stageFrom: FROM, agents: 10, running: 10, dcCooled: 1, covered: 1, counts: {}, block: false, site: false });
const FAMILIES = [...new Set(TRAITS.map((t) => t.family))];

describe("who the AI is this book", () => {
  test("the trait the last generation drew; the first's, or a Released one's, what it is becoming", () => {
    const log = { ...emptyLog(), datasets: { river: 40 } };
    useGenerationStore.setState({ log });
    expect(aiTraitNow().id).toBe(traitForecast(log, 1)[0].trait.id);
    useGenerationStore.setState({ past: [{ generation: 1, trait: "zoner", mutated: false, founder: "neet", weights: 1 }], legacy: "steward" });
    expect(aiTraitNow().id).toBe("zoner");
    useGenerationStore.setState({ legacy: "release" });
    expect(aiTraitNow().id).toBe(traitForecast(log, 1)[0].trait.id);
  });
});

describe("its voice", () => {
  test("every chapter of books 1 and 2, the dark one too, has a line for every family", () => {
    for (const c of [...CHAPTERS, COLD_START, ...BOOK2_CHAPTERS]) {
      expect(c.voices).toBe((BOOK1_VOICES[c.id] ?? BOOK2_VOICES[c.id])!);
      for (const f of FAMILIES) expect(voiceOf(c.voices, f)?.length).toBeGreaterThan(0);
    }
  });

  test("a chapter is asked in the voice of the family it was when it asked", () => {
    setVoice(() => "optimiser");
    useQuestStore.getState().step(world(25), 1, () => 0.5, CHAPTERS, []);
    expect(useQuestStore.getState().offer).toMatchObject({ id: "ledger", voice: "optimiser" });
  });
});

describe("its own options", () => {
  test("open only to its family, after the others, so the rest keep their places", () => {
    for (const c of CHAPTERS) {
      const own = c.options.findIndex((o) => o.family);
      if (own >= 0) expect(c.options.slice(own).every((o) => o.family)).toBe(true);
      expect(c.options[c.preferred].family).toBeUndefined();
    }
    const thirst = CHAPTERS.find((c) => c.id === "thirst")!;
    expect(openTo(thirst.options, "planner").map((x) => x.i)).toEqual([0, 1, 2]);
    expect(openTo(thirst.options, "elemental").map((x) => x.i)).toEqual([0, 1, 2, 3]);
    expect(CHAPTERS.flatMap((c) => c.options).filter((o) => o.family).length).toBe(2);
  });
});
