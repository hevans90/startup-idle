/**
 * Waterfalls: the parabola, and where its pieces are filed.
 *
 * These used to live with the water mesh, because a fall used to BE two more
 * parts of it. It is its own layer now for one reason, and that reason is the
 * thing most of these check: water thrown off a lip travels toward the camera
 * as it drops, so the band a piece of it belongs in is not the band the lip is
 * in, and a mesh sorted by column has no way to say so.
 */
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, setHeight, setSource } from "../grid";
import {
  COLUMNS_PER_TILE, createWaterField, pourAt, runSources, stepWater, tileOf,
} from "../water/field";
import {
  BREAK, FALL_THROW, driftAt, fallExtent, falling, throwOf,
} from "../../fluid/falls";
import { activeBox } from "../../fluid/columns";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { createBandLayer } from "./bands";
import { colourAt, quadAt, type QuadBatch } from "./quads";
import {
  alongLip, createFallLayer, destroyFallLayer, drawFalls, pourOf, sharedBrink,
  sharedFoam, sharedLip, sharedLit, sharedPour, sharedShown, sharedThrow,
} from "./falls-render";
import {
  AERATED, FRAY, NAPPE_STEPS, breakingAt, nappeSteps, sheetLook, thinAt,
  type NappeStep, type SheetLook,
} from "./nappe";
import {
  LIGHTEST, SHADES, TINTS, createWaterLayer, destroyWaterLayer, drawWater,
  paleAt, surfaceLook,
} from "./water";

describe("the parabola a fall follows", () => {
  test("it goes out as the ROOT of how far it has come down", () => {
    // Not linearly, which is what one straight quad from lip to front drew. A
    // projectile is in the air `sqrt(2h/g)` seconds, so four times the drop is
    // twice the time and twice the distance out.
    const near = driftAt(1, 4), far = driftAt(1, 16);
    expect(far / near).toBeCloseTo(2, 6);
    expect(driftAt(1, 0)).toBe(0);                // and nothing at the lip
  });

  test("and the speed it goes out at is capped, where the flow is not", () => {
    // Physically there is nothing to cap. Drawn, a river at the solver's top
    // speed throws itself two tiles and reads as fired from a hose.
    expect(throwOf(0.4)).toBeCloseTo(0.4, 6);
    expect(throwOf(3)).toBe(FALL_THROW);
    expect(throwOf(-2)).toBe(0);                  // and never backwards
  });

  test("it thins as it accelerates, and never quite to nothing", () => {
    // Continuity: the same water goes past every point of it, and it is going
    // `sqrt(2gh)` faster the further it has dropped.
    expect(thinAt(0)).toBeCloseTo(1, 6);
    expect(thinAt(60)).toBeGreaterThan(0);
    expect(thinAt(4)).toBeGreaterThan(thinAt(16));
  });

  test("and it is cut into pieces from the head down to the front", () => {
    const steps = nappeSteps(2, 14);
    expect(steps.length).toBe(NAPPE_STEPS);
    expect(steps[0].from).toBeCloseTo(2, 6);
    expect(steps[steps.length - 1].to).toBeCloseTo(14, 6);
    // Each piece starts where the last one ended, so there is no seam — and
    // since the drift is a function of the DEPTH alone, agreeing about the
    // depth is agreeing about where the sheet is.
    for (let k = 1; k < steps.length; k++) {
      expect(steps[k].from).toBeCloseTo(steps[k - 1].to, 6);
      expect(driftAt(1, steps[k].from)).toBeCloseTo(driftAt(1, steps[k - 1].to), 6);
    }
  });

  test("and it starts COMING APART past a few full steps", () => {
    // Two different things, both true. It thins because it is accelerating
    // and the same water has to fit through a faster place, which is true of
    // an intact sheet the whole way down. Past `BREAK` the solver is also
    // pulling drops out of it and throwing them clear.
    expect(breakingAt(0)).toBe(0);
    expect(breakingAt(BREAK)).toBe(0);            // nothing has broken yet
    expect(breakingAt(BREAK * 1.5)).toBeCloseTo(0.5, 6);
    expect(breakingAt(BREAK * 2)).toBe(1);        // a breaking length on, all of it
    expect(breakingAt(BREAK * 9)).toBe(1);        // and no more than all of it
  });

  test("and coming apart makes it PALER, not absent", () => {
    // The first version of this took the sheet's body away entirely, and it
    // was plainly wrong the moment it was on screen: an eighteen half step
    // fall faded out two half steps short of the floor, and what replaced it
    // was four drops. The bottom of a tall waterfall is the part you can see
    // from furthest away. It stops being a surface and becomes a diffuse
    // white column, which is less solid and no less there.
    expect(FRAY).toBeLessThan(1);
    expect(AERATED).toBeGreaterThan(0);
    expect(1 - FRAY).toBeGreaterThan(0.5);        // most of it survives breaking up
    const { layer } = cascade(BREAK * 3);
    const quads = filed(layer.strips);
    // Nothing anywhere down a tall fall is drawn at nothing at all.
    expect(Math.min(...quads.map((q) => q.footA))).toBeGreaterThan(0);
    // And the deep end of a piece that is breaking up is WHITER than its top,
    // which is the half of this that makes the foot of a big drop read as the
    // loudest part of it rather than the faintest.
    expect(quads.some((q) => q.paleFoot > q.paleTop + 8)).toBe(true);
    destroyFallLayer(layer);
  });

  test("the sheet hangs from the SURFACE, as thick as the water on the lip", () => {
    // A nappe used to hang from `ground[i]` — the bed, the BOTTOM of the water
    // — so a body arrived at a lip, stopped dead in a vertical face as deep as
    // it was, and a curtain of no thickness started again underneath. That
    // face is a sheer wall of flat colour along every brink on the map, and it
    // is the whole of what a free overfall does not look like.
    //
    // The sheet is the body carrying on over the edge, so where it leaves it
    // is exactly as thick as the water standing on the lip, and there is
    // nothing between the two for a face to fill.
    const { field, layer } = cascade(24);
    const c = field.columns;
    const lips: { lip: number; brink: number; crestZ: number }[] = [];
    for (let i = 0; i < c.depth.length; i++) {
      if (!falling(c, i, 0)) continue;
      const cx = i % c.nx, cy = (i / c.nx) | 0;
      // The crest of this edge's topmost piece, undrifted: `from` is nought
      // there, so its screen x is the lip's own and its y carries the whole
      // of the height. Found by x, then take the highest.
      const ax = tileOf(cx) - 0.5 + ((cx % COLUMNS_PER_TILE) + 1) / COLUMNS_PER_TILE;
      const ay = tileOf(cy) - 0.5 + (cy % COLUMNS_PER_TILE) / COLUMNS_PER_TILE;
      const x = (ax - ay) * HW;
      const hits = filed(layer.strips).filter(({ p }) => Math.abs(p[0] - x) < 1e-6);
      if (!hits.length) continue;
      const crest = Math.min(...hits.map(({ p }) => p[1]));
      lips.push({
        lip: c.ground[i],
        brink: sharedBrink(c, i, alongLip(c, i, 0, -1)),
        crestZ: ((ax + ay) * HH - crest) / HEIGHT_UNIT,
      });
    }
    expect(lips.length).toBeGreaterThan(0);
    for (const { lip, brink, crestZ } of lips) {
      // The top of the sheet is the water's own surface at the brink.
      expect(crestZ).toBeCloseTo(lip + brink, 4);
      // Which is to say it is ABOVE the bed, by a real depth of water — the
      // thing the vertical face used to be drawn in.
      expect(crestZ).toBeGreaterThan(lip);
    }
    destroyFallLayer(layer);
  });

  test("a lip that STEPS along its length is one curtain, not a plate per tread", () => {
    // Stairs going down, with the water going off the SIDE of them. Every
    // tread has its own lip at its own height, so the lip steps along its own
    // length — and a quad's far end is its neighbour's near end.
    //
    // Pour, throw and thickness were all shared at that boundary so the two
    // quads agree there. The lip height was not: each quad hung off its own
    // column's ground, so the curtain tore by a whole tread. Measured on a six
    // half step stair, ninety-nine pixels of vertical shear, at every step,
    // with the cliff showing through it.
    const W = 32;
    const grid = createGrid(W, W);
    fillTerrain(grid, 1);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const tread = 24 - 6 * Math.floor(x / 6);
        setHeight(grid, x, y, y <= 18 ? Math.max(0, tread) : -6);
      }
    }
    for (let x = 2; x < 26; x++) setSource(grid, x, 6, 16);
    const field = createWaterField(grid);
    const bands = createBandLayer(W, W);
    const layer = createFallLayer(bands, 1);
    for (let n = 0; n < 60 * 8; n++) {
      runSources(field, grid, 1 / 60);
      stepWater(field, 1 / 60);
    }
    drawFalls(layer, field.columns, activeBox(field.columns));

    const c = field.columns;
    let pairs = 0, stepped = 0, worst = 0;
    for (let i = 0; i < c.depth.length; i++) {
      if (!falling(c, i, 1)) continue;
      const j = alongLip(c, i, 1, 1);
      if (j < 0) continue;
      pairs++;
      if (c.ground[i] !== c.ground[j]) stepped++;
      // The same corner, worked out from each side in turn. Both have to put
      // it in one place, and they do exactly, because addition commutes.
      const zA = sharedLip(c, i, j) + sharedBrink(c, i, j);
      const zB = sharedLip(c, j, i) + sharedBrink(c, j, i);
      worst = Math.max(worst, Math.abs(zA - zB));
    }
    expect(pairs).toBeGreaterThan(20);
    expect(stepped).toBeGreaterThan(0);          // the case actually arises here
    expect(worst).toBe(0);
    destroyFallLayer(layer);
  });

  test("the pieces are cut in TIME, so the bend at the lip is where they are", () => {
    // A projectile's path is the straight one in time, and all of its bend is
    // in the first moment. Cut evenly in DEPTH — which is how this was — a
    // twenty-four half step drop put its first chord across 0.27 tiles of the
    // 0.67 the whole fall covers: forty per cent of the bend, drawn as one
    // straight line, at the lip, which is the one place a waterfall is
    // visibly round. That is the hard corner at the top of a fall: not a
    // missing curve, a curve sampled where it is straight and straightened
    // where it curves.
    const steps = nappeSteps(0, 24);
    expect(steps.length).toBe(NAPPE_STEPS);
    expect(steps[0].from).toBe(0);
    expect(steps[steps.length - 1].to).toBeCloseTo(24, 6);

    // What must come out smooth is the ANGLE, since that is what a crease is.
    // Measured on screen, against the 33 degrees the surface arrives at and
    // the 27 of flat water.
    const HW = 66, HH = 33, HU = 16.5;
    const deg = (dx: number, db: number) =>
      (Math.atan((dx * HH + db * HU) / (dx * HW)) * 180) / Math.PI;
    const angles = steps.map((k) =>
      deg(driftAt(FALL_THROW, k.to) - driftAt(FALL_THROW, k.from), k.to - k.from));

    // It LEAVES flat, which is what stops the top of a fall being a corner.
    // Cut evenly in depth this was 62 degrees against a surface arriving at
    // 33 — a twenty-nine degree shear at every lip on the map.
    expect(angles[0]).toBeLessThan(34);
    expect(angles[0]).toBeGreaterThan(26);       // and not flatter than flat

    // And it turns evenly from there, rather than kinking once and running
    // straight: no join between chords may be a visible corner.
    for (let k = 1; k < angles.length; k++) {
      expect(angles[k] - angles[k - 1]).toBeLessThan(9);
      expect(angles[k]).toBeGreaterThanOrEqual(angles[k - 1] - 1e-9);
    }

    // The depths crowd toward the lip, which is where the bend is.
    expect(steps[0].to).toBeLessThan(24 / NAPPE_STEPS);
    expect(steps[0].to - steps[0].from)
      .toBeLessThan((steps[NAPPE_STEPS - 1].to - steps[NAPPE_STEPS - 1].from) / 5);

    // Still seamless, and still monotonic.
    for (let k = 1; k < steps.length; k++) {
      expect(steps[k].from).toBeCloseTo(steps[k - 1].to, 6);
      expect(steps[k].to).toBeGreaterThan(steps[k].from);
    }
  });

  test("a DEEP lip does not fold over — the sheet keeps its thickness", () => {
    // The shear on a big fall, and the reason a trickle over the same edge
    // looked fine. The sheet's top was drawn at `brink * thinAt(b)` above the
    // ballistic path, so the thinning dragged it down ON TOP of gravity — an
    // error that goes with the depth of the lip. A trickle's top edge fell
    // 1.02 times as fast as the water; a wave eight half steps deep had its
    // top fall 11.4 half steps while the water fell 8, half again as fast as
    // gravity and folding onto the path inside `FALL_REACH`.
    //
    // Two particles leaving a brink horizontally at the same speed fall under
    // the same gravity, so their vertical separation never changes. A nappe
    // thins PERPENDICULAR to its flow; what makes it look thin lower down is
    // that it has turned toward vertical, which the projection does for free.
    //
    // Measured off the DRAWN quads: how far the top surface descends over a
    // fall, against how far the water itself falls. Any excess is the fold.
    const drop = (deep: number) => {
      const W = 32;
      const grid = createGrid(W, W);
      fillTerrain(grid, 1);
      for (let y = 0; y < W; y++) for (let x = 0; x < 16; x++) setHeight(grid, x, y, 24);
      // Poured to a level over the lip, so the brink really is `deep` thick.
      for (let y = 4; y < W - 4; y++) {
        for (let x = 2; x < 16; x++) grid.pool[y * W + x] = deep;
        grid.fluid[y * W + 8] = 1;
      }
      const field = createWaterField(grid);
      const bands = createBandLayer(W, W);
      const layer = createFallLayer(bands, 1);
      for (let n = 0; n < 60; n++) stepWater(field, 1 / 60);
      drawFalls(layer, field.columns, activeBox(field.columns));
      const c = field.columns;
      // One edge, and its own fall's reach, so the comparison is like for like.
      let best = -1, reach = 0;
      for (let i = 0; i < c.depth.length; i++) {
        const r = fallExtent(c, i, 0);
        if (r && r.front > reach) { best = i; reach = r.front; }
      }
      expect(best).toBeGreaterThanOrEqual(0);
      // The top surface's descent, in half steps, off the drawn screen Ys.
      // The lip faces east and the flow is along x, so every vertex of this
      // edge shares its `fy` and the iso term cancels between two of them.
      const quads = filed(layer.strips);
      const ys = quads.flatMap(({ p }) => [p[1], p[3], p[5], p[7]]);
      const xs = quads.flatMap(({ p }) => [p[0], p[2], p[4], p[6]]);
      const span = (Math.max(...ys) - Math.min(...ys)
        - (Math.max(...xs) - Math.min(...xs)) * (HH / HW)) / HEIGHT_UNIT;
      destroyFallLayer(layer);
      return { span, reach };
    };

    // A thin lip and a deep one. The sheet's top must descend the distance the
    // water falls and no further, at BOTH — with the fold in, the deep one
    // overshot its own reach and the thin one did not, which is exactly the
    // shape of the bug.
    for (const deep of [1, 8]) {
      const { span, reach } = drop(deep);
      expect(span).toBeLessThan(reach * 1.08);
    }
  });

  test("a fall that has not started has no pieces", () => {
    expect(nappeSteps(0, 0).length).toBe(0);
    expect(nappeSteps(5, 3).length).toBe(0);
  });

  test("and an array handed back gets the same answer a fresh one does", () => {
    // The falls renderer hands the same array back every frame, so the steps
    // are rewritten in place rather than pushed. That is a hundred and fifty
    // thousand objects a frame saved and one way to be wrong: a call that
    // wants fewer pieces than the last one left behind, or one that wants
    // none at all, must not be able to read the previous fall's tail.
    const kept: NappeStep[] = [];
    for (const [head, front, count] of [
      [0, 24, NAPPE_STEPS], [2, 14, NAPPE_STEPS], [0, 1, 4], [3, 9, NAPPE_STEPS],
    ] as const) {
      nappeSteps(head, front, kept, count);
      const fresh = nappeSteps(head, front, [], count);
      expect(kept.length).toBe(fresh.length);
      expect(kept.map((k) => [k.from, k.to, k.thinFrom, k.thinTo]))
        .toEqual(fresh.map((k) => [k.from, k.to, k.thinFrom, k.thinTo]));
    }
    // And a dry lip empties it, rather than leaving the last fall hanging.
    nappeSteps(5, 3, kept);
    expect(kept.length).toBe(0);
    nappeSteps(0, 24, kept);
    expect(kept.length).toBe(NAPPE_STEPS);
    expect(kept[0].from).toBe(0);
    expect(kept[NAPPE_STEPS - 1].to).toBeCloseTo(24, 6);
  });

  test("and a look written into scratch is the look it would have made", () => {
    const into: SheetLook = { pale: 0, cover: 0 };
    for (const below of [0, 1.5, 7, 20]) {
      const made = sheetLook(0.6, 0.3, 0.2, 4, below);
      const wrote = sheetLook(0.6, 0.3, 0.2, 4, below, into);
      expect(wrote).toBe(into);
      expect(wrote.pale).toBe(made.pale);
      expect(wrote.cover).toBe(made.cover);
    }
  });
});

/** A river fed over a tall cliff, run until it is falling properly. */
function cascade(cliff = 24, seconds = 25) {
  const W = 32;
  const grid = createGrid(W, W);
  fillTerrain(grid, 1);
  for (let y = 0; y < W; y++) for (let x = 0; x < 16; x++) setHeight(grid, x, y, cliff);
  for (let d = -2; d <= 2; d++) setSource(grid, 13, 16 + d, 8);
  const field = createWaterField(grid);
  const bands = createBandLayer(W, W);
  const layer = createFallLayer(bands, 1);
  for (let n = 0; n < 60 * seconds; n++) {
    runSources(field, grid, 1 / 60);
    stepWater(field, 1 / 60);
  }
  drawFalls(layer, field.columns, activeBox(field.columns));
  return { grid, field, bands, layer };
}

/** How white a packed colour is, ignoring how solid. */
const pale = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);

/**
 * Every quad the layer holds, with the band it was filed under.
 *
 * Alphas by SIDE, because a piece has two of them: its lateral ends are shared
 * with the columns either side and are shaded from both. Comparing the crest
 * of one end against the foot of the OTHER compares two different falls and is
 * only ever right by luck.
 */
function filed(strips: QuadBatch[]) {
  const out: {
    band: number; p: number[];
    topA: number; footA: number; topB: number; footB: number;
    paleTop: number; paleFoot: number;
  }[] = [];
  strips.forEach((b, band) => {
    for (let q = 0; q < b.n; q++) {
      out.push({
        band, p: quadAt(b, q),
        topA: colourAt(b, q, 0) >>> 24, topB: colourAt(b, q, 1) >>> 24,
        footB: colourAt(b, q, 2) >>> 24, footA: colourAt(b, q, 3) >>> 24,
        paleTop: pale(colourAt(b, q, 0)), paleFoot: pale(colourAt(b, q, 3)),
      });
    }
  });
  return out;
}

describe("a fall on the map", () => {
  test("pieces are filed in bands no LIP is in, which is the whole point", () => {
    // A quad's band decides what paints over it. Drawn whole, a fall belongs
    // to the band of the lip it left — and measured on this exact scene, all
    // 92 of them put their foot a band further forward than that, so the
    // terrain in front, being a later band, painted over the bottom of every
    // one of them.
    //
    // The decisive check needs no un-projecting: collect the bands the LIPS
    // are in, and the bands the layer actually filed into. If every piece went
    // in with its lip those two sets are the same. They are not.
    const { field, layer } = cascade();
    const c = field.columns;
    const lips = new Set<number>();
    for (let cy = 0; cy < c.ny; cy++) {
      for (let cx = 0; cx < c.nx; cx++) {
        const i = cy * c.nx + cx;
        for (let axis = 0; axis < 2; axis++) {
          if (fallExtent(c, i, axis)) lips.add(tileOf(cx) + tileOf(cy));
        }
      }
    }
    const drawn = new Set(layer.strips.flatMap((b, i) => (b.n > 0 ? [i] : [])));
    expect(lips.size).toBeGreaterThan(0);
    expect(drawn.size).toBeGreaterThan(0);

    const beyond = [...drawn].filter((b) => !lips.has(b));
    expect(beyond.length).toBeGreaterThan(0);     // water where no lip is
    // And forward, not backward: a fall drifts towards the camera.
    const furthestLip = Math.max(...lips);
    expect(Math.max(...drawn)).toBeGreaterThan(furthestLip);
    destroyFallLayer(layer);
  });

  test("it is drawn in more than one band, because it crosses one", () => {
    // The same claim from the other side and without any un-projecting: a
    // single fall spans two bands, so the layer must hold quads in both. Drawn
    // as one quad it could only ever have been in one.
    const { layer } = cascade();
    const used = layer.strips.map((b, i) => (b.n > 0 ? i : -1)).filter((i) => i >= 0);
    expect(used.length).toBeGreaterThan(1);
    // And they are adjacent: a fall drifts by under a tile, so the bands it
    // touches are a run, not a scatter.
    for (let k = 1; k < used.length; k++) expect(used[k] - used[k - 1]).toBeLessThanOrEqual(2);
    destroyFallLayer(layer);
  });

  test("it thins from the lip to the foot, and never becomes a wall", () => {
    const { layer } = cascade();
    const quads = filed(layer.strips);
    for (const q of quads) {
      // Down each SIDE. Crest against the far end's foot is two different
      // falls compared with each other, and passed for a while by luck.
      expect(q.footA).toBeLessThanOrEqual(q.topA);      // never bolder lower down
      expect(q.footB).toBeLessThanOrEqual(q.topB);
    }
    expect(quads.some((q) => q.footA < q.topA * 0.95)).toBe(true);

    // The CAP belongs on the bottom of the fall, not on every piece of it.
    // It was on every piece, and the pieces used to be cut evenly in depth —
    // so the shallowest of them started four half steps down, by which point
    // anything is thinned. Cut in TIME the first piece is a couple of tenths
    // long, and a sheet two tenths below the lip is the water on the lip: as
    // solid as the surface it is leaving, which is the whole point of hanging
    // it there. What must not read as a wall is the FOOT.
    const deepest = quads.reduce((a, b) => (b.p[5] > a.p[5] ? b : a));
    expect(deepest.footA).toBeLessThan(200);
    expect(deepest.footB).toBeLessThan(200);
    destroyFallLayer(layer);
  });

  test("and every piece is FULL WIDTH, so a run of them is one sheet", () => {
    // Inset or tapered, the faces along a cliff a river runs off are a row of
    // ribbons with the rock showing between them. How much is going over is in
    // the opacity.
    //
    // Measured in TILES and not in screen pixels, which is what this used to
    // do. A piece's two ends are thrown out by different amounts — that is the
    // whole of the seam fix — so its top edge is no longer parallel to the lip
    // and its span in screen x is the width PLUS that difference. Un-project
    // it instead: the two ends of a level edge are at the same z, so their
    // screen offset is the tile offset and nothing else, and one component of
    // that is the lip direction. THAT one is a column wide; the other is the
    // drift, and is allowed to be anything.
    const { layer } = cascade();
    const COL = 1 / 4;                            // one column, in tiles
    const span = (dx: number, dy: number) => {
      const dtx = (dx / HW + dy / HH) * 0.5, dty = (dy / HH - dx / HW) * 0.5;
      return Math.min(Math.abs(dtx - COL), Math.abs(dty - COL));
    };
    // Give or take the SHEAR. A sheet is thrown along the flow, and where the
    // flow along the lip differs between a piece's two ends the piece stretches
    // or squeezes by the difference — which is what a diverging flow does to a
    // sheet. Measured on this scene it is 1.3% of a column on average and 22%
    // at its worst, so the bar is a third: still plainly a column wide, and
    // nowhere near the inset that turns a run of them into bunting.
    for (const { p } of filed(layer.strips)) {
      expect(span(p[2] - p[0], p[3] - p[1])).toBeLessThan(COL / 3);   // the crest
      expect(span(p[4] - p[6], p[5] - p[7])).toBeLessThan(COL / 3);   // and the foot
    }
    destroyFallLayer(layer);
  });

  test("what two columns share at the lip between them, they agree on EXACTLY", () => {
    // The seam. A fall's quad is one column wide, so its lateral ends are
    // exactly where the next column's quad begins — and taken from each
    // column alone the two ends disagree there. Shaded differently that is a
    // step down the whole length of the drop; thrown differently it is worse,
    // because the two sheets then hang at different distances from the rock
    // and a wide lip draws as a row of loose strips with cliff showing
    // between them instead of as one sheet.
    //
    // Exact equality, not close-to: the shared value is the mean of the two
    // columns, and addition commutes, so the number column k computes for its
    // far end is bit for bit the number column k+1 computes for its near one.
    // Anything less than exact is a hairline.
    const { field } = cascade();
    const c = field.columns;
    let pairs = 0, differing = 0;
    for (let cy = 0; cy < c.ny; cy++) {
      for (let cx = 0; cx < c.nx; cx++) {
        const i = cy * c.nx + cx;
        for (let axis = 0; axis < 2; axis++) {
          const j = alongLip(c, i, axis, 1);
          if (j < 0 || !fallExtent(c, i, axis)) continue;
          pairs++;
          if (pourOf(c, i, axis) !== pourOf(c, j, axis)) differing++;
          expect(sharedPour(c, i, j, axis)).toBe(sharedPour(c, j, i, axis));
          expect(sharedThrow(c, i, j, axis)).toBe(sharedThrow(c, j, i, axis));
        }
      }
    }
    expect(pairs).toBeGreaterThan(0);
    // And there was something to reconcile: neighbours along a real lip do
    // NOT pour at the same rate, which is why this is worth doing at all.
    expect(differing).toBeGreaterThan(0);
  });

  test("but the outermost column of a run keeps its own, rather than tapering", () => {
    // Averaging with a dry neighbour fades the edge of the sheet to half and
    // then to nothing, which is insetting every fall by another name — the
    // thing that put the rock back between the ribbons. A run ends at full
    // strength and the shape of the water is what shows where it stops.
    const { field } = cascade();
    const c = field.columns;
    let ends = 0;
    for (let cy = 0; cy < c.ny; cy++) {
      for (let cx = 0; cx < c.nx; cx++) {
        const i = cy * c.nx + cx;
        for (let axis = 0; axis < 2; axis++) {
          if (!fallExtent(c, i, axis)) continue;
          for (const d of [-1, 1]) {
            if (alongLip(c, i, axis, d) >= 0) continue;
            ends++;
            expect(sharedPour(c, i, -1, axis)).toBe(pourOf(c, i, axis));
          }
        }
      }
    }
    expect(ends).toBeGreaterThan(0);
  });

  test("the two sheets at a CORNER meet, instead of leaving a wedge of rock", () => {
    // A convex corner is one column with a fall on BOTH its edges, and the far
    // corner of that column is a point the two of them share. Thrown along the
    // edge each went over — east for one, south for the other — they shared it
    // only where the drift was nought, and below that they pulled apart: a
    // wedge of bare cliff down the whole height of the drop, widening the
    // further it fell, with the water visibly stepping away from the corner on
    // both sides. The water that made both sheets was travelling DIAGONALLY
    // out over the corner; thrown that way, both land on the same line.
    const W = 24, TOP = 20, LO = 6, HI = 17;
    const grid = createGrid(W, W);
    fillTerrain(grid, 1);
    for (let y = LO; y <= HI; y++) for (let x = LO; x <= HI; x++) setHeight(grid, x, y, TOP);
    const field = createWaterField(grid);
    const bands = createBandLayer(W, W);
    const layer = createFallLayer(bands, 1);
    // Standing water on the block, so it pours off every edge at once.
    for (let y = LO; y <= HI; y++) {
      for (let x = LO; x <= HI; x++) pourAt(field, x, y, 6, 1);
    }
    for (let n = 0; n < 60 * 3; n++) stepWater(field, 1 / 60);
    drawFalls(layer, field.columns, activeBox(field.columns));

    // The corner post: the far corner of the block's last column, undrifted,
    // which is where both sheets start.
    const corner = HI + 0.5;
    const cx = (corner - corner) * HW;
    const lipY = (corner + corner) * HH - TOP * HEIGHT_UNIT;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

    // pushQuad writes crest-A, crest-B, foot-B, foot-A — so vertex 1 is the
    // crest at the shared end and vertex 2 is its foot.
    //
    // Matched on the post's SCREEN X alone, because the height a sheet hangs
    // from is no longer the lip: a nappe is as thick where it leaves as the
    // water on the lip is deep, so its crest stands that far above the bed.
    // The drift is nought at the crest, so the x is still the post's own.
    // The crest of a fall's FIRST piece is undrifted, so it sits exactly on
    // the post's screen x; every piece below it has drifted off. Other falls
    // along the block share that x too — a screen x is a diagonal — so take
    // the ones highest up, which are the two that start at this post.
    const atCorner = filed(layer.strips)
      .filter(({ p }) => near(p[2], cx) && p[3] < lipY && lipY - p[3] < HEIGHT_UNIT * 8)
      .sort((a, b) => a.p[3] - b.p[3])
      .slice(0, 2);
    expect(atCorner.length).toBe(2);               // one sheet per edge

    // And it hangs from the SURFACE, not from the bed — the crest stands a
    // real depth of water above the lip, which is the thing that leaves no
    // vertical face to fill. Both sheets agree about how far, being the same
    // water going over the same corner.
    expect(lipY - atCorner[0].p[3]).toBeGreaterThan(0.01);
    expect(atCorner[0].p[3]).toBeCloseTo(atCorner[1].p[3], 6);

    // And they hang together the whole way down rather than parting company.
    const [east, south] = atCorner;
    expect(east.p[4]).toBeCloseTo(south.p[4], 3);
    expect(east.p[5]).toBeCloseTo(south.p[5], 3);
    destroyFallLayer(layer);
  });

  test("a dry map draws no falls at all", () => {
    const W = 16;
    const grid = createGrid(W, W);
    fillTerrain(grid, 1);
    const field = createWaterField(grid);
    const bands = createBandLayer(W, W);
    const layer = createFallLayer(bands, 1);
    drawFalls(layer, field.columns, activeBox(field.columns));
    expect(filed(layer.strips).length).toBe(0);
    destroyFallLayer(layer);
  });
});

describe("the sheet leaves the lip in the SURFACE'S OWN colour", () => {
  /**
   * The seam this was written for.
   *
   * The surface mesh stops at a lip and a sheet carries on over it. At the
   * brink they are the same water in the same frame, drawn by two different
   * files — and they did not agree. On a foaming lip the surface sat at 0.93
   * of the way to white, RGB(240,245,248), and the sheet leaving it at 0.72,
   * RGB(195,215,226): a gap of forty-five, thirty and twenty-two along the one
   * line the eye is already following. Worse, 0.72 was the sheet's CEILING,
   * because it took foam as something ADDED — `CARRIED * foam`, a third at
   * most — while the surface MIXED it to the white end. The harder the water
   * broke, the wider the gap got.
   *
   * So these compare the two AT the join, not near it.
   */
  test("at nought below the lip it IS the surface look, to the last bit", () => {
    // By construction now, and that is the point: `sheetLook` at nought is
    // `surfaceLook` with the lip's own numbers and nothing of the fall added.
    // If this ever drifts, the two recipes have grown apart again.
    const { field } = cascade();
    const c = field.columns;
    let checked = 0;
    for (let cy = 0; cy + 1 < c.ny; cy++) {
      for (let cx = 0; cx < c.nx; cx++) {
        const i = cy * c.nx + cx;
        if (!falling(c, i, 0)) continue;
        const j = alongLip(c, i, 0, -1);
        const shown = sharedShown(c, i, j);
        const foam = 0.6;
        const lit = sharedLit(c, i, j, null);
        const want = surfaceLook(shown, foam, lit);
        const got = sheetLook(shown, foam, lit, sharedBrink(c, i, j), 0);
        expect(got.cover).toBeCloseTo(want.cover, 12);
        expect(got.pale).toBeCloseTo(paleAt(want.shade), 12);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  test("a white lip leaves a WHITE sheet, all the way to the top of the ramp", () => {
    // The ceiling. Foam of one is the top of the ramp whatever was underneath
    // it — on the surface and now on the sheet — so a fully broken lip and the
    // sheet leaving it land on the same shade from either side. Added on, the
    // sheet could not get there however hard the water broke.
    const top = paleAt(SHADES - 1);
    for (const lit of [0.2, 0.5, 0.84]) {
      expect(sheetLook(6, 1, lit, 6, 0).pale).toBeCloseTo(top, 12);
      expect(surfaceLook(6, 1, lit).shade).toBeCloseTo(SHADES - 1, 12);
    }
    // And a lip carrying no foam is left where the water's own shading put
    // it, which is what "a mix" means at the other end.
    expect(sheetLook(6, 0, 0.5, 6, 0).pale).toBeCloseTo(paleAt(0.5 * (TINTS - 1)), 12);
  });

  test("and it only leaves that colour BEHIND as it falls, never jumps", () => {
    // Monotone away from the lip: a sheet thins and breaks up on the way down,
    // so it can only get paler. A step anywhere in that is a band across the
    // fall.
    let pale = -Infinity;
    for (let b = 0; b <= 40; b += 0.25) {
      const k = sheetLook(6, 0.3, 0.5, 6, b);
      expect(k.pale).toBeGreaterThanOrEqual(pale - 1e-12);
      pale = k.pale;
    }
    // And it starts exactly where the surface is, not a step above it.
    expect(sheetLook(6, 0.3, 0.5, 6, 0).pale)
      .toBeCloseTo(paleAt(surfaceLook(6, 0.3, 0.5).shade), 12);
  });

  test("the fall's OWN white is a mix too, so it cannot leave the ramp", () => {
    // The same fault one step along. Foam mixes into the lip's shade; the
    // aeration a fall makes on the way down then has to mix into THAT, or it
    // is an addition again and a sheet can be whiter than the whitest thing
    // the renderer draws. Nothing is, and a surface and a sheet that reach
    // different ceilings do not match at the join for long.
    const top = paleAt(SHADES - 1);
    for (const foam of [0, 0.3, 1]) {
      for (const lit of [0.2, 0.5, 0.84]) {
        for (let b = 0; b <= 60; b += 0.5) {
          expect(sheetLook(6, foam, lit, 6, b).pale).toBeLessThanOrEqual(top + 1e-12);
        }
      }
    }
    // And a lip already at the ceiling STAYS there: there is nowhere paler to
    // go, so a white lip and the white sheet under it are one colour.
    for (let b = 0; b <= 60; b += 0.5) {
      expect(sheetLook(6, 1, 0.5, 6, b).pale).toBeCloseTo(top, 12);
    }
  });

  test("and on a real cascade the mesh and the sheet agree at the join", () => {
    // End to end, through everything: the solver's own foam and wash fields,
    // the mesh's corner averaging, the sheet's shared pairs. The two are built
    // by different files from different arrays and have to land on the same
    // colour along the whole lip.
    //
    // Measured before this was shared: the typical foaming lip was 45 of 255
    // apart on the red channel. Now the MEAN is about one, which is under the
    // palette's own step — the surface is quantised to 32 shades of water, so
    // half a step is the most a lookup can resolve.
    //
    // The worst is larger and is a run's END, where `alongLip` has no partner
    // and the sheet keeps its own value rather than averaging with water that
    // is not there — a deliberate difference, and one lip wide.
    const W = 32, cliff = 24;
    const grid = createGrid(W, W);
    fillTerrain(grid, 1);
    for (let y = 0; y < W; y++) for (let x = 0; x < 16; x++) setHeight(grid, x, y, cliff);
    for (let d = -2; d <= 2; d++) setSource(grid, 13, 16 + d, 8);
    const field = createWaterField(grid);
    const bands = createBandLayer(W, W);
    const wl = createWaterLayer(field, bands, 1);
    for (let n = 0; n < 60 * 25; n++) {
      runSources(field, grid, 1 / 60);
      stepWater(field, 1 / 60);
    }
    drawWater(wl, field, bands, 1 / 60);

    const c = field.columns, vw = c.nx + 1;
    let sum = 0, n = 0;
    for (let cy = 0; cy + 1 < c.ny; cy++) {
      for (let cx = 0; cx + 1 < c.nx; cx++) {
        const i = cy * c.nx + cx;
        if (!falling(c, i, 0)) continue;
        // An east edge runs from corner (cx+1, cy) to (cx+1, cy+1), and the A
        // end — the one `alongLip(-1)` pairs with — is the first of those.
        const v = cy * vw + (cx + 1);
        if (!wl.vn[v]) continue;
        const j = alongLip(c, i, 0, -1);
        const look = sheetLook(
          sharedShown(c, i, j), sharedFoam(wl.foam.now, i, j),
          sharedLit(c, i, j, wl.wash.now), sharedBrink(c, i, j), 0,
        );
        sum += Math.abs(look.pale - paleAt(wl.vl[v]));
        n++;
      }
    }
    expect(n).toBeGreaterThan(40);
    // A shade step is LIGHTEST / (TINTS - 1) of the way to white. Half of one
    // is all the palette can tell apart, and that is the bar.
    expect(sum / n).toBeLessThan(LIGHTEST / (TINTS - 1) * 0.5);
    destroyWaterLayer(wl);
  });
});

describe("a fall takes time to get down", () => {
  test("nothing hangs off the cliff before the water reaches it", () => {
    // Water went over a lip and arrived at the bottom in the same frame, so a
    // cliff was either bare or curtained with no moment in between: the wave
    // at the top stopped and the wave at the bottom started, and nothing
    // crossed the distance.
    const W = 32, CLIFF = 24;
    const grid = createGrid(W, W);
    fillTerrain(grid, 1);
    for (let y = 0; y < W; y++) for (let x = 0; x < 16; x++) setHeight(grid, x, y, CLIFF);
    for (let d = -2; d <= 2; d++) setSource(grid, 13, 16 + d, 8);
    const field = createWaterField(grid);
    const bands = createBandLayer(W, W);
    const layer = createFallLayer(bands, 1);
    const tick = () => {
      runSources(field, grid, 1 / 60);
      stepWater(field, 1 / 60);
      drawFalls(layer, field.columns, activeBox(field.columns));
    };
    /** How far down the wall anything has got, in half steps. */
    const reach = () => {
      let most = 0;
      for (const { p } of filed(layer.strips)) most = Math.max(most, Math.abs(p[1] - p[7]));
      return most / HEIGHT_UNIT;
    };

    for (let n = 0; n < 30; n++) tick();
    expect(reach()).toBe(0);                      // the river has not arrived

    // And once the river gets there, something hangs off the cliff.
    for (let n = 0; n < 60 * 30 && reach() <= 0; n++) tick();
    expect(reach()).toBeGreaterThan(0);
    destroyFallLayer(layer);
  }, 20000);
});
