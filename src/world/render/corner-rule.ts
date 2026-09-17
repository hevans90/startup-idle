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
): Corner {
  const high = hiCount ? hiSum / hiCount : 0;
  const low = loCount ? loSum / loCount : high;
  if (hiCount && loCount && low >= bed) {
    const one = (high * hiCount + low * loCount) / (hiCount + loCount);
    return { high: one, low: one };
  }
  return { high, low };
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
  let floorA = bedJ;
  let floorB = bedJ;
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

/** Which shading language the caller wants the rule written in. */
export type Dialect = "wgsl" | "glsl";

/**
 * The same rule as shader source.
 *
 * The host shader has to supply four things, because they are the only parts
 * that differ between the two paths and neither is this rule's business:
 * `inside(x, y)`, `depthAt(x, y)`, `groundAt(x, y)` and `dryDepth()`. GLSL
 * must also supply a `select(a, b, cond)` — WGSL has it built in, and one
 * three-line helper is cheaper than teaching this template about ternaries.
 *
 * Written against the smallest vocabulary the two languages share, so what
 * varies is a handful of keywords rather than the shape of the code.
 */
export function cornerRuleSource(dialect: Dialect): string {
  const wgsl = dialect === "wgsl";
  const head = wgsl
    ? "fn cornerOf(vx: i32, vy: i32) -> vec4<f32> {"
    : "vec4 cornerOf(int vx, int vy) {";
  const VEC4 = wgsl ? "vec4<f32>" : "vec4";
  const MUT = wgsl ? "var" : "float";          // a float that is written again
  const NUM = wgsl ? "let" : "float";          // a float that is not
  const INT = wgsl ? "let" : "int";            // an int that is not
  const LOOP = wgsl ? "var" : "int";
  return `
${head}
  ${MUT} bed = -1000.0;
  ${MUT} hi = 0.0;
  ${MUT} nHi = 0.0;
  ${MUT} lo = 0.0;
  ${MUT} nLo = 0.0;
  // The up-to-four columns that meet here, sorted into the two groups as they
  // arrive: anything standing lower than the highest bed seen so far goes
  // below, and a bed higher than that demotes what was there and starts again.
  for (${LOOP} k = 0; k < 4; k = k + 1) {
    ${INT} cx = vx - 1 + (k & 1);
    ${INT} cy = vy - 1 + (k >> 1);
    if (!inside(cx, cy)) { continue; }
    ${NUM} d = depthAt(cx, cy);
    if (d <= dryDepth()) { continue; }
    ${NUM} g = groundAt(cx, cy);
    ${NUM} surface = g + d;
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
  ${MUT} top = mHi;
  // One again wherever the lower water reaches the higher bed — see the note
  // at the top of corner-rule.ts, and resolveCorner, which is this.
  if (nHi > 0.0 && nLo > 0.0 && mLo >= bed) {
    ${NUM} one = (mHi * nHi + mLo * nLo) / (nHi + nLo);
    top = one;
    mLo = one;
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
  ${MUT} floorA = bedJ;
  ${MUT} floorB = bedJ;
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
