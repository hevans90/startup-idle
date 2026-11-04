import { afterEach, describe, expect, test } from "bun:test";

import { addCondition, conditionEffects, conditionsNow, loadConditions, setConditionsSink, type Condition } from "./conditions";
import { cultureNow } from "./culture-now";

afterEach(() => loadConditions([]));

describe("conditions", () => {
  test("wear off on the clock; one for the run does not", () => {
    loadConditions([]);
    addCondition({ source: "a", lean: 1, only: "intern", until: 1000 });
    addCondition({ source: "b", effects: { buildSpeed: 1.2 }, until: null });
    expect(conditionsNow(500).map((c) => c.source)).toEqual(["a", "b"]);
    expect(conditionsNow(1001).map((c) => c.source)).toEqual(["b"]);
  });

  test("are kept by the sink, and come back from a save", () => {
    let saved: readonly Condition[] = [];
    const undo = setConditionsSink((l) => { saved = l; });
    loadConditions([]);
    addCondition({ source: "x", effects: { output: 1.1 }, only: "vibe_coder", until: null });
    undo();
    loadConditions(JSON.parse(JSON.stringify(saved)));
    expect(conditionEffects("vibe_coder")).toEqual([{ output: 1.1 }]);
    expect(conditionEffects("intern")).toEqual([]);
  });

  test("are read under the culture deck", () => {
    loadConditions([]);
    const before = cultureNow().buildSpeed;
    addCondition({ source: "x", effects: { buildSpeed: 1.5 }, until: null });
    expect(cultureNow().buildSpeed).toBeCloseTo(before * 1.5);
  });
});
