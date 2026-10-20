import { describe, expect, jest, test } from "bun:test";

import { DIRT, GRASS, SAND, WOODS } from "../../../state/world.store";
import { commit, createHistory } from "../../edit/commands";
import { generatePlayableMap } from "../../gen/generate-map";
import { DEFAULT_GEN } from "../../gen/params";
import { createGrid, type Grid } from "../../grid";
import { structureDef } from "../../structures/def";
import { placeCommand, validatePlacement } from "../../structures/place";
import { blockAt, inBox, planTown, townCentre } from "./plan";
import { chooseBlock, planCost } from "./lookahead";
import { styleOf } from "./style";

/** A generated map with a garage near the middle, as a company starts. */
function founded(size: number, seed = 11): Grid {
  const g = createGrid(size, size);
  generatePlayableMap(g, { seed, material: GRASS, dirt: DIRT, sand: SAND, woods: WOODS, params: { ...DEFAULT_GEN, size } });
  const def = structureDef("garage")!;
  const m = size >> 1;
  outer: for (let y = m - 8; y < m + 8; y++) for (let x = m - 8; x < m + 8; x++) if (validatePlacement(g, def, x, y, { needsRoad: true }).ok) { commit(g, createHistory(), placeCommand(g, def, x, y, { needsRoad: true })!); break outer; }
  return g;
}
const o = { kinds: ["intern" as const], services: true, offices: true };

describe("the next block, looked ahead at", () => {
  test("TALL: adds as much settled income for its price as the nearest block would, or more", () => {
    for (const seed of [11, 22]) {
      const g = founded(64, seed), owned = () => true, style = styleOf(["aesthete"]);
      const c = chooseBlock(g, owned, townCentre(g), new Set(), { ...o, style })!;
      const box = blockAt(g, owned, townCentre(g))!;
      const near = planTown(g, { ...o, style, owned: (x, y) => inBox(box, x, y) });
      expect(c.choice.of).toBeGreaterThan(1);
      expect(c.choice.gain / c.choice.cost).toBeGreaterThanOrEqual((near.predicted - near.now) / planCost(g, near) - 1e-9);
    }
  });

  test("WIDE: puts down as many beds for its price as the nearest block would, or more", () => {
    const g = founded(64), owned = () => true, style = styleOf(["hivemind"]);
    const c = chooseBlock(g, owned, townCentre(g), new Set(), { ...o, style })!;
    const box = blockAt(g, owned, townCentre(g))!;
    const near = planTown(g, { ...o, style, owned: (x, y) => inBox(box, x, y) });
    const lots = near.steps.filter((s) => s.kind === "build" && s.def.startsWith("kit:")).length;
    expect(c.choice.beds / c.choice.cost).toBeGreaterThanOrEqual((lots * 2) / planCost(g, near) - 1e-9);
  });

  test("nowhere to grow: none", () => {
    const g = founded(64);
    for (let i = 0; i < g.paved.length; i++) g.paved[i] = 0;
    expect(chooseBlock(g, () => true, { x: 32, y: 32 }, new Set(), o)).toBeNull();
  });

  test("is quick enough for the worker on a big map", () => {
    jest.useRealTimers();
    const g = founded(96);
    const t0 = performance.now();
    chooseBlock(g, () => true, townCentre(g), new Set(), o);
    if (process.env.BALANCE) console.log(`96²: ${(performance.now() - t0).toFixed(0)} ms`);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
