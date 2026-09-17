/**
 * World v2 — how the water mesh is stitched where the BED changes, in one place.
 *
 * Two rules, and the second is written in terms of the first: what height a
 * CORNER is drawn at, and how far down the SIDE that hangs from it reaches.
 *
 * A corner is shared by up to four columns and every one of them has to draw
 * it at the same height, or the mesh comes apart. It carries TWO heights, not
 * one, split by the BED its contributors stand on: a sheet on a plateau and
 * the lake at the foot of its cliff meet at the same corner and no single
 * height serves both — averaged, the sheet's edge runs down into the rock.
 *
 * And they are ONE again wherever the lower water reaches the higher bed. The
 * split is for two separate BODIES, and a body is separate when there is air
 * between it and the other one's floor; under a pool deep enough to drown a
 * dip in the bed there is none. It is the solver's own sill test, borrowed.
 *
 * WHY THIS FILE EXISTS. The rule was written out three times — once in the
 * mesh builder, once in WGSL, once in GLSL — and the third time it was written
 * it was already wrong, because the merge had been added to the first and not
 * the others. What that looked like was a hairline of grass down every dip in
 * the bed on one rendering path and not on the other: the columns either side
 * drew the same corner at two heights that differed by the surface's own
 * ripple, up to 0.57 half steps, which is nine pixels.
 *
 * So each rule has two copies here and no more: the TypeScript one, which the
 * mesh builder calls and the tests pin down, and a shader one generated once
 * and emitted in whichever dialect asks — so WGSL and GLSL cannot disagree
 * with each other at all, and a test proves that by comparing their skeletons.
 * The copies sit in the same file, a screen apart, which is the only
 * arrangement that makes a change to one an obvious omission in the other.
 */

import { FALL_MIN } from "../../fluid/falls";

/**
 * How far a rim corner is brought down to the ground it stands on.
 *
 * A FREE VERTICAL FACE OF WATER CANNOT EXIST. Water is bounded by a container,
 * by a shore, or it is falling — and a flat, hard-edged, uniformly translucent
 * pane with the terrain visible through it undistorted is a FISH TANK. That is
 * what the side of every body of water on every raised level has been: an
 * artifact of clipping a heightfield slab at a cell boundary, drawn as though
 * it were a thing that exists.
 *
 * No amount of sheet drawn PAST the edge repairs it, because the object
 * breaking it is at the wall. What repairs it is the water not having a cut
 * face at all: bring the outermost corner down to the bed and a body ends in a
 * WATERLINE. The side then has no height left to draw — `resolveSide` already
 * gives nothing when a face's top meets its floor — so the pane is not
 * suppressed, it stops existing. What replaces it is a surface you look AT
 * rather than a pane you look THROUGH.
 *
 * A corner is on the rim when fewer than four wet columns meet at it on its
 * own bed: a dry neighbour is a shore, and a neighbour standing lower with no
 * water reaching up is a drop. Interior corners have all four and are
 * untouched, so a body keeps its depth everywhere but the fringe.
 *
 * One is all the way to the ground. A number rather than a derivation because
 * the right answer is a thing to look at: the whole of a deep pool's depth
 * over one column is a steep bevel, and a gentler one may read better at the
 * cost of a wider fringe.
 *
 * WHICH BOUNDARY a corner is on decides how much of this applies, and that is
 * `rimAt` — a shore is a waterline, a container and the map's own edge are
 * panes, and a lip is bounded by the sheet leaving it. The face follows the
 * same split one step on, in `sideFace`.
 *
 * ON, and it was behind `?rim` for three commits while it was being finished.
 * The strength is still an argument rather than a constant read at the point
 * of use, which is what lets a test ask for the rule at nought and pin what
 * the rule REPLACED beside what it does — and what let the whole suite be run
 * at nought, at one and at the default before this became the default.
 */
export const RIM = 1;

/**
 * How much of the rim rule applies at a corner, given the STEP the ground
 * makes beside it.
 *
 * A free vertical face of water cannot exist. Water is bounded by a container,
 * by a shore, or it is falling — and only the shore is a waterline. Which one
 * a corner is on is read off one number, because all three of the others are
 * ground that does NOT stay at the water's own level:
 *
 *  - BY A SHORE — the ground carries on at about this bed and there is simply
 *    no more water. It must end in a waterline, and that is what this does.
 *  - BY A CONTAINER — the ground RISES over the water: a bank, a wall, the far
 *    side of a bowl. The water does not end at a container, it is held by one,
 *    and it keeps its full depth right up against it. Feathered, a lake in a
 *    crater would taper away from the crater wall, and under `?xray` — where
 *    the wall in front is translucent on purpose — what is behind it is a
 *    sheet with a void under it, which is the bug `sideFace` was fixed for.
 *  - BY FALLING — the ground DROPS away and the water goes over it. What
 *    bounds it is the sheet, so the corner keeps its thickness: a sheet starts
 *    on this corner, and feathered there is nothing for it to start from.
 *  - BY A CUT THROUGH THE WORLD, at the map's own rim. The terrain shows its
 *    skirt there and the water should show a cross-section to match, so an
 *    out-of-bounds neighbour counts as the biggest step there is.
 *
 * So: the size of the step, whichever way it goes. Ramped over `FALL_MIN`
 * rather than switched, so a shore that steepens into a bank or a lip does it
 * gradually instead of popping at a threshold. A BEACH is the gentle end of
 * that ramp and is a shore — it is a wall that is not.
 */
const rimAt = (rim: number, aside: number) =>
  rim * (1 - Math.min(1, Math.max(0, aside) / FALL_MIN));

/** A corner's two heights, and which bed the upper one belongs to. */
export type Corner = { high: number; low: number };

/**
 * Resolve a corner from what its contributors added up to.
 *
 * `hiSum`/`hiCount` are the surfaces of the columns standing on the HIGHEST
 * bed any contributor stands on, `loSum`/`loCount` the rest, and `bed` that
 * highest bed. A corner with nothing below it answers the same either way,
 * which is every corner on level ground.
 */
export function resolveCorner(
  hiSum: number, hiCount: number, loSum: number, loCount: number, bed: number,
  aside = 0, rim = RIM,
): Corner {
  const high = hiCount ? hiSum / hiCount : 0;
  const low = loCount ? loSum / loCount : high;
  if (hiCount && loCount && low >= bed) {
    const one = (high * hiCount + low * loCount) / (hiCount + loCount);
    // One body, so the rim rule reads the whole of it.
    const n = hiCount + loCount;
    const r = n < 4 ? rimAt(rim, aside) : 0;
    const v = one + (bed - one) * r;
    return { high: v, low: v };
  }
  // THE RIM. A corner with fewer than four wet columns around it on its own
  // bed is on the OUTSIDE of the water — and what to do about that depends on
  // WHICH kind of outside it is. See `rimAt`.
  const r = hiCount < 4 ? rimAt(rim, aside) : 0;
  return { high: high + (bed - high) * r, low };
}

/**
 * Which of a corner's two heights a column standing on `bed` draws it at.
 *
 * The high group if that bed is the highest at the corner, the low one
 * otherwise. Every column on a tile shares its bed, so neighbours always pick
 * the same one and the mesh holds together; the two differ only where the
 * corner really does touch two bodies of water, and there a cliff stands
 * between them.
 */
export const levelAt = (high: number, low: number, cornerBed: number, bed: number) =>
  (bed >= cornerBed ? high : low);

/** Where the side of a body of water starts and where it reaches down to. */
export type Side = { topA: number; topB: number; floorA: number; floorB: number };

/**
 * The SIDE of the water on a column: its surface down to the ground it stands
 * on, and no further.
 *
 * No further is the whole point. It used to run down to whatever the NEIGHBOUR
 * stood on, so a pond on a plateau painted itself over the entire cliff
 * beneath it — and the higher the ground, the more of the cliff it covered,
 * because the excess was exactly the height of the drop. What is below the
 * water's own floor is rock.
 *
 * And it reaches down to the corner the NEIGHBOUR ITSELF DRAWS, end for end.
 * The rule was once "skip the side wherever the water next door reaches this
 * column's bed, because then the two are one body and the surface covers the
 * join" — a guess, and one that contradicts the corner split, which
 * deliberately gives two beds two different heights for the same corner. Water
 * running down a staircase tore along every step's seam: 2.7% of the ground
 * under interior water showed through, every sample of it on a tile with a one
 * step drop. Matched corner for corner to what the neighbour actually draws
 * there is nothing left to leave showing.
 *
 *
 * AND IT REACHES DOWN TO THIS COLUMN'S OWN BED wherever the neighbour is DRY,
 * whether that neighbour is lower or higher. Higher used to squash the face to
 * nothing — the reasoning being that a face buried in the hillside next door
 * is a face nobody can see — and that was true right up until two things made
 * it false. At the RIM OF THE MAP there is no neighbour at all and so nothing
 * to be buried in: water ran to the edge and stopped, a sheet with a void
 * under it and the terrain's own skirt showing through where its body should
 * be. And in X-RAY the ground in front is translucent on purpose, so a face
 * that was only ever hidden by it is a face you are now looking through at
 * nothing. Drawn always, the normal view is unchanged — the hillside in front
 * is a later band and paints over it — and both of those read as water with a
 * body instead of a sheet.
 *
 * The tops come back already clamped to their own floors, so a side that
 * should not be drawn at all is one whose two ends are both zero height. That
 * costs the shader nothing — a zero-height quad makes no fragments — and saves
 * the mesh builder a quad it would only have to blank.
 */
export function resolveSide(
  bed: number, bedJ: number, wetJ: boolean,
  aHigh: number, aLow: number, aBed: number,
  bHigh: number, bLow: number, bBed: number,
): Side {
  // Down to our own bed by default. Only WATER next door raises that: a face
  // against the neighbour's own water is a face with nothing on either side of
  // it, and drawing one darkens the seam between two halves of one body.
  let floorA = bed;
  let floorB = bed;
  if (wetJ) {
    floorA = Math.max(levelAt(aHigh, aLow, aBed, bedJ), bedJ);
    floorB = Math.max(levelAt(bHigh, bLow, bBed, bedJ), bedJ);
  }
  floorA = Math.max(bed, floorA);
  floorB = Math.max(bed, floorB);
  const topA = Math.max(Math.max(levelAt(aHigh, aLow, aBed, bed), bed), floorA);
  const topB = Math.max(Math.max(levelAt(bHigh, bLow, bBed, bed), bed), floorB);
  return { topA, topB, floorA, floorB };
}

/**
 * Does this column's water stand at a BRINK, rather than at a shoreline?
 *
 * The third rule here, and it exists because the first two gave the water a
 * lip to pour over and nothing told the FADE about it. A surface fades in over
 * {@link import("./water").SHOW_DEPTH} so that a shoreline arrives instead of
 * switching on — the solver's minimum head leaves a shallow fringe wherever a
 * puddle stopped spreading, and a hard cutoff there is invisible.
 *
 * A lip is not a shoreline. Water at a brink is thin because it is LEAVING —
 * it accelerates over the edge, and the same continuity that thins a nappe
 * thins the last column before one. Faded as though it were ending, a brink
 * goes translucent and the ground shows through the one place a sheet has to
 * be continuous: measured on a river over a twelve half step cliff, 908 of
 * 11,520 lip samples drawn under full opacity, a flickering translucent band
 * along the brink, and every one of those 908 a column with a fall off it.
 *
 * Read off the GROUND and the neighbour's SURFACE, not off any fall state, so
 * the vertex shader can ask the same question — and so a still pool standing
 * at a cliff edge answers yes too, which is right: its edge is a face, not a
 * shore. A pool deep enough below to reach up here is not a brink any more,
 * which is why this reads the neighbour's surface rather than its bed.
 *
 * A RAMP from nought to one rather than a yes or no, over the half of a fall's
 * least height that ends at it: nothing on the gentle steps a river tumbles
 * down, all of it off a real cliff. Written as a threshold it was a threshold
 * evaluated in DOUBLE on one path and in FLOAT on the other, and a hair either
 * side of it flipped a whole column's opacity — the two renderers' pictures
 * parted by 35 of 255 on the pixels where that happened. It is also what stops
 * a plunge pool popping the brink above it as it rises past the line.
 */
export const BRINK_REACH = 3;

/**
 * How much the water is LEAVING over one edge, 0 to 1.
 *
 * `bed` is the ground the water stands on and `beside` what is over the edge —
 * the neighbour's own surface where it holds water, and its bare ground where
 * it does not. Nought where the ground carries on at about this level, one
 * where it has fallen away by a whole `fallMin`.
 *
 * A ramp rather than a yes or no, and the same one for both of its callers.
 * `atBrink` asks it of the four edges round a column and keeps the largest;
 * `sideFace` asks it of the one edge it is about to draw.
 */
export function spillAt(bed: number, beside: number, fallMin: number): number {
  const how = (bed - beside - fallMin * 0.5) / (fallMin * 0.5);
  return how <= 0 ? 0 : how >= 1 ? 1 : how;
}

export function atBrink(
  nx: number, ny: number, i: number,
  ground: Float32Array, depth: Float32Array, dryDepth: number, fallMin: number,
): number {
  const cx = i % nx, cy = (i / nx) | 0;
  const bed = ground[i];
  let most = 0;
  for (let k = 0; k < 4; k++) {
    const dx = k === 0 ? 1 : k === 1 ? -1 : 0;
    const dy = k === 2 ? 1 : k === 3 ? -1 : 0;
    // OUT TO `BRINK_REACH`, falling off with the distance, because the water
    // upstream of a lip is on its way over one too — the surface starts to go
    // down before the edge, not at it. One column of it is a kink; three is a
    // curve. Stops at anything standing higher, which is not a way the water
    // is going and not a lip it is bending toward.
    for (let r = 1; r <= BRINK_REACH; r++) {
      const jx = cx + dx * r, jy = cy + dy * r;
      if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) break;
      const j = jy * nx + jx;
      if (ground[j] > bed) break;
      const beside = depth[j] > dryDepth ? ground[j] + depth[j] : ground[j];
      const how = spillAt(bed, beside, fallMin);
      const near = how * (1 - (r - 1) / BRINK_REACH);
      if (near > most) most = near;
      if (how > 0) break;                       // found this way's lip
    }
  }
  return most;
}

/** Which shading language the caller wants the rule written in. */
export type Dialect = "wgsl" | "glsl";

/**
 * The same rule as shader source.
 *
 * The host shader has to supply four things, because they are the only parts
 * that differ between the two paths and neither is this rule's business:
 * `inside(x, y)`, `depthAt(x, y)`, `groundAt(x, y)`, `dryDepth()` and
 * `fallMin()`. GLSL
 * must also supply a `select(a, b, cond)` — WGSL has it built in, and one
 * three-line helper is cheaper than teaching this template about ternaries.
 *
 * Written against the smallest vocabulary the two languages share, so what
 * varies is a handful of keywords rather than the shape of the code.
 */
export function cornerRuleSource(dialect: Dialect, drawdown = 0, rim = RIM): string {
  const wgsl = dialect === "wgsl";
  const head = wgsl
    ? "fn cornerOf(vx: i32, vy: i32) -> vec4<f32> {"
    : "vec4 cornerOf(int vx, int vy) {";
  const VEC4 = wgsl ? "vec4<f32>" : "vec4";
  const MUT = wgsl ? "var" : "float";          // a float that is written again
  const NUM = wgsl ? "let" : "float";          // a float that is not
  const INT = wgsl ? "let" : "int";            // an int that is not
  const LOOP = wgsl ? "var" : "int";
  const FLT = wgsl ? "f32" : "float";        // an int made a float
  return `
${wgsl
  ? "fn spillAt(bed: f32, beside: f32) -> f32 {"
  : "float spillAt(float bed, float beside) {"}
  // How much the water is LEAVING over one edge — see the twin in
  // corner-rule.ts. Both of its callers use this one ramp.
  return clamp((bed - beside - fallMin() * 0.5) / (fallMin() * 0.5), 0.0, 1.0);
}

${wgsl
  ? "fn atBrink(cx: i32, cy: i32) -> f32 {"
  : "float atBrink(int cx, int cy) {"}
  ${NUM} bed = groundAt(cx, cy);
  ${MUT} most = 0.0;
  for (${LOOP} k = 0; k < 4; k = k + 1) {
    ${INT} dx = select(0, select(-1, 1, k == 0), k < 2);
    ${INT} dy = select(select(-1, 1, k == 2), 0, k < 2);
    // Out to BRINK_REACH, falling off with the distance — see the twin in
    // corner-rule.ts. One column of it is a kink; three is a curve.
    for (${LOOP} r = 1; r <= ${BRINK_REACH}; r = r + 1) {
      ${INT} jx = cx + dx * r;
      ${INT} jy = cy + dy * r;
      if (!inside(jx, jy)) { break; }
      if (groundAt(jx, jy) > bed) { break; }
      ${NUM} dj = depthAt(jx, jy);
      ${NUM} beside = select(groundAt(jx, jy), groundAt(jx, jy) + dj, dj > dryDepth());
      ${NUM} how = spillAt(bed, beside);
      most = max(most, how * (1.0 - ${FLT}(r - 1) / ${BRINK_REACH}.0));
      if (how > 0.0) { break; }
    }
  }
  return most;
}

${head}
  ${MUT} bed = -1000.0;
  ${MUT} hi = 0.0;
  ${MUT} nHi = 0.0;
  ${MUT} lo = 0.0;
  ${MUT} nLo = 0.0;
  // The STEP the ground makes beside the corner, over all four columns whether
  // they are wet or not, either way up, and unbounded off the edge of the map
  // — see rimAt, which is what it is for.
  ${MUT} lowest = 1000.0;
  ${MUT} highest = -1000.0;
  ${MUT} edge = 0.0;
  // The up-to-four columns that meet here, sorted into the two groups as they
  // arrive: anything standing lower than the highest bed seen so far goes
  // below, and a bed higher than that demotes what was there and starts again.
  for (${LOOP} k = 0; k < 4; k = k + 1) {
    ${INT} cx = vx - 1 + (k & 1);
    ${INT} cy = vy - 1 + (k >> 1);
    if (!inside(cx, cy)) { edge = 1.0; continue; }
    lowest = min(lowest, groundAt(cx, cy));
    highest = max(highest, groundAt(cx, cy));
    ${NUM} d = depthAt(cx, cy);
    if (d <= dryDepth()) { continue; }
    ${NUM} g = groundAt(cx, cy);
    // Leaned toward the lip — see water.ts's DRAWDOWN, which is this. The
    // HEIGHT only: how solid it looks is gathered separately and untouched.
    ${NUM} surface = g + d - d * ${drawdown} * atBrink(cx, cy);
    if (g > bed) {
      lo = lo + hi;
      nLo = nLo + nHi;
      hi = surface;
      nHi = 1.0;
      bed = g;
    } else if (g == bed) {
      hi = hi + surface;
      nHi = nHi + 1.0;
    } else {
      lo = lo + surface;
      nLo = nLo + 1.0;
    }
  }
  if (nHi + nLo == 0.0) { return ${VEC4}(0.0, 0.0, -1000.0, 0.0); }
  ${NUM} mHi = select(0.0, hi / max(nHi, 1.0), nHi > 0.0);
  ${MUT} mLo = select(mHi, lo / max(nLo, 1.0), nLo > 0.0);
  // THE RIM — see corner-rule.ts's RIM and rimAt, which this is. Fewer than
  // four wet columns on this bed means the corner is on the outside of the
  // water, and how much of the rule applies depends on which kind of outside.
  ${NUM} aside = select(max(bed - lowest, highest - bed), 1000.0, edge > 0.0);
  ${NUM} rimHere = ${rim} * (1.0 - clamp(aside / fallMin(), 0.0, 1.0));
  ${MUT} top = select(mHi, mHi + (bed - mHi) * rimHere, nHi < 4.0);
  // One again wherever the lower water reaches the higher bed — see the note
  // at the top of corner-rule.ts, and resolveCorner, which is this.
  if (nHi > 0.0 && nLo > 0.0 && mLo >= bed) {
    ${NUM} one = (mHi * nHi + mLo * nLo) / (nHi + nLo);
    ${NUM} v = select(one, one + (bed - one) * rimHere, nHi + nLo < 4.0);
    top = v;
    mLo = v;
  }
  return ${VEC4}(top, mLo, bed, nHi + nLo);
}

${wgsl
  ? "fn levelAt(c: vec4<f32>, bed: f32) -> f32 {"
  : "float levelAt(vec4 c, float bed) {"}
  return select(c.y, c.x, bed >= c.z);
}

${wgsl
  ? "fn resolveSide(bed: f32, bedJ: f32, wetJ: bool, a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {"
  : "vec4 resolveSide(float bed, float bedJ, bool wetJ, vec4 a, vec4 b) {"}
  ${MUT} floorA = bed;
  ${MUT} floorB = bed;
  if (wetJ) {
    floorA = max(levelAt(a, bedJ), bedJ);
    floorB = max(levelAt(b, bedJ), bedJ);
  }
  floorA = max(bed, floorA);
  floorB = max(bed, floorB);
  // Clamped to their own floors, so a side that should not be drawn is one
  // whose two ends are both zero height and makes no fragments.
  ${NUM} topA = max(max(levelAt(a, bed), bed), floorA);
  ${NUM} topB = max(max(levelAt(b, bed), bed), floorB);
  return ${VEC4}(topA, topB, floorA, floorB);
}

`;
}
