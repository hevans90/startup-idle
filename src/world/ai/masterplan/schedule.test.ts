import { describe, expect, test } from "bun:test";

import { DESKS } from "../../agents/commute";
import { createGrid, fillTerrain, type Grid } from "../../grid";
import { desksShort } from "./schedule";
import { SPARE_PLAIN } from "./style";

/** Interns' houses, `n` of them with four in each, and offices: built, or still going up. */
function town(n: number, offices: { build: boolean }[]): Grid {
  const g = createGrid(40, 40);
  fillTerrain(g, 1);
  let id = 1;
  for (let k = 0; k < n; k++) g.structures.set(id, { id: id++, def: "kit:intern.t0", x: k, y: 0, w: 1, h: 1, residents: 4 });
  for (const [k, o] of offices.entries()) {
    g.structures.set(id, { id: id++, def: "office-intern", x: 4 * k, y: 10, w: 3, h: 3, ...(o.build ? { build: { done: 0, need: 1, delivered: 0, deliveries: 1, cost: 0, priority: 2, updatedAt: 0 } } : {}) });
  }
  return g;
}
const short = (g: Grid) => desksShort(g, { rules: {}, kinds: ["intern"], offices: true }).find((k) => k.who === "intern");

describe("the AI's offices", () => {
  test("one still going up counts as its desks: the shortage it was ordered for is not asked for again while it is built", () => {
    const desks = DESKS["office-intern"];
    const none = short(town(40, []))!, one = short(town(40, [{ build: true }]))!, two = short(town(40, [{ build: true }, { build: true }]))!;
    expect(one.need).toBe(none.need - desks);
    expect(two.need).toBe(none.need - 2 * desks);
    // Built or still going up, the same to the plan.
    expect(short(town(40, [{ build: false }]))!.need).toBe(one.need);
    // Nobody sits at a desk that is still being built, all the same.
    expect(one.now).toBe(none.now);
    // Enough going up for all that will live there: none asked for.
    expect(short(town(40, Array.from({ length: Math.ceil(none.need / desks) }, () => ({ build: true }))))).toBeUndefined();
  });
  test("counts the beds houses have now, not what they may grow to: no office ahead of anyone to sit in it", () => {
    // Ten starter lots, two beds each and empty: twenty beds ahead, past the spare desks kept — not twelve a lot.
    const g = town(10, []);
    for (const s of g.structures.values()) s.residents = 0;
    expect(short(g)!.ahead).toBe(20 - SPARE_PLAIN);
    // Four of them, eight beds: within the spare. None asked for.
    const few = town(4, []);
    for (const s of few.structures.values()) s.residents = 0;
    expect(short(few)).toBeUndefined();
  });
});
