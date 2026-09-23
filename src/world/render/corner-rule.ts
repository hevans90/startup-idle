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
import { OPEN_SKY, connected } from "../../fluid/slots";

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
  aMine: number, aTheirs: number,
  bMine: number, bTheirs: number,
): Side {
  // FOUR HEIGHTS, ALREADY RESOLVED, and the caller says how it got them.
  //
  // This used to take both of a corner's groups and pick between them twice,
  // with `levelAt` and two different beds — once for "what do I draw here"
  // and once for "what does the neighbour draw here". That pick is an
  // identity question, and a bed is only a stand-in for identity. The CPU
  // path asks by SHEET now (see `render/bodies`) and the shader still asks by
  // bed; what a side IS, given the two answers, is this, and it is one rule
  // either way.
  //
  // Down to our own bed by default. Only WATER next door raises that: a face
  // against the neighbour's own water is a face with nothing on either side of
  // it, and drawing one darkens the seam between two halves of one body.
  let floorA = bed;
  let floorB = bed;
  if (wetJ) {
    floorA = Math.max(aTheirs, bedJ);
    floorB = Math.max(bTheirs, bedJ);
  }
  floorA = Math.max(bed, floorA);
  floorB = Math.max(bed, floorB);
  const topA = Math.max(Math.max(aMine, bed), floorA);
  const topB = Math.max(Math.max(bMine, bed), floorB);
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
  base = 0, roof: Float32Array | null = null,
): number {
  // `i` is a COLUMN and `base` is the start of the slot's own plane, so a
  // deck looks along the deck and the channel under it looks along the
  // channel. At one layer the base is nought and this is what it was.
  const cx = i % nx, cy = (i / nx) | 0;
  const bed = ground[base + i];
  const lid = roof ? roof[base + i] : OPEN_SKY;
  const cells = nx * ny;
  const layers = roof ? Math.max(1, Math.round(ground.length / cells)) : 1;
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
      // WHICH SLOT OVER THERE THE WATER WOULD ACTUALLY REACH, which is the
      // solver's own question and not a second opinion about heights.
      // @see fluid/slots
      //
      // At the mouth of a bridge the road stands level with the deck and the
      // CHANNEL runs fourteen below it. Asked of the ground alone that reads
      // as a lip the water is about to pour over, so the surface was leaned
      // into a hole it cannot get to and the road's corner dived from 2.50 to
      // 1.36 over four columns. The abutment is CLOSED — the road's slot is
      // roofed below its own floor by the soffit — and nothing crosses.
      //
      // BUT IT IS EVERY SLOT OVER THERE AND NOT THE SAME-NUMBERED ONE, which
      // is the half of this I got wrong first and which tore the parapet. A
      // deck's water leaves over the side into the CHANNEL — slot zero of the
      // column beside it — while slot one over there is absent. Matching
      // plane against plane, that read as a wall, the drawdown never fired,
      // and the surface stood 0.2 to 0.28 above the nappe along the whole
      // length of every parapet: the sheet and the fall leaving it drawn at
      // two different heights.
      //
      // The LOWEST it can reach, because that is the drop it is leaning into.
      const jc = jy * nx + jx;
      let beside = 0, floor = 0, found = false;
      for (let b = 0; b < layers; b++) {
        const jb = b * cells + jc;
        if (!connected(bed, lid, ground[jb], roof ? roof[jb] : OPEN_SKY)) continue;
        const s = depth[jb] > dryDepth ? ground[jb] + depth[jb] : ground[jb];
        if (!found || s < beside) { beside = s; floor = ground[jb]; found = true; }
      }
      if (!found) break;                        // a wall, and no way over it
      if (floor > bed) break;                   // higher ground, not a way down
      const how = spillAt(bed, beside, fallMin);
      const near = how * (1 - (r - 1) / BRINK_REACH);
      if (near > most) most = near;
      if (how > 0) break;                       // found this way's lip
    }
  }
  return most;
}

/**
 * WHETHER A COLUMN HAS WATER THE MESH SHOULD DRAW AT ALL.
 *
 * `dryDepth` is the solver's "there is nothing here", and using it as the
 * mesh's cutoff too punches holes in a sheet wherever the water happens to
 * sit on it. That is not hypothetical and it is not new: {@link SHOW_DEPTH}
 * carries the same story one threshold up — "a sheet lying on a raised tile
 * sits at exactly this depth all over, so a cutoff punched holes in it and
 * you could see the tile through them", 164 columns of it, every one on
 * raised ground. The fix there was to fade instead of cut. This is the same
 * fault at the remaining cutoff, and a BRIDGE'S PARAPET is the most raised
 * tile there is: a kerb one column wide holding the film that went over it.
 * Measured on the crossing fixture, parapet columns sitting at 0.019, 0.017,
 * 0.009 against a dryDepth of 0.02 — so the ones a hair under lost their quad
 * and the sheet had a hole a quarter of a tile wide.
 *
 * SO THERE IS NO CUTOFF. Any water at all draws, and the opacity ramp fades
 * it: at a hundredth of a step that is an alpha of seven thousandths, which
 * is nothing to look at and nothing to see a hole through either.
 *
 * GATING IT ON A BRINK WAS NOT ENOUGH, and the way it failed is worth
 * keeping. A lip's film drew while `atBrink` was positive — and a fall ends
 * when the pool underneath rises far enough to drown its lip, which is the
 * same rise that takes `atBrink` to nought. So the gate let go at the exact
 * moment it was needed: the sheet stopped going over, the brink died with
 * it, and the column that had been pouring vanished out of the middle of the
 * surface. A threshold that is only wrong sometimes is worse than one that
 * is always wrong, because it is the sometimes that gets shipped.
 *
 * It costs about a fifth more surface quads — measured on the crossing
 * fixture, 4,659 columns over `dryDepth` against 968 holding less than that
 * and more than nothing. That is the price of the class of bug going away
 * rather than moving, and the gathering is what makes it affordable.
 */
export function showsWater(
  nx: number, ny: number, i: number,
  ground: Float32Array, depth: Float32Array, dryDepth: number, fallMin: number,
  base = 0, roof: Float32Array | null = null,
): boolean {
  void nx; void ny; void ground; void dryDepth; void fallMin; void roof;
  return depth[base + i] > 0;
}

/** Which shading language the caller wants the rule written in. */
export type Dialect = "wgsl" | "glsl";

/**
 * The same rule as shader source.
 *
 * The host shader has to supply the parts that differ between the two paths
 * and are none of this rule's business: `inside(x, y)`, `slots()`,
 * `depthAt(x, y, a)`, `groundAt(x, y, a)`, `roofAt(x, y, a)`,
 * `sheetAt(x, y, a)`, `dryDepth()` and `fallMin()`. The `a` is which STOREY — a column is a stack of slots and
 * a bridge puts water in two of them. GLSL must
 * also supply a `select(a, b, cond)` — WGSL has it built in, and one
 * three-line helper is cheaper than teaching this template about ternaries.
 *
 * `sheetAt` is which BODY OF WATER stands on a column, and it is why this
 * rule can be one rule again. The corner used to split its contributors by
 * the BED they stood on and merge them back where that guess was wrong; the
 * split is made once now, off the geometry, by `render/bodies` — so what
 * arrives here is a corner and a sheet, and the answer is the average over
 * the contributors that belong to it.
 *
 * Written against the smallest vocabulary the two languages share, so what
 * varies is a handful of keywords rather than the shape of the code.
 */
export function cornerRuleSource(dialect: Dialect, drawdown = 0, rim = RIM): string {
  const wgsl = dialect === "wgsl";
  /**
   * A number that is definitely a FLOAT in both languages.
   *
   * WGSL promotes an abstract integer where a float is wanted; GLSL does not,
   * and refuses `1 * someFloat` outright. So a tuning constant that happens to
   * be whole — `RIM` is 1 — compiled on one path and took the other down with
   * "no operation * exists that takes a const int and a highp float". Every
   * number this template interpolates goes through here.
   */
  const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));
  const head = wgsl
    ? "fn cornerOf(vx: i32, vy: i32, sheet: f32) -> vec4<f32> {"
    : "vec4 cornerOf(int vx, int vy, float sheet) {";
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
  ? "fn atBrink(cx: i32, cy: i32, a: i32) -> f32 {"
  : "float atBrink(int cx, int cy, int a) {"}
  // ALONG THE SLOT'S OWN STOREY. A deck looks along the deck for its lip and
  // the channel under it looks along the channel; asked of storey nought, a
  // bridge would take its drawdown from the riverbed.
  ${NUM} bed = groundAt(cx, cy, a);
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
      // WHICH SLOT OVER THERE THE WATER WOULD ACTUALLY REACH — the solver's
      // own question. See the twin in corner-rule.ts and the note on it: a
      // road at the mouth of a span is level with the deck and fourteen above
      // the channel, and the abutment is closed, so nothing crosses. And it is
      // EVERY slot over there, not the same-numbered one — a deck's water
      // leaves over the side into the channel, which is slot zero, while slot
      // one beside it is absent. The LOWEST it can reach, because that is the
      // drop it is leaning into.
      // A FLOAT FLAG AND NOT A BOOL, because the two dialects are held to
      // differing in nothing but their keywords, and a GLSL bool is not one
      // of the words that rule knows about.
      ${MUT} beside = 0.0;
      ${MUT} floorJ = 0.0;
      ${MUT} found = 0.0;
      for (${LOOP} b = 0; b < slots(); b = b + 1) {
        ${NUM} gj = groundAt(jx, jy, b);
        if (min(roofAt(cx, cy, a), roofAt(jx, jy, b)) <= max(bed, gj)) { continue; }
        ${NUM} dj2 = depthAt(jx, jy, b);
        ${NUM} s = select(gj, gj + dj2, dj2 > dryDepth());
        if (found == 0.0 || s < beside) { beside = s; floorJ = gj; found = 1.0; }
      }
      if (found == 0.0) { break; }
      if (floorJ > bed) { break; }
      ${NUM} how = spillAt(bed, beside);
      most = max(most, how * (1.0 - ${FLT}(r - 1) / ${BRINK_REACH}.0));
      if (how > 0.0) { break; }
    }
  }
  return most;
}

${wgsl
  ? "fn showsWater(cx: i32, cy: i32, a: i32) -> bool {"
  : "bool showsWater(int cx, int cy, int a) {"}
  // The twin of showsWater in corner-rule, and the note on it: there is no
  // cutoff, because every cutoff tried so far punched a hole somewhere. The
  // opacity ramp fades what is too thin to be worth seeing.
  return depthAt(cx, cy, a) > 0.0;
}

${head}
  ${MUT} bed = -1000.0;
  ${MUT} sum = 0.0;
  ${MUT} n = 0.0;
  // The STEP the ground makes beside the corner, over all four columns whether
  // they are wet or not, either way up, and unbounded off the edge of the map
  // — see rimAt, which is what it is for.
  ${MUT} lowest = 1000.0;
  ${MUT} highest = -1000.0;
  ${MUT} edge = 0.0;
  // THE UP-TO-FOUR COLUMNS THAT MEET HERE, and only the ones on this SHEET.
  // Which water is one sheet was decided once, off the geometry — nothing
  // solid between it and no fall between it — so there is no grouping to do
  // and nothing to think better of afterwards. @see render/bodies
  for (${LOOP} k = 0; k < 4; k = k + 1) {
    ${INT} cx = vx - 1 + (k & 1);
    ${INT} cy = vy - 1 + (k >> 1);
    if (!inside(cx, cy)) { edge = 1.0; continue; }
    // THE GROUND BESIDE IT is storey nought's, always: the rim rule asks what
    // the land does around the corner, and the land is the land whatever is
    // built over it.
    lowest = min(lowest, groundAt(cx, cy, 0));
    highest = max(highest, groundAt(cx, cy, 0));
    // AND EVERY STOREY OF IT, because a bridge's deck and the channel under
    // it both meet this corner and only one of them is on this sheet.
    for (${LOOP} a = 0; a < slots(); a = a + 1) {
      ${NUM} d = depthAt(cx, cy, a);
      // ANY WATER CONTRIBUTES — see showsWater and the sheet membership it
      // has to agree with. A column that draws but gathers no corner of its
      // own comes out at an alpha of nought, which is a hole with extra
      // steps, and it is the corner rule that decides that.
      if (d <= 0.0) { continue; }
      if (sheetAt(cx, cy, a) != sheet) { continue; }
      ${NUM} g = groundAt(cx, cy, a);
      // UNDER A ROOF THE WATER STOPS AT THE ROOF. A slot running full is
      // against a soffit and there is nothing above it to see; drawn at
      // floor plus depth it is a sheet inside the bridge. The twin of
      // wetTop in fluid/slots, which is what surfaceAt gives the builder.
      ${NUM} wet = min(g + d, roofAt(cx, cy, a));
      // Leaned toward the lip — see water.ts's DRAWDOWN, which is this. The
      // HEIGHT only: how solid it looks is gathered separately and untouched.
      ${NUM} surface = wet - d * ${drawdown} * atBrink(cx, cy, a);
      sum = sum + surface;
      n = n + 1.0;
      // The highest bed of this sheet's OWN contributors, which is what the
      // rim rule is measured from.
      bed = max(bed, g);
    }
  }
  if (n == 0.0) { return ${VEC4}(0.0, 0.0, -1000.0, 0.0); }
  ${NUM} mean = sum / n;
  // THE RIM — see corner-rule.ts's RIM and rimAt, which this is. Fewer than
  // four wet columns of this sheet means the corner is on the outside of it,
  // and how much of the rule applies depends on which kind of outside.
  ${NUM} aside = select(max(bed - lowest, highest - bed), 1000.0, edge > 0.0);
  ${NUM} rimHere = ${f(rim)} * (1.0 - clamp(aside / fallMin(), 0.0, 1.0));
  ${NUM} top = select(mean, mean + (bed - mean) * rimHere, n < 4.0);
  return ${VEC4}(top, top, bed, n);
}

${wgsl
  ? "fn resolveSide(bed: f32, bedJ: f32, wetJ: bool, aMine: f32, aTheirs: f32, bMine: f32, bTheirs: f32) -> vec4<f32> {"
  : "vec4 resolveSide(float bed, float bedJ, bool wetJ, float aMine, float aTheirs, float bMine, float bTheirs) {"}
  // FOUR HEIGHTS, ALREADY RESOLVED, and the caller says how it got them —
  // the twin of the one in this file's TypeScript, argument for argument.
  // It used to pick between a corner's two groups by BED and then use the
  // answer as a height, which is an identity question answered with a
  // measurement; both callers ask by SHEET now.
  ${MUT} floorA = bed;
  ${MUT} floorB = bed;
  if (wetJ) {
    floorA = max(aTheirs, bedJ);
    floorB = max(bTheirs, bedJ);
  }
  floorA = max(bed, floorA);
  floorB = max(bed, floorB);
  // Clamped to their own floors, so a side that should not be drawn is one
  // whose two ends are both zero height and makes no fragments.
  ${NUM} topA = max(max(aMine, bed), floorA);
  ${NUM} topB = max(max(bMine, bed), floorB);
  return ${VEC4}(topA, topB, floorA, floorB);
}

`;
}
