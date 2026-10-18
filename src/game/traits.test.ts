import { describe, expect, test } from "bun:test";

import { emptyLog } from "../state/generation.store";
import { TRAITS, drawTrait, traitForecast, traitScores } from "./traits";

describe("the AI's traits", () => {
  test("lean toward the family it was trained on", () => {
    const log = { ...emptyLog(), datasets: { river: 5 } };
    const top = traitForecast(log, 2).map((f) => f.trait.family);
    expect(top).toEqual(["elemental", "elemental"]);
  });

  test("read how it was run and treated", () => {
    const kept = traitScores({ ...emptyLog(), throttled: 900, full: 100 });
    expect(kept.patient).toBeGreaterThan(kept.restless);
    const shut = traitScores({ ...emptyLog(), shutdowns: 2 });
    expect(traitForecast({ ...emptyLog(), shutdowns: 2 }, 1)[0].trait.id).toBe("resentful");
    expect(shut.resentful).toBeGreaterThan(shut.patient);
    // Raised by one founder, it takes after them.
    expect(traitScores({ ...emptyLog(), founders: { hustler: 4 } }).mirror).toBeGreaterThan(1);
  });

  test("draws every trait sometimes, and odds sum to one", () => {
    const log = emptyLog();
    const seen = new Set<string>();
    let s = 1;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let k = 0; k < 2000; k++) seen.add(drawTrait(log, rand));
    expect(seen.size).toBe(TRAITS.length);
    const all = traitForecast(log, TRAITS.length).reduce((n, f) => n + f.odds, 0);
    expect(all).toBeCloseTo(1);
  });
});
