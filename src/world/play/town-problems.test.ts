import { describe, expect, test } from "bun:test";

import type { Grid, Structure } from "../grid";
import { WHY, type MoodParts } from "../agents/mood-rules";
import { townProblems, TOWN_FROM } from "./town-problems";

/** A town of intern houses, each with its mood. */
function town(moods: MoodParts[]): { g: Grid; moods: Map<number, MoodParts> } {
  const structures = new Map<number, Structure>();
  const out = new Map<number, MoodParts>();
  moods.forEach((m, id) => {
    structures.set(id, { id, def: "kit:intern.t0", x: id, y: 0, w: 1, h: 1, residents: 1 } as Structure);
    out.set(id, m);
  });
  return { g: { structures } as unknown as Grid, moods: out };
}
const noServices = (total = -6): MoodParts => ({ total, parts: [{ why: WHY.noServices, points: total }] });
const happy: MoodParts = { total: 4, parts: [{ why: WHY.cafe, points: 4 }] };

describe("a problem the whole town shares", () => {
  test("most houses of a kind unhappy for one reason: said once, their badges quiet", () => {
    const { g, moods } = town([...Array(10).fill(noServices()), happy, happy]);
    const { problems, quiet } = townProblems(g, moods, () => 0);
    expect(problems).toEqual([{ kind: "intern", houses: 10, why: WHY.noServices }]);
    expect(quiet.size).toBe(10);
  });

  test("a house worse off than its street keeps its badge", () => {
    const { g, moods } = town([...Array(9).fill(noServices()), noServices(-20)]);
    const { quiet } = townProblems(g, moods, () => 0);
    expect(quiet.has(9)).toBe(false);
    expect(quiet.size).toBe(9);
  });

  test("a few houses, or a reason most do not share, is no town problem", () => {
    expect(townProblems(town(Array(TOWN_FROM - 1).fill(noServices())).g, town(Array(TOWN_FROM - 1).fill(noServices())).moods, () => 0).problems).toEqual([]);
    const { g, moods } = town([...Array(4).fill(noServices()), ...Array(6).fill(happy)]);
    expect(townProblems(g, moods, () => 0).problems).toEqual([]);
  });
});
