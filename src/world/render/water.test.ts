/**
 * Drawing the water surface.
 *
 * These tests read the VERTICES the mesh ends up holding, not a screenshot,
 * because the one bug this file exists for looked perfectly healthy from the
 * outside: the polygons were built, filled and batched, they were simply all
 * the same polygon. A test that counted draws would have passed.
 */
import { describe, expect, test } from "bun:test";

import { FLOW_DEFAULTS } from "../../fluid/columns";
import {
  COLUMNS_PER_TILE, createWaterField, pourAt, runSources, stepWater, syncGround,
  type WaterField,
} from "../water/field";
import { createGrid, fillTerrain, setHeight } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { createBandLayer } from "./bands";
import { colourAt, quadAt, type QuadBatch } from "./quads";
import { createWaterLayer, destroyWaterLayer, drawWater, asideAt } from "./water";

/** Every quad a band's batch holds this frame, as flat point arrays. */
function polysOf(b: QuadBatch): number[][] {
  const out: number[][] = [];
  for (let q = 0; q < b.n; q++) out.push(quadAt(b, q));
  return out;
}

/** Every quad on the whole layer. */
const allPolys = (strips: QuadBatch[]) => strips.flatMap(polysOf);

/**
 * Whether a quad is a DROP FACE rather than a piece of surface.
 *
 * A surface quad is a DIAMOND, and the two ends of a diamond's long axis sit
 * at the same screen x — the tile step cancels between them. A face is a
 * vertical band along one edge, so they do not. Deliberately not a test on the
 * left and right pairs sharing an x: a face is full width at the lip and
 * narrower at the foot, so they no longer do.
 */
const isFace = (p: number[]) => p[0] !== p[4];

function scene(w = 16, h = 16) {
  const grid = createGrid(w, h);
  fillTerrain(grid, 1);
  const field = createWaterField(grid);
  const bands = createBandLayer(w, h);
  const wl = createWaterLayer(field, bands, 1);
  return { grid, field, bands, wl };
}

/** A square of tiles, poured. */
function pool(field: WaterField, x0: number, y0: number, n: number, amount = 6) {
  for (let y = y0; y < y0 + n; y++) {
    for (let x = x0; x < x0 + n; x++) pourAt(field, x, y, amount, 1);
  }
}

describe("how far the ground falls away beside a corner", () => {
  // What tells a SHORE from a LIP, and the rim rule turns on which. Measured
  // here rather than in corner-rule.ts because it is the indexing that can be
  // wrong: a corner is named by its own coordinates and reads the four COLUMNS
  // that meet there, which are the ones a step back in each direction.
  function ground(w: number, h: number) {
    const grid = createGrid(w, h);
    fillTerrain(grid, 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setHeight(grid, x, y, 4);
    const field = createWaterField(grid);
    syncGround(field, grid);
    return { grid, field };
  }

  test("nothing, over ground that stays where it is", () => {
    const { field } = ground(8, 8);
    const bed = field.columns.ground[0];
    expect(asideAt(field.columns, 12, 12, bed)).toBe(0);
  });

  test("the whole of the step, at the corners of a hole in the ground", () => {
    const { grid, field } = ground(8, 8);
    // One tile dropped by two half steps. Tiles are COLUMNS_PER_TILE columns wide,
    // so the hole is the block of columns from 8 to 11 inclusive.
    setHeight(grid, 2, 2, 2);
    syncGround(field, grid);
    const bed = field.columns.ground[0];
    const deep = bed - field.columns.ground[8 * field.columns.nx + 8];
    expect(deep).toBeGreaterThan(0);

    // Every corner ON the hole's rim sees it — the corner at column 8 is the
    // one between column 7 and column 8.
    expect(asideAt(field.columns, 8, 8, bed)).toBeCloseTo(deep, 12);
    expect(asideAt(field.columns, 12, 12, bed)).toBeCloseTo(deep, 12);
    // And a corner one further out does not, or the fringe would be two wide.
    expect(asideAt(field.columns, 7, 7, bed)).toBe(0);
    expect(asideAt(field.columns, 13, 13, bed)).toBe(0);
  });

  test("unbounded at the rim of the map, where there is no neighbour", () => {
    // A cut through the world is not a shore: the terrain shows its skirt
    // there and the water has to keep a cross-section to match it.
    const { field } = ground(8, 8);
    const { nx, ny } = field.columns;
    const bed = field.columns.ground[0];
    expect(asideAt(field.columns, 0, 4, bed)).toBe(Infinity);
    expect(asideAt(field.columns, 4, 0, bed)).toBe(Infinity);
    expect(asideAt(field.columns, nx, 4, bed)).toBe(Infinity);
    expect(asideAt(field.columns, 4, ny, bed)).toBe(Infinity);
    // One corner in from the edge is ordinary ground again.
    expect(asideAt(field.columns, 1, 4, bed)).toBe(0);
  });
});

describe("the surface the mesh carries", () => {
  test("every wet column gets its OWN quad", () => {
    // The regression this file was written for. A shared point buffer left
    // every polygon reading the last quad written into it, and the whole lake
    // collapsed onto a quarter of a tile: invisible, and very fast.
    const { field, bands, wl } = scene();
    pool(field, 4, 4, 4);
    drawWater(wl, field, bands, 1 / 60);

    const polys = allPolys(wl.strips);
    expect(polys.length).toBeGreaterThan(20);
    expect(new Set(polys.map((p) => p.join(","))).size).toBe(polys.length);
    destroyWaterLayer(wl);
  });

  test("the quads span the whole pool, not one tile of it", () => {
    const { field, bands, wl } = scene();
    pool(field, 4, 4, 4);
    drawWater(wl, field, bands, 1 / 60);

    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of allPolys(wl.strips)) {
      for (let k = 0; k < p.length; k += 2) {
        x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]);
        y0 = Math.min(y0, p[k + 1]); y1 = Math.max(y1, p[k + 1]);
      }
    }
    // Four tiles across is about four diamonds wide and four tall on screen.
    expect(x1 - x0).toBeGreaterThan(250);
    expect(y1 - y0).toBeGreaterThan(125);
    destroyWaterLayer(wl);
  });

  test("a tile is COLUMNS_PER_TILE squared surface quads when it is fully wet", () => {
    const { field, bands, wl } = scene();
    pourAt(field, 5, 5, 6, 1);
    // Pinned at rim NOUGHT — the rule this replaced. A puddle on flat
    // ground is bounded by a SHORE, so the rim ends it in a waterline and
    // there is no pane here at all any more; `what the rim rule does to the
    // faces` is the same scene from the other side. Kept because the count
    // is what a face used to be, and the surface quads either way.
    drawWater(wl, field, bands, 1 / 60, true, 0);
    const polys = polysOf(wl.strips[10]);
    expect(polys.filter((p) => !isFace(p)).length).toBe(COLUMNS_PER_TILE * COLUMNS_PER_TILE);
    // Poured onto dry ground it stands proud of it, so the columns along its
    // two down-screen edges drop to the bare ground. Only those: a column with
    // a wet neighbour inside the same tile has nothing to fall to.
    //
    // And they are in the NEXT band, because those edges are the TILE's far
    // edges: a face there hangs down into the diamond of the tile in front and
    // is filed with it. See the note at the call site.
    const faces = [...polysOf(wl.strips[10]), ...polysOf(wl.strips[11])].filter(isFace);
    expect(faces.length).toBe(2 * COLUMNS_PER_TILE);
    expect(polys.filter(isFace).length).toBe(0);
    destroyWaterLayer(wl);
  });

  test("a shallow column is drawn, but faded almost to nothing", () => {
    // Not SKIPPED, which is what it used to be. A hard cutoff is invisible on
    // a shoreline and ruinous on a sheet lying at exactly that depth all over,
    // which is what a raised tile holds: it punched holes in the sheet and you
    // could see the tile through them.
    const { field, bands, wl } = scene();
    pourAt(field, 5, 5, 0.05, 1);      // damp, not wet
    drawWater(wl, field, bands, 1 / 60);
    const drawn = allPolys(wl.strips).filter((p) => !isFace(p));
    expect(drawn.length).toBe(COLUMNS_PER_TILE * COLUMNS_PER_TILE);
    for (const b of wl.strips) {
      for (let q = 0; q < b.n; q++) {
        if (isFace(quadAt(b, q))) continue;
        for (let v = 0; v < 4; v++) expect(colourAt(b, q, v) >>> 24).toBeLessThan(40);
      }
    }
    destroyWaterLayer(wl);
  });

  test("a big wave does not tear the sheet open", () => {
    // The bug: a corner far from a column's own surface used to be dropped in
    // favour of that surface, to stop a plateau's last quad diving toward the
    // water below it. But "far" is a threshold, and a threshold is a decision
    // each column makes for ITSELF — put a wave through a pond and the crest
    // crosses it while the trough beside it does not, so the two stop sharing
    // the corner between them and the sheet splits. Nothing at rest, 2.3% of
    // edges torn at a modest wave, 19% at a big one, gaps up to two hundred
    // pixels of ground showing through the water.
    const torn = (jolt: number) => {
      const grid = createGrid(32, 32);
      fillTerrain(grid, 1);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) if (x < 3 || y < 3 || x > 28 || y > 28) setHeight(grid, x, y, 30);
      }
      const field = createWaterField(grid, { ...FLOW_DEFAULTS, wind: 0 });
      const bands = createBandLayer(32, 32);
      const wl = createWaterLayer(field, bands, 1);
      for (let y = 3; y <= 28; y++) for (let x = 3; x <= 28; x++) pourAt(field, x, y, 6, 1);
      for (let n = 0; n < 60 * 20; n++) stepWater(field, 1 / 60);
      for (let y = 14; y <= 17; y++) for (let x = 14; x <= 17; x++) pourAt(field, x, y, jolt, 1);
      for (let n = 0; n < 40; n++) stepWater(field, 1 / 60);
      drawWater(wl, field, bands, 1 / 60);

      // Every surface quad back to the column that pushed it: coverage is one
      // to one, and `fillQuads` walks the columns in a known order.
      const C = field.columns;
      const owner = new Map<number, { x: number[]; y: number[] }>();
      const perBand = new Map<number, number[]>();
      for (let cy = 0; cy < C.ny; cy++) {
        for (let cx = 0; cx < C.nx; cx++) {
          if (C.depth[cy * C.nx + cx] <= C.params.dryDepth) continue;
          const b = Math.floor(cx / COLUMNS_PER_TILE) + Math.floor(cy / COLUMNS_PER_TILE);
          const list = perBand.get(b) ?? [];
          list.push(cy * C.nx + cx);
          perBand.set(b, list);
        }
      }
      for (const [b, cols] of perBand) {
        const batch = wl.strips[b];
        const surfaces: number[] = [];
        for (let q = 0; q < batch.n; q++) if (!isFace(quadAt(batch, q))) surfaces.push(q);
        expect(surfaces.length).toBe(cols.length);
        cols.forEach((i, k) => owner.set(i, {
          x: quadAt(batch, surfaces[k]).filter((_, n) => n % 2 === 0),
          y: quadAt(batch, surfaces[k]).filter((_, n) => n % 2 === 1),
        }));
      }

      // Corner 1 of a column is corner 0 of the one to its east, and corner 2
      // is that one's corner 3. Both must match exactly, or there is a hole.
      let pairs = 0, split = 0;
      for (const [i, a] of owner) {
        const east = owner.get(i + 1);
        if (!east || (i % C.nx) === C.nx - 1) continue;
        pairs++;
        if (a.y[1] !== east.y[0] || a.y[2] !== east.y[3]) split++;
      }
      destroyWaterLayer(wl);
      expect(pairs).toBeGreaterThan(1000);
      return split;
    };
    for (const jolt of [0, 6, 14, 30]) expect(torn(jolt)).toBe(0);
  });

  test("every column holding water is drawn — the sheet has no holes in it", () => {
    // The regression, and it took a solver change to expose it: once water
    // stopped evacuating a raised tile, raised tiles held thin sheets, and a
    // thin sheet sits at exactly the depth the cutoff was set at. 329 columns
    // ringed on all four sides by water they were not drawn with.
    const grid = createGrid(32, 32);
    fillTerrain(grid, 1);
    for (const [x0, y0, h] of [[6, 6, 2], [18, 6, 4], [6, 18, 8], [18, 18, 1]] as const) {
      for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + 6; x++) setHeight(grid, x, y, h);
    }
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) if (x < 2 || y < 2 || x > 29 || y > 29) setHeight(grid, x, y, 24);
    }
    const field = createWaterField(grid);
    const bands = createBandLayer(32, 32);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 2; y <= 29; y++) for (let x = 2; x <= 29; x++) pourAt(field, x, y, 5, 1);
    for (let n = 0; n < 60 * 12; n++) stepWater(field, 1 / 60);
    drawWater(wl, field, bands, 1 / 60);
    let holding = 0;
    for (const d of field.columns.depth) if (d > field.columns.params.dryDepth) holding++;
    const surfaces = allPolys(wl.strips).filter((p) => !isFace(p)).length;
    expect(holding).toBeGreaterThan(4000);
    expect(surfaces).toBe(holding);
    destroyWaterLayer(wl);
  });

  test("a face is full width top and bottom, so a run of them is one sheet", () => {
    // The complaint this started from: inset from both sides by the flow, the
    // faces along a cliff a river was running off were a row of ribbons with
    // the rock showing between them. Tapered into the drop instead, they were
    // a row of wedges, which reads as bunting rather than water. How much is
    // going over is in the OPACITY.
    const grid = createGrid(16, 16);
    fillTerrain(grid, 1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, 10);
    const field = createWaterField(grid);
    const bands = createBandLayer(16, 16);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 4; y <= 8; y++) pourAt(field, 7, y, 3, 1);
    for (let n = 0; n < 30; n++) stepWater(field, 1 / 60);
    drawWater(wl, field, bands, 1 / 60);

    const faces = allPolys(wl.strips).filter(isFace);
    expect(faces.length).toBeGreaterThan(0);
    // One column's edge is a quarter tile across, which is a half diamond
    // width on screen: HW / COLUMNS_PER_TILE.
    const full = HW / COLUMNS_PER_TILE;
    // To four places, not six: a fall LEANS now, and adding the same drift to
    // both ends of an edge and then projecting is not bit-for-bit the same
    // arithmetic as not adding it. Two millionths of a pixel is not a ribbon.
    for (const p of faces) {
      expect(Math.abs(p[0] - p[2])).toBeCloseTo(full, 4);
      expect(Math.abs(p[4] - p[6])).toBeCloseTo(full, 4);
    }
    destroyWaterLayer(wl);
  });

  test("a face is one flat alpha, and never a wall", () => {
    const grid = createGrid(16, 16);
    fillTerrain(grid, 1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, 10);
    const field = createWaterField(grid);
    const bands = createBandLayer(16, 16);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 4; y <= 8; y++) pourAt(field, 7, y, 3, 1);
    for (let n = 0; n < 30; n++) stepWater(field, 1 / 60);
    drawWater(wl, field, bands, 1 / 60);

    let solidWall = 0;
    for (const b of wl.strips) {
      for (let q = 0; q < b.n; q++) {
        if (!isFace(quadAt(b, q))) continue;
        const top = colourAt(b, q, 0) >>> 24, foot = colourAt(b, q, 2) >>> 24;
        // FLAT, top to bottom. Lightening the waterline is the physical story
        // — you are looking through less water at the top of a face than at
        // the bottom — and drawn it is worse, because the grade puts the
        // ground's own colour through the top half of every edge.
        expect(top).toBe(foot);
        // Water, not frosted glass. This used to be a flat cap at 140 — half
        // solid, whatever the water was doing — and that cap is what made a
        // deep body and a heavy fall both read as things you could see the
        // rock through. What replaced it is a RAMP, so the bound that is still
        // worth holding is the one at the end of it: water always lets
        // something through, and the ramp tops out at 0.92.
        if (Math.max(top, foot) > 240) solidWall++;
      }
    }
    // Falls are not in this mesh at all any more — they thin down their own
    // length and are their own layer, in `render/falls-render`. Everything
    // left here is the side of a body of water.
    expect(solidWall).toBe(0);
    destroyWaterLayer(wl);
  });

  test("and how solid it is follows how much water there is", () => {
    // The ramp, which is the whole of what the flat pair of numbers was
    // missing: you see through the edge of a puddle and you do not see through
    // the edge of a lake. Same cliff, same everything, twice.
    const boldest = (depth: number) => {
      const grid = createGrid(16, 16);
      fillTerrain(grid, 1);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, 10);
      const field = createWaterField(grid);
      const bands = createBandLayer(16, 16);
      const wl = createWaterLayer(field, bands, 1);
      for (let y = 4; y <= 8; y++) for (let x = 4; x <= 7; x++) pourAt(field, x, y, depth, 1);
      drawWater(wl, field, bands, 1 / 60);
      let most = 0;
      for (const b of wl.strips) {
        for (let q = 0; q < b.n; q++) {
          if (!isFace(quadAt(b, q))) continue;
          most = Math.max(most, colourAt(b, q, 2) >>> 24);
        }
      }
      destroyWaterLayer(wl);
      return most;
    };
    const puddle = boldest(0.5), lake = boldest(8);
    expect(lake).toBeGreaterThan(puddle * 1.5);
    expect(lake).toBeGreaterThan(200);            // near enough a curtain
    expect(puddle).toBeLessThan(140);             // still a veil
  });

  test("the lips of neighbouring faces meet, leaving no rock between them", () => {
    const grid = createGrid(16, 16);
    fillTerrain(grid, 1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, 10);
    const field = createWaterField(grid);
    const bands = createBandLayer(16, 16);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 3; y <= 9; y++) pourAt(field, 7, y, 4, 1);
    for (let n = 0; n < 30; n++) stepWater(field, 1 / 60);
    // Pinned at rim NOUGHT. These are the panes along a LIP, which the rim
    // now hands to the sheet, so with the rule at its default there are
    // none here to abut. What it checks — that a run of faces is one sheet
    // and not a row of ribbons — still holds wherever faces ARE drawn, and
    // this is the scene the complaint came from.
    drawWater(wl, field, bands, 1 / 60, true, 0);

    // Every DISTINCT lip along the cliff, as a screen-x span, sorted and
    // walked. Distinct because one edge can carry both the side of the water
    // and a fall going over it, and those share a lip exactly.
    const seen = new Set<string>();
    const lips = allPolys(wl.strips).filter(isFace)
      .map((p) => [Math.min(p[0], p[2]), Math.max(p[0], p[2])] as const)
      .filter((sp) => { const k = sp.join(","); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a[0] - b[0]);
    expect(lips.length).toBeGreaterThan(4);
    let touching = 0;
    for (let k = 1; k < lips.length; k++) {
      if (Math.abs(lips[k][0] - lips[k - 1][1]) < 1e-6) touching++;
    }
    // A run of abutting lips, not a scatter of separated ribbons.
    expect(touching).toBeGreaterThan(lips.length / 2);
    destroyWaterLayer(wl);
  });

  test("water running to the RIM of the map still has a body under it", () => {
    // The edge of the map is not a neighbour, and the side face used to give
    // up when it could not find one. What that drew was a sheet that stopped
    // dead at the rim with the terrain's own skirt showing through where the
    // water's body should have been — most visible on exactly the maps where
    // water is meant to run off the edge, which is all of them by default.
    //
    // A map flooded corner to corner has no dry neighbour anywhere, so every
    // face in it is a rim face and there is nothing else it could be.
    const grid = createGrid(8, 8);
    fillTerrain(grid, 1);
    const field = createWaterField(grid);
    const bands = createBandLayer(8, 8);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pourAt(field, x, y, 4, 1);
    drawWater(wl, field, bands, 1 / 60);

    const faces = allPolys(wl.strips).filter(isFace);
    expect(faces.length).toBeGreaterThan(0);
    const tall = Math.max(...faces.map((p) => Math.abs(p[1] - p[7]))) / HEIGHT_UNIT;
    expect(tall).toBeCloseTo(4, 1);               // as deep as the water is
    destroyWaterLayer(wl);
  });

  test("and so does water standing against a bank that RISES over it", () => {
    // The other half of the same rule. A face buried in the hillside next door
    // used to be squashed to nothing, on the reasoning that nobody can see it
    // — true until x-ray, which makes the hillside translucent on purpose and
    // so turns every one of those into a sheet with a void under it. Drawn
    // always: the normal view is unchanged, because the bank in front is a
    // later band and paints over it.
    const grid = createGrid(12, 12);
    fillTerrain(grid, 1);
    for (let y = 0; y < 12; y++) for (let x = 6; x < 12; x++) setHeight(grid, x, y, 20);
    const field = createWaterField(grid);
    const bands = createBandLayer(12, 12);
    const wl = createWaterLayer(field, bands, 1);
    // A pool on the low ground, reaching the foot of the bank but nowhere near
    // its top, so the bank is dry and stands well above the water.
    for (let y = 3; y <= 8; y++) for (let x = 3; x <= 5; x++) pourAt(field, x, y, 5, 1);
    drawWater(wl, field, bands, 1 / 60);

    const tall = Math.max(
      ...allPolys(wl.strips).filter(isFace).map((p) => Math.abs(p[1] - p[7])),
    ) / HEIGHT_UNIT;
    expect(tall).toBeCloseTo(5, 1);               // the full depth, not nothing
    destroyWaterLayer(wl);
  });

  test("water on a plateau paints NOTHING below the ground it stands on", () => {
    // The bug, and the reason it got worse the higher the ground was: the side
    // of the water ran down to whatever the NEIGHBOUR stood on, so water on a
    // plateau covered the cliff beneath it and the excess was exactly the
    // height of the drop.
    //
    // Drawn the instant it is poured, before any of it has moved: no flux, so
    // no falls, and every face is the side of a body of water.
    const tallestFace = (cliff: number) => {
      const grid = createGrid(20, 20);
      fillTerrain(grid, 1);
      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 10; x++) setHeight(grid, x, y, cliff);
      }
      const field = createWaterField(grid);
      const bands = createBandLayer(20, 20);
      const wl = createWaterLayer(field, bands, 1);
      for (let y = 6; y <= 12; y++) for (let x = 5; x <= 9; x++) pourAt(field, x, y, 4, 1);
      // Pinned at rim NOUGHT. A pool at a plateau's edge is at a LIP and
      // the rim hands its pane to the sheet, so at the default there is no
      // face here to measure. Kept at nought because this is where getting
      // the clamp wrong was WORST — the excess was the height of the cliff
      // — and `resolveSide` pins the rule itself directly.
      drawWater(wl, field, bands, 1 / 60, true, 0);
      // Corner 0 against corner 3 — the SAME end of the edge, top and bottom,
      // so the isometric offset between the two ends cancels and what is left
      // is the height. Corner 0 against corner 2 measures the diagonal.
      const tall = Math.max(
        ...allPolys(wl.strips).filter(isFace).map((p) => Math.abs(p[1] - p[7])),
      );
      destroyWaterLayer(wl);
      return tall / HEIGHT_UNIT;                  // back into half steps
    };
    // The water is four deep. Its side is four tall, on a plateau of any
    // height — it was four PLUS the cliff, which is what you could see.
    expect(tallestFace(0)).toBeCloseTo(4, 1);
    expect(tallestFace(10)).toBeCloseTo(4, 1);
    expect(tallestFace(30)).toBeCloseTo(4, 1);
  });

  test("no part of a sheet on a raised tile is drawn below the tile", () => {
    // One raised tile with water on it AND water on the ground all round, so
    // the corners along its edge average across the step. Only its own surface
    // quads are read — a fall belongs below the bed, the sheet lying on it
    // does not.
    //
    // A ONE-step rise is the case that survived every earlier attempt: the
    // averaged corner lands near enough to the column's surface to pass the
    // far-apart test and is still under the tile's top face.
    const lowestOnTile = (bed: number) => {
      const grid = createGrid(9, 9);
      fillTerrain(grid, 1);
      setHeight(grid, 4, 4, bed);
      const field = createWaterField(grid);
      const bands = createBandLayer(9, 9);
      const wl = createWaterLayer(field, bands, 1);
      for (let y = 2; y <= 6; y++) {
        for (let x = 2; x <= 6; x++) pourAt(field, x, y, x === 4 && y === 4 ? 1 : 1.5, 1);
      }
      for (let n = 0; n < 3; n++) stepWater(field, 1 / 60);
      drawWater(wl, field, bands, 1 / 60);

      // Band 8 holds the raised tile; its quads are the ones within half a
      // diamond of the centre line, the rest of the band being elsewhere.
      const b = wl.strips[8];
      let maxY = -Infinity, n = 0;
      for (let q = 0; q < b.n; q++) {
        const p = quadAt(b, q);
        if (isFace(p)) continue;
        const xs = [p[0], p[2], p[4], p[6]];
        if (Math.min(...xs) < -HW || Math.max(...xs) > HW) continue;
        n++;
        for (let v = 0; v < 4; v++) maxY = Math.max(maxY, p[v * 2 + 1]);
      }
      destroyWaterLayer(wl);
      expect(n).toBe(COLUMNS_PER_TILE * COLUMNS_PER_TILE);
      // The tile's most down-screen corner is at (tx + 0.5, ty + 0.5), so a
      // vertex there at height h lands at (tx + ty + 1) * HH - h * HEIGHT_UNIT.
      return ((4 + 4 + 1) * HH - maxY) / HEIGHT_UNIT;
    };
    for (const bed of [1, 2, 4, 10]) {
      expect(lowestOnTile(bed)).toBeGreaterThanOrEqual(bed - 1e-6);
    }
  });

  test("water with water beside it has no edge to draw, however much it is moving", () => {
    // One body of water is one body: where the neighbour reaches this
    // column's bed the surface quads already cover the join. Drawing an edge
    // wherever two neighbours differed by a hair meant drawing one EVERYWHERE
    // on water that is moving — sixty-eight thousand of them on a flat flooded
    // map, against sixty-five thousand pieces of surface.
    const grid = createGrid(24, 24);
    fillTerrain(grid, 1);
    const field = createWaterField(grid);
    const bands = createBandLayer(24, 24);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 4; y <= 19; y++) for (let x = 4; x <= 19; x++) pourAt(field, x, y, 6, 1);
    for (let n = 0; n < 60 * 3; n++) stepWater(field, 1 / 60);
    drawWater(wl, field, bands, 1 / 60);

    const polys = allPolys(wl.strips);
    const faces = polys.filter(isFace).length;
    expect(polys.length - faces).toBeGreaterThan(500);      // plenty of surface
    // Only the shoreline, which is a fraction of it — not one per column.
    expect(faces).toBeLessThan((polys.length - faces) * 0.25);
    destroyWaterLayer(wl);
  });

  test("a shallow sheet on a raised tile still has an edge holding it down", () => {
    // Refusing to draw one under DROP_MIN left a sheet under a step deep
    // hanging over the tile with nothing joining the two — a panel of water
    // floating above the ground it was lying on.
    const edges = (depth: number) => {
      const grid = createGrid(9, 9);
      fillTerrain(grid, 1);
      setHeight(grid, 4, 4, 4);
      const field = createWaterField(grid);
      const bands = createBandLayer(9, 9);
      const wl = createWaterLayer(field, bands, 1);
      pourAt(field, 4, 4, depth, 1);
      // Pinned at rim NOUGHT — a raised tile's edges are lips, and at the
      // default the sheet going over them is what bounds the water.
      drawWater(wl, field, bands, 1 / 60, true, 0);
      const n = allPolys(wl.strips).filter(isFace).length;
      destroyWaterLayer(wl);
      return n;
    };
    // The two down-screen edges of the tile, a column at a time. However
    // shallow the sheet on it is.
    for (const depth of [0.4, 0.8, 1.5, 3]) {
      expect(edges(depth)).toBe(2 * COLUMNS_PER_TILE);
    }
  });

  test("a fall that stops lets go of its lip instead of vanishing", () => {
    const grid = createGrid(16, 12);
    fillTerrain(grid, 1);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, 14);
    const field = createWaterField(grid);
    const bands = createBandLayer(16, 12);
    const wl = createWaterLayer(field, bands, 1);
    // A slug right at the lip, so it goes over at once and then runs out.
    for (let y = 4; y <= 7; y++) pourAt(field, 7, y, 10, 1);
    const tick = () => {
      stepWater(field, 1 / 60);
      drawWater(wl, field, bands, 1 / 60);
    };
    for (let n = 0; n < 45; n++) tick();

    // Somewhere in the middle of the wall, hanging off nothing: the head has
    // left the lip and the water is on its way down.
    let detached = false;
    for (let n = 0; n < 120 && !detached; n++) {
      tick();
      for (let k = 0; k < field.columns.falls.head.length; k++) {
        if (field.columns.falls.head[k] > 1 && field.columns.falls.front[k] > field.columns.falls.head[k]) detached = true;
      }
    }
    expect(detached).toBe(true);
    destroyWaterLayer(wl);
  });

  test("a fall is drawn where water CROSSES a lip, not where it merely stands above one", () => {
    // A height difference is a cliff. A waterfall is water going over it, and
    // telling them apart is what the flux is for — drawn off the drop alone,
    // there was one under every pond that happened to be on high ground.
    const plateau = (settle: number) => {
      const grid = createGrid(20, 20);
      fillTerrain(grid, 1);
      for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) setHeight(grid, x, y, 10);
      const field = createWaterField(grid);
      const bands = createBandLayer(20, 20);
      const wl = createWaterLayer(field, bands, 1);
      for (let y = 6; y <= 12; y++) for (let x = 5; x <= 9; x++) pourAt(field, x, y, 4, 1);
      for (let n = 0; n < settle; n++) stepWater(field, 1 / 60);
      drawWater(wl, field, bands, 1 / 60);
      // A live fall is one whose front has got further down the wall than its
      // head — see `render/falls`.
      let falls = 0;
      for (let k = 0; k < field.columns.falls.front.length; k++) {
        if (field.columns.falls.front[k] > field.columns.falls.head[k]) falls++;
      }
      destroyWaterLayer(wl);
      return falls;
    };
    // The instant it is poured nothing is moving yet, so nothing is falling —
    // even though it is already sitting on the edge of a ten-step drop.
    expect(plateau(0)).toBe(0);
    // A moment later it is going over.
    expect(plateau(30)).toBeGreaterThan(0);
  });

  test("a drop over a cliff adds a face on top of the surface quads", () => {
    const grid = createGrid(16, 16);
    fillTerrain(grid, 1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, 8);
    const field = createWaterField(grid);
    const bands = createBandLayer(16, 16);
    const wl = createWaterLayer(field, bands, 1);

    // Deep water right at the top of the step, so there is a real drop east.
    pourAt(field, 7, 6, 12, 1);
    drawWater(wl, field, bands, 1 / 60);
    const polys = allPolys(wl.strips);
    expect(polys.filter(isFace).length).toBeGreaterThan(0);
    expect(polys.filter((p) => !isFace(p)).length).toBeGreaterThan(0);
    destroyWaterLayer(wl);
  });
});

describe("shading a sheet over uneven ground", () => {
  /** The alpha byte of a quad's four corners. */
  const alphas = (b: QuadBatch, q: number) =>
    [0, 1, 2, 3].map((v) => colourAt(b, q, v) >>> 24);

  test("opacity comes from each CORNER, so a dip in the bed is a gradient", () => {
    // The complaint this fixes: a flat-shaded quad takes its opacity from its
    // own depth, so under a level puddle every column boundary over a dipped
    // bed was a hard step in the shading. Corner alphas interpolate instead.
    const grid = createGrid(16, 16);
    fillTerrain(grid, 1);
    setHeight(grid, 6, 6, -4);                // a hollow under the middle
    const field = createWaterField(grid);
    const bands = createBandLayer(16, 16);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 4; y <= 8; y++) for (let x = 4; x <= 8; x++) pourAt(field, x, y, 6, 1);
    // Let it find its level: poured and drawn on the same frame every column
    // holds the same SIX, hollow or not, so there is no gradient to read and
    // never was. What this used to pass on was the sides.
    for (let n = 0; n < 60 * 3; n++) stepWater(field, 1 / 60);
    drawWater(wl, field, bands, 1 / 60);

    // SURFACE quads only, which is what this is about. Read across every quad
    // in the band it also passed on the sides, whose two ends used to carry
    // different alphas for a reason of their own — so it was green while
    // saying nothing about the surface, and went red the day the sides became
    // one flat number.
    const over = wl.strips[12];               // band of tile (6,6)
    const tops = [...Array(over.n).keys()].filter((q) => !isFace(quadAt(over, q)));
    expect(tops.length).toBeGreaterThan(0);

    // The quads over the hollow are not flat: deeper water at the corners
    // inside it, shallower at the corners on the rim.
    const varied = tops
      .map((q) => alphas(over, q))
      .filter((a) => Math.max(...a) > Math.min(...a));
    expect(varied.length).toBeGreaterThan(0);

    // And the shading is CONTINUOUS: a corner shared by two columns has one
    // alpha, so neighbouring quads meet without a step.
    const deepest = Math.max(...tops.flatMap((q) => alphas(over, q)));
    const shallowest = Math.min(...tops.flatMap((q) => alphas(over, q)));
    expect(deepest).toBeGreaterThan(shallowest);
    destroyWaterLayer(wl);
  });

  test("a level sheet over LEVEL ground is evenly shaded", () => {
    // The other half of the claim: the gradient tracks the bed, and where the
    // bed is flat there is nothing to see.
    const { field, bands, wl } = scene();
    pool(field, 4, 4, 4);
    drawWater(wl, field, bands, 1 / 60);
    const inner = wl.strips[12];
    const mid = [...Array(inner.n).keys()]
      .map((q) => alphas(inner, q))
      .filter((a) => a.every((v) => v === a[0]));
    expect(mid.length).toBeGreaterThan(0);
    destroyWaterLayer(wl);
  });

  test("deeper corners are more opaque than shallow ones", () => {
    const grid = createGrid(16, 16);
    fillTerrain(grid, 1);
    // The step runs along a BAND, so a whole strip sits on one side of it and
    // can be read without picking quads out of a diagonal that crosses it.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) if (x + y >= 14) setHeight(grid, x, y, -2);
    }
    const field = createWaterField(grid);
    const bands = createBandLayer(16, 16);
    const wl = createWaterLayer(field, bands, 1);
    // Shallow enough either side that neither has run up against full opacity.
    for (let y = 2; y <= 12; y++) for (let x = 2; x <= 12; x++) pourAt(field, x, y, 1.5, 1);
    for (let n = 0; n < 240; n++) stepWater(field, 1 / 60);
    drawWater(wl, field, bands, 1 / 60);

    // Surface quads only: this is about how the sheet is shaded, and the
    // edges around it carry their own opacity for their own reasons.
    const band = (b: number) => {
      const s = wl.strips[b];
      const all = [...Array(s.n).keys()]
        .filter((q) => !isFace(quadAt(s, q)))
        .flatMap((q) => alphas(s, q));
      return all.reduce((t, a) => t + a, 0) / all.length;
    };
    expect(band(18)).toBeGreaterThan(band(10) + 10);   // the low side, and clearly
    destroyWaterLayer(wl);
  });
});

describe("running water reads as running", () => {
  /**
   * The spread of the shading, ignoring the extremes.
   *
   * Not min against max: one corner on a shoreline leans steeply however calm
   * the water behind it is, and a single outlier is not a pattern.
   */
  const spread = (v: number[]) => {
    const a = [...v].sort((x, y) => x - y);
    return a[Math.floor(a.length * 0.95)] - a[Math.floor(a.length * 0.05)];
  };

  /** Every surface vertex's red channel — how light the water is drawn. */
  const shades = (wl: ReturnType<typeof createWaterLayer>) => {
    const out: number[] = [];
    for (const b of wl.strips) {
      for (let q = 0; q < b.n; q++) {
        if (isFace(quadAt(b, q))) continue;
        for (let v = 0; v < 4; v++) out.push(colourAt(b, q, v) & 0xff);
      }
    }
    return out;
  };

  /** A walled channel running downhill, fed by a spring at the top. */
  const river = () => {
    const grid = createGrid(24, 12);
    fillTerrain(grid, 1);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 24; x++) {
        setHeight(grid, x, y, Math.round((22 - x) * 0.5) + (y <= 3 || y >= 8 ? 6 : 0));
      }
    }
    grid.source[6 * 24 + 2] = 8;
    const field = createWaterField(grid);
    const bands = createBandLayer(24, 12);
    const wl = createWaterLayer(field, bands, 1);
    for (let n = 0; n < 60 * 30; n++) {
      runSources(field, grid, 1 / 60);
      stepWater(field, 1 / 60);
    }
    return { grid, field, bands, wl };
  };

  test("a current is drawn in bands of light; a dead calm pond is not", () => {
    const { field, bands, wl } = river();
    drawWater(wl, field, bands, 1 / 60);
    expect(spread(shades(wl))).toBeGreaterThan(40);
    destroyWaterLayer(wl);

    // The same water with nothing moving it: no current, no weather, no bands.
    const grid = createGrid(16, 16);
    fillTerrain(grid, 1);
    const still = createWaterField(grid, { ...FLOW_DEFAULTS, wind: 0 });
    const sb = createBandLayer(16, 16);
    const swl = createWaterLayer(still, sb, 1);
    for (let y = 4; y <= 11; y++) for (let x = 4; x <= 11; x++) pourAt(still, x, y, 4, 1);
    for (let n = 0; n < 60 * 60; n++) stepWater(still, 1 / 60);
    drawWater(swl, still, sb, 1 / 60);
    // Against better than 40 for the river. Not zero: a shoreline leans, and
    // the fringe fades out rather than stopping, so there is always some.
    expect(spread(shades(swl))).toBeLessThan(30);
    destroyWaterLayer(swl);
  });

  test("neighbouring corners agree — the pattern is carried, not computed", () => {
    // The regression this file is for. A plane wave whose phase is the
    // corner's POSITION dotted with the local flow direction cannot be
    // coherent: two neighbours forty tiles from the origin whose flow differs
    // by eight degrees come out four whole cycles apart. Measured on this very
    // river, one column's shade correlated with its neighbour's at 0.002,
    // which is to say television static, which is what it looked like.
    const { field, bands, wl } = river();
    drawWater(wl, field, bands, 1 / 60);

    const vw = field.columns.nx + 1;
    const at = (lag: number) => {
      const a: number[] = [], b: number[] = [];
      for (let y = 1; y < field.columns.ny - 1; y++) {
        for (let x = 1; x < vw - 1 - lag; x++) {
          const v = y * vw + x;
          if (!wl.vn[v] || !wl.vn[v + lag]) continue;
          a.push(wl.vl[v]);
          b.push(wl.vl[v + lag]);
        }
      }
      const mean = (z: number[]) => z.reduce((p, q) => p + q, 0) / z.length;
      const ma = mean(a), mb = mean(b);
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
      }
      return num / Math.sqrt(da * db);
    };
    // Smooth over several columns, which is what "you can see a pattern"
    // means. It is 0.79 and 0.40 as it stands.
    expect(at(1)).toBeGreaterThan(0.5);
    expect(at(2)).toBeGreaterThan(0.2);
    destroyWaterLayer(wl);
  });

  test("and the water carries it downstream", () => {
    const { grid, field, bands, wl } = river();
    drawWater(wl, field, bands, 1 / 60);
    const before = shades(wl);
    for (let n = 0; n < 30; n++) {
      runSources(field, grid, 1 / 60);
      stepWater(field, 1 / 60);
      drawWater(wl, field, bands, 1 / 60);
    }
    const after = shades(wl);
    let moved = 0;
    for (let k = 0; k < Math.min(before.length, after.length); k++) {
      if (Math.abs(before[k] - after[k]) > 6) moved++;
    }
    expect(moved).toBeGreaterThan(before.length * 0.2);
    destroyWaterLayer(wl);
  });

  test("a wave crossing still water takes its shading with it", () => {
    // A rippled pond was drawn with a shade range of nine steps out of
    // thirty-one and ONE percent of its corners changing from one third of a
    // second to the next — which is a photograph. The mesh was rippling
    // underneath a mottle that sat still, because the waves themselves were
    // shaded at four percent of the range and could not be seen at all.
    const grid = createGrid(28, 28);
    fillTerrain(grid, 1);
    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 28; x++) {
        if (x < 4 || y < 4 || x > 23 || y > 23) setHeight(grid, x, y, 12);
      }
    }
    const field = createWaterField(grid);
    const bands = createBandLayer(28, 28);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 4; y <= 23; y++) for (let x = 4; x <= 23; x++) pourAt(field, x, y, 6, 1);
    const run = (frames: number) => {
      for (let n = 0; n < frames; n++) {
        stepWater(field, 1 / 60);
        drawWater(wl, field, bands, 1 / 60);
      }
    };
    run(60 * 15);                                   // settle, with the weather on

    expect(spread([...wl.vl].filter((_, v) => wl.vn[v]))).toBeGreaterThan(6);

    const before = [...wl.vl], wet = [...wl.vn];
    run(20);
    let moved = 0, n = 0;
    for (let v = 0; v < before.length; v++) {
      if (!wet[v] || !wl.vn[v]) continue;
      n++;
      if (Math.abs(before[v] - wl.vl[v]) > 2) moved++;
    }
    expect(moved).toBeGreaterThan(n * 0.15);
    destroyWaterLayer(wl);
  });

  test("a corner is shaded from AVERAGED neighbours, not from their sum", () => {
    // The bug this caught: shading a corner in the same pass that averages
    // them left the tilt reading the next row while it still held the sum of
    // the columns round it, four times what it should be. Every corner it
    // touched pinned at the darkest shade there is, and the bands were
    // computed perfectly and then thrown away.
    //
    // On a dead flat, dead calm pond every corner leans the same way — which
    // is to say not at all — so every one of them is the middle shade.
    const grid = createGrid(16, 16);
    fillTerrain(grid, 1);
    const field = createWaterField(grid, { ...FLOW_DEFAULTS, wind: 0 });
    const bands = createBandLayer(16, 16);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 4; y <= 11; y++) for (let x = 4; x <= 11; x++) pourAt(field, x, y, 4, 1);
    for (let n = 0; n < 60 * 60; n++) stepWater(field, 1 / 60);
    // Pinned at rim NOUGHT, which is what makes every corner alike: at the
    // default the fringe is deliberately a BEVEL and leans, so the flattest
    // pond in the world has a ring of corners that are not the middle. The
    // INTERIOR is what this is about and the interior is untouched.
    drawWater(wl, field, bands, 1 / 60, true, 0);
    const mid = shades(wl);
    expect(Math.min(...mid)).toBeGreaterThan(60);     // nothing pinned at the floor
    destroyWaterLayer(wl);
  });
});

describe("what the rim rule does to the faces", () => {
  /**
   * The other half of every test above that asserts a face EXISTS.
   *
   * A FREE VERTICAL FACE OF WATER CANNOT EXIST. Water is bounded by a
   * container, by a shore, or it is falling, and only one of those three is a
   * pane you can see through. The strength goes in as an argument so that
   * what the rule REPLACED can be pinned beside what it does — the tests
   * above passing nought are the same scenes from the other side.
   *
   * The two halves are deliberately the same scenes: what the rim takes away
   * is exactly what the pinned-at-off tests still assert is there.
   */
  const faceCount = (
    build: (field: WaterField, grid: ReturnType<typeof createGrid>) => void,
    rim: number, w = 16,
  ) => {
    const grid = createGrid(w, w);
    fillTerrain(grid, 1);
    const field = createWaterField(grid);
    build(field, grid);
    const bands = createBandLayer(w, w);
    const wl = createWaterLayer(field, bands, 1);
    drawWater(wl, field, bands, 1 / 60, true, rim);
    // Faces with HEIGHT in them. A quad whose two ends both sit on their own
    // floor makes no fragments, and `resolveSide` leaves those behind rather
    // than paying to blank them — counting one as a pane would be counting
    // something nobody can see.
    const faces = allPolys(wl.strips).filter(isFace)
      .filter((p) => Math.abs(p[1] - p[7]) > 1e-6 || Math.abs(p[3] - p[5]) > 1e-6);
    const tall = faces.length
      ? Math.max(...faces.map((p) => Math.abs(p[1] - p[7]))) / HEIGHT_UNIT : 0;
    destroyWaterLayer(wl);
    return { n: faces.length, tall };
  };

  /** The two end heights of every face with anything in it, in half steps. */
  const faceShapes = (
    build: (field: WaterField, grid: ReturnType<typeof createGrid>) => void,
    rim: number, w = 16,
  ) => {
    const grid = createGrid(w, w);
    fillTerrain(grid, 1);
    const field = createWaterField(grid);
    build(field, grid);
    const bands = createBandLayer(w, w);
    const wl = createWaterLayer(field, bands, 1);
    drawWater(wl, field, bands, 1 / 60, true, rim);
    const out = allPolys(wl.strips).filter(isFace)
      .map((p) => ({
        a: Math.abs(p[1] - p[7]) / HEIGHT_UNIT,
        b: Math.abs(p[3] - p[5]) / HEIGHT_UNIT,
      }))
      .filter((e) => e.a > 1e-6 || e.b > 1e-6);
    destroyWaterLayer(wl);
    return out;
  };

  test("a puddle on flat ground loses its panes: a shore is a waterline", () => {
    // THE FISH TANK, in its simplest form. A pool standing proud of dry ground
    // at its own level had a hard, flat, uniformly translucent side with the
    // grass visible through it undistorted. The water does not end in a wall,
    // it ends in a waterline: the corner comes down to its bed and there is no
    // height left for a face to hang in.
    const puddle = (f: WaterField) => pourAt(f, 5, 5, 6, 1);
    expect(faceCount(puddle, 0).n).toBe(2 * COLUMNS_PER_TILE);
    expect(faceCount(puddle, 1).n).toBe(0);
  });

  test("and so does a pool at a LIP: the sheet leaving it is its boundary", () => {
    // The largest one in any scene, and the one that survived the first cut of
    // this rule. The corner at a lip KEEPS its height — a sheet starts there
    // and needs the thickness — so the pane comes back with it unless the face
    // is handed over separately. A nappe hangs from the surface by the lip's
    // own thickness and drifts by nothing at the lip itself, so at the brink
    // the sheet already covers this face end for end.
    const plateau = (f: WaterField, g: ReturnType<typeof createGrid>) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) setHeight(g, x, y, 10);
      syncGround(f, g);
      for (let y = 6; y <= 10; y++) for (let x = 4; x <= 7; x++) pourAt(f, x, y, 4, 1);
    };
    // With the rule off, a PANE: both ends standing at full depth.
    const off = faceShapes(plateau, 0);
    expect(off.filter((e) => e.a > 1 && e.b > 1).length).toBeGreaterThan(0);
    // With it on, no pane anywhere. What is left is at most a WEDGE where the
    // waterline turns into the lip — one end on the bed, the other carrying
    // the lip's own thickness, which is the shape that transition really is.
    // A rectangle there would be a fish tank; a wedge is the corner of a body
    // of water seen end on.
    for (const e of faceShapes(plateau, 1)) {
      expect(Math.min(e.a, e.b)).toBeCloseTo(0, 6);
    }
  });

  test("but water HELD BY A BANK keeps its full side against it", () => {
    // A container is not a shore. The water does not end at a bank, it is held
    // by one, and it stands full depth right up against it — feathered, a lake
    // in a crater tapers away from the crater wall, and under `?xray`, where
    // the wall in front is translucent on purpose, what is behind it is a
    // sheet with a void under it. That is the bug `sideFace` was fixed for and
    // the rim rule very nearly put back.
    const bowl = (f: WaterField, g: ReturnType<typeof createGrid>) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (x < 4 || x > 11 || y < 4 || y > 11) setHeight(g, x, y, 10);
      }
      syncGround(f, g);
      // Right up to the wall, or the outermost water is standing on the bowl's
      // own floor beside DRY floor, which is a shore and not a container.
      for (let y = 4; y <= 11; y++) for (let x = 4; x <= 11; x++) pourAt(f, x, y, 4, 1);
    };
    expect(faceCount(bowl, 1).n).toBeGreaterThan(0);
    // And as tall as the water is deep, the same as with the rule off.
    expect(faceCount(bowl, 1).tall).toBeCloseTo(faceCount(bowl, 0).tall, 6);
  });

  test("and water running to the EDGE OF THE MAP keeps its cross-section", () => {
    // A cut through the world is honest when the thing cut is the world. The
    // terrain shows its own skirt at the map's edge and the water should show
    // a matching cross-section, so an off-map neighbour counts as the biggest
    // step there is and the rule stays off. A map flooded corner to corner has
    // no dry neighbour anywhere, so every face in it is a rim face.
    const flooded = (f: WaterField) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pourAt(f, x, y, 4, 1);
    };
    expect(faceCount(flooded, 1, 8).n).toBeGreaterThan(0);
    expect(faceCount(flooded, 1, 8).tall).toBeCloseTo(4, 1);   // as deep as the water
  });

  test("a BEACH is a shore, and a wall is not, with the same ramp between", () => {
    // The rule reads one number — the step the ground makes beside the corner,
    // either way up — so a bank that rises gently is a shore and keeps the
    // waterline, and one that rises sharply is a container and keeps the body.
    // Ramped rather than switched, or a bank being raised a half step at a
    // time pops a whole ring of surface.
    const bank = (h: number) => faceCount((f, g) => {
      for (let y = 0; y < 16; y++) for (let x = 8; x < 16; x++) setHeight(g, x, y, h);
      syncGround(f, g);
      for (let y = 4; y <= 11; y++) for (let x = 4; x <= 7; x++) pourAt(f, x, y, 4, 1);
    }, 1).tall;
    // Monotone from a beach to a wall, and the wall keeps the whole body.
    let last = -Infinity;
    for (const h of [0, 1, 2, 3, 4, 6]) {
      const t = bank(h);
      expect(t).toBeGreaterThanOrEqual(last - 1e-9);
      last = t;
    }
    expect(bank(6)).toBeGreaterThan(bank(0));
  });
});

describe("a corner agrees with itself", () => {
  /**
   * A corner carries two heights when two BEDS meet at it, so that a sheet on
   * a plateau and a lake at the foot of its cliff are not averaged into one
   * surface running through the rock between them. These are about when that
   * split should and should not happen.
   */
  const corners = (wl: ReturnType<typeof createWaterLayer>) => {
    let meeting = 0, apart = 0, upsideDown = 0, worst = 0;
    for (let v = 0; v < wl.vs.length; v++) {
      if (!wl.vn[v] || !wl.vnLow[v]) continue;
      meeting++;
      const d = wl.vsLow[v] - wl.vs[v];
      if (Math.abs(d) > 1e-6) apart++;
      if (d > 1e-4) { upsideDown++; worst = Math.max(worst, d); }
    }
    return { meeting, apart, upsideDown, worst };
  };

  test("a dip in the bed under one pool is not two bodies of water", () => {
    // The crack. Drown a dipped bed deep enough and it is one sheet at one
    // level, but the split fired on the bed difference all the same and handed
    // the columns either side of the dip two different heights for the same
    // corner. They differ only by the surface's own ripple — up to 0.57 half
    // steps, with the LOW group the higher one 39% of the time — but a corner
    // that does not agree with itself is a crack, and that is nine pixels of
    // grass showing through twenty half steps of water.
    const w = 20, h = 20;
    const grid = createGrid(w, h);
    fillTerrain(grid, 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dip = Math.sin(x * 0.9) * Math.cos(y * 0.7) > 0.25 ? -6 : 0;
        setHeight(grid, x, y, 10 + dip + (x < 2 || y < 2 || x >= w - 2 || y >= h - 2 ? 40 : 0));
      }
    }
    const field = createWaterField(grid);
    const bands = createBandLayer(w, h);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) pourAt(field, x, y, 20, 1);
    for (let n = 0; n < 60 * 20; n++) {
      stepWater(field, 1 / 60);
      drawWater(wl, field, bands, 1 / 60);
    }
    const c = corners(wl);
    expect(c.meeting).toBeGreaterThan(100);      // the dips really do meet
    // Not one corner may put the LOWER bed's water ABOVE the higher bed's,
    // which is the crack: 198 of them did, by up to 0.57 half steps. And most
    // of them should not be split at all — the ones that remain are at the
    // rim, where a film on the wall really is a separate body from the pool.
    expect(c.upsideDown).toBe(0);
    expect(c.apart).toBeLessThan(c.meeting * 0.3);
    destroyWaterLayer(wl);
  });

  test("but a sheet on a plateau and the lake below it still are", () => {
    // The case the split exists for, and the reason the test above cannot
    // simply be "never split": there is AIR between these two, and averaging
    // them runs the sheet's edge down into the cliff.
    const w = 20, h = 20;
    const grid = createGrid(w, h);
    fillTerrain(grid, 1);
    for (let y = 6; y <= 13; y++) for (let x = 6; x <= 13; x++) setHeight(grid, x, y, 12);
    const field = createWaterField(grid);
    const bands = createBandLayer(w, h);
    const wl = createWaterLayer(field, bands, 1);
    for (let y = 7; y <= 12; y++) for (let x = 7; x <= 12; x++) pourAt(field, x, y, 2, 1);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (x < 6 || x > 13 || y < 6 || y > 13) pourAt(field, x, y, 4, 1);
      }
    }
    for (let n = 0; n < 60 * 15; n++) {
      stepWater(field, 1 / 60);
      drawWater(wl, field, bands, 1 / 60);
    }
    const c = corners(wl);
    expect(c.meeting).toBeGreaterThan(50);
    expect(c.apart).toBe(c.meeting);             // every one of them, kept apart
    destroyWaterLayer(wl);
  });
});

describe("a breaking wave goes white", () => {
  /**
   * The lightest the water's OWN shading can reach, in the red channel.
   *
   * Water is `0x2a6f97` and the tint table stops 45% of the way to white, so
   * nothing that is merely lit — tilted towards the light, streaked by the
   * current — can get past this. Foam carries on up the same ramp from there,
   * which is what makes "whiter than water gets" a thing a test can ask.
   */
  const WATER_TOPS_OUT = 42 + Math.round(0.45 * (255 - 42));

  /** Every surface corner, as (red, alpha). */
  const corners = (wl: ReturnType<typeof createWaterLayer>) => {
    const out: { red: number; alpha: number }[] = [];
    for (const b of wl.strips) {
      for (let q = 0; q < b.n; q++) {
        if (isFace(quadAt(b, q))) continue;
        for (let v = 0; v < 4; v++) {
          const c = colourAt(b, q, v);
          out.push({ red: c & 0xff, alpha: c >>> 24 });
        }
      }
    }
    return out;
  };

  test("a settled pond never leaves the range water is drawn in", () => {
    const { field, bands, wl } = scene(20, 20);
    pool(field, 4, 4, 12, 6);
    for (let n = 0; n < 60 * 12; n++) {
      stepWater(field, 1 / 60);
      drawWater(wl, field, bands, 1 / 60);
    }
    const reds = corners(wl).map((c) => c.red);
    expect(reds.length).toBeGreaterThan(100);
    expect(Math.max(...reds)).toBeLessThanOrEqual(WATER_TOPS_OUT);
    destroyWaterLayer(wl);
  });

  test("the foot of a waterfall is whiter than water gets, and you see less through it", () => {
    const grid = createGrid(20, 20);
    fillTerrain(grid, 1);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, 12);
    const field = createWaterField(grid);
    const bands = createBandLayer(20, 20);
    const wl = createWaterLayer(field, bands, 1);
    for (let n = 0; n < 60 * 8; n++) {
      for (let y = 8; y <= 10; y++) pourAt(field, 3, y, 0.4, 1);
      stepWater(field, 1 / 60);
      drawWater(wl, field, bands, 1 / 60);
    }

    const all = corners(wl);
    const white = all.filter((c) => c.red > WATER_TOPS_OUT);
    expect(white.length).toBeGreaterThan(20);

    // And foam is not see-through. Water is clear; white water is full of air.
    // A crest that went pale and stayed as transparent as the pond behind it
    // read as a highlight painted on the mesh rather than as foam on water.
    const pale = white.reduce((m, c) => Math.max(m, c.alpha), 0);
    const plain = all.filter((c) => c.red <= WATER_TOPS_OUT);
    const median = plain.map((c) => c.alpha).sort((a, b) => a - b)[plain.length >> 1];
    expect(pale).toBeGreaterThan(median * 1.5);
    destroyWaterLayer(wl);
  });
});

describe("which bands get any of it", () => {
  test("an empty field draws nothing and touches no band", () => {
    const { field, bands, wl } = scene();
    drawWater(wl, field, bands, 1 / 60);
    expect(allPolys(wl.strips).length).toBe(0);
    expect(wl.live.size).toBe(0);
    expect(wl.strips.some((b) => b.mesh.visible)).toBe(false);
    destroyWaterLayer(wl);
  });

  test("a face on a tile's far edge is filed with the tile it hangs INTO", () => {
    // The teeth. A side face hangs DOWN from the surface, so a face on a
    // tile's far edge pokes into the diamond of the tile in front of it —
    // whose terrain is a later band and paints over it. On flat water nothing
    // shows, because the tile in front is at the same level and its own water
    // covers the same strip. At a LIP it is six half steps down and covers
    // nothing there, so what is left is ground showing through the sheet:
    // along a stepped cascade, a row of square teeth, one per band, each as
    // tall as the water is deep.
    const { grid, field, bands, wl } = scene();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) setHeight(grid, x, y, 6);
    syncGround(field, grid);
    pourAt(field, 7, 7, 3, 1);                    // the last tile before the drop
    drawWater(wl, field, bands, 1 / 60);

    // Its surface is in band 14; the face on its east edge hangs over the lip
    // and is filed in 15, with the tile it hangs into.
    expect(polysOf(wl.strips[14]).filter(isFace).length).toBe(0);
    expect(polysOf(wl.strips[15]).filter(isFace).length).toBeGreaterThan(0);
  });

  test("but a face against HIGHER ground stays where it is", () => {
    // A tile in front that stands above the water is genuinely in front of it,
    // and its terrain covering the face is the band order doing its job. Filed
    // forward, a pond against a wall would paint its edge up the wall.
    const { grid, field, bands, wl } = scene();
    for (let y = 0; y < 16; y++) for (let x = 8; x < 16; x++) setHeight(grid, x, y, 20);
    syncGround(field, grid);
    pourAt(field, 7, 7, 3, 1);                    // lapping against the wall
    drawWater(wl, field, bands, 1 / 60);

    // The east face is against the wall, so it stays in its own band; the
    // south face is over open ground and goes forward.
    const home = polysOf(wl.strips[14]).filter(isFace);
    expect(home.length).toBeGreaterThan(0);
    expect(polysOf(wl.strips[15]).filter(isFace).length).toBeLessThan(home.length + 1);
  });

  test("water lands in the band of the tile it sits in", () => {
    // Its SURFACE does. The faces on the tile's two far edges are filed one
    // band on, because that is the diamond they hang into — see the call site.
    const { field, bands, wl } = scene();
    pourAt(field, 5, 6, 6, 1);
    // Band 12 holds the two far edges' PANES, so which bands come alive is
    // a question the rim rule answers: on a flat map a puddle is bounded by
    // a shore, has no panes, and never reaches the band in front of it.
    drawWater(wl, field, bands, 1 / 60, true, 0);
    expect([...wl.live].sort((a, b) => a - b)).toEqual([11, 12]);
    drawWater(wl, field, bands, 1 / 60);
    expect([...wl.live].sort((a, b) => a - b)).toEqual([11]);
    expect(wl.strips[11].mesh.visible).toBe(true);
    destroyWaterLayer(wl);
  });

  test("bands off screen are culled, and empty when they leave", () => {
    const { field, bands, wl } = scene();
    pool(field, 4, 4, 4);
    drawWater(wl, field, bands, 1 / 60);
    const wide = wl.live.size;
    expect(polysOf(wl.strips[8]).length).toBeGreaterThan(0);

    bands.visibleLo = 12;
    bands.visibleHi = 13;
    drawWater(wl, field, bands, 1 / 60);
    expect(wl.live.size).toBeLessThan(wide);
    for (const b of wl.live) expect(b).toBeGreaterThanOrEqual(12);
    for (const b of wl.live) expect(b).toBeLessThanOrEqual(13);
    // The bands that went away hold nothing now, and stopped drawing.
    expect(polysOf(wl.strips[8]).length).toBe(0);
    expect(wl.strips[8].mesh.visible).toBe(false);
    destroyWaterLayer(wl);
  });
});

describe("what the GPU is left holding", () => {
  test("a band that empties has its old vertices blanked, not abandoned", () => {
    // The index buffer covers the batch's whole capacity, so a quad left in
    // the buffer keeps being drawn whether or not this frame wrote it.
    const { field, bands, wl } = scene();
    pool(field, 4, 4, 3);
    drawWater(wl, field, bands, 1 / 60);
    const band = [...wl.live][0];
    const batch = wl.strips[band];
    const had = batch.n;
    expect(had).toBeGreaterThan(0);

    for (let y = 4; y < 7; y++) for (let x = 4; x < 7; x++) pourAt(field, x, y, -6, 0);
    drawWater(wl, field, bands, 1 / 60);

    expect(batch.n).toBe(0);
    expect(batch.mesh.visible).toBe(false);
    // Every vertex the GPU can still reach collapsed to the origin.
    for (let k = 0; k < had * 4 * 3; k++) expect(batch.f32[k]).toBe(0);
    destroyWaterLayer(wl);
  });

  test("the buffer is grown, not reallocated per frame", () => {
    const { field, bands, wl } = scene();
    pool(field, 4, 4, 4);
    drawWater(wl, field, bands, 1 / 60);
    const caps = wl.strips.map((b) => b.cap);
    const arrays = wl.strips.map((b) => b.f32);
    for (let n = 0; n < 5; n++) drawWater(wl, field, bands, 1 / 60);
    expect(wl.strips.map((b) => b.cap)).toEqual(caps);
    wl.strips.forEach((b, i) => expect(b.f32).toBe(arrays[i]));
    destroyWaterLayer(wl);
  });

  test("a batch grows to fit a band that fills up", () => {
    const { field, bands, wl } = scene();
    pourAt(field, 5, 6, 6, 1);
    drawWater(wl, field, bands, 1 / 60);
    const batch = wl.strips[11];
    const cap0 = batch.cap;

    // The whole band, which is far more quads than one tile needed.
    for (let x = 0; x < 12; x++) pourAt(field, x, 11 - x, 6, 1);
    drawWater(wl, field, bands, 1 / 60);
    expect(batch.n).toBeGreaterThan(cap0);
    expect(batch.cap).toBeGreaterThan(cap0);
    expect(batch.cap).toBeGreaterThanOrEqual(batch.n);
    expect(batch.f32.length).toBe(batch.cap * 4 * 3);
    const polys = polysOf(batch);
    expect(new Set(polys.map((p) => p.join(","))).size).toBe(polys.length);
    destroyWaterLayer(wl);
  });

  test("deeper water is more opaque, and the colour rides with the vertex", () => {
    const { field, bands, wl } = scene();
    pourAt(field, 5, 6, 1, 1);
    drawWater(wl, field, bands, 1 / 60);
    const shallow = wl.strips[11].u32[2] >>> 24;

    pourAt(field, 5, 6, 8, 1);
    drawWater(wl, field, bands, 1 / 60);
    const deep = wl.strips[11].u32[2] >>> 24;

    expect(deep).toBeGreaterThan(shallow);
    destroyWaterLayer(wl);
  });
});
