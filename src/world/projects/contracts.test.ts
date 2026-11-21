/**
 * BUILT, NOT BOUGHT, through the game's own actions: what the player — and
 * the AI, by the same hand — puts up is a site, and costs nothing until its
 * loads are sent. The editor and anything headless still place at once.
 * @see contracts, plans/built-not-bought.md
 */
import { afterEach, describe, expect, test } from "bun:test";

import { buildCost } from "../../game/build-cost";
import { useMoneyStore } from "../../state/money.store";
import { useWorldStore } from "../../state/world.store";
import { idx } from "../grid";
import { placeStructure } from "../play/build-actions";
import { housingCapacity } from "../../game/housing";
import { HOUSE_KITS } from "../houses/kits";
import { CONTRACTS, contractFor } from "./contracts";

const s = () => useWorldStore.getState();
/** A map with a road along row 10, money for anything. */
function game(built: boolean) {
  s().resize(40, 24);
  const g = s().grid;
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 10)] = 1;
  s().loadGrid(g);
  useWorldStore.setState({ playing: true, roadWorks: built });
  useMoneyStore.getState().increaseMoney(1e9);
  return s().grid;
}
afterEach(() => useWorldStore.setState({ playing: false, roadWorks: false }));

describe("what the player puts up in the game", () => {
  test("is a site with its price for its loads, and nothing is paid at the order", () => {
    const g = game(true), before = useMoneyStore.getState().money;
    let x = 2;
    for (const def of Object.keys(CONTRACTS)) {
      const price = buildCost(def);
      if (!price) continue;
      const n = g.structures.size;
      placeStructure(def, { x, y: 11 });
      x += 5;
      if (g.structures.size === n) continue;   // (not placeable just there: a levee wants water, a processor its own)
      const site = [...g.structures.values()].find((q) => q.def === def)!;
      expect(site.build, def).toMatchObject({ done: 0, delivered: 0, deliveries: CONTRACTS[def].loads });
      expect(site.build!.cost, def).toBeCloseTo(price.toNumber(), 6);
    }
    expect([...g.structures.values()].some((q) => q.build)).toBe(true);
    expect(useMoneyStore.getState().money.eq(before)).toBe(true);
  });

  test("where the map is not the game's own — the editor, a headless run — it is placed and paid for at once", () => {
    const g = game(false), before = useMoneyStore.getState().money;
    expect(placeStructure("office-intern", { x: 4, y: 11 })).toBe(true);
    const office = [...g.structures.values()].find((q) => q.def === "office-intern")!;
    expect(office.build).toBeUndefined();
    expect(before.minus(useMoneyStore.getState().money).toNumber()).toBeCloseTo(buildCost("office-intern")!.toNumber(), 6);
  });

  test("a LOT is put down whole, its beds there at once: no gang sets it out", () => {
    const g = game(true);
    for (const k of HOUSE_KITS.filter((k) => k.endsWith(".t0"))) expect(contractFor(`kit:${k}`), k).toBeNull();
    expect(placeStructure("kit:intern.t0", { x: 4, y: 11 })).toBe(true);
    const lot = [...g.structures.values()].find((q) => q.def === "kit:intern.t0")!;
    expect(lot.build).toBeUndefined();
    expect(housingCapacity(g).intern).toBeGreaterThan(0);
  });
});
