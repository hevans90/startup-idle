/**
 * World v2 — drawing waterfalls.
 *
 * Its own layer, and off the water mesh entirely. That mesh is a function of
 * the COLUMNS: every quad in it belongs to the column it was computed from and
 * therefore to that column's band, which is the assumption the whole
 * diagonal-band scheme rests on. A waterfall breaks it. Water thrown off a lip
 * travels toward the camera as it falls, so by the time it lands it is in a
 * different tile from the one it left — measured on a river over a twenty-four
 * half step cliff, every one of 92 falls put its foot a band further forward
 * than the band its quad was drawn in, and the terrain in front, being a later
 * band, painted over the bottom of all of them.
 *
 * So a fall is cut into pieces and each piece is filed under the band it is
 * actually in. That is the whole reason this is a layer rather than two more
 * parts of the surface shader, and it is why it is built on the CPU: the
 * surface is a quarter of a million corners a frame and had to move to a
 * vertex shader to be affordable, while a busy map has under a hundred falls
 * on it and six pieces each. Five hundred quads is not a budget worth writing
 * a shader for — and keeping them here means the one parabola in `nappe.ts` is
 * the only copy, rather than a copy per shading language, which is exactly how
 * the falls came to behave differently on WebGL than on WebGPU.
 *
 * What it draws is the sheet between the lip and wherever the water has got
 * to. What happens when it lands is not here: it arrives in the column below
 * through the solver, and the white it makes is `render/foam`.
 */
import type { Container } from "pixi.js";

import type { ColumnField } from "../../fluid/columns";
import { driftAt, fallExtent, falling } from "../../fluid/falls";
import { COLUMNS_PER_TILE, tileOf } from "../water/field";
import { fluidMaterial } from "../water/materials";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import type { BandLayer } from "./bands";
import {
  createQuadBatch, destroyQuadBatch, pushQuad, resetQuads, rgba, uploadQuads,
  type QuadBatch,
} from "./quads";
import { DRAWDOWN, FULL_FALL_FLUX, aerate, litAt, shownDepth } from "./water";
import { atBrink } from "./corner-rule";
import { FALL_MIN } from "../../fluid/falls";
import { nappeSteps, sheetLook, type NappeStep } from "./nappe";

export type FallLayer = {
  strips: QuadBatch[];
  scale: number;
  /** Bands holding quads, or holding some last frame — both need uploading. */
  live: Set<number>;
};

export function createFallLayer(bands: BandLayer, scale = 1): FallLayer {
  const strips: QuadBatch[] = [];
  for (let b = 0; b < bands.bands.length; b++) {
    strips.push(createQuadBatch(bands.structureOf[b] as Container, 16));
  }
  return { strips, scale, live: new Set() };
}

export function destroyFallLayer(layer: FallLayer) {
  for (const b of layer.strips) destroyQuadBatch(b);
  layer.strips.length = 0;
  layer.live.clear();
}

/** Scratch, so a frame allocates nothing. */
const STEPS: NappeStep[] = [];

/** How hard a column is pouring over its `axis` edge, nought to one. */
export function pourOf(c: ColumnField, i: number, axis: number) {
  const flux = axis === 0 ? c.fx[i] : c.fy[i];
  return Math.min(1, Math.max(flux, 0) / FULL_FALL_FLUX);
}

/**
 * How fast a column throws its water out, capped — see `FALL_THROW`.
 *
 * A COMPONENT and not a scalar, which is the whole of the corner fix. A sheet
 * used to be thrown along the edge it went over and nothing else, so at a
 * convex corner the east face's sheet flew east and the south face's flew
 * south while the water that made both of them was travelling diagonally out
 * over the corner. The two shared the corner post only where the drift was
 * nought, and below that they pulled apart — a wedge of bare rock down the
 * whole height of the cliff, widening the further it fell.
 *
 * Thrown along the VELOCITY instead, both sheets leave in the direction the
 * water was actually going, so at the corner they land on the same line and
 * the corner is a crease rather than a hole. A straight cliff is unchanged:
 * there is no flow across it to speak of, so the across-component is nought
 * and the sheet drops the way it always did.
 *
 * SMOOTHED, and read off the solver rather than worked out here — see
 * `FallState.throwX`. The throw is the water's own velocity and that surges,
 * so taken raw the sheet swims about from frame to frame and, worse, it
 * disagrees with where the solver has decided to land the water. One arc
 * means one number, and the solver owns it.
 */
const throwX = (c: ColumnField, i: number) => c.falls.throwX[i];
const throwY = (c: ColumnField, i: number) => c.falls.throwY[i];

/**
 * The column on one side of this one ALONG THE LIP, if it is falling too.
 *
 * `d` is which side, −1 or +1. The lip of an east edge runs along y and the
 * lip of a south edge along x, so the neighbour that shares a lip with this
 * one is across the OTHER axis from the one the water went over.
 */
function alongLip(c: ColumnField, i: number, axis: number, d: number) {
  const cx = i % c.nx, cy = (i / c.nx) | 0;
  const jx = axis === 0 ? cx : cx + d;
  const jy = axis === 0 ? cy + d : cy;
  if (jx < 0 || jy < 0 || jx >= c.nx || jy >= c.ny) return -1;
  const j = jy * c.nx + jx;
  return falling(c, j, axis) ? j : -1;
}

/**
 * What the two columns either side of a lip's END agree that end is like.
 *
 * A QUAD BOUNDARY IS A BOUNDARY — the same rule the water mesh states about
 * corners, for the same reason and against the same failure. The pour and the
 * throw belong to a COLUMN, and a fall's quad is a column wide, so its two
 * lateral ends sit exactly where the next column's quad begins. Take each end
 * from its own column alone and the two disagree there: they are shaded
 * differently, which is a visible step down the whole length of the drop, and
 * — far worse — they are thrown out by different amounts, so the sheets are
 * at different distances from the rock and a wide lip draws as a row of loose
 * strips with the cliff between them rather than as one falling sheet.
 *
 * Averaged over both columns, the value at that boundary is the same number
 * computed from either side, exactly, because addition commutes. So the
 * strips meet.
 *
 * The END of a run keeps its own value rather than averaging with a dry
 * neighbour. A fall is FULL WIDTH or it is bunting: tapering the outermost
 * column into nothing is the same mistake as insetting every one of them,
 * which is what put the rock back between the ribbons.
 */
export const sharedPour = (c: ColumnField, i: number, j: number, axis: number) =>
  j < 0 ? pourOf(c, i, axis) : (pourOf(c, i, axis) + pourOf(c, j, axis)) * 0.5;

/**
 * @see sharedPour — the same rule, on what the lip throws.
 *
 * `along` is which COMPONENT of the throw is wanted, 0 for x and 1 for y, and
 * not which edge the water went over: a sheet is thrown along the flow, so
 * both of its components matter whichever edge it left by.
 */
export const sharedThrow = (c: ColumnField, i: number, j: number, along: number) => {
  const of = along === 0 ? throwX : throwY;
  return j < 0 ? of(c, i) : (of(c, i) + of(c, j)) * 0.5;
};

/**
 * @see sharedPour — the same rule, on how THICK the sheet leaves.
 *
 * A nappe is as thick at the lip as the water standing on the lip is deep,
 * because it is that water: the sheet is not something that starts below the
 * body, it is the body carrying on over the edge. Shared between the two
 * columns at the boundary for the reason every other lip quantity is — a quad
 * end computed from one side only disagrees with the neighbour that draws the
 * same end from the other.
 */
const drawnAt = (c: ColumnField, i: number) =>
  c.depth[i] * (1 - DRAWDOWN * atBrink(
    c.nx, c.ny, i, c.ground, c.depth, c.params.dryDepth, FALL_MIN));

export const sharedBrink = (c: ColumnField, i: number, j: number) =>
  j < 0 ? drawnAt(c, i) : (drawnAt(c, i) + drawnAt(c, j)) * 0.5;

/**
 * @see sharedPour — the same rule, on the HEIGHT the sheet leaves from.
 *
 * The one lip quantity that was not shared, and the only one that POSITIONS
 * the quad rather than shading it. Pour, throw and thickness were all computed
 * from both columns, so the two quads meeting at a boundary agree there; the
 * lip was each quad's own `ground[i]`, so where a lip STEPS ALONG ITS OWN
 * LENGTH — stairs with the water going off the side of them — a quad's far end
 * and its neighbour's near end are the same corner drawn a whole tread apart.
 * Measured on a six half step stair, ninety-nine pixels of vertical tear, at
 * every step, with the cliff showing through it.
 *
 * Averaged, the curtain is one surface descending across the step instead of a
 * plate per tread, and the two quads put that corner in exactly the same place
 * because addition commutes.
 */
export const sharedLip = (c: ColumnField, i: number, j: number) =>
  j < 0 ? c.ground[i] : (c.ground[i] + c.ground[j]) * 0.5;

/**
 * @see sharedPour — the same rule, on the WHITE the lip is carrying.
 *
 * Read off the solver's own breaking intensity, which is where `render/foam`
 * gets the field it paints on the surface — so the white going over the lip
 * and the white lying on the water either side of it are the same number, and
 * a fall joins the foam above it to the foam below instead of interrupting
 * them. See {@link CARRIED}.
 */
export const sharedFoam = (foam: Float32Array, i: number, j: number) =>
  j < 0 ? foam[i] : (foam[i] + foam[j]) * 0.5;

/**
 * @see sharedPour — the same rule, on how DEEP the lip reads as being.
 *
 * The surface's own measure and not the raw depth: a lip is thin because it is
 * leaving, and `shownDepth` floors it so the one place a sheet has to be
 * continuous does not fade out. The corner above the sheet is shaded from
 * this, so the sheet has to be too.
 */
export const sharedShown = (c: ColumnField, i: number, j: number) =>
  (j < 0 ? shownDepth(c, i, c.depth[i])
    : (shownDepth(c, i, c.depth[i]) + shownDepth(c, j, c.depth[j])) * 0.5);

/**
 * @see sharedPour — the same rule, on the pattern the current is carrying.
 */
export const sharedWash = (wash: Float32Array, i: number, j: number) =>
  (j < 0 ? wash[i] : (wash[i] + wash[j]) * 0.5);

/**
 * How LIT the lip is, on the surface's own scale — see `litAt`, which this is.
 *
 * A LIP LEANS DOWNSTREAM BY CONSTRUCTION. The surface reads its lean off the
 * corners either side, which a sheet has no way to see; but the thing that
 * makes a lip lean is the drawdown, and how much drawdown there is is exactly
 * `atBrink`. So the brink itself is what goes in as the lean, and a full brink
 * comes out as lit as the surface diving over it.
 *
 * And `shown` is one, because the pattern is fullest on water that is moving
 * and water at a lip is moving as fast as it gets.
 */
export const sharedLit = (
  c: ColumnField, i: number, j: number, wash: Float32Array | null,
) => litAt(
  brinkOf(c, i, j), wash ? sharedWash(wash, i, j) : 0, 1,
);

const brinkAt = (c: ColumnField, i: number) => atBrink(
  c.nx, c.ny, i, c.ground, c.depth, c.params.dryDepth, FALL_MIN,
);
const brinkOf = (c: ColumnField, i: number, j: number) =>
  (j < 0 ? brinkAt(c, i) : (brinkAt(c, i) + brinkAt(c, j)) * 0.5);

export { alongLip };

/**
 * Every fall on the map, cut up and filed by band.
 *
 * Walks the columns rather than keeping a list, for the same reason the solver
 * does: a fall is a property of an EDGE and the edges that have one change
 * every frame. The active box bounds it, so a dry map costs nothing.
 */
export function drawFalls(
  layer: FallLayer, columns: ColumnField,
  region: { x0: number; y0: number; x1: number; y1: number } | null,
  foam: Float32Array | null = null, wash: Float32Array | null = null,
) {
  for (const b of layer.live) resetQuads(layer.strips[b]);
  const had = layer.live.size > 0;
  layer.live.clear();
  if (!region) {
    // Nothing wet, so nothing falling. Whatever was drawn last frame has been
    // reset above and still has to go up, or it stays on the screen.
    if (had) for (const b of layer.strips) uploadQuads(b);
    return;
  }

  const s = layer.scale;
  const HWs = HW * s, HHs = HH * s, HUs = HEIGHT_UNIT * s;
  const step = 1 / COLUMNS_PER_TILE;
  const { nx, material } = columns;
  const lastBand = layer.strips.length - 1;

  for (let cy = region.y0; cy <= region.y1; cy++) {
    for (let cx = region.x0; cx <= region.x1; cx++) {
      const i = cy * nx + cx;
      for (let axis = 0; axis < 2; axis++) {
        const jx = axis === 0 ? cx + 1 : cx, jy = axis === 0 ? cy : cy + 1;
        if (jx >= columns.nx || jy >= columns.ny) continue;
        const reach = fallExtent(columns, i, axis);
        if (!reach) continue;

        // The edge it goes over, in tiles: the east edge runs along y, the
        // south edge along x. Full width, always — the whole edge of the
        // column is what the water leaves by, and anything narrower leaves
        // the rock showing between one fall and the next.
        const tx = tileOf(cx), ty = tileOf(cy);
        const fx0 = tx - 0.5 + (cx % COLUMNS_PER_TILE) * step;
        const fy0 = ty - 0.5 + (cy % COLUMNS_PER_TILE) * step;
        const ax = axis === 0 ? fx0 + step : fx0;
        const ay = axis === 0 ? fy0 : fy0 + step;
        const bx = fx0 + step, by = fy0 + step;
        const base = fluidMaterial(material[i])?.colour ?? 0x2a6f97;

        // The lip's two ENDS, each shared with whatever is beside it — see
        // `sharedPour`. `a` is the end towards −y on an east edge and −x on a
        // south edge, which is the same side `alongLip` calls −1.
        const back = alongLip(columns, i, axis, -1);
        const fwd = alongLip(columns, i, axis, 1);
        // The throw at each end, as a VECTOR — see `throwX`. Both components,
        // because a sheet goes the way the water was going and not the way the
        // rock happens to face.
        const axThrow = sharedThrow(columns, i, back, 0);
        const ayThrow = sharedThrow(columns, i, back, 1);
        const bxThrow = sharedThrow(columns, i, fwd, 0);
        const byThrow = sharedThrow(columns, i, fwd, 1);
        // What the lip is carrying, so the fall is not the one clean stretch
        // between two white pools — see `sharedFoam`.
        const foamA = foam ? sharedFoam(foam, i, back) : 0;
        const foamB = foam ? sharedFoam(foam, i, fwd) : 0;
        // AND EVERYTHING ELSE THE SURFACE KNOWS ABOUT THIS WATER. The sheet
        // used to mix its own colour from a flat 0.20, how hard the lip was
        // pouring and a third of the foam — a recipe that agreed with the
        // surface above it nowhere. See `sheetLook`, which these feed.
        const shownA = sharedShown(columns, i, back);
        const shownB = sharedShown(columns, i, fwd);
        const litA = sharedLit(columns, i, back, wash);
        const litB = sharedLit(columns, i, fwd, wash);

        // How thick the sheet is where it leaves, at each end — see
        // `sharedBrink`. This is what the sheet is HUNG FROM.
        const brinkA = sharedBrink(columns, i, back);
        const brinkB = sharedBrink(columns, i, fwd);
        // And the height it leaves FROM, shared for the same reason — see
        // `sharedLip`. This is the one that was not, and it is the one that
        // tore a stepped lip into a plate per tread.
        const lipA = sharedLip(columns, i, back);
        const lipB = sharedLip(columns, i, fwd);

        nappeSteps(reach.head, reach.front, STEPS);
        for (const piece of STEPS) {
          // THE BAND THIS PIECE IS IN, not the band the lip is in. Drift in
          // either axis moves the piece forward in `x + y`, so the middle of
          // the quad decides — one band for the whole of it, because a quad is
          // drawn in one place however far its two ends have been thrown.
          const deep = (piece.from + piece.to) * 0.5;
          const midX = driftAt((axThrow + bxThrow) * 0.5, deep);
          const midY = driftAt((ayThrow + byThrow) * 0.5, deep);
          const band = Math.round((ax + bx) * 0.5 + midX)
            + Math.round((ay + by) * 0.5 + midY);
          if (band < 0 || band > lastBand) continue;
          const batch = layer.strips[band];

          // WHERE THE TOP OF THE SHEET IS, which is not the lip.
          //
          // A nappe used to hang from `ground[i]` — the BED, the bottom of the
          // water — so a body of water arrived at a lip, stopped dead in a
          // vertical wall as deep as it was, and a separate curtain of no
          // thickness at all started again underneath. That wall is the whole
          // of what a free overfall does not look like, and it was there at
          // every lip on every map: measured on a river over a twelve half
          // step cliff, thirty-seven faces between four and nine half steps,
          // up to a hundred and fifty-four pixels of flat colour standing on
          // edge along the brink.
          //
          // The sheet is the body CARRYING ON over the edge, so it is as thick
          // at the lip as the water on the lip is deep, and it thins from
          // there by the same continuity that already decides how much of it
          // is left — {@link thinAt} was the SHAPE of this all along and was
          // being spent on opacity instead. At nought below the lip the top of
          // the sheet is the surface the mesh draws at the brink, so there is
          // nothing left for a vertical face to fill; by `FALL_REACH` the two
          // have converged and it is the ribbon it always was.
          //
          // Per END and not per piece, exactly like the drift: the two lateral
          // ends of a quad belong to two different columns' worth of lip.
          // THE VERTICAL THICKNESS DOES NOT CHANGE, and that is the whole of
          // the shear on a big fall.
          //
          // This used to be `brink * thinAt(b)`, so the top of the sheet was
          // dragged down by the thinning ON TOP OF falling. On a trickle that
          // is nothing — the top edge falls 1.02 times as fast as the water —
          // but the error goes with the depth, and a wave eight half steps
          // deep going over had its top edge fall 11.4 half steps while the
          // water fell 8. Half again as fast as gravity, collapsing onto the
          // ballistic path inside `FALL_REACH`, which is a fold across the
          // top of the sheet. That is why a small flow over an edge looked
          // right and a big one sheared.
          //
          // And it was never the physics. Two particles leaving a brink
          // horizontally at the same speed fall under the same gravity, so
          // their vertical separation is CONSTANT — a nappe thins
          // perpendicular to its flow, and its vertical extent does not
          // change at all. Continuity says as much: perpendicular thickness
          // goes as `cos θ` and vertical extent is that over `cos θ`, which
          // is the thickness it left with, for ever.
          //
          // What makes a sheet look thin further down is that it has turned
          // toward vertical, and the projection does that on its own: two
          // curves a constant height apart, both going straight down, are the
          // same line. So it thickens at the lip, collapses to a ribbon where
          // it is falling, and nothing has to be told to do either.
          //
          // {@link thinAt} keeps its job, which is OPACITY — that is the
          // thickness you look THROUGH, and it really does thin.
          const topZA = lipA - piece.from + brinkA;
          const topZB = lipB - piece.from + brinkB;
          const footZA = lipA - piece.to + brinkA;
          const footZB = lipB - piece.to + brinkB;
          // Thinned because it is accelerating, and BREAKING UP because past
          // a few full steps the solver is pulling drops out of it — which
          // takes some of its body away and turns the rest white, those being
          // two halves of one fact. See `breakingAt`.
          // How much sheet is left and how white it has gone, at each end of
          const hiA = sheetLook(shownA, foamA, litA, brinkA, piece.from);
          const hiB = sheetLook(shownB, foamB, litB, brinkB, piece.from);
          const loA = sheetLook(shownA, foamA, litA, brinkA, piece.to);
          const loB = sheetLook(shownB, foamB, litB, brinkB, piece.to);
          // AS SOLID AS THE WATER IT IS, on the SURFACE'S OWN CURVE. It used
          // to be `solid(pour)` — how hard the lip was pouring — while the
          // sheet's own crest sits on the surface quad's last corner, which
          // is `shade(depth)`. Two answers to "how much water is there" a
          // pixel apart: measured at the join, 235 against 172 out of 255, a
          // quarter of an alpha, stepping along the whole length of every lip.
          // That is the hard seam, and no amount of bending the arc touches
          // it, because it is not the arc.
          //
          // The sheet is as thick as the water on the lip and thins from
          // there, so its thickness IS a depth and goes through the same
          // curve. At nought below the lip it asks `shade` the same question
          // the corner above it did.
          const crestA = rgba(aerate(base, hiA.pale), hiA.cover);
          const crestB = rgba(aerate(base, hiB.pale), hiB.cover);
          const footA = rgba(aerate(base, loA.pale), loA.cover);
          const footB = rgba(aerate(base, loB.pale), loB.cover);
          const tax = ax + driftAt(axThrow, piece.from);
          const tay = ay + driftAt(ayThrow, piece.from);
          const tbx = bx + driftAt(bxThrow, piece.from);
          const tby = by + driftAt(byThrow, piece.from);
          const fax = ax + driftAt(axThrow, piece.to);
          const fay = ay + driftAt(ayThrow, piece.to);
          const fbx = bx + driftAt(bxThrow, piece.to);
          const fby = by + driftAt(byThrow, piece.to);
          pushQuad(
            batch,
            (tax - tay) * HWs, (tax + tay) * HHs - topZA * HUs, crestA,
            (tbx - tby) * HWs, (tbx + tby) * HHs - topZB * HUs, crestB,
            (fbx - fby) * HWs, (fbx + fby) * HHs - footZB * HUs, footB,
            (fax - fay) * HWs, (fax + fay) * HHs - footZA * HUs, footA,
          );
          layer.live.add(band);
        }
      }
    }
  }

  for (const b of [...layer.live]) {
    const batch = layer.strips[b];
    uploadQuads(batch);
    if (batch.n === 0) layer.live.delete(b);
  }
}
