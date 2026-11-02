import { describe, expect, test } from "bun:test";

import { emptyDeck, type CardId, type Deck } from "../../game/culture";
import { createGrid, fillTerrain, idx, type Grid, type Structure } from "../grid";
import { propsOf } from "./culture-props";

const deck = (...ids: CardId[]): Deck => ({ ...emptyDeck(), slots: 9, ranks: Object.fromEntries(ids.map((id) => [id, 1])), slotted: ids });

/** A green with a building on it, its cells stamped. */
function green(...builds: Partial<Structure>[]): Grid {
  const g = createGrid(20, 20);
  fillTerrain(g, 1);
  builds.forEach((b, k) => {
    const s = { id: k + 1, x: 5, y: 5, w: 2, h: 2, def: "garage", ...b } as Structure;
    g.structures.set(s.id, s);
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g.structureAt[idx(g, x, y)] = s.id;
  });
  return g;
}

describe("the culture deck, seen in the town", () => {
  test("nothing slotted, nothing shown", () => {
    expect(propsOf(green({}), emptyDeck())).toEqual([]);
  });

  test("a card's prop beside each building it touches, on a tile of its own, front sides first", () => {
    const props = propsOf(green({ w: 2, h: 1 }), deck("stack", "freeze"));
    expect(props.map((p) => p.card)).toEqual(["stack", "freeze"]);
    // The +u side first: the tile beside it, then the next along.
    expect(props.map((p) => [p.x, p.y])).toEqual([[7, 5], [5, 6]]);
  });

  test("a kind's own card at that kind's workplaces only", () => {
    const g = green({ def: "garage" }, { id: 2, def: "studio", x: 12, y: 12, w: 3, h: 2 });
    expect(propsOf(g, deck("hackathon")).map((p) => [p.card, p.x >= 12])).toEqual([["hackathon", true]]);
  });

  test("a food truck on a street beside the building, and a ground prop pushed onto the pavement when the green is gone", () => {
    const g = green({ w: 1, h: 1 });
    for (let y = 0; y < 20; y++) g.paved[idx(g, 6, y)] = 1;
    // Built in on its other sides.
    for (const [x, y] of [[5, 6], [4, 5], [5, 4]]) g.structureAt[idx(g, x, y)] = 99;
    const [truck, flag] = propsOf(g, deck("lunch", "stack"));
    expect(truck).toMatchObject({ card: "lunch", x: 6, y: 5, alongV: true });
    // On the pavement at its corner, pushed in against the building.
    expect(flag).toMatchObject({ card: "stack", x: 6, y: 6 });
    expect(flag.du! < 0 && flag.dv! < 0).toBe(true);
  });

  test("not on a building site, but Move Fast's cones are", () => {
    const g = green({ build: { done: 0, need: 1 } as Structure["build"] });
    expect(propsOf(g, deck("stack", "movefast")).map((p) => p.card)).toEqual(["movefast"]);
  });
});
