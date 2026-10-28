import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Structure } from "../grid";
import { createWaterField, pourAt } from "../water/field";
import { fluidIndexOf } from "../water/materials";
import { DRY_REACH, SLUDGED, dryUp, sludgeAt, sludgedHouses } from "./sludge";

/** A flat map with these buildings on it, each on its cells. */
function map(...list: Structure[]) {
  const g = createGrid(40, 40);
  fillTerrain(g, 1);
  g.height.fill(4);
  for (const s of list) {
    g.structures.set(s.id, s);
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g.structureAt[idx(g, x, y)] = s.id;
  }
  return { g, field: createWaterField(g) };
}
const house = (id: number, x: number, y: number): Structure => ({ id, def: "kit:intern.t0", x, y, w: 1, h: 1 });
const studio: Structure = { id: 1, def: "studio", x: 5, y: 5, w: 3, h: 2 };

describe("spilled sludge", () => {
  test("is on the doorstep of a house beside it, and of no house further off", () => {
    const { g, field } = map(studio, house(2, 10, 6), house(3, 20, 20));
    pourAt(field, 9, 6, SLUDGED * 3, fluidIndexOf("slop"));
    expect([...sludgedHouses(field, g)]).toEqual([2]);
  });

  test("dries up near the workplaces that spill it, and is left alone far from them", () => {
    const { g, field } = map(studio);
    const far = 5 + 3 + DRY_REACH + 2;
    pourAt(field, 9, 6, 1, fluidIndexOf("slop"));
    pourAt(field, far, 6, 1, fluidIndexOf("slop"));
    for (let k = 0; k < 10; k++) dryUp(field, g, [studio], 2);
    expect(sludgeAt(field, 9, 6)).toBeLessThan(0.5);
    expect(sludgeAt(field, far, 6)).toBeCloseTo(1, 3);
  });
});
