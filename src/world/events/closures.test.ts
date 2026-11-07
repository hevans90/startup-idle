import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx } from "../grid";
import { busiestJunction, houseWork, isJunction, resetClosures, setClosed, setHouseWork } from "./closures";
import { walkFrom } from "../agents/commute";

/** A plus of road: a junction at (4, 4). */
function plus() {
  const g = createGrid(9, 9);
  fillTerrain(g, 1);
  for (let k = 1; k < 8; k++) { g.paved[idx(g, k, 4)] = 1; g.paved[idx(g, 4, k)] = 1; }
  return g;
}

describe("closures", () => {
  test("a closed junction is no way through, and opened again it is", () => {
    const g = plus();
    expect(isJunction(g, 4, 4)).toBe(true);
    expect(busiestJunction(g, [{ x: 4, y: 2, n: 5 }])).toEqual({ x: 4, y: 4 });
    expect(walkFrom(g, [idx(g, 1, 4)])[idx(g, 7, 4)]).toBe(6);
    setClosed([idx(g, 4, 4)]);
    expect(walkFrom(g, [idx(g, 1, 4)])[idx(g, 7, 4)]).toBe(-1);
    setClosed([]);
    expect(walkFrom(g, [idx(g, 1, 4)])[idx(g, 7, 4)]).toBe(6);
  });

  test("homes on strike work at a share until it runs out", () => {
    resetClosures();
    setHouseWork([3], 0.5, 1000);
    expect(houseWork(3, 500)).toBe(0.5);
    expect(houseWork(3, 1500)).toBe(1);
    expect(houseWork(4, 500)).toBe(1);
  });
});
