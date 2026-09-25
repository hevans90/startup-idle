/**
 * World v2 — where the water goes white, and how long it stays that way.
 *
 * Foam is not a shade of water, it is a thing that HAPPENS to water and then
 * sits on it: a crest breaks, and the white it leaves drifts off downstream
 * and fades long after the wave that made it has gone. Drawn as a function of
 * the surface — whiten whatever is steep this frame — it reads as a highlight
 * painted on the mesh, appearing and vanishing with the geometry underneath.
 * So foam is a FIELD, born in one place, carried by the current, and decaying
 * on its own clock, the same shape of thing as the pattern in `flow-wash` and
 * for the same reason.
 *
 * WHERE IT IS BORN IS NOT DECIDED HERE any more. It used to be: this file
 * carried its own three criteria — a crest too tall for the water under it, a
 * front outrunning its own waves, a wave too steep to hold its shape — and
 * the solver carried a fourth for the dissipation it does when a wave breaks.
 * Two tests of the same thing in two places, and they did not agree: measured
 * on a pour they fired on 46% and 58% of the water with only 30% of it in
 * common, and on a waterfall on 8% and 4% with 2% in common. So there was
 * white where nothing was being dissipated and dissipation with nothing to
 * show for it.
 *
 * Breaking is the SOLVER's now, because there it has consequences — see
 * `stepBreaking` in `fluid/columns`. This file reads `broke`, the nought to
 * one intensity the solver already works out, and the water goes white
 * exactly where it is losing energy. It draws slightly MORE foam than the old
 * criteria did, which was the surprise: a steady river comes out at 35% white
 * against 28%, a waterfall at 44% against 31%, a big wave at 22% against 17%,
 * and a settled pond at nought either way.
 *
 * The two things still decided here are both about water ARRIVING out of the
 * air rather than breaking: the foot of a waterfall, and where a drop from a
 * pipe lands. Neither is a wave coming apart — water that has been falling has
 * air in it — and the solver has no opinion about either, because both are put
 * into the column directly rather than through the divergence the breaking
 * test reads.
 */
import { flowX, flowY, type ColumnField } from "../../fluid/columns";
import { wetTop } from "../../fluid/slots";

/**
 * How white the foot of a fall used to go, kept as the scale the splash is
 * read against.
 *
 * Nothing uses it now: the white at a fall's foot comes from the splash the
 * plunge banks, which measured 0.895 here against this 0.9. Left as the note
 * of what that number was chosen to match. @see stepFoam
 */
export const LANDING = 0.9;

/**
 * A TRICKLE MUST NOT READ AS A WATERFALL, which `FULL_AIR` used to guarantee
 * and the splash now does better.
 *
 * The landing term went white in proportion to `min(1, air / FULL_AIR)`, and
 * that ceiling existed for a real fault: a walled basin grew a permanent white
 * fringe, because a film a thirtieth of a half step deep had crept onto the
 * top of the wall and was trickling back in over a ten step drop. That IS a
 * fall and it does land, but it lands a trickle — the edges of a fed waterfall
 * carry two to five, the fringe carried 0.003 to 0.04.
 *
 * With the landing term gone the white comes from the plunge's splash, which
 * is `amount * PLUNGE_WHITE * speed / IMPACT_REF` — scaled by the water
 * actually delivered AND by how hard it arrives, rather than clipped at a
 * ceiling. Measured on the waterfall fixture the marks run from 0.012 to 0.895
 * with a tenth percentile of 0.276, so the faint falls stay faint.
 * @see markSplash
 */

/** How long foam lasts, in seconds — an e-folding, not a cutoff. */
export const LIFE = 1.1;

export type FoamField = {
  readonly nx: number;
  readonly ny: number;
  /** Tiles across one column, so a speed in tiles becomes a step in columns. */
  readonly cell: number;
  /** `nx * ny`: the stride from one storey's plane to the next. */
  readonly cells: number;
  /** How many storeys. @see ColumnField.layers */
  readonly layers: number;
  /**
   * How white each SLOT is, 0 to 1, as a plane per storey.
   *
   * A PLANE PER STOREY, and it was one plane over columns until a bridge
   * showed why it cannot be. Foam is carried by the current and born where the
   * water breaks, and on a span those are two different waters: the deck's
   * road runs one way and the channel under it runs another. Held per column,
   * the deck's white was advected by the RIVER's flow, born from the RIVER's
   * breaking, and wiped outright wherever the channel below happened to be
   * dry — so water crossing onto a span lost most of its foam at the abutment,
   * which is exactly what it looked like.
   *
   * It is still one field of the world in the sense that matters — the same
   * rule, the same clock — but which water is carrying it is a question that
   * needs a storey named. @see stepFoam
   */
  now: Float32Array;
  /** Scratch, so a frame never reads what it has already written. */
  next: Float32Array;
};

export function createFoam(columns: ColumnField): FoamField {
  const { nx, ny, cell, cells, layers } = columns;
  return {
    nx, ny, cell, cells, layers,
    now: new Float32Array(cells * layers),
    next: new Float32Array(cells * layers),
  };
}

/**
 * THERE IS NO LANDING TERM HERE ANY MORE, and it took a measurement to see why.
 *
 * There was one: for each column, look at the two edges that could reach it —
 * the ones immediately west and north — and if a fall's front had arrived on
 * either, go white in proportion to what was in the air. It marked the column
 * IMMEDIATELY OVER THE EDGE, and that is not where the water goes. Water
 * thrown off a lip travels while it falls; {@link landsAt} is what says where
 * it arrives.
 *
 * Measured on the waterfall fixture: every one of the 240 edges with water in
 * flight landed between four and eight columns from the foot of its cliff, six
 * most often. Four columns is a tile. So the white sat a tile or two BEHIND
 * the sheet that made it, on water the sheet never touched.
 *
 * And it was not needed. `plungeInto` already marks a splash at the column the
 * water reaches, unconditionally, the moment the front arrives — the same
 * moment this fired — and the loop below already reads those marks. Measured
 * on the same scene: all 240 landing columns marked, at 0.895, against a
 * LANDING of 0.9; and not one of the 240 cliff feet marked. The two terms were
 * the same white, one of them in the wrong place.
 *
 * So this is a deletion and not a move. @see markSplash, plungeInto
 */

/**
 * The white on column `(jx, jy)`, in the storey this water CAME FROM.
 *
 * A PLANE PER STOREY is not enough on its own, and the abutment of a bridge is
 * why. A road is one storey and its water is in slot nought; the deck it runs
 * onto is a second storey and its water is in slot one. So water crossing onto
 * a span changes SLOT, and a backward trace that stays in its own plane finds
 * nothing behind it — the deck came out with no white at all, which is worse
 * than the wrong white it had before.
 *
 * Foam is carried BY THE WATER, so the trace has to follow the water — and
 * the test is whether the two bodies of water TOUCH: their wetted intervals
 * overlap, floor to wet top. `connected` is the wrong question here and it is
 * worth saying why, because it was the first thing tried: two slots both open
 * to the sky are connected by the air above them however far apart their water
 * is, so a channel twenty half steps down would have had its white lifted onto
 * the deck over it — the original fault wearing a new hat. Water that touches
 * water is water that could have carried this white here.
 *
 * The same storey is tried first, because on a map with no bridges that is
 * always the answer and it then costs one test. Nothing touching means nothing
 * arrived, which reads as nought — a lip with air behind it has no upstream
 * white, and that is right.
 */
function whiteAt(
  foam: Float32Array, c: ColumnField, jx: number, jy: number,
  bed: number, top: number, a: number,
): number {
  const { cells, layers, nx, ground, roof, depth, params } = c;
  const jc = jy * nx + jx;
  const dry = params.dryDepth;
  const touches = (jb: number) => {
    if (depth[jb] <= dry) return false;
    const jt = wetTop(ground[jb], roof[jb], depth[jb]);
    return (jt < top ? jt : top) > (ground[jb] > bed ? ground[jb] : bed);
  };
  const same = a * cells + jc;
  if (touches(same)) return foam[same];
  for (let b = 0; b < layers; b++) {
    if (b === a) continue;
    const jb = b * cells + jc;
    if (touches(jb)) return foam[jb];
  }
  return 0;
}

/**
 * Carry the foam one frame down the current, fading it as it goes.
 *
 * The same backward trace as the flow wash — for each column, where was the
 * water that is here now a moment ago, and how white was it — except that this
 * one decays towards nothing rather than settling back to a pattern, and new
 * foam is taken as a MAXIMUM against what arrived. Adding it instead lets a
 * standing breaker pile up white without limit, and what you get is a solid
 * blob parked on the wave rather than foam being made and swept away.
 */
export function stepFoam(
  foam: FoamField, columns: ColumnField, dt: number,
  region: { x0: number; y0: number; x1: number; y1: number },
) {
  const { nx, cell, now, next, cells, layers } = foam;
  const { depth, broke, params } = columns;
  const splash = columns.drips.splashed ? columns.drips.splash : null;
  const dry = params.dryDepth;
  const back = dt / cell;
  const keep = Math.exp(-dt / LIFE);
  const lastX = foam.nx - 1, lastY = foam.ny - 1;
  const rim = columns.openEdge;
  for (let a = 0; a < layers; a++) {
    const A = a * cells;
    for (let y = region.y0; y <= region.y1; y++) {
      for (let x = region.x0; x <= region.x1; x++) {
        const i = y * nx + x;
        const ia = A + i;
        // AND THE RIM LOSES ITS WHITE WITH ITS WATER. `spill` empties the
        // outermost ring every substep, and foam advected into it has nothing
        // left to ride out on — so it piles up there and the edge of the map
        // goes white and stays white. Cleared, what reaches the rim leaves with
        // everything it was carrying, which is what an open edge means.
        if (rim && (x === 0 || y === 0 || x === lastX || y === lastY)) {
          next[ia] = 0;
          continue;
        }
        if (depth[ia] <= dry) { next[ia] = 0; continue; }
        // THIS SLOT'S OWN CURRENT. A deck's water is carried by what is
        // running over the deck, not by the river under it.
        const vx = flowX(columns, x, y, a), vy = flowY(columns, x, y, a);
        let sx = x - vx * back;
        let sy = y - vy * back;
        sx = sx < 0 ? 0 : sx > lastX ? lastX : sx;
        sy = sy < 0 ? 0 : sy > lastY ? lastY : sy;
        const x0 = sx | 0, y0 = sy | 0;
        const x1 = x0 < lastX ? x0 + 1 : x0, y1 = y0 < lastY ? y0 + 1 : y0;
        const fx = sx - x0, fy = sy - y0;
        // EACH CORNER IN THE STOREY IT FED FROM. @see whiteAt
        const bed = columns.ground[ia];
        const wet = wetTop(bed, columns.roof[ia], depth[ia]);
        const p = whiteAt(now, columns, x0, y0, bed, wet, a);
        const q = whiteAt(now, columns, x1, y0, bed, wet, a);
        const c = whiteAt(now, columns, x0, y1, bed, wet, a);
        const d = whiteAt(now, columns, x1, y1, bed, wet, a);
        const top = p + (q - p) * fx, bot = c + (d - c) * fx;
        const carried = (top + (bot - top) * fy) * keep;
        // What the SOLVER says is breaking HERE, in this slot, which is the
        // same number it dissipates on — so the water goes white exactly
        // where it loses energy. `broke` has been per slot all along.
        const wave = broke[ia];
        // And where a DROP landed. Water arriving out of the air has air in it
        // whether it came over a lip as a sheet or out of a pipe as a drop; the
        // difference is that a drop is put in by hand rather than through the
        // divergence, so the surface rate the breaking test reads never sees it
        // and it has to leave word — see `splash` in fluid/drips.
        //
        // ON STOREY NOUGHT ONLY, and that is a known hole rather than a
        // choice: `drips.splash` is one plane over columns, because a drop
        // records where it landed and not which storey it landed ON. Put on
        // every storey it would whiten a deck when something splashed in the
        // channel underneath; put here it does what it has always done. What
        // it needs is the landing slot, which means `markSplash` taking one.
        const splashed = a === 0 && splash ? splash[i] : 0;
        const born = wave > splashed ? wave : splashed;
        next[ia] = carried > born ? carried : born;
      }
    }
    // Swap rather than copy: the whole point of the scratch array.
    for (let y = region.y0; y <= region.y1; y++) {
      const row = A + y * nx;
      now.set(next.subarray(row + region.x0, row + region.x1 + 1), row + region.x0);
    }
  }
}
