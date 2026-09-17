/**
 * World v2 — the shape of a waterfall, as arithmetic.
 *
 * A NAPPE is the sheet of water between a lip and wherever it has got to. It
 * was one quad hung on the edge it went over, and everything wrong with that
 * came from the same thing: a quad on the edge plane is IN the cliff, so it
 * read as a decal, so it had to be faded out after four half steps, so most of
 * a tall drop had no water drawn on it at all.
 *
 * Water going over a lip is a PROJECTILE and nothing more complicated than
 * one. It leaves at the speed it had, falls at `FALL_GRAVITY`, and so at a
 * depth `b` below the lip it has been in the air `sqrt(2b/g)` seconds and is
 * `v sqrt(2b/g)` out from the rock. That is a parabola, and the whole of this
 * file is that parabola and what it implies:
 *
 *   - WHERE the sheet is, which is what lets it leave the wall — the arc
 *     itself is `fluid/falls`, because the drops a breaking sheet sheds are
 *     on it too and there had better be one of it;
 *   - HOW THICK it is, from continuity — the same water passes every point of
 *     it, and it is going `sqrt(2gb)` faster the further it has dropped, so it
 *     must be thinner by the same factor;
 *   - and WHICH BAND each piece of it belongs in, which is the part a single
 *     quad could not answer at all. Drawn in one piece, a fall belongs to the
 *     band of the lip it came off, and its foot is somewhere else entirely:
 *     measured on a river over a twenty-four half step cliff, every one of 92
 *     falls had its foot land a band further forward than the band it was
 *     drawn in, so the terrain in front — a later band — painted over the
 *     bottom of all of them. Cut into segments, each piece goes in the band it
 *     is actually in.
 *
 * Kept apart from anything that draws so both the mesh builder and the tests
 * can ask the same questions of it, and so there is one parabola rather than
 * one per renderer.
 */
import { BREAK, FALL_GRAVITY } from "../../fluid/falls";
import { SHADES, paleAt, surfaceLook } from "./water";

/**
 * How many pieces a fall is cut into.
 *
 * Enough to CURVE, which is the whole of why there are this many. Six was
 * enough to sort into bands and nowhere near enough to bend: measured on a
 * twenty-four half step drop, the first chord left the lip at 62 degrees on
 * screen while the surface it is supposed to be continuing arrives at 33, so
 * the top of every waterfall was a twenty-nine degree corner. That is the
 * shear you see — the sheet does not fail to curve, it fails to curve IN THE
 * FIRST QUARTER TILE, which is the only part of it anyone can see bending.
 *
 * Cut in time (see {@link nappeSteps}) the pieces crowd toward the lip, so
 * the count buys resolution exactly there: at twenty-four the first chord
 * leaves at 36 degrees against the surface's 33, which is a crease of three
 * degrees and reads as a continuous surface.
 *
 * The cost is a quad. A busy map has under a hundred falls on it, so this is
 * a couple of thousand quads on a layer whose neighbour draws a quarter of a
 * million corners a frame.
 */
export const NAPPE_STEPS = 24;

/**
 * How far a fall thins over, in half steps.
 *
 * NOT a cutoff, which is what it used to be — four half steps and the sheet
 * was gone, because the quad hugged the rock and a translucent panel pasted
 * down a cliff curtains the whole of anything raised. A sheet that has left
 * the rock does not need hiding, so this is the distance over which it THINS
 * instead, and it never quite reaches nothing: a fall's extent is bounded by
 * how far its front has actually got, which is a thing the solver knows.
 */
export const FALL_REACH = 4;

/**
 * How much harder than evenly-in-time the pieces crowd toward the lip.
 *
 * Cutting in time equalises the DRIFT each chord crosses, which equalises how
 * far each one strays from the true arc — and by that measure it is the right
 * answer. But what a lip looks like is not a position error, it is an ANGLE,
 * and the angle turns fastest at the very start: evenly in time over a
 * twenty-four half step drop the chords come out at 36, 50, 59, 65, 69 … so
 * the first kink alone is fourteen degrees, which is the one you can see.
 *
 * What would turn evenly is spacing by the tangent angle itself, and that is
 * `t` proportional to `tan θ` — uniform near the lip, stretching toward the
 * foot. Three halves is that curve's shape without needing to know the throw
 * to work it out, and it measures the same: the turn falls to seven degrees
 * at its worst, the sheet leaves at 29 against flat water's 27, and no chord
 * strays more than a tenth of a pixel from the arc it is drawn across.
 */
const LIP_BIAS = 1.5;

/**
 * How much of the sheet is left, `below` half steps down, from nothing to one.
 *
 * Continuity: the same water goes past every point of a sheet that is
 * accelerating, so where it is faster it is thinner. It is going
 * `sqrt(2 g below)` faster, hence one over the root — a far gentler curve than
 * the straight line to nothing this used to be, which is what let the fade
 * double as a way of hiding a panel.
 *
 * PERPENDICULAR to the flow, which is the only thickness that thins, and so
 * this is for OPACITY and not for where the sheet is drawn. It was used for
 * both, and the geometry half was wrong in a way that only showed on a big
 * fall: two particles leaving a brink horizontally at the same speed fall
 * under the same gravity, so the sheet's VERTICAL extent never changes at all
 * — perpendicular thickness goes as `cos θ`, vertical extent is that over
 * `cos θ`, and what is left is the thickness it left with. Multiplying the
 * drawn top by this dragged it down on top of gravity, at a rate that went
 * with the depth of the lip: a trickle's top edge fell 1.02 times as fast as
 * the water and looked fine, a wave eight half steps deep fell 1.42 times as
 * fast and folded over. See `falls-render`, where the top is now hung a
 * constant thickness above the arc.
 */
export const thinAt = (below: number) =>
  1 / Math.sqrt(1 + Math.max(0, below) / FALL_REACH);

/**
 * How far through coming APART it is, `below` half steps down: nought to one.
 *
 * Thinning and breaking up are two different things and this is the second. A
 * nappe thins because it is accelerating and the same water has to fit through
 * a faster place, which is {@link thinAt} and is true of an intact sheet the
 * whole way down. Past `BREAK` it is also being taken apart — the solver is
 * pulling drops out of it there and throwing them clear.
 *
 * Nought at the breaking point and one a breaking length past it.
 */
export const breakingAt = (below: number) =>
  Math.min(1, Math.max(0, below - BREAK) / BREAK);

/**
 * How much BODY a sheet loses to being a cloud rather than a sheet.
 *
 * Not all of it, which is what this was first written as, and it was plainly
 * wrong the moment it was on screen: an eighteen half step fall faded out two
 * half steps short of the floor and what replaced it was four drops. The
 * bottom of a tall waterfall is not emptier than the top, it is the part you
 * can see from furthest away. It stops being a SURFACE — coherent, with a
 * shine — and becomes a diffuse column, which is less solid and no less there.
 */
export const FRAY = 0.4;

/**
 * And how much whiter, which is the other half of the same fact.
 *
 * White water is white because it is full of air. The point at which a sheet
 * comes apart is the point at which it starts carrying air, so the same number
 * that takes its body away gives it its colour — a fall that fades to nothing
 * is wrong twice, and this is the half that makes the foot of a big drop read
 * as the loudest part of it.
 */
export const AERATED = 0.42;

/**
 * How white a sheet goes from THINNING alone, before it breaks up at all.
 *
 * Aeration used to begin at {@link BREAK} and nowhere sooner, so a fall
 * shorter than four full steps was drawn in the flat colour of the water that
 * fed it, from lip to floor. Next to a pool going white where it spills in and
 * a plunge pool going white where it lands, the one part of the picture that
 * is actually in the air was the one part with no white on it.
 *
 * A sheet does not wait for `BREAK` to start carrying air. It is thinning and
 * accelerating from the moment it leaves, and air goes into it the whole way
 * down — {@link BREAK} is where it stops being a surface, not where it starts
 * being aerated. So this rides on the thinning, which is the one number that
 * already describes how far along that road a piece is.
 */
export const SPRAYED = 0.35;

/**
 * How much of the foam on the water at the LIP the sheet carries over.
 *
 * The other half of the same complaint. Foam is a field that lives on the
 * surface, and a fall is not the surface, so white water arriving at a lip
 * went over the edge and vanished — foam above the drop, foam below it, and a
 * clean ribbon in between joining them. What goes over a lip is the water that
 * was on the lip, and if that water was white it is still white in the air.
 */
export const CARRIED = 0.3;

/**
 * What a sheet looks like `below` half steps down, having left `brink` thick.
 *
 * Separate from the drawing because a look written out twice is a look that
 * drifts — see `sheetLook`, which builds on it, and `corner-rule`, which
 * exists because a rule got written three times and the third was wrong.
 */
export function sheetAt(brink: number, below: number) {
  const thin = thinAt(below);
  const gone = breakingAt(below);
  return {
    /** The thickness the opacity is taken from: thinned, and frayed by breaking. */
    body: brink * thin * (1 - FRAY * gone),
    /** How far towards white it has gone — see `SPRAYED` and `AERATED`. */
    white: Math.min(1, SPRAYED * (1 - thin) + AERATED * gone),
  };
}

/**
 * One piece of a nappe: how far down its top and its foot are, and how much
 * sheet is left at each.
 *
 * No DRIFT, deliberately, although the drift is the reason the pieces exist.
 * A piece is one quad and a quad has two lateral ends, and the two ends of a
 * piece belong to two different columns' worth of lip — they are shared with
 * the neighbour on either side. So there is a drift at each end and they are
 * not the same number, and the place that knows which columns are involved is
 * the thing building the geometry. What survives here is what a piece has ONE
 * of: a depth range, and the thinning that follows from it.
 */
export type NappeStep = {
  /** Half steps below the lip, at the top of this piece and at its foot. */
  readonly from: number;
  readonly to: number;
  /** How much sheet is left at each, nought to one. */
  readonly thinFrom: number;
  readonly thinTo: number;
};

/**
 * Cut a fall into its pieces, top to bottom.
 *
 * `head` and `front` are the solver's: how far down the top of the sheet has
 * got and how far down its leading edge has. A fall still attached to its lip
 * has a head of nought and grows downward; one that has let go has both ends
 * moving and sails away from the rock as a piece.
 */
export function nappeSteps(
  head: number, front: number,
  into: NappeStep[] = [],
  count = NAPPE_STEPS,
): NappeStep[] {
  into.length = 0;
  if (!(front > head)) return into;
  // CUT IN TIME, not in depth, because a projectile's path is the straight
  // one in time and all of its bend is in the first moment of it.
  //
  // Cut evenly in depth, as this was, a twenty half step drop put its pieces
  // at 0, 3.3, 6.7, 10 … and their drifts at 0, 0.27, 0.39, 0.47 … — so the
  // first chord alone crossed 0.27 tiles of the 0.67 the whole fall covers.
  // Forty per cent of the bend, chorded by one straight line, at the lip,
  // which is the one place a waterfall is visibly round. That is the hard
  // corner at the top: not a missing curve, a curve sampled where it is
  // straight and straightened where it curves.
  //
  // In time the drift comes out evenly spaced, because drift is `v t`, and
  // the depths crowd toward the lip as `t^2` — which is where the pieces are
  // wanted. Same six quads, same cost, and the error spread along the arc
  // instead of piled at its top.
  const tHead = Math.sqrt((2 * Math.max(0, head)) / FALL_GRAVITY);
  const tFront = Math.sqrt((2 * Math.max(0, front)) / FALL_GRAVITY);
  let from = head;
  for (let k = 1; k <= count; k++) {
    // Biased toward the lip on top of being cut in time — see `LIP_BIAS`.
    const t = tHead + (tFront - tHead) * Math.pow(k / count, LIP_BIAS);
    // The last one is `front` by construction rather than by arithmetic, so a
    // fall ends exactly where the solver says its front has got to.
    const to = k === count ? front : (FALL_GRAVITY * t * t) / 2;
    into.push({ from, to, thinFrom: thinAt(from), thinTo: thinAt(to) });
    from = to;
  }
  return into;
}

/**
 * What the SHEET looks like at `below` half steps under the lip it left.
 *
 * The whole point of this function is its value at nought, which is the
 * SURFACE'S OWN LOOK, exactly — `surfaceLook` with the lip's own numbers and
 * nothing of the fall's added yet. The mesh stops at the lip and this carries
 * on over it, and at the brink they are the same water in the same frame, so
 * any difference between them is a seam along the one line the eye is already
 * following.
 *
 * It was a seam. The sheet had its own recipe — a flat 0.20 lightened by how
 * hard the lip was pouring, plus `CARRIED * foam` — and on a foaming lip that
 * put the surface at 0.93 of the way to white and the sheet at 0.72, which is
 * RGB(240,245,248) above the line and RGB(195,215,226) below it. Worse, 0.72
 * was the sheet's CEILING, so the harder the water broke the wider the gap
 * got: foam was something ADDED to the sheet and something MIXED into the
 * surface, and a mix reaches the white end while an addition cannot.
 *
 * So the fall's own white is mixed in by the same rule foam is, on top of an
 * already-mixed lip, and the sheet leaves white when the lip is white.
 *
 * What the fall itself contributes is the thinning and the breaking up, both
 * out of {@link sheetAt}: less water to look through, and what is left going
 * whiter as the solver pulls drops out of it.
 */
export function sheetLook(
  shown: number, foam: number, lit: number, brink: number, below: number,
) {
  const s = sheetAt(brink, below);
  // How much of the lip's own body is still in the sheet here. Through the
  // same curve the surface uses rather than scaling the answer, because
  // `shade` is not a straight line and half the water is not half the alpha.
  const left = brink > 0 ? s.body / brink : 0;
  const look = surfaceLook(shown * left, foam, lit);
  return {
    pale: paleAt(look.shade + s.white * (SHADES - 1 - look.shade)),
    cover: look.cover,
  };
}
