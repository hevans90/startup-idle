import { describe, expect, test } from "bun:test";

import { createGrid, type Structure } from "../grid";
import { MOOD, MOVE_OUT_EVERY, moodOffsets, moodsOf, moodWord, stepMood, tooUnhappy } from "./mood";
import type { ServiceId } from "./services";

/** A grid with these structures on it, by id. */
function town(list: Partial<Structure>[]) {
  const g = createGrid(40, 40);
  list.forEach((s, k) => g.structures.set(k + 1, { id: k + 1, x: 0, y: 0, w: 1, h: 1, def: "kit:intern.t0", ...s } as Structure));
  return g;
}
const cover = (entries: [number, ServiceId[]][]) => new Map(entries.map(([id, s]) => [id, new Set(s)]));

describe("a house's mood", () => {
  test("adds up its services, and has none to complain of near work with a café", () => {
    const g = town([{ x: 5, y: 5, residents: 2 }, { def: "garage", x: 1, y: 1, w: 2 }]);
    const moods = moodsOf(g, new Map([[1, { tiles: 3, eff: 1, to: 2 }]]), cover([[1, ["cafe", "park"]]]), 0);
    expect(moods.get(1)!.total).toBe(MOOD.cafe + MOOD.park);
    expect(moodWord(moods.get(1)!.total)).toBe("Content");
  });

  test("suffers a long commute, no services, and the slop pit next door — the fuller the worse", () => {
    const g = town([{ x: 5, y: 5, residents: 2 }, { def: "garage", x: 30, y: 30, w: 2 }, { def: "slop-pit", x: 8, y: 5, w: 3, h: 3 }]);
    const commute = new Map([[1, { tiles: 40, eff: 0.6, to: 2 }]]);
    const empty = moodsOf(g, commute, new Map(), 0).get(1)!;
    const full = moodsOf(g, commute, new Map(), 1).get(1)!;
    expect(empty.parts.map((p) => p.why)).toEqual(["long commute", "no services", "slop pit"]);
    expect(full.total).toBe(Math.max(-40, -24 + MOOD.noServices + MOOD.slopNear + MOOD.slopFull));
    expect(full.total).toBeLessThan(empty.total);
    expect(tooUnhappy(full)).toBe(true);
  });

  test("does not count a commute against anyone with nowhere to work yet", () => {
    const g = town([{ x: 5, y: 5, residents: 2 }]);
    const moods = moodsOf(g, new Map([[1, { tiles: null, eff: 0.25, to: null }]]), cover([[1, ["cafe"]]]), 0);
    expect(moods.get(1)!.parts.some((p) => p.why === "no road to work")).toBe(false);
  });

  test("a dense house wants a park, and a wonder nearby cheers anyone", () => {
    const g = town([{ def: "kit:intern.t2", x: 5, y: 5, residents: 12 }, { def: "datacentre", x: 9, y: 5, w: 3, h: 3 }]);
    const moods = moodsOf(g, new Map(), cover([[1, ["cafe"]]]), 0);
    expect(moods.get(1)!.parts.map((p) => p.why)).toEqual(["café", "crowded", "near a wonder"]);
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
