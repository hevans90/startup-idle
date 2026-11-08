import { afterEach, describe, expect, test } from "bun:test";

import { setSlopMaking } from "../../game/slop";
import { commit, createHistory } from "../edit/commands";
import { MAIN_END, SEWER_FIT, createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { createWaterField } from "../water/field";
import { upstreamOfTown } from "../water/pollution";
import { planSewer, routeSewer } from "../sewers/lay";
import { neededSewer, trunkInto, trunkRoute } from "./sewer-ai";

afterEach(() => setSlopMaking(0));

/** A lake down the west edge; a vibe office on x 10–11, y 3–4, its slop port at (12, 4). */
function street() {
  const g = createGrid(24, 16);
  fillTerrain(g, 1);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 : 2);
  for (let y = 0; y < 16; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("office-vibe")!, placement: undefined }, 10, 3)!);
  return g;
}
const wetOf = (g: Grid) => (x: number, y: number) => g.pool[idx(g, x, y)] > 0;
const PRICES = { unit: 10, liftPrice: 1000 };

/** Plan a trunk along cells and lay it. */
function lay(g: Grid, cells: { x: number; y: number }[]) {
  const p = planSewer(g, cells, wetOf(g), PRICES);
  if ("refused" in p) throw new Error(p.refused);
  for (const c of p.cells) {
    const i = idx(g, c.x, c.y);
    g.sewer[i] |= c.join;
    if (p.staged.sewerFit[i]) g.sewerFit[i] = p.staged.sewerFit[i];
  }
  g.rev++;
  return p;
}
const fitAtEnd = (g: Grid, cells: { x: number; y: number }[]) => {
  const p = planSewer(g, cells, wetOf(g), PRICES);
  if ("refused" in p) throw new Error(p.refused);
  return p.staged.sewerFit[idx(g, cells.at(-1)!.x, cells.at(-1)!.y)];
};

describe("the AI's sewers", () => {
  test("with nothing laid, a trunk from beside the port to the bank, for an outfall", () => {
    const g = street();
    const cells = trunkRoute(g, { x: 13, y: 4 }, wetOf(g))!;
    expect(cells[0]).toEqual({ x: 13, y: 4 });
    expect(cells.at(-1)!.x).toBe(4);
    expect(fitAtEnd(g, cells)).toBe(SEWER_FIT.outfall);
  });

  test("with a refinery in reach, to its inlet instead, though the water is nearer", () => {
    const g = street();
    commit(g, createHistory(), placeCommand(g, { ...structureDef("refinery")!, placement: undefined }, 18, 8)!);
    const cells = trunkRoute(g, { x: 13, y: 4 }, wetOf(g))!;
    expect(fitAtEnd(g, cells)).toBe(SEWER_FIT.inlet);
  });

  test("onto a live sewer already laid, joining it", () => {
    const g = street();
    lay(g, routeSewer(g, { x: 0, y: 10 }, { x: 14, y: 10 }, wetOf(g))!);
    const cells = trunkRoute(g, { x: 13, y: 4 }, wetOf(g))!;
    expect(cells.at(-1)!.y).toBe(10);
  });

  test("let out downstream of the town's intake, not into the water it drinks", () => {
    // A river down the west edge, falling southward (y up); an intake at (4, 8).
    const g = createGrid(24, 24);
    fillTerrain(g, 1);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) setHeight(g, x, y, x <= 3 ? -2 - (y >> 1) : 2);
    for (let y = 0; y < 24; y++) for (let x = 0; x <= 3; x++) g.pool[idx(g, x, y)] = 4;
    g.mainEnd[idx(g, 4, 8)] = MAIN_END.intake;
    const upstream = upstreamOfTown(createWaterField(g), g);
    expect(upstream.has(idx(g, 3, 4))).toBe(true);
    expect(upstream.has(idx(g, 3, 14))).toBe(false);
    expect(trunkRoute(g, { x: 13, y: 4 }, wetOf(g), upstream)!.at(-1)!.y).toBeGreaterThan(9);
    // With nothing to keep clean, the nearest water.
    expect(trunkRoute(g, { x: 13, y: 4 }, wetOf(g))!.at(-1)!.y).toBeLessThan(8);
  });

  test("goes round a hill rather than over it, so nothing need be lifted", () => {
    const g = street();
    // A ridge across the way to the water, but for a gap at the south.
    for (let y = 0; y < 13; y++) setHeight(g, 8, y, 12);
    const cells = trunkRoute(g, { x: 13, y: 4 }, wetOf(g))!;
    expect(cells.some((c) => c.x === 8 && c.y < 13)).toBe(false);
  });

  test("only wanted while there is slop: a trunk first, then the lateral down into it", () => {
    const g = street();
    expect(neededSewer(g)).toBeNull();
    setSlopMaking(1);
    const trunk = neededSewer(g)!;
    expect(trunk.kind).toBe("trunk");
    lay(g, trunk.cells);
    const lateral = neededSewer(g)!;
    expect(lateral.kind).toBe("lateral");
    expect(lateral.cells[0]).toEqual({ x: 12, y: 4 });
    expect(lateral.cells.length).toBeLessThanOrEqual(7);
  });

  test("a block it means to build on gets a trunk into it, unless a manhole reaches it", () => {
    const g = street();
    const box = { x0: 14, y0: 8, x1: 22, y1: 14 };
    const job = trunkInto(g, box)!;
    expect(job.kind).toBe("trunk");
    expect(job.cells[0]).toEqual({ x: 18, y: 11 });
    lay(g, job.cells);
    expect(trunkInto(g, box)).toBeNull();
  });
});
