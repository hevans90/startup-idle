/**
 * The rules of PLAY, as distinct from the rules of the data.
 *
 * `validatePlacement` answers whether a placement is possible at all — on the
 * map, on ground, not already occupied. Frontage and price are different: they
 * are the game talking, and the editor has to stay able to author a map that
 * breaks both. These tests pin that separation, because collapsing it is the
 * mistake that is easy to make and expensive to undo.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import Decimal from "break_infinity.js";
import { buildCost, canAfford, spendForBuild, upgradeCost } from "./build-cost";
import { housedBy } from "./housing";
import { useMoneyStore } from "../state/money.store";
import { createGrid, fillTerrain, idx } from "../world/grid";
import { structureDef } from "../world/structures/def";
import { placeCommand, touchesRoad, validatePlacement } from "../world/structures/place";

const KIT = structureDef("kit:intern.t0")!;

/** Flat ground, with a two-lane road along row 4 if asked for. */
function ground(withRoad: boolean) {
  const g = createGrid(12, 12);
  fillTerrain(g, 1);
  if (withRoad) {
    for (let x = 0; x < g.w; x++) { g.paved[idx(g, x, 4)] = 1; g.paved[idx(g, x, 5)] = 1; }
  }
  return g;
}

describe("frontage is a rule of the game, not of the data", () => {
  test("the editor may put a building anywhere legal", () => {
    const g = ground(false);
    expect(validatePlacement(g, KIT, 8, 8).ok).toBe(true);
    expect(placeCommand(g, KIT, 8, 8)).not.toBeNull();
  });

  test("but under the game's rules it needs a road", () => {
    const g = ground(false);
    const check = validatePlacement(g, KIT, 8, 8, { needsRoad: true });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("no road access");
    expect(placeCommand(g, KIT, 8, 8, { needsRoad: true })).toBeNull();
  });

  test("beside the road is fine; two cells away is not", () => {
    const g = ground(true);
    expect(validatePlacement(g, KIT, 8, 3, { needsRoad: true }).ok).toBe(true);
    expect(validatePlacement(g, KIT, 8, 6, { needsRoad: true }).ok).toBe(true);
    expect(validatePlacement(g, KIT, 8, 2, { needsRoad: true }).ok).toBe(false);
    expect(validatePlacement(g, KIT, 8, 7, { needsRoad: true }).ok).toBe(false);
  });

  /** ON a road is still refused — the two rules are different questions. */
  test("beside a road is not the same as on one", () => {
    const g = ground(true);
    const check = validatePlacement(g, KIT, 8, 4, { needsRoad: true });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("on a road");
  });

  test("a corner touch is not frontage", () => {
    const g = createGrid(8, 8);
    fillTerrain(g, 1);
    g.paved[idx(g, 2, 2)] = 1;
    expect(touchesRoad(g, 3, 2)).toBe(true);           // orthogonal
    expect(touchesRoad(g, 2, 3)).toBe(true);
    expect(touchesRoad(g, 3, 3)).toBe(false);          // diagonal
  });

  test("and a cell at the map's edge does not read off the end", () => {
    const g = createGrid(4, 4);
    fillTerrain(g, 1);
    expect(() => touchesRoad(g, 0, 0)).not.toThrow();
    expect(touchesRoad(g, 0, 0)).toBe(false);
  });
});

describe("what a building costs", () => {
  beforeEach(() => { useMoneyStore.setState({ money: new Decimal(0) }); });

  test("more beds cost more", () => {
    const t0 = buildCost("kit:intern.t0")!;
    const t2 = buildCost("kit:intern.t2")!;
    expect(t2.gt(t0)).toBe(true);
  });

  /**
   * The premium is the point: bigger housing is better per cell of GROUND and
   * worse per pound, so which is right depends on whether you are short of
   * money or short of frontage. Without it, "build the biggest" is the only
   * move and the map stops being a decision.
   */
  test("a bigger building is dearer PER BED, not merely in total", () => {
    const t0 = buildCost("kit:intern.t0")!.toNumber() / housedBy("kit:intern.t0")!.slots;
    const t2 = buildCost("kit:intern.t2")!.toNumber() / housedBy("kit:intern.t2")!.slots;
    expect(t2).toBeGreaterThan(t0);
  });

  test("something that is not housing is not for sale", () => {
    expect(buildCost("statue")).toBeNull();
    expect(canAfford(null)).toBe(false);
    expect(spendForBuild(null)).toBe(false);
  });

  /** A refusal must not take the money — the same trap as the hiring gate. */
  test("a build you cannot afford charges nothing", () => {
    const price = buildCost("kit:intern.t0")!;
    useMoneyStore.setState({ money: price.sub(1) });
    const before = useMoneyStore.getState().money;
    expect(spendForBuild(price)).toBe(false);
    expect(useMoneyStore.getState().money.eq(before)).toBe(true);
  });

  test("and one you can afford takes exactly the price", () => {
    const price = buildCost("kit:intern.t0")!;
    useMoneyStore.setState({ money: price.times(3) });
    expect(spendForBuild(price)).toBe(true);
    expect(useMoneyStore.getState().money.eq(price.times(2))).toBe(true);
  });
});

describe("seaports have a price", () => {
  test("off the boats a minute they turn round, the same deal at every tier", () => {
    expect(buildCost("seaport")!.toNumber()).toBe(240);
    expect(buildCost("seaport-2")!.toNumber()).toBe(640);
    expect(buildCost("seaport-3")!.toNumber()).toBe(1440);
  });

  test("and an upgrade costs the step up, so building up costs what building outright does", () => {
    expect(upgradeCost("seaport", "seaport-2")!.toNumber()).toBe(400);
    expect(upgradeCost("seaport-2", "seaport-3")!.toNumber()).toBe(800);
    expect(upgradeCost("kit:intern.t0", "nothing")).toBeNull();
  });
});

describe("frontage is the footprint's, not every cell's", () => {
  test("a two-deep building fronts the road from its back row", () => {
    const g = ground(true);                      // road on rows 4 and 5
    // Rows 2 and 3: only row 3 touches the road. Refused for the bank, not the road.
    expect(validatePlacement(g, structureDef("seaport")!, 3, 2, { needsRoad: true }).reason)
      .toBe("not on a river bank");
    // Rows 1 and 2: neither does.
    const back = validatePlacement(g, structureDef("seaport")!, 3, 1, { needsRoad: true });
    expect(back.reason).toBe("no road access");
    expect(back.cells.every((c) => !c.ok)).toBe(true);
  });
});
