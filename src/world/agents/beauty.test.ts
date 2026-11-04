import { describe, expect, test } from "bun:test";
// Books first: chapters → finale → quest.store → books is a cycle. @see test-parallel
import "../../game/quests/books";

import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { streetsOf } from "../roads/streets";
import { streetPropsOf } from "../render/street-props";
import { BEAUTY_MOOD, beautyOf, levelFor } from "./beauty";
import { moodsOf } from "./mood";
import { WHY } from "./mood-rules";

/** A street along row 5, ten homes on its north side, their doors on it. */
function street(): { g: Grid; doors: Map<number, number> } {
  const g = createGrid(16, 10);
  fillTerrain(g, 1);
  for (let x = 2; x < 14; x++) g.paved[idx(g, x, 5)] = 1;
  const doors = new Map<number, number>();
  for (let k = 0; k < 10; k++) {
    g.structures.set(k + 1, { id: k + 1, def: "kit:intern.t1", x: 3 + k, y: 4, w: 1, h: 1 });
    doors.set(k + 1, idx(g, 3 + k, 5));
  }
  return { g, doors };
}

describe("how fine a street is", () => {
  test("its level by the share of its homes served in full: a third, two thirds, nine in ten", () => {
    expect([0, 0.32, 0.33, 0.65, 0.66, 0.89, 0.9, 1].map(levelFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  test("a street's homes get its level, and its road tiles too", () => {
    const { g, doors } = street();
    const b = beautyOf(g, streetsOf(g), doors, (s) => s.id <= 7);
    expect(b.home.get(1)).toBe(2);
    expect([...b.home.values()].every((l) => l === 2)).toBe(true);
    expect(b.tile[idx(g, 6, 5)]).toBe(2);
    expect(b.tile[idx(g, 6, 4)]).toBe(-1);
    // An empty lot is nobody's home: it does not count.
    g.structures.get(10)!.residents = 0;
    g.structures.get(9)!.residents = 0;
    g.structures.get(8)!.residents = 0;
    expect(beautyOf(g, streetsOf(g), doors, (s) => s.id <= 7).home.get(1)).toBe(3);
  });

  test("a fine street weighs in a house's mood", () => {
    const { g } = street();
    const m = moodsOf(g, new Map(), new Map(), undefined, undefined, undefined, 0, undefined, new Map([[1, 3]]));
    expect(m.get(1)!.parts).toContainEqual({ why: WHY.street, points: BEAUTY_MOOD[3] });
    expect(m.get(2)!.parts.some((p) => p.why === WHY.street)).toBe(false);
  });

  test("each level brings its props: trees first, then lamps and crossings, then tables, bunting and murals", () => {
    const { g, doors } = street();
    const kinds = (n: number) => {
      const { props, murals } = streetPropsOf(g, streetsOf(g), beautyOf(g, streetsOf(g), doors, (s) => s.id <= n));
      return { kinds: new Set(props.map((p) => p.kind)), murals: murals.length };
    };
    expect(kinds(0).kinds.size).toBe(0);
    const one = kinds(4);
    expect(one.kinds.has("tree")).toBe(true);
    expect(one.kinds.has("lamp")).toBe(false);
    const two = kinds(7);
    expect(two.kinds.has("lamp")).toBe(true);
    expect(two.kinds.has("bunting")).toBe(false);
    const three = kinds(10);
    expect(["table", "bunting"].every((k) => three.kinds.has(k as never))).toBe(true);
    expect(three.murals).toBe(5);
  });
});
