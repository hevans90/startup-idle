/**
 * World v2 — drawing the water the columns say is there.
 *
 * The mesh IS the simulation's output. Every frame, each wet column contributes
 * a quad whose corners are the interpolated surface of the columns around it,
 * so the sheet rises, falls, tilts and retreats as the water does. Nothing here
 * knows about pools, levels or waterfalls: those were all consequences of a
 * flat plane per body of water, and there is no plane any more.
 *
 * A DROP FACE comes out of the same data. Where a wet column's surface stands
 * well above what is beside it, the gap between them is drawn as a vertical
 * quad — that is a waterfall, and it appears and disappears with the flow
 * rather than being derived from the map and drawn as decoration over it. Only
 * the two down-screen faces carry one, the same two `render/cliffs` draws
 * columns on, because the others point away from the camera.
 *
 * Per-band strips, as everything else in this engine: a column belongs to the
 * tile it sits in, and that tile's band decides what occludes it.
 */
import {
  MATERIAL_SLOTS, activeBox, flowX, flowY, surfaceAt, velocityAt, type ColumnField,
} from "../../fluid/columns";
import { COLUMNS_PER_TILE, columnOf, tileOf } from "../water/field";
import { FALL_MIN } from "../../fluid/falls";
import { fluidMaterial } from "../water/materials";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import {
  createQuadBatch, destroyQuadBatch, packAlpha, packRGB, pushQuad, resetQuads, rgba,
  uploadQuads, type QuadBatch,
} from "./quads";
import { RIM, atBrink, resolveCorner, resolveSide, spillAt } from "./corner-rule";
import {
  CORNER_COLUMNS, contribOf, cornerMasksInto, sharedContrib,
} from "./sheet-group";
import { OPEN_SKY } from "../../fluid/slots";
import { createFlowWash, stepFlowWash, type FlowWash } from "./flow-wash";
import { createFoam, stepFoam, type FoamField } from "./foam";
import type { BandLayer } from "./bands";

/**
 * Depth at which water is drawn at its full opacity.
 *
 * It FADES in below this rather than switching on, and that matters more than
 * it sounds. The solver's minimum head leaves a shallow fringe where a puddle
 * stopped spreading, and a hard cutoff there is invisible — but a sheet lying
 * on a raised tile sits at exactly this depth all over, so a cutoff punched
 * holes in it and you could see the tile through them. Measured on a stepped
 * scene, 164 columns ringed on all four sides by water they were not drawn
 * with, every one of them on raised ground.
 */
export const SHOW_DEPTH = 0.14;
/** Depth at which the surface is as opaque as it gets. */
export const OPAQUE_DEPTH = 4;
/**
 * Surface slope, in half steps per column, at which shading is half its
 * fullest.
 *
 * Small, because the slopes are: a wind-driven ripple on a pond leans about a
 * tenth of a half step from one column to the next. Shaded in proportion the
 * waves came out at four percent of the range and were invisible, so what you
 * saw was the carried mottle sitting still while the mesh rippled underneath
 * it — a texture painted on the world rather than on the water. The response
 * is steep near flat and saturates, so a pond's ripples and a river's standing
 * waves both read without either clipping.
 */
export const SLOPE_REF = 0.11;

/**
 * Flow speed, in tiles a second, at which the carried pattern is fullest.
 *
 * A river's surface is not a tilted plate, and that is exactly what it was:
 * the solver knew the velocity of every column and the sheet lying on them
 * ignored it, so a standing flow read as a still ribbon. What it shows now is
 * the pattern the current carries — see `flow-wash`.
 */
export const STREAK_SPEED = 1.2;
/**
 * Shades of each fluid, precomputed.
 *
 * Lightening a colour and packing it is thirty-odd operations, and the shading
 * is per CORNER — at four columns to the tile on a flooded map that is a
 * quarter of a million of them a frame, which measured as more than the rest
 * of the draw put together. There are only so many shades of water, so they
 * are worked out once and looked up.
 */
export const TINTS = 32;
/**
 * Shades of FOAM above those, and how far towards white the last one goes.
 *
 * A separate stretch of the same ramp rather than a wider one: the thirty-two
 * below carry the ordinary business of a surface — its tilt, the pattern the
 * current drags over it — and they need every step they have, because a pond's
 * ripples only just clear one shade from the next. Foam starts where they stop
 * and goes on to nearly white, so a breaking crest leaves the range that water
 * ever reaches instead of being the top of it.
 */
export const FOAM_TINTS = 24;
export const FOAM_WHITE = 0.93;
/**
 * How much of the way to opaque foam takes the surface.
 *
 * White water is white because it is full of air, and air is not something you
 * see through — a crest that goes pale but stays as transparent as the water
 * around it reads as a highlight rather than as foam. Scaled by the same fade
 * that brings a thin sheet in, so foam on a shallow front cannot paint ground
 * the water itself is not covering.
 */
export const FOAM_COVER = 0.75;
/** Flux at which a fall is the full width of the edge it goes over. */
export const FULL_FALL_FLUX = 1.5;

export type WaterLayer = {
  /** One quad batch per band, made once and rewritten every frame. */
  strips: QuadBatch[];
  /**
   * The same batches again, one tier lower: water that has something OVER it.
   *
   * A river under a bridge is in the same band as the bridge and drew after
   * it, so a channel running full painted itself across the front of the
   * span. Roofed water goes in here instead, which is drawn before the
   * paving. @see BandLayer.underOf
   */
  under: QuadBatch[];
  scale: number;
  /**
   * WHICH SHEET each corner's tiers hold, as a membership mask, or
   * {@link NO_SHEET} for a free one.
   *
   * A corner is shared by four columns and, with storeys, by every slot of
   * each — and those can belong to different bodies of water that have
   * nothing to do with each other: a river and the bridge deck over it, a
   * sheet on a plateau and the lake at the foot of its cliff. Each gets a
   * TIER of its own, and a column reads back the tier holding ITS OWN sheet.
   *
   * This used to be two groups split by the BED the contributors stood on,
   * which is a guess at identity rather than identity; then a global id from
   * a flood fill over the whole map, which was a fourth source of truth and
   * stale on the path that ships. It is the corner's own partition now, named
   * by WHICH of its at most twelve contributors are in it — canonical, so
   * every one of them files under the same key. @see render/sheet-group
   *
   * A small open table, scanned linearly: tier `t` of corner `v` is at
   * `v * TIERS + t`, and a lookup is at most {@link TIERS} compares against a
   * cache line. @see tierFor
   */
  cSheet: Int32Array;
  /**
   * EVERY CORNER'S PARTITION, worked out once each frame it is wanted.
   *
   * The rule is cheap and the builder is not shy about asking: the scatter,
   * the quad and both side faces all come back to the same corner, a dozen
   * times over per column. Held per corner instead, a corner is partitioned
   * once — a union-find over at most twelve nodes — and everything after that
   * is a read. Measured on the pond tests, which run twelve hundred frames:
   * without this the CPU builder went from about two seconds to nine.
   *
   * `maskStamp` is which frame a corner's entry belongs to, against `stamp`.
   * A stamp rather than a clear because the whole array is the map and the
   * water is a corner of it. @see cornerMasksInto
   */
  masks: Int32Array;
  maskStamp: Int32Array;
  /** Bumped once per draw, which is what makes `maskStamp` mean anything. */
  stamp: number;
  /** Summed surface per tier, and how many contributed. */
  vs: Float32Array;
  vn: Uint8Array;
  /**
   * The highest bed any of a tier's contributors stands on, and which SLOT
   * that one was in.
   *
   * Both go to the rim rule, which asks what the ground does beside the
   * corner — and on a map with bridges "the ground" is a question that needs
   * a storey named before it can be answered. @see asideAt
   */
  vBed: Int8Array;
  vSlot: Uint8Array;
  /**
   * Vertex ALPHA, one byte per TIER, from the water standing at it.
   *
   * Per corner rather than per column because opacity is the one thing that
   * varies across a still sheet: the surface is level but the bed under it is
   * not, so depth — and with it how much you see through — changes from one
   * column to the next. Flat-shaded, every cell boundary under a puddle became
   * a hard step in the shading, which is what a dipped bed looked like.
   *
   * PER TIER is the fix for the bridge: these all followed the high group
   * alone, so the river under a span was drawn at its own height with the
   * DECK's colour and opacity. Measured on a culvert, alpha 235 in the open
   * channel and 23 under the span.
   */
  va: Uint8Array;
  /** Scratch: summed depth per tier, before it becomes `va`. */
  vd: Float32Array;
  /** Scratch: summed flow per tier, before it becomes `vl`. */
  vvx: Float32Array;
  vvy: Float32Array;
  /** Vertex LIGHTNESS, as an index into `tint`: tilt and the flow bands. */
  vl: Uint8Array;
  /** `TINTS` shades of every fluid, packed and ready to pair with an alpha. */
  tint: Uint32Array;
  /** The pattern the current carries, and the corner averages of it. */
  wash: FlowWash;
  vw: Float32Array;
  /** Where the water has gone white, and the corner averages of that. */
  foam: FoamField;
  vf: Float32Array;
  /**
   * How many contributors were dropped for want of a tier, last frame.
   *
   * A diagnostic and not a fallback: {@link TIERS} is set from this, and a
   * number that is not nought on an ordinary map means it is set too low.
   */
  overflow: number;
  /**
   * Bands whose batch holds quads, or held some last frame.
   *
   * Both halves matter: a band that has just emptied still has to be uploaded
   * once more, to take last frame's quads off the GPU.
   */
  live: Set<number>;
  t: number;
};

/**
 * How many distinct SHEETS one corner may carry.
 *
 * Three, and the number is measured rather than chosen. A corner is touched
 * by four columns and every storey of each, so eight entries at two storeys —
 * but they collapse: the four columns of one sheet are one tier, and it takes
 * genuinely separate water to need another. Two is enough for a bridge (the
 * deck and the channel) and enough for a cliff (the sheet and the lake); the
 * third is for a cliff AT a bridge, which is where a span meets a bank.
 *
 * Contributors past the last tier are DROPPED, and `overflow` counts them so
 * that "never happens" is a measurement and not a hope.
 */
export const TIERS = 3;

/**
 * A tier nobody has claimed.
 *
 * Nought, and it can be: a component always holds at least the contributor
 * that asked for it, so a real mask is never nought. That is one fewer
 * sentinel to import now that the global ids are gone.
 * @see render/sheet-group
 */
export const NO_SHEET = 0;

/** `columns` and not a `WaterField`, so a second storey can have a layer. */
export function createWaterLayer(columns: ColumnField, bands: BandLayer, scale = 1): WaterLayer {
  const strips: QuadBatch[] = [];
  const under: QuadBatch[] = [];
  for (let b = 0; b < bands.bands.length; b++) {
    strips.push(createQuadBatch(bands.structureOf[b]));
    under.push(createQuadBatch(bands.underOf[b]));
  }
  const corners = (columns.nx + 1) * (columns.ny + 1);
  const n = corners * TIERS;
  return {
    strips,
    under,
    scale,
    cSheet: new Int32Array(n),
    masks: new Int32Array(corners * CORNER_COLUMNS * columns.layers),
    maskStamp: new Int32Array(corners),
    stamp: 0,
    vs: new Float32Array(n),
    vBed: new Int8Array(n),
    vSlot: new Uint8Array(n),
    va: new Uint8Array(n),
    vd: new Float32Array(n),
    vvx: new Float32Array(n),
    vvy: new Float32Array(n),
    vl: new Uint8Array(n),
    vn: new Uint8Array(n),
    tint: buildTints(),
    wash: createFlowWash(columns),
    vw: new Float32Array(n),
    foam: createFoam(columns),
    vf: new Float32Array(n),
    overflow: 0,
    live: new Set(),
    t: 0,
  };
}

/**
 * The tier corner `v` keeps sheet `b` in, claiming a free one if it has none.
 *
 * -1 when every tier is taken by another sheet, which is the overflow the
 * layer counts. Dropping a contributor is the only honest thing to do with
 * one: merging it into a tier that belongs to different water is exactly the
 * fault this whole scheme exists to remove.
 */
function tierFor(wl: WaterLayer, v: number, b: number): number {
  const base = v * TIERS;
  for (let t = 0; t < TIERS; t++) {
    const id = wl.cSheet[base + t];
    if (id === b) return base + t;
    if (id === NO_SHEET) {
      wl.cSheet[base + t] = b;
      return base + t;
    }
  }
  wl.overflow++;
  return -1;
}

/**
 * The tier corner `v` already holds sheet `b` in, or -1. Claims nothing.
 *
 * Exported because a corner's value is no longer at its own index — anything
 * reading `vs`, `va` or `vl` has to say WHICH water it means, and the falls
 * renderer and the tests both do.
 */
export function tierAt(wl: WaterLayer, v: number, b: number): number {
  const base = v * TIERS;
  for (let t = 0; t < TIERS; t++) {
    if (wl.cSheet[base + t] === b) return base + t;
  }
  return -1;
}

/**
 * The tier corner `v` holds the water of slot `a` of column `(cx, cy)` in.
 *
 * The lookup every caller outside this file actually wants: it partitions the
 * corner and then finds the tier. `(vx, vy)` is the corner's own coordinate
 * and `v` its index, which are two spellings of one thing and both wanted —
 * the caller has the index already and the rule needs the coordinate.
 */
export function tierOf(
  wl: WaterLayer, columns: ColumnField, v: number,
  vx: number, vy: number, cx: number, cy: number, a: number,
): number {
  return tierAt(wl, v, maskOf(wl, columns, v, vx, vy, cx, cy, a));
}

/**
 * The component slot `a` of column `(cx, cy)` is in at corner `v`.
 *
 * The memo in front of {@link cornerMasksInto}, and the only thing that reads
 * `masks` — so a stale stamp can only ever cost a recompute, never a wrong
 * answer. @see WaterLayer.masks
 */
function maskOf(
  wl: WaterLayer, columns: ColumnField, v: number,
  vx: number, vy: number, cx: number, cy: number, a: number,
): number {
  const n = CORNER_COLUMNS * columns.layers;
  const at = v * n;
  if (wl.maskStamp[v] !== wl.stamp) {
    cornerMasksInto(columns, vx, vy, wl.masks, at);
    wl.maskStamp[v] = wl.stamp;
  }
  return wl.masks[at + contribOf(vx, vy, cx, cy, a, columns.layers)];
}

/** Lightest a surface gets, as a fraction of the way to white. */
export const LIGHTEST = 0.45;

/** Shades per fluid: the water's own, then the foam's. */
export const SHADES = TINTS + FOAM_TINTS;

/**
 * How LIT a piece of surface is, before foam: nought is the darkest shade
 * water reaches and one the lightest.
 *
 * `lean` is which way it faces, already through {@link respond} and so in
 * -1..1; `wash` is the pattern the current carries, and `shown` how much of
 * that pattern is out — see the note at the call site.
 *
 * Shared with the SHEET going over a lip, which has to arrive at the same
 * answer from the other side of the join and cannot be left to retype these
 * three coefficients. A lip leans fully downstream by construction, so what it
 * passes for `lean` is how much of a brink it is on.
 */
export const litAt = (lean: number, wash: number, shown: number) =>
  0.5 + lean * 0.34 + wash * (0.2 + 0.8 * shown) * 0.3;

/**
 * What a piece of water LOOKS like: how far along the shade ramp it sits, and
 * how much of what is behind it it covers.
 *
 * THE ONE PLACE, because there are two objects drawing the same water. The
 * surface mesh stops at a lip and a SHEET carries on over it, and at the brink
 * they are the same water seen in the same frame — so anything that decides
 * how that water looks has to be asked once and answered once, or there is a
 * seam exactly where the eye is already looking.
 *
 * It was two places, and they did not agree. Measured on a foaming lip: the
 * surface at 0.93 of the way to white and RGB(240,245,248), the sheet leaving
 * it at 0.72 and RGB(195,215,226) — a gap of forty-five, thirty and twenty-two
 * across the join, with the sheet the greyer. And 0.72 was the sheet's
 * CEILING: it took foam as something ADDED, `CARRIED * foam` with `CARRIED` a
 * third, so the whitest sheet it could draw fell short of the whitest surface
 * however hard the water was breaking.
 *
 * Which is the same fault the surface had and had already fixed, one object
 * later — see the note below on foam as a MIX. Foam of one is the top of the
 * ramp whatever was underneath it, so a fully broken lip and the fully broken
 * sheet leaving it land on the same shade from either side.
 *
 * `shade` comes back as a position on the ramp rather than a colour: the mesh
 * rounds it to a palette index, and a sheet — which has no palette — carries
 * the fraction. See `paleAt` for the colour.
 */
export function surfaceLook(shown: number, foam: number, lit: number) {
  const body = shade(shown);
  // FOAM CLOSES THE SURFACE UP as well as whitening it. Water is clear and
  // foam is not — it is full of air — so a crest that went pale and stayed as
  // see-through as the pond behind it looked like a highlight painted on the
  // mesh. It can only close what the water is already covering: the fade that
  // brings a thin sheet in gates it, or a spreading front would paint white
  // over ground its own sheet is still invisible on.
  const fade = Math.min(1, shown / SHOW_DEPTH);
  const cover = body + (1 - body) * foam * FOAM_COVER * fade;
  // AND FOAM CARRIES THE SHADE past anything water does, into the range above
  // — as a MIX towards the white end, not as something added on. Added on,
  // foam had to work from wherever the water's own shading had got to, which
  // is halfway up a ramp of thirty-two: a fully broken crest landed at 40 of
  // 55 and came out RGB(174,...) against water's own ceiling of 138. Barely
  // paler than water, for the whitest thing the renderer can draw.
  const base = Math.max(0, Math.min(1, lit)) * (TINTS - 1);
  return { cover, shade: base + foam * (SHADES - 1 - base) };
}

/** How far towards white a place on the shade ramp is. @see buildTints */
export const paleAt = (k: number) => (k < TINTS
  ? LIGHTEST * k / (TINTS - 1)
  : LIGHTEST + (FOAM_WHITE - LIGHTEST) * (k - TINTS + 1) / FOAM_TINTS);

/** Every shade of every fluid, packed once. See {@link TINTS}. */
function buildTints(): Uint32Array {
  const out = new Uint32Array(MATERIAL_SLOTS * SHADES);
  for (let m = 0; m < MATERIAL_SLOTS; m++) {
    const base = fluidMaterial(m)?.colour ?? 0x2a6f97;
    for (let k = 0; k < SHADES; k++) out[m * SHADES + k] = packRGB(aerate(base, paleAt(k)));
  }
  return out;
}

export function destroyWaterLayer(wl: WaterLayer) {
  for (const b of wl.strips) destroyQuadBatch(b);
  for (const b of wl.under) destroyQuadBatch(b);
  wl.strips.length = 0;
  wl.under.length = 0;
  wl.live.clear();
}

/**
 * How opaque water of a given depth is, from nothing to its fullest.
 *
 * Two ramps: one for how much water there is to see through, and one that
 * fades the whole thing away as the sheet thins to nothing. The second is what
 * lets the mesh cover every wet column without a damp fringe painting the map.
 */
/**
 * The opacity ramp itself: from as faint as water is ever drawn to as solid as
 * it gets, against how much of it there is to see through.
 *
 * One curve, used for three different measures of "how much" — the depth
 * standing on a column, the depth at an edge, and how hard a lip is pouring —
 * because they are all the same question and answering it three ways is how a
 * surface, its sides and its falls come to disagree about being the same
 * water.
 */
/**
 * The two ends of the opacity ramp, NAMED so the shaders can be given them.
 *
 * They were literals inside `solid`, which was fine while `solid` was the only
 * statement of it — and it is not: `sheet.ts` writes the same two numbers into
 * WGSL by hand. @see sheetRuleSource
 */
export const SOLID_FLOOR = 0.30;
export const SOLID_RANGE = 0.62;

export const solid = (much: number) =>
  SOLID_FLOOR + SOLID_RANGE * Math.min(1, much);

/**
 * How solid a given DEPTH of this fluid is drawn, nought to one.
 *
 * Exported because the falls layer draws the same water: a sheet leaving a lip
 * is as thick as the water on the lip, so it is as solid as that water, and
 * asking the question a second way is what put a step in the middle of it.
 */
export const shade = (d: number) =>
  solid(d / OPAQUE_DEPTH) * Math.min(1, d / SHOW_DEPTH);


/**
 * How much of its depth a column's surface is DRAWN DOWN by, in half steps.
 *
 * A free overfall does not go over the edge flat. The surface starts falling
 * before the brink and is already tipped toward the fall when it gets there —
 * that is the drawdown, and it is the curve you actually see at the top of a
 * waterfall, as opposed to the arc of the sheet below it.
 *
 * The solver HAS it. Traced down a lip: 0.74, 0.70, 0.75, 0.75, 0.68, 0.65,
 * 0.62, 0.63, 0.57, 0.48, 0.32 half steps, and the mesh draws every one of
 * those faithfully. The trouble is that it is 0.42 of a half step spread over
 * two and a half tiles — SEVEN PIXELS of sag across a hundred and sixty-five,
 * which is nothing, and a sheet cannot sag further than it is thick.
 *
 * What it can do is sag in the right PLACE. A real drawdown is steepest in
 * the last fraction before the brink; the solver spreads it across cells
 * because cells are what it has. Leaning the same drop toward the lip turns
 * seven flat pixels into a bend, and costs no water: this moves where the
 * surface is DRAWN, not how much of it there is — the depth that decides how
 * solid it looks is untouched, or the seam at the lip would open again.
 *
 * Bounded by the water's own depth, which is the honest limit of it. On a
 * sheet twelve pixels deep there is no rounded lip to be had at any price,
 * and the curve has to come from the sheet below — see `render/nappe`.
 */
export const DRAWDOWN = 0.55;

/**
 * The depth a column is SHOWN at: its own, unless its water stands at a BRINK.
 *
 * The fade that brings a shoreline in has no business at a lip — see
 * `corner-rule`'s {@link atBrink}. Water at a brink is thin because it is
 * leaving, not because it is ending, and faded as though it were ending the
 * one place a sheet has to be continuous goes translucent.
 *
 * A FLOOR and not an override, so nothing deeper is touched, and the only
 * thing it changes past the fade is the opacity ramp's own term — by at most
 * `SHOW_DEPTH / OPAQUE_DEPTH`, which is six thousandths of an alpha.
 */
export function shownDepth(columns: ColumnField, i: number, d: number): number {
  if (d >= SHOW_DEPTH) return d;
  const a = (i / columns.cells) | 0;
  const brink = atBrink(
    columns.nx, columns.ny, i % columns.cells, columns.ground, columns.depth,
    columns.params.dryDepth, FALL_MIN, a * columns.cells, columns.roof,
  );
  const floor = SHOW_DEPTH * brink;
  return d > floor ? d : floor;
}

/**
 * The biggest STEP the ground makes beside a corner, either way up, in half
 * steps.
 *
 * Over all four columns that meet there, dry ones included: the question is
 * what the GROUND does, not what the water does. Either way up because the rim
 * rule wants the one case where the ground stays at the water's own level — a
 * shore — and a bank rising over the water is a container, not a shore, just
 * as a lip falling away from it is not. See `rimAt`.
 *
 * Off the edge of the MAP it is unbounded, because a cut through the world is
 * not a shore either: the terrain shows its skirt there and the water should
 * show a cross-section to match.
 */
export function asideAt(
  columns: ColumnField, vx: number, vy: number, bed: number, a = 0,
) {
  const { nx, ny, ground } = columns;
  const base = a * columns.cells;
  let lowest = bed, highest = bed;
  for (let k = 0; k < 4; k++) {
    const cx = vx - 1 + (k & 1), cy = vy - 1 + (k >> 1);
    if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) return Infinity;
    const g = ground[base + cy * nx + cx];
    if (g < lowest) lowest = g;
    if (g > highest) highest = g;
  }
  return Math.max(bed - lowest, highest - bed);
}

/**
 * Average the surrounding wet columns into each corner.
 *
 * Corner-averaged rather than one flat quad per column: a quad at its own
 * surface makes the water a staircase of plates, one per column, and every
 * column boundary a visible step. Averaging only WET neighbours is what keeps
 * the edge of the water at the edge of the water — including dry ones would
 * drag the shoreline down toward the ground and leave the sheet sloping into
 * nothing.
 */
function cornerValues(
  wl: WaterLayer, columns: ColumnField,
  region: { x0: number; y0: number; x1: number; y1: number },
  rim: number,
) {
  const { nx, depth, params } = columns;
  const vw = nx + 1;
  // Only the region's own corners, cleared and rebuilt: filling the whole
  // vertex array cost more than the water did on a mostly dry map.
  //
  // TWO ARRAYS AND NOT ONE. `cSheet` is what empties a tier, and `vn` is what
  // says whether the first contributor to it has arrived — everything else is
  // written by that first contributor, so nothing else needs clearing. Left
  // out, `vn` carried last frame's count into this one: the sums went on
  // accumulating for ever and a still scene drawn six times running gave six
  // different answers, the corners sliding from 3.0 down through 2.5, 1.81,
  // 1.38, 1.12 as the divisor ran away from the sum.
  for (let y = region.y0; y <= region.y1 + 1; y++) {
    const row = y * vw;
    const from = (row + region.x0) * TIERS, to = (row + region.x1 + 2) * TIERS;
    wl.cSheet.fill(NO_SHEET, from, to);
    wl.vn.fill(0, from, to);
  }
  wl.overflow = 0;
  // EVERY STOREY INTO THE SAME TABLE, keyed by the sheet it belongs to.
  //
  // What a corner holds is no longer a guess from bed heights, and no longer
  // an id from a flood fill over the whole map either. Each corner partitions
  // its own at most twelve contributors by the two rules the solver owns —
  // nothing solid between them, and no fall between them — and the key is
  // WHICH of them are in the component. That key is canonical, so two columns
  // of one sheet cannot land in different tiers. @see render/sheet-group
  //
  // That is what joins a bridge to the road at its end: the road's slot zero
  // and the deck's slot one are the same sheet, so they average into the same
  // vertices and there is no join to line up. And it is what keeps the river
  // under the span out of it: a deck is solid, so that is a second sheet with
  // a tier and a colour of its own.
  for (let a = 0; a < columns.layers; a++) {
  const A = a * columns.cells;
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      const ci = y * nx + x;
      const i = A + ci;
      const d = depth[i];
      if (d <= params.dryDepth) continue;
      const bed = columns.ground[i];
      const shown = shownDepth(columns, i, d);
      // Leaned toward the lip — see `DRAWDOWN`. The height only; `shown` is
      // what decides how solid it looks and stays the water's own.
      const sag = d * DRAWDOWN * atBrink(
        columns.nx, columns.ny, ci, columns.ground, columns.depth,
        columns.params.dryDepth, FALL_MIN, A, columns.roof,
      );
      const surface = surfaceAt(columns, i) - sag;
      const vx = flowX(columns, x, y, a), vy = flowY(columns, x, y, a);
      const wash = wl.wash.now, foam = wl.foam.now;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const v = (y + dy) * vw + (x + dx);
        // THIS CORNER'S OWN PARTITION, asked with this column as the one
        // doing the asking. A column is always one of its corners' four, so
        // what comes back is always the component it is in.
        const k = tierFor(wl, v, maskOf(wl, columns, v, x + dx, y + dy, x, y, a));
        if (k < 0) continue;                    // no room; counted, not merged
        if (wl.vn[k] === 0) {
          wl.vs[k] = surface;
          wl.vn[k] = 1;
          wl.vBed[k] = bed;
          wl.vSlot[k] = a;
          wl.vd[k] = shown;
          wl.vvx[k] = vx;
          wl.vvy[k] = vy;
          wl.vw[k] = wash[ci];
          wl.vf[k] = foam[i];
        } else {
          wl.vs[k] += surface;
          wl.vn[k]++;
          // The highest bed of the sheet's own contributors, and the storey
          // it was in — both for the rim rule alone. @see asideAt
          if (bed > wl.vBed[k]) { wl.vBed[k] = bed; wl.vSlot[k] = a; }
          wl.vd[k] += shown;
          wl.vvx[k] += vx;
          wl.vvy[k] += vy;
          wl.vw[k] += wash[ci];
          wl.vf[k] += foam[i];
        }
      }
    }
  }
  }
  // Averaged FIRST, all of them, and only then shaded. Doing both in one pass
  // left `tiltAt` reading the next row's corners while they still held the SUM
  // of the columns round them — up to four times what they should be — so the
  // tilt came out enormously negative and every corner it touched was pinned
  // at the darkest shade there is. The bands were being computed perfectly and
  // then thrown away.
  for (let y = region.y0; y <= region.y1 + 1; y++) {
    for (let x = region.x0; x <= region.x1 + 1; x++) {
      const v = y * vw + x;
      for (let t = 0; t < TIERS; t++) {
        const k = v * TIERS + t;
        if (wl.cSheet[k] === NO_SHEET) break;    // tiers fill in order
        const n = wl.vn[k];
        if (!n) continue;
        // What HEIGHT the corner is drawn at is not decided here — see
        // `corner-rule.ts`, which the shader path is generated from too. It
        // was written out three times once, and the third one was wrong.
        //
        // WITH AN EMPTY LOW GROUP, always, and that is the whole of what the
        // sheets bought. The rule's job was to split one corner's water into
        // two bodies and then think better of it where the split was wrong;
        // the split is now made by `findBodies`, once, off the geometry, so
        // what arrives here is one body and the merge branch never runs.
        //
        // The rule still needs to know WHAT IS BESIDE the corner: only a
        // corner beside ground at its own level is a shore, and only a shore
        // ends in a waterline. A bank over it is a container and a drop under
        // it is a lip, and neither wants feathering. Asked in the sheet's own
        // STOREY, or a deck's rim would be measured against the riverbed
        // twenty half steps under it and read as a cut through the world.
        const corner = resolveCorner(
          wl.vs[k], n, 0, 0, wl.vBed[k],
          asideAt(columns, x, y, wl.vBed[k], wl.vSlot[k]), rim,
        );
        wl.vs[k] = corner.high;
        wl.vd[k] /= n;
        wl.vvx[k] /= n;
        wl.vvy[k] /= n;
        wl.vw[k] /= n;
        wl.vf[k] /= n;
      }
    }
  }

  for (let y = region.y0; y <= region.y1 + 1; y++) {
    for (let x = region.x0; x <= region.x1 + 1; x++) {
      const v = y * vw + x;
      for (let t = 0; t < TIERS; t++) {
        const k = v * TIERS + t;
        const sheet = wl.cSheet[k];
        if (sheet === NO_SHEET) break;
        if (!wl.vn[k]) continue;
        // Packed here, once per corner per sheet, rather than four times over
        // in the quad loop: a corner is shared by four quads and its shade is
        // the same for all of them.
        //
        // Foam closes the surface up as well as whitening it. Water is clear
        // and foam is not — it is full of air — so a crest that went pale and
        // stayed as see-through as the pond behind it looked like a highlight
        // painted on the mesh. It can only close what the water is already
        // covering: the fade that brings a thin sheet in gates it, or a
        // spreading front would paint white over ground its own sheet is
        // still invisible on.
        const foam = wl.vf[k];

        // How the surface leans, along BOTH axes rather than one: up-screen in
        // this projection is up and left together, so a wave running the other
        // way was unlit by a shading term that only looked one way. Along the
        // SHEET, so a lean is a slope in the same water rather than the drop
        // to whatever else happens to reach this corner.
        const gx = nearby(wl, columns, v, -1, 0, k) - nearby(wl, columns, v, 1, 0, k);
        const gy = nearby(wl, columns, v, 0, -1, k) - nearby(wl, columns, v, 0, 1, k);
        const lean = (gx + gy) * 0.5;

        // The pattern the current carries, shown where the water is moving —
        // and where it is LEANING. That second part is what stops the mottle
        // reading as a texture stuck to the world: a wave passing over still
        // water brings the pattern out on its own face and lets it go again
        // behind, so what you see travels with the wave even though what it is
        // made of stays where it is. Which is how water works, more or less:
        // the swell moves, the water does not go with it.
        const sp = Math.sqrt(wl.vvx[k] * wl.vvx[k] + wl.vvy[k] * wl.vvy[k]);
        const rough = Math.min(1, (Math.abs(gx) + Math.abs(gy)) / (SLOPE_REF * 2));
        const shown = Math.max(rough, Math.min(1, sp / STREAK_SPEED));
        const lit = litAt(respond(lean), wl.vw[k], shown);
        // And FOAM carries the shade on past anything water does, into the
        // range above — as a MIX towards the white end, not as something added
        // on. Added on, foam had to work from wherever the water's own shading
        // had got to, which is halfway up a ramp of thirty-two: a fully broken
        // crest landed at 40 of 55 and came out RGB(174,...) against water's
        // own ceiling of 138. Barely paler than water, for the whitest thing
        // the renderer can draw. Mixed, foam of one is the top of the ramp
        // whatever was underneath it, and foam of nothing leaves the water
        // alone. Both of them in one place, because the SHEET going over a lip
        // has to arrive at the same answer — see `surfaceLook`.
        const look = surfaceLook(wl.vd[k], foam, lit);
        wl.va[k] = packAlpha(look.cover);
        wl.vl[k] = Math.round(look.shade);
      }
    }
  }
}

/**
 * A corner's surface as the sheet `b` draws it.
 *
 * A column asks for its OWN sheet and always finds it: the column itself
 * contributed to this corner under that id, so the tier is there and holds a
 * value it helped make. That is the property the bed split was chosen for and
 * it is exact here rather than approximate — two columns of one sheet are not
 * deciding anything, the fill decided once, for the edge between them.
 *
 * The fallback is for the caller that asks about somebody ELSE's sheet — the
 * side faces do, end for end — and for the one corner in a million that ran
 * out of tiers.
 */
const level = (wl: WaterLayer, k: number, fallback: number) =>
  (k < 0 || !wl.vn[k] ? fallback : wl.vs[k]);

/**
 * The same sheet's surface one step away, or this corner's own where the
 * sheet does not reach.
 *
 * The fallback reads as level. The alternative is a shoreline lit as though
 * it fell away to nothing, because an unwritten corner holds zero — and, now
 * that a corner holds several sheets, a shoreline lit by whatever unrelated
 * water happens to be next to it.
 */
function nearby(
  wl: WaterLayer, columns: ColumnField, v: number, dx: number, dy: number,
  k: number,
): number {
  const vw = columns.nx + 1;
  const j = v + dx + dy * vw;
  const here = wl.vs[k];
  if (j < 0 || j * TIERS >= wl.vs.length) return here;
  // ASKED THROUGH A COLUMN THE TWO CORNERS SHARE, picked canonically — a
  // component decided AT this corner says nothing about the one a step away,
  // and picking the bridge per asker would give four columns of one sheet
  // four different answers for the corner they share. @see sharedContrib
  const vx = v % vw, vy = (v / vw) | 0;
  const m = sharedContrib(wl.cSheet[k], dx, dy, columns.layers);
  if (m >= 0) {
    const q = Math.floor(m / columns.layers);
    const jk = tierAt(wl, j, maskOf(
      wl, columns, j, vx + dx, vy + dy,
      vx - 1 + (q & 1), vy - 1 + (q >> 1), m % columns.layers,
    ));
    if (jk >= 0 && wl.vn[jk]) return wl.vs[jk];
  }
  // NOT THIS SHEET, so it is only a gradient if it is BELOW. A lip is the
  // case that matters: the surface really does tip over the edge, and the
  // sheet leaving it is lit from exactly that — so a brink read as level
  // stops agreeing with its own waterfall, which is measured in
  // `falls-render.test`. Water ABOVE is a bridge, and a bridge is not a
  // slope in the water under it: lit from one, a river changed brightness
  // wherever it passed beneath a span.
  //
  // The lowest of them, so a drop is the drop to the floor of whatever is
  // down there rather than to the nearest of several sheets.
  let below = here;
  for (let t = 0; t < TIERS; t++) {
    const o = j * TIERS + t;
    if (wl.cSheet[o] === NO_SHEET) break;
    if (wl.vn[o] && wl.vs[o] < below) below = wl.vs[o];
  }
  return below;
}

/**
 * Steep near flat, saturating past it. Maps any slope onto -1..1.
 *
 * A straight multiple cannot serve both: the coefficient that makes a pond's
 * ripples visible sends a river's standing waves off the end of the scale, and
 * the one that suits the river leaves the pond looking like glass.
 */
const respond = (v: number) => v / (Math.abs(v) + SLOPE_REF);

/** Lighten toward white, for the aerated look of moving water. */
export function aerate(colour: number, t: number): number {
  const ch = (sh: number) => {
    const c = (colour >> sh) & 0xff;
    return Math.min(255, Math.round(c + (255 - c) * t));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * Rewrite the whole surface from the columns.
 *
 * Every frame and from scratch, because that is what "the mesh is the
 * simulation's output" means — there is no incremental version of a surface
 * that changes everywhere at once. What makes that affordable is that a frame
 * writes vertices and uploads them: the cost is one quad per wet column, in
 * proportion to how much water there is rather than to how big the map is.
 */
export function drawWater(
  wl: WaterLayer, columns: ColumnField, bands: BandLayer, dt: number,
  faces = true, rim = RIM,
) {
  wl.t += dt;
  // A NEW FRAME, so every corner's partition is stale. One increment rather
  // than clearing a megabyte of stamps. @see WaterLayer.masks
  wl.stamp++;

  // Rewind the batches that hold anything, so an empty map costs nothing. The
  // quads still sit in their buffers until they are overwritten or uploaded
  // over; `live` is what remembers that they need one or the other.
  for (const b of wl.live) { resetQuads(wl.strips[b]); resetQuads(wl.under[b]); }

  const region = activeBox(columns);
  if (region) {
    // WHICH WATER IS ONE SHEET is no longer worked out here, ahead of
    // everything, and that is the point of `render/sheet-group`: each corner
    // partitions its own contributors when it is asked, out of depth, ground
    // and roof. There is nothing to prepare, nothing to keep in step with the
    // box, and nothing that can be a frame behind what it is grouping.
    //
    // It also takes a bug with it. The fill had to run one column WIDER than
    // the active box, because a side face asks what the NEIGHBOUR draws and
    // the neighbour of the last column in the box is outside it; labelled only
    // to the box, that neighbour answered with whatever it was carrying from
    // an earlier, larger frame, and the faces came out differently on the
    // second draw of an unchanged scene. A corner that decides for itself has
    // no edge to fall off.
    //
    // Carried one frame down the current before anything reads it. The falls
    // advance in the SOLVER now — where a fall has got to decides when its
    // water lands, so it is not a thing the renderer may have an opinion on.
    if (dt > 0) {
      stepFlowWash(wl.wash, columns, dt, region);
      stepFoam(wl.foam, columns, dt, region);
    }
    cornerValues(wl, columns, region, rim);
    fillQuads(wl, columns, bands, region, faces, rim);
  }

  for (const b of [...wl.live]) {
    uploadQuads(wl.strips[b]);
    uploadQuads(wl.under[b]);
    // Emptied, and now uploaded empty — but only once BOTH tiers are, or a
    // band whose surface water has gone would stop uploading the roofed
    // water still in it.
    if (wl.strips[b].n === 0 && wl.under[b].n === 0) wl.live.delete(b);
  }
}

/** Walk the wet columns and write a quad for each. */
function fillQuads(
  wl: WaterLayer, columns: ColumnField, bands: BandLayer,
  region: { x0: number; y0: number; x1: number; y1: number },
  faces: boolean, rim: number,
) {
  const { nx, depth } = columns;
  const s = wl.scale;

  // CULLED to the bands on screen: the band renderer already knows what is
  // visible, having been built around exactly that question, and there is no
  // reason to push a vertex for water behind the camera.
  const lo = bands.visibleLo, hi = bands.visibleHi;

  const vw = nx + 1;
  const step = 1 / COLUMNS_PER_TILE;
  const HWs = HW * s, HHs = HH * s, HUs = HEIGHT_UNIT * s;

  for (let cy = region.y0; cy <= region.y1; cy++) {
    const ty = tileOf(cy);
    const fy0 = ty - 0.5 + (cy % COLUMNS_PER_TILE) * step;
    const fy1 = fy0 + step;
    // A band is a DIAGONAL, so for this row the visible tiles are exactly
    // `lo - ty` to `hi - ty` in x — clamping the scan rather than testing each
    // column and skipping. On a flooded map that is the difference between
    // walking every column and walking the strip you can see.
    const rx0 = Math.max(region.x0, columnOf(Math.max(0, lo - ty)));
    const rx1 = Math.min(region.x1, columnOf(hi - ty) + COLUMNS_PER_TILE - 1);
    for (let cx = rx0; cx <= rx1; cx++) {
      const ci = cy * nx + cx;
      // A QUAD PER SLOT, not per column. A bridge column carries the river
      // under the span and whatever is standing on the deck, and both of them
      // are water somebody can see. @see cornerValues
      for (let a = 0; a < columns.layers; a++) {
      const i = a * columns.cells + ci;
      const d = depth[i];
      if (d <= columns.params.dryDepth) continue;

      const tx = tileOf(cx);
      // UNDER A ROOF GOES UNDER THE ROOF. Everything else is water in the
      // open and draws where water has always drawn. @see BandLayer.underOf
      const roofed = columns.roof[i] < OPEN_SKY;
      const set = roofed ? wl.under : wl.strips;
      const batch = set[tx + ty];
      if (!batch) continue;

      const mat = columns.material[i];
      const base = fluidMaterial(mat)?.colour ?? 0x2a6f97;
      const fx0v = tx - 0.5 + (cx % COLUMNS_PER_TILE) * step;
      const fx1v = fx0v + step;

      // A FALL is about what is crossing the edge, not what is standing on it.
      // The FALLS are not here. Water thrown off a lip travels toward the
      // camera as it drops, so by the time it lands it is in a different band
      // from the column it left — which is the one thing a mesh sorted by
      // column cannot express. See `render/falls-render`.
      wl.live.add(tx + ty);

      // A CORNER IS A CORNER. Every column that meets at one draws it at the
      // same height, or the mesh comes apart — and the only thing that may
      // move it is the bed, which is shared by every column standing on that
      // tile, so neighbours still agree.
      //
      // There was a second rule here and it tore the water open. A corner far
      // from a column's own surface was dropped in favour of that surface, to
      // stop a plateau's last quad diving toward the water ten steps below it.
      // But "far" is a threshold, and a threshold is a decision each column
      // makes for itself: put a wave through a pond and the crest crosses it
      // while the trough beside it does not, so the two stop sharing the
      // corner between them and the sheet splits. Measured on a pond with a
      // slug dropped in it: nothing at rest, 2.3% of edges torn at a modest
      // wave, 19% at a big one, gaps up to two hundred pixels — whole tiles
      // of ground showing through the water. The clamp alone does the job the
      // threshold was there for, and cannot disagree with itself.
      const bed = columns.ground[i];
      const own = surfaceAt(columns, i);
      const v00 = cy * vw + cx, v10 = v00 + 1, v01 = v00 + vw, v11 = v01 + 1;
      // EACH CORNER'S OWN PARTITION, asked with this column. The key is no
      // longer one id shared by all four — it is what each corner made of the
      // contributors it has — but it names the same water, because this
      // column is in every one of them. @see render/sheet-group
      const k00 = tierOf(wl, columns, v00, cx, cy, cx, cy, a);
      const k10 = tierOf(wl, columns, v10, cx + 1, cy, cx, cy, a);
      const k11 = tierOf(wl, columns, v11, cx + 1, cy + 1, cx, cy, a);
      const k01 = tierOf(wl, columns, v01, cx, cy + 1, cx, cy, a);
      const h00 = Math.max(k00 < 0 ? own : wl.vs[k00], bed);
      const h10 = Math.max(k10 < 0 ? own : wl.vs[k10], bed);
      const h11 = Math.max(k11 < 0 ? own : wl.vs[k11], bed);
      const h01 = Math.max(k01 < 0 ? own : wl.vs[k01], bed);

      // BOTH the shade and the opacity come from each CORNER, so the surface
      // runs smoothly instead of stepping at every column boundary — a step in
      // the opacity is what a dip in the bed under a puddle used to look like,
      // and a step in the shade is what turned a river into a row of facets.
      //
      // FROM THIS SHEET'S OWN TIER. Before, the corner had one set of these
      // and they came from whichever group won the bed split, so the river
      // under a bridge was drawn with the opacity of whatever was standing on
      // the deck above it. @see bodies.ts
      const tints = mat * SHADES;
      const shadeOf = (k: number) => (k < 0
        ? (packAlpha(1) << 24 | wl.tint[tints]) >>> 0
        : (wl.va[k] << 24 | wl.tint[tints + wl.vl[k]]) >>> 0);
      const c00 = shadeOf(k00), c10 = shadeOf(k10);
      const c11 = shadeOf(k11), c01 = shadeOf(k01);

      pushQuad(
        batch,
        (fx0v - fy0) * HWs, (fx0v + fy0) * HHs - h00 * HUs, c00,
        (fx1v - fy0) * HWs, (fx1v + fy0) * HHs - h10 * HUs, c10,
        (fx1v - fy1) * HWs, (fx1v + fy1) * HHs - h11 * HUs, c11,
        (fx0v - fy1) * HWs, (fx0v + fy1) * HHs - h01 * HUs, c01,
      );

      // And the SIDE of the water body, on the two visible edges only, hung
      // from the very corners the surface quad just used — so the sheet and
      // its own edge share vertices and there is no seam between them.
      //
      // FILED FORWARD off a tile's far edge. A face hangs DOWN from the
      // surface, so a face on the boundary of a tile pokes into the diamond of
      // the tile in FRONT of it — and that tile's terrain is a later band and
      // paints over it. On flat water nothing shows, because the tile in front
      // is at the same level and its own water covers the same strip; at a LIP
      // it is six half steps down, its water covers nothing there, and what is
      // left is ground showing through the sheet. Along a stepped cascade that
      // is a row of square teeth, one per band, each as tall as the water is
      // deep.
      //
      // Only where the ground in front is BELOW this water. A tile in front
      // that stands higher is genuinely in front, and its terrain covering the
      // face is the band order doing its job — filed forward, a pond against a
      // wall would paint its edge up the wall. And only on the tile's own far
      // edge: an interior face never crosses a band boundary, so moving it
      // would be a lie about where it is for no gain.
      const surface = columns.ground[i] + d;
      const last = COLUMNS_PER_TILE - 1;
      // Within the slot's own plane: whether the water's edge pokes forward
      // is a question about what is under it in the same storey.
      const eastOn = cx % COLUMNS_PER_TILE === last
        && cx + 1 < nx && columns.ground[i + 1] < surface;
      const southOn = cy % COLUMNS_PER_TILE === last
        && cy + 1 < columns.ny && columns.ground[i + nx] < surface;
      // Never past the cull: a band that is switched off draws nothing, and
      // the tile the face belongs to is still on screen.
      if (!faces) continue;                     // the debug switch
      const ahead = tx + ty + 1 <= hi ? set[tx + ty + 1] : undefined;
      const eastB = eastOn && ahead ? ahead : batch;
      const southB = southOn && ahead ? ahead : batch;
      if (eastB !== batch || southB !== batch) wl.live.add(tx + ty + 1);
      sideFace(eastB, wl, columns, i, a, cx, cy, 1, 0, fx1v, fy0, fx1v, fy1,
        v10, v11, base, HWs, HHs, HUs, rim);
      sideFace(southB, wl, columns, i, a, cx, cy, 0, 1, fx0v, fy1, fx1v, fy1,
        v01, v11, base, HWs, HHs, HUs, rim);
      }
    }
  }
}

/** How fast a column is going, 0 to 1. */
function speed(columns: ColumnField, cx: number, cy: number, a = 0): number {
  const { vx, vy } = velocityAt(columns, cx, cy, a);
  return Math.min(1, (Math.abs(vx) + Math.abs(vy)) * 0.5);
}

/**
 * The SIDE of the water standing on a column: its surface down to the ground
 * it is standing on, and no further.
 *
 * No further is the whole point. It used to run down to whatever the NEIGHBOUR
 * stood on, so a pond on a plateau painted itself over the entire cliff
 * beneath it — and the higher the ground, the more of the cliff it covered,
 * because the excess was exactly the height of the drop. What is below the
 * water's own floor is rock.
 */
function sideFace(
  batch: QuadBatch, wl: WaterLayer, columns: ColumnField, i: number, a: number,
  cx: number, cy: number, dx: number, dy: number,
  ax: number, ay: number, bx: number, by: number,
  vA: number, vB: number,
  base: number, HWs: number, HHs: number, HUs: number, rim: number,
) {
  const nx2 = cx + dx, ny2 = cy + dy;
  const bed = columns.ground[i];
  // THE RIM OF THE MAP IS NOT A NEIGHBOUR. It used to return here, and water
  // running to the edge was drawn as a sheet with nothing under it — the
  // terrain's own skirt showing through where the water's body should be. The
  // edge behaves like dry ground at this column's own level, which is what
  // makes the body reach all the way down to the bed it stands on.
  const offMap = nx2 >= columns.nx || ny2 >= columns.ny;
  // THE NEIGHBOUR IN THIS COLUMN'S OWN STOREY, which is what the shader reads
  // and what this did not. `i` is a SLOT and this was a COLUMN, so every side
  // face on a bridged map was hung against slot nought of the column next
  // door: at a deck-to-road seam the shader saw the road's water and this saw
  // the CHANNEL under it, twenty half steps down and usually dry. One path
  // drew a full-height pane there and the other drew nothing.
  //
  // It was invisible to the pixel comparison because the only deck in that
  // scene is submerged, so it has no deck-to-road seam on it at all. The scene
  // has a road onto the span now. @see sidePart
  const j = offMap ? i : a * columns.cells + ny2 * columns.nx + nx2;
  const bedJ = offMap ? bed : columns.ground[j];

  // DOWN TO WHERE THE NEIGHBOUR'S OWN QUAD REACHES, corner for corner, and no
  // lower than this column's bed — below that is rock.
  //
  // Read off what is actually drawn rather than guessed at. The rule here used
  // to be "if the neighbour's water reaches this column's bed, the two are one
  // body and the surface covers the join", which contradicts the corner split
  // that deliberately gives two levels two different heights: water running
  // down a staircase left a band of ground showing along every step's seam,
  // 2.7% of the ground under it and every sample of it on a tile with a one
  // step drop. Matched to the neighbour's corners there is nothing left to
  // leave showing.
  const wetJ = !offMap && columns.depth[j] > columns.params.dryDepth;
  // BOTH SHEETS, EACH NAMED BY THE COLUMN THAT STANDS IN IT. The face hangs
  // from what THIS column's water draws at each corner down to what the
  // NEIGHBOUR'S draws there — which used to be two calls to `levelAt` with
  // two different beds, a stand-in for exactly this question. Asked by
  // contributor it is a lookup, and a neighbour that is a different body of
  // water gives a different answer without anything having to infer that from
  // heights. The twin of water-gpu's sidePart.
  const mine = surfaceAt(columns, i);
  const vw2 = columns.nx + 1;
  const tier = (v: number, qx: number, qy: number) => tierOf(
    wl, columns, v, v % vw2, (v / vw2) | 0, qx, qy, a,
  );
  // What the neighbour would draw if this corner did not know about it: its
  // own surface, which is what it is standing at. Falling back to its BED
  // instead makes the face taller than the water it is the side of, and puts
  // a pane along every edge the rim rule had just taken away.
  const theirTop = wetJ ? surfaceAt(columns, j) : bedJ;
  // Where the side starts and where it reaches is `corner-rule.ts`, which the
  // shader path is generated from too.
  const side = resolveSide(
    bed, bedJ, wetJ,
    level(wl, tier(vA, cx, cy), mine),
    level(wl, wetJ ? tier(vA, nx2, ny2) : -1, theirTop),
    level(wl, tier(vB, cx, cy), mine),
    level(wl, wetJ ? tier(vB, nx2, ny2) : -1, theirTop),
  );
  // Both ends flat against their own floor is a side that is not there. The
  // shader draws it anyway and makes no fragments; here it would be a quad to
  // write and then blank again.
  if (side.topA <= side.floorA && side.topB <= side.floorB) return;

  // Barely lightened. This is the side of a body of water seen edge on, not
  // spray: aerated as hard as a fall it came out near white, and a ring of
  // near-white round every pool on a plateau is what made them read as panels
  // stuck to the rock rather than water standing on it.
  // AS SOLID AS THE WATER IS DEEP, top to bottom, on the same ramp the surface
  // uses — see `shade`. It was a flat 0.30 at the waterline and 0.48 at the
  // foot whatever the water was doing, and that is what made a deep body read
  // as a SHEET OVER A VOID: the geometry was there all along, a flooded
  // sixteen tile map building a hundred and twenty-eight rim faces each
  // exactly as tall as the water is deep, and at a third of an alpha over
  // bright grass what you saw through them was the grass.
  //
  // Flat top to bottom, and that was tried the other way. Lightening the
  // waterline is the physical story — you are looking through less water at
  // the top of a face than at the bottom — but drawn it is worse: the grade
  // puts the ground's own colour through the top half of every edge, so a
  // lake picks up a rim of whatever it is standing on. One number, and the
  // edge reads as the side of a body of water.
  //
  // AND AT A LIP IT IS HANDED OVER TO THE SHEET. A free vertical face of water
  // cannot exist: water is bounded by a container, by a shore, or it is
  // falling, and only two of those are a pane.
  //
  //  - A SHORE is a waterline, and the rim rule has already dealt with it —
  //    the corner comes down to its bed and there is no height here to draw.
  //  - A CONTAINER is a pane, and a real one. Water held by a bank stands full
  //    depth against it. The neighbour is HIGHER, so `beside` is above `bed`,
  //    the spill is nought and the face is untouched.
  //  - THE MAP'S OWN EDGE is a pane too, and an honest one: the terrain shows
  //    its skirt there and the water should show a cross-section to match. An
  //    off-map neighbour stands at this column's own level, so again nought.
  //  - FALLING is not a pane. The water at a lip is not cut and does not end:
  //    it goes over, and what bounds it is the SHEET. Drawn as well, the pane
  //    is a fish tank hung in front of the fall — flat, hard-edged, uniformly
  //    translucent, with the cliff visible through it undistorted, and on a
  //    deep lip the largest one in the scene.
  //
  // What this replaces is the argument that a face at a lip is "the
  // cross-section of the water standing ON the lip, and that water is really
  // there". True, and beside the point: the water is there and the SHEET is
  // what draws it. A nappe hangs from the surface by the lip's own thickness
  // and `driftAt` is NOUGHT at the lip itself, so at the brink the sheet
  // covers this face end for end and every pixel of pane is a second, flatter
  // copy of water already drawn. The bare cliff the old note measured at 82
  // pixels was from when the nappe hung from the BED instead of the surface.
  //
  // Read off the GROUND, not off the solver's fall state, because the shader
  // has the ground and does not have the falls, and the two paths agreeing
  // matters more than either being clever. The one place they differ from
  // "wherever a sheet is drawn" is a lip that is wet but has no fall yet,
  // which lasts the one frame before the solver makes one.
  //
  // Faded rather than switched, over the same ramp `atBrink` uses, so a lip
  // that deepens hands the boundary from the pane to the sheet gradually.
  const beside = wetJ ? bedJ + columns.depth[j] : bedJ;
  const spill = rim * spillAt(bed, beside, FALL_MIN);
  const body = shade(shownDepth(columns, i, columns.depth[i])) * (1 - spill);
  if (body <= 0) return;

  face(batch, ax, ay, bx, by,
    side.topA, side.topB, side.floorA, side.floorB,
    aerate(base, 0.08 + speed(columns, cx, cy, (i / columns.cells) | 0) * 0.14),
    body, body, HWs, HHs, HUs);
}

/**
 * One vertical quad along the full width of an edge, shaded top to bottom.
 *
 * Full width, always: the whole edge of the column is what the water leaves
 * by, and anything narrower leaves the ground showing between one column's
 * face and the next. Everything a face has to say about how much water is
 * involved, it says in the two alphas.
 */
function face(
  batch: QuadBatch,
  ax: number, ay: number, bx: number, by: number,
  topA: number, topB: number, bottomA: number, bottomB: number,
  colour: number, topAlpha: number, bottomAlpha: number,
  HWs: number, HHs: number, HUs: number,
  dx = 0, dy = 0, leanTop = 0, leanFoot = 0,
) {
  const crest = rgba(colour, topAlpha);
  const foot = rgba(colour, bottomAlpha);
  // The LEAN is how far the quad's foot has travelled away from its top,
  // along the axis it is falling down. A side of a body of water has none and
  // is a vertical plane; a fall has one, because water going over a lip keeps
  // the speed it had and the two ends of it are no longer above each other.
  const tx = dx * leanTop, ty = dy * leanTop;
  const bxx = dx * leanFoot, byy = dy * leanFoot;
  pushQuad(
    batch,
    (ax + tx - ay - ty) * HWs, (ax + tx + ay + ty) * HHs - topA * HUs, crest,
    (bx + tx - by - ty) * HWs, (bx + tx + by + ty) * HHs - topB * HUs, crest,
    (bx + bxx - by - byy) * HWs, (bx + bxx + by + byy) * HHs - bottomB * HUs, foot,
    (ax + bxx - ay - byy) * HWs, (ax + bxx + ay + byy) * HHs - bottomA * HUs, foot,
  );
}
