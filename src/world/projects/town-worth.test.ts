import { describe, expect, test } from "bun:test";

import { createGrid } from "../grid";
import { PER_GROWN, PER_SERVICE, PER_WONDER, townBonusOf } from "./town-worth";

describe("what a town is worth at a sale", () => {
  test("counts houses grown, services and wonders, and nothing still being built", () => {
    const g = createGrid(10, 10);
    const add = (id: number, def: string, extra = {}) => g.structures.set(id, { id, def, x: 0, y: 0, w: 1, h: 1, ...extra });
    add(1, "kit:intern.t2", { grown: 2, residents: 12 });
    add(2, "cafe");
    add(3, "park");
    add(4, "datacentre");
    add(5, "ipo", { build: { done: 0, need: 1, delivered: 0, deliveries: 1, cost: 0, priority: 2, updatedAt: 0 } });
    add(6, "studio");
    expect(townBonusOf(g)).toBeCloseTo(2 * PER_GROWN + 2 * PER_SERVICE + PER_WONDER, 9);
  });

  test("is capped at half again", () => {
    const g = createGrid(10, 10);
    for (let k = 1; k <= 40; k++) g.structures.set(k, { id: k, def: "gym", x: 0, y: 0, w: 1, h: 1 });
    expect(townBonusOf(g)).toBe(0.5);
  });
});
