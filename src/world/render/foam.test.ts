/**
 * Where the water goes white.
 *
 * Tested on the FIELD rather than on the mesh, because every question worth
 * asking about foam is a question about water — does the white outlive the
 * crest, does a trickle over a cliff land like a waterfall — and none of them
 * are questions about vertices.
 *
 * WHERE foam is born is the solver's answer now, not this file's: it reads
 * `broke`, the intensity the solver already works out to dissipate on, so the
 * water goes white exactly where it is losing energy. What is tested here is
 * what this file still decides — that the white is carried, that it fades, and
 * that the foot of a waterfall is white whatever the waves are doing.
 */
import { describe, expect, test } from "bun:test";

import { activeBox } from "../../fluid/columns";
import { createWaterField, pourAt, stepWater, type WaterField } from "../water/field";
import { createGrid, fillTerrain, setHeight } from "../grid";
import { createFoam, stepFoam, type FoamField } from "./foam";

/** Run the water and the foam together, the way the renderer does. */
function run(field: WaterField, foam: FoamField, seconds: number) {
  for (let n = 0; n < Math.round(seconds * 60); n++) {
    stepWater(field, 1 / 60);
    const region = activeBox(field.columns);
    if (region) stepFoam(foam, field.columns, 1 / 60, region);
  }
}

const most = (foam: FoamField) => {
  let max = 0;
  for (const v of foam.now) if (v > max) max = v;
  return max;
};

const total = (foam: FoamField) => {
  let sum = 0;
  for (const v of foam.now) sum += v;
  return sum;
};

/** A flat basin with walls, so nothing leaves. */
function basin(size: number, wall: number, rim: number) {
  const grid = createGrid(size, size);
  fillTerrain(grid, 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < rim || y < rim || x >= size - rim || y >= size - rim) setHeight(grid, x, y, wall);
    }
  }
  return grid;
}

describe("foam", () => {
  test("still water is not white", () => {
    const grid = basin(20, 12, 4);
    const field = createWaterField(grid);
    const foam = createFoam(field.columns);
    for (let y = 4; y <= 15; y++) for (let x = 4; x <= 15; x++) pourAt(field, x, y, 6, 1);
    run(field, foam, 15);
    // The wind never lets it be perfectly still, and that is the point: a
    // surface that foams because something is always moving it would be white
    // all over, for ever.
    expect(most(foam)).toBe(0);
  });

  test("a pour on a flat plain goes white, with no crest to stand on", () => {
    // Nothing on a flat sheet stands above the sheet, so there is no crest
    // here at all — measured, the tallest anywhere is under a tenth of what
    // the water could carry. What a spreading pour has instead is a surface
    // coming up fast, which is what the solver's test is, and it is why the
    // edge of a wave washing up a beach is white.
    const grid = createGrid(32, 32);
    fillTerrain(grid, 1);
    const field = createWaterField(grid);
    const foam = createFoam(field.columns);
    pourAt(field, 16, 16, 6, 1);
    run(field, foam, 0.4);

    const columns = field.columns;
    const { nx, ny, ground, depth, params } = columns;
    let tallest = 0;
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const i = y * nx + x;
        if (depth[i] <= params.dryDepth) continue;
        const floor = ground[i];
        let around = 0, n = 0;
        for (const j of [i - 1, i + 1, i - nx, i + nx]) {
          if (depth[j] <= params.dryDepth) continue;
          const v = ground[j] + depth[j];
          around += v > floor ? v : floor;
          n++;
        }
        if (n >= 2) tallest = Math.max(tallest, floor + depth[i] - around / n);
      }
    }
    // Nothing on the sheet is a crest worth the name.
    expect(tallest / 6).toBeLessThan(0.4);
    expect(most(foam)).toBeGreaterThan(0.8);
  });

  test("a sheet on a plateau does not foam at the cliff beside it", () => {
    // A sheet lying still on a plateau is not breaking, however far below it
    // the next water is. An earlier criterion compared a column against its
    // neighbours and had to be taught that a cliff is not a trough; this one
    // asks only how fast the surface is moving, and a sheet at rest is not.
    const grid = createGrid(20, 20);
    fillTerrain(grid, 1);
    for (let y = 6; y <= 13; y++) for (let x = 6; x <= 13; x++) setHeight(grid, x, y, 10);
    const field = createWaterField(grid);
    const foam = createFoam(field.columns);
    for (let y = 7; y <= 12; y++) for (let x = 7; x <= 12; x++) pourAt(field, x, y, 4, 1);
    run(field, foam, 6);

    const nx = field.columns.nx;
    let onTop = 0;
    for (let cy = 6 * 4; cy < 14 * 4; cy++) {
      for (let cx = 6 * 4; cx < 14 * 4; cx++) if (foam.now[cy * nx + cx] > 0.05) onTop++;
    }
    expect(onTop).toBe(0);
  });

  test("the white outlives the crest that made it, and then goes", () => {
    // Foam that is a function of the surface this frame appears and vanishes
    // with the geometry under it, which reads as a highlight rather than as
    // something floating on the water.
    const grid = basin(24, 12, 4);
    const field = createWaterField(grid);
    const foam = createFoam(field.columns);
    for (let y = 4; y <= 19; y++) for (let x = 4; x <= 19; x++) pourAt(field, x, y, 4, 1);
    run(field, foam, 8);
    expect(total(foam)).toBe(0);

    for (let y = 10; y <= 13; y++) for (let x = 10; x <= 13; x++) pourAt(field, x, y, 14, 1);
    run(field, foam, 1);
    const splash = total(foam);
    expect(splash).toBeGreaterThan(20);

    // A basin this hard hit rings for a long time — the fluid's own damping is
    // deliberately weak, so a quarter of a disturbance is still there a minute
    // later — and while it is still breaking it is still white. What must not
    // happen is white that never leaves.
    run(field, foam, 29);
    expect(total(foam)).toBeLessThan(splash * 0.02);
  });

  test("a ripple is not a breaker, and a wave worth the name is", () => {
    // The gap that used to need a criterion of its own: out in the middle of a
    // full basin there is nothing to be shallow over and the water is going
    // nowhere in particular, so a pond could never break however big the wave
    // — not until the wave was as tall as the pond is deep.
    const pond = (slug: number) => {
      const grid = basin(28, 30, 4);
      const field = createWaterField(grid);
      const foam = createFoam(field.columns);
      for (let y = 4; y <= 23; y++) for (let x = 4; x <= 23; x++) pourAt(field, x, y, 8, 1);
      run(field, foam, 12);
      expect(most(foam)).toBe(0);
      for (let y = 12; y <= 15; y++) for (let x = 12; x <= 15; x++) pourAt(field, x, y, slug, 1);
      run(field, foam, 1.5);

      const { nx, ny, depth, params } = field.columns;
      let open = 0, white = 0;
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) {
          const i = y * nx + x;
          if (depth[i] <= params.dryDepth) continue;
          if (![i - 1, i + 1, i - nx, i + nx].every((j) => depth[j] > params.dryDepth)) continue;
          open++;
          if (foam.now[i] > 0.1) white++;
        }
      }
      return white / open;
    };

    // A ripple leaves a tenth of a percent of the water white — a column here
    // and there, which is nothing you would see. A wave worth the name goes
    // white along its crest and nowhere else.
    expect(pond(2)).toBeLessThan(0.01);
    const big = pond(8);
    expect(big).toBeGreaterThan(0.04);
    expect(big).toBeLessThan(0.5);
  });

  test("a fed waterfall lands white; a trickle down the same cliff does not", () => {
    const cliff = () => {
      const grid = createGrid(20, 20);
      fillTerrain(grid, 1);
      for (let y = 0; y < 20; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, 12);
      const field = createWaterField(grid);
      return { field, foam: createFoam(field.columns) };
    };

    const fed = cliff();
    for (let n = 0; n < 60 * 8; n++) {
      for (let y = 8; y <= 10; y++) pourAt(fed.field, 3, y, 0.4, 1);
      stepWater(fed.field, 1 / 60);
      const region = activeBox(fed.field.columns);
      if (region) stepFoam(fed.foam, fed.field.columns, 1 / 60, region);
    }

    const drip = cliff();
    for (let n = 0; n < 60 * 8; n++) {
      for (let y = 8; y <= 10; y++) pourAt(drip.field, 3, y, 0.004, 1);
      stepWater(drip.field, 1 / 60);
      const region = activeBox(drip.field.columns);
      if (region) stepFoam(drip.foam, drip.field.columns, 1 / 60, region);
    }

    expect(most(fed.foam)).toBeGreaterThan(0.7);
    expect(most(drip.foam)).toBeLessThan(0.15);
  });
});
