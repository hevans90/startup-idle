import { describe, expect, test } from "bun:test";

import { createGrid, type Structure } from "../grid";
import { MOOD, MOVE_OUT_EVERY, NEED_MOOD, moodOffsets, moodsOf, moodWord, stepMood, tooUnhappy } from "./mood";
import type { NeedId } from "./services";

/** A grid with these structures on it, by id. */
function town(list: Partial<Structure>[]) {
  const g = createGrid(40, 40);
  list.forEach((s, k) => g.structures.set(k + 1, { id: k + 1, x: 0, y: 0, w: 1, h: 1, def: "kit:intern.t0", ...s } as Structure));
  return g;
}
const cover = (entries: [number, NeedId[]][]) => new Map(entries.map(([id, s]) => [id, new Set(s)]));

describe("a house's mood", () => {
  test("enjoys a water view — unless slop has fouled the water", () => {
    const g = town([{ x: 5, y: 5, residents: 2 }]);
    const sees = () => true;
    const clean = moodsOf(g, new Map(), cover([[1, ["food"]]]), new Set(), new Set(), sees).get(1)!;
    const fouled = moodsOf(g, new Map(), cover([[1, ["food"]]]), new Set(), new Set(), sees, 0, new Set([1])).get(1)!;
    expect(clean.parts.map((p) => p.why)).toContain("water view");
    expect(fouled.parts.map((p) => p.why)).toEqual(["food", "polluted water"]);
    expect(fouled.total).toBe(NEED_MOOD.intern + MOOD.polluted);
  });

  test("adds up its kind's needs met — not another kind's — and has none to complain of near work", () => {
    const g = town([{ x: 5, y: 5, residents: 2 }, { def: "garage", x: 1, y: 1, w: 2 }]);
    const moods = moodsOf(g, new Map([[1, { tiles: 3, eff: 1, to: 2 }]]), cover([[1, ["food", "nightlife", "coffee"]]]));
    expect(moods.get(1)!.parts.map((p) => p.why)).toEqual(["food", "nightlife"]);
    expect(moods.get(1)!.total).toBe(2 * NEED_MOOD.intern);
    expect(moodWord(moods.get(1)!.total)).toBe("Content");
  });

  test("suffers a long commute, no services, and spilled sludge on the doorstep", () => {
    const g = town([{ x: 5, y: 5, residents: 2 }, { def: "garage", x: 30, y: 30, w: 2 }]);
    const commute = new Map([[1, { tiles: 40, eff: 0.6, to: 2 }]]);
    const clean = moodsOf(g, commute, new Map()).get(1)!;
    const sludged = moodsOf(g, commute, new Map(), new Set([1])).get(1)!;
    expect(clean.parts.map((p) => p.why)).toEqual(["long commute", "unmet needs"]);
    expect(sludged.parts.map((p) => p.why)).toEqual(["long commute", "unmet needs", "sludge"]);
    expect(sludged.total).toBe(Math.max(-40, -24 + MOOD.unmet + MOOD.sludge));
    expect(tooUnhappy(sludged)).toBe(true);
  });

  test("does not count a commute against anyone with nowhere to work yet", () => {
    const g = town([{ x: 5, y: 5, residents: 2 }]);
    const moods = moodsOf(g, new Map([[1, { tiles: null, eff: 0.25, to: null }]]), cover([[1, ["food"]]]));
    expect(moods.get(1)!.parts.some((p) => p.why === "no road to work")).toBe(false);
  });

  test("a dense house of a kind that needs quiet wants a park, and a wonder nearby cheers anyone", () => {
    const g = town([{ def: "kit:10x_dev.t2", x: 5, y: 5, residents: 12 }, { def: "kit:intern.t2", x: 7, y: 5, residents: 12 }, { def: "datacentre", x: 9, y: 5, w: 3, h: 3 }]);
    const moods = moodsOf(g, new Map(), cover([[1, ["health"]], [2, ["food"]]]));
    expect(moods.get(1)!.parts.map((p) => p.why)).toEqual(["a doctor", "crowded", "near a wonder"]);
    expect(moods.get(2)!.parts.map((p) => p.why)).toEqual(["food", "near a wonder"]);
  });
});

describe("the town's mood", () => {
  test("leans each kind toward its houses, weighted by who lives where", () => {
    const g = town([{ x: 1, y: 1, residents: 1 }, { def: "kit:intern.t1", x: 3, y: 3, residents: 3 }, { def: "kit:vibe_coder.t0", x: 5, y: 5, residents: 0 }]);
    const moods = new Map([[1, { total: 20, parts: [] }], [2, { total: -20, parts: [] }], [3, { total: 30, parts: [] }]]);
    expect(moodOffsets(g, moods)).toEqual({ intern: (20 - 60) / 4 });
  });

  test("a miserable house loses someone every so often, and a content one nobody", () => {
    const g = town([{ x: 1, y: 1, residents: 2 }, { x: 3, y: 3, residents: 2 }]);
    const moods = new Map([[1, { total: -30, parts: [] }], [2, { total: 5, parts: [] }]]);
    const u = new Map();
    expect(stepMood(u, g, moods, MOVE_OUT_EVERY - 1)).toEqual([]);
    expect(stepMood(u, g, moods, 2)).toEqual([1]);
    expect(g.structures.get(1)!.residents).toBe(1);
    expect(g.structures.get(2)!.residents).toBe(2);
  });
});
