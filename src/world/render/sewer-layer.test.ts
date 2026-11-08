import { describe, expect, test } from "bun:test";

import { DIR } from "../../iso/dir";
import { SEWER_FIT, createGrid, fillTerrain, idx } from "../grid";
import { createBandLayer } from "./bands";
import { createSewerLayer } from "./sewer-layer";

/** A sewer along y = 2 from an outfall at x = 1 to a manhole at x = 6. */
function map(exit = true) {
  const g = createGrid(16, 8);
  fillTerrain(g, 1);
  g.height.fill(4);
  for (let x = 1; x <= 6; x++) g.sewer[idx(g, x, 2)] = (x > 1 ? DIR.N : 0) | (x < 6 ? DIR.S : 0);
  if (exit) g.sewerFit[idx(g, 1, 2)] = SEWER_FIT.outfall;
  g.sewerFit[idx(g, 6, 2)] = SEWER_FIT.node;
  g.rev++;
  return g;
}
const count = (tiers: { children: unknown[] }[]) => tiers.reduce((n, t) => n + t.children.length, 0);

describe("the sewer layer", () => {
  test("draws its tubes under the ground, shown only in the underground view", () => {
    const g = map(), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    layer.sync(g, 1, false);
    expect(count(bands.sewerOf)).toBeGreaterThan(0);
    expect(bands.sewerOf.every((t) => !t.visible)).toBe(true);
    layer.sync(g, 1, true);
    expect(bands.sewerOf.every((t) => t.visible)).toBe(true);
  });

  test("tints the tiles a live manhole reaches, while a slop maker is in hand", () => {
    const g = map(), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    layer.sync(g, 1, false);
    const paved = count(bands.pavedOf);
    layer.sync(g, 1, false, null, true);
    expect(count(bands.pavedOf)).toBeGreaterThan(paved);
    layer.sync(g, 1, false, null, false);
    expect(count(bands.pavedOf)).toBe(paved);
  });

  test("a manhole on a sewer with no exit reaches nothing", () => {
    const g = map(false), bands = createBandLayer(g.w, g.h), layer = createSewerLayer(bands);
    layer.sync(g, 1, false);
    const paved = count(bands.pavedOf);
    layer.sync(g, 1, false, null, true);
    expect(count(bands.pavedOf)).toBe(paved);
  });
});
