import { describe, expect, test } from "bun:test";

import { planted, plantsTrees, setPlanted, type PlantedTree } from "./planted";

const oak = (u: number): PlantedTree => ({ kind: "oak", u, v: 2, z: 0, turn: 0, size: 1 });

describe("planted trees", () => {
  test("on the continuous surface the woods' mesh draws them", () => {
    expect(plantsTrees()).toBe(true);
  });

  test("a source's trees are listed, replaced and cleared, the count changing only when they do", () => {
    const r0 = planted().rev;
    setPlanted("t:a", [oak(1), oak(2)]);
    setPlanted("t:b", [oak(5)]);
    const r1 = planted().rev;
    expect(r1).toBeGreaterThan(r0);
    expect(planted().trees.filter((t) => t.v === 2).map((t) => t.u).sort()).toEqual([1, 2, 5]);
    // The same trees again: nothing to redraw.
    setPlanted("t:a", [oak(1), oak(2)]);
    expect(planted().rev).toBe(r1);
    expect(planted()).toBe(planted());
    setPlanted("t:a", [oak(3)]);
    expect(planted().rev).toBeGreaterThan(r1);
    setPlanted("t:a", []);
    setPlanted("t:b", []);
    const r2 = planted().rev;
    expect(planted().trees.some((t) => t.v === 2)).toBe(false);
    setPlanted("t:a", []);
    expect(planted().rev).toBe(r2);
  });
});
