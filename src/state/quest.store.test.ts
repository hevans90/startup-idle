import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../simulation/reset-game-stores";
import type { Chapter, Request } from "../game/quests/types";
import type { QuestWorld } from "../game/quests/objectives";
import { questIncomeMult } from "../game/quests/effects";
import { CHAPTER_WAIT, LONGEST_STEP, REQUEST_EVERY, REQUEST_WAIT, setFamilyLean, useQuestStore } from "./quest.store";
import { useGenerationStore } from "./generation.store";

afterEach(() => { resetAllGameStores(); setFamilyLean(() => ({})); });

const FROM = { tool: 0, assistant: 20, colleague: 40, manager: 60, overseer: 80, ascension: 100 };
const world = (w: Partial<QuestWorld> = {}): QuestWorld => ({
  meter: 0, stageFrom: FROM, agents: 10, running: 10, dcCooled: 1, covered: 1, counts: {}, block: false, site: false, ...w,
});

const LEDGER: Chapter = {
  id: "ledger", title: "The Shadow Ledger", stage: "assistant", preferred: 0,
  transmission: (f) => [f.has("x") ? "Again." : "Hello."],
  options: [
    { label: "Give it the keys", says: "", effects: [{ kind: "incomeMult", mult: 1.05 }, { kind: "flag", name: "ledger:open" }], axis: { autonomy: 1, machine: 1 } },
    {
      label: "Sandbox it", says: "", effects: [], axis: { autonomy: -1 },
      objective: { kind: "throttleAtMost", share: 0.5, seconds: 10, window: 30, says: "Keep the throttle at half" },
      success: [{ kind: "incomeMult", mult: 1.03 }], successSays: "Fine.", failure: [{ kind: "flag", name: "forgot" }], failureSays: "You forgot about me.",
    },
    { label: "Say no", says: "", effects: [{ kind: "flag", name: "ledger:refused" }], axis: { autonomy: -3, machine: -1 } },
  ],
};
const THIRST: Chapter = {
  id: "thirst", title: "Thirst", stage: "manager", preferred: 0, transmission: () => ["I am thirsty."],
  options: [{ label: "Pipe it", says: "", effects: [], axis: {}, objective: { kind: "coolDataCentre", share: 1, window: 20, says: "Cool it" }, failureSays: "Thirsty still." }],
};
const ask = (id: string, family: Request["family"]): Request => ({
  id, family, text: id, preferred: 1,
  options: [{ label: "a", says: "", effects: [], axis: { machine: 1 } }, { label: "b", says: "", effects: [{ kind: "flag", name: `${id}:b` }], axis: {} }],
});
const ARC = [LEDGER, THIRST];
const step = (w: Partial<QuestWorld>, dt = 1, rand = () => 0.5) =>
  useQuestStore.getState().step(world(w), dt, rand, ARC, [ask("river", "elemental"), ask("press", "shepherd")]);
const q = () => useQuestStore.getState();

describe("the arc", () => {
  test("a chapter is offered the first time the meter reaches its stage, once, one thing at a time", () => {
    step({ meter: 10 });
    expect(q().offer).toBeNull();
    step({ meter: 61 });
    expect(q().offer).toEqual({ kind: "chapter", id: "ledger", waited: 0 });
    q().choose(0, ARC);
    step({ meter: 61 });
    expect(q().offer?.id).toBe("thirst");
    q().choose(0, ARC);
    step({ meter: 61 });
    expect(q().offer).toBeNull();
  });

  test("an answer moves the disposition, within ±3, puts its effects in force and sets its echoes", () => {
    step({ meter: 25 });
    useQuestStore.setState({ disposition: { autonomy: -1, machine: 0 } });
    const before = questIncomeMult();
    // Ignored for the whole wait, it takes its preferred option: the keys.
    for (let k = 0; k < CHAPTER_WAIT; k++) step({ meter: 25 });
    expect(q().chapters.ledger).toBe(0);
    expect(q().disposition).toEqual({ autonomy: 0, machine: 1 });
    expect(questIncomeMult()).toBeCloseTo(before * 1.05);
    expect(q().flags).toContain("ledger:open");
    expect(q().path.length).toBe(1);
  });

  test("an objective met brings its success; one out of time its failure, and what it says", () => {
    step({ meter: 25 });
    answer("ledger", 1);
    for (let k = 0; k < 9; k++) step({ meter: 25, running: 4 });
    expect(q().objective?.progress).toBeCloseTo(0.9);
    step({ meter: 25, running: 4 });
    expect(q().objective).toBeNull();
    expect(questIncomeMult()).toBeCloseTo(1.03);
    expect(q().said).toEqual(["Fine."]);
    // Thirst: never cooled, its window runs out.
    useQuestStore.setState({ said: [] });
    step({ meter: 61 });
    answer("thirst", 0);
    for (let k = 0; k < 20; k++) step({ meter: 61, dcCooled: 0.5 });
    expect(q().objective).toBeNull();
    expect(q().said).toEqual(["Thirsty still."]);
  });

  test("time away moves nothing: no window spent, nothing fired", () => {
    step({ meter: 25 });
    answer("ledger", 1);
    step({ meter: 25, running: 10 }, LONGEST_STEP + 1);
    expect(q().objective?.elapsed).toBe(0);
    step({ meter: 61 }, 3600);
    expect(q().offer).toBeNull();
    step({ meter: 25, running: 10 }, 1);
    expect(q().objective?.elapsed).toBe(1);
  });

  test("requests from the Colleague on, every 8–12 minutes, leant by the family it is becoming; ignored, they pick themselves", () => {
    useQuestStore.setState({ chapters: { ledger: 2, thirst: 0 } });
    step({ meter: 30 }, 1);
    expect(q().requestIn).toBeNull();
    setFamilyLean(() => ({ shepherd: 1 }));
    step({ meter: 45 }, 1, () => 0);
    expect(q().requestIn).toBe(REQUEST_EVERY[0] - 1);
    for (let k = 0; k < REQUEST_EVERY[0]; k++) step({ meter: 45 }, 1, () => 0.6);
    // The shepherd's family leant 4 to 1: a roll of 0.6 lands on it.
    expect(q().offer).toMatchObject({ kind: "request", id: "press" });
    for (let k = 0; k < REQUEST_WAIT; k++) step({ meter: 45 });
    expect(q().requests.press).toBe(1);
    expect(q().flags).toContain("press:b");
  });

  test("belongs to the first generation; the Ascension closes it into the record", () => {
    step({ meter: 25 });
    answer("ledger", 2);
    expect(q().disposition).toEqual({ autonomy: -3, machine: -1 });
    useQuestStore.getState().closeArc();
    expect(q().chapters).toEqual({});
    expect(q().record).toEqual([{ generation: 1, chapters: { ledger: 2 }, disposition: { autonomy: -3, machine: -1 }, flags: ["ledger:refused"], ending: null }]);
    useGenerationStore.setState({ generation: 2 });
    step({ meter: 99 });
    expect(q().offer).toBeNull();
  });
});

/** Answer the offer, which must be this chapter. */
function answer(id: string, option: number) {
  expect(q().offer?.id).toBe(id);
  q().choose(option, ARC);
}
