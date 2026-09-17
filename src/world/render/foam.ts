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
import { dropAt } from "../../fluid/falls";

/** How white the foot of a fall goes, where the water arrives out of the air. */
const LANDING = 0.9;

/**
 * The water in the air, in half steps over one column, at which a fall lands
 * as white as it is going to get.
 *
 * A fall is a fall whatever its size, so the arrival was flat out at first —
 * and a walled basin grew a permanent white fringe, because a film a thirtieth
 * of a half step deep had crept onto the top of the wall and was trickling
 * back in over a ten step drop. That IS a fall and it does land, but it lands
 * a trickle: the edges of a fed waterfall carry two to five, the fringe
 * carried 0.003 to 0.04, and at one they come out two orders of magnitude
 * apart, which is what they look like.
 */
const FULL_AIR = 1;

/** How long foam lasts, in seconds — an e-folding, not a cutoff. */
const LIFE = 1.1;

export type FoamField = {
  readonly nx: number;
  readonly ny: number;
  /** Tiles across one column, so a speed in tiles becomes a step in columns. */
  readonly cell: number;
  /** How white each column is, 0 to 1. */
  now: Float32Array;
  /** Scratch, so a frame never reads what it has already written. */
  next: Float32Array;
};

export function createFoam(columns: ColumnField): FoamField {
  const { nx, ny, cell } = columns;
  return { nx, ny, cell, now: new Float32Array(nx * ny), next: new Float32Array(nx * ny) };
}

/**
 * How much water is landing on this column out of the air, 0 to 1.
 *
 * Only the two edges that can reach it — a fall crosses an edge in the `+x` or
 * `+y` direction, so what lands here left the column behind it on that axis.
 * It counts from the moment the fall's front arrives, which is the moment the
 * water does, and it counts by how much is coming: see {@link FULL_AIR}.
 */
function landingAt(columns: ColumnField, x: number, y: number): number {
  const { nx, falls } = columns;
  const i = y * nx + x;
  let most = 0;
  if (x > 0 && falls.air[(i - 1) * 2] > 0) {
    const k = (i - 1) * 2, drop = dropAt(columns, i - 1, 0);
    if (drop > 0 && falls.front[k] >= drop) most = falls.air[k];
  }
  if (y > 0 && falls.air[(i - nx) * 2 + 1] > 0) {
    const k = (i - nx) * 2 + 1, drop = dropAt(columns, i - nx, 1);
    if (drop > 0 && falls.front[k] >= drop && falls.air[k] > most) most = falls.air[k];
  }
  return most > 0 ? LANDING * Math.min(1, most / FULL_AIR) : 0;
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
  const { nx, cell, now, next } = foam;
  const { depth, broke, params } = columns;
  const splash = columns.drips.splashed ? columns.drips.splash : null;
  const dry = params.dryDepth;
  const air = columns.falls.air;
  const back = dt / cell;
  const keep = Math.exp(-dt / LIFE);
  const lastX = foam.nx - 1, lastY = foam.ny - 1;
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      const i = y * nx + x;
      if (depth[i] <= dry) { next[i] = 0; continue; }
      const vx = flowX(columns, x, y), vy = flowY(columns, x, y);
      let sx = x - vx * back;
      let sy = y - vy * back;
      sx = sx < 0 ? 0 : sx > lastX ? lastX : sx;
      sy = sy < 0 ? 0 : sy > lastY ? lastY : sy;
      const x0 = sx | 0, y0 = sy | 0;
      const x1 = x0 < lastX ? x0 + 1 : x0, y1 = y0 < lastY ? y0 + 1 : y0;
      const fx = sx - x0, fy = sy - y0;
      const a = now[y0 * nx + x0], b = now[y0 * nx + x1];
      const c = now[y1 * nx + x0], d = now[y1 * nx + x1];
      const top = a + (b - a) * fx, bot = c + (d - c) * fx;
      const carried = (top + (bot - top) * fy) * keep;
      // The air on the two edges that can reach this column, read INLINE and
      // before anything else. There is no fall anywhere near almost every
      // column on almost every map, and a call per column to find that out
      // cost as much as the whole of the rest of this loop.
      const west = x > 0 ? (i - 1) * 2 : -1;
      const north = y > 0 ? (i - nx) * 2 + 1 : -1;
      const maybe = (west >= 0 && air[west] > 0) || (north >= 0 && air[north] > 0);
      const landed = maybe ? landingAt(columns, x, y) : 0;
      // And what the SOLVER says is breaking here, which is the same number it
      // dissipates on — so the water goes white exactly where it loses energy.
      const wave = broke[i];
      // And where a DROP landed. Water arriving out of the air has air in it
      // whether it came over a lip as a sheet or out of a pipe as a drop; the
      // difference is that a drop is put in by hand rather than through the
      // divergence, so the surface rate the breaking test reads never sees it
      // and it has to leave word — see `splash` in fluid/drips.
      const splashed = splash ? splash[i] : 0;
      const born = Math.max(landed, wave, splashed);
      next[i] = carried > born ? carried : born;
    }
  }
  // Swap rather than copy: the whole point of the scratch array.
  for (let y = region.y0; y <= region.y1; y++) {
    const row = y * nx;
    now.set(next.subarray(row + region.x0, row + region.x1 + 1), row + region.x0);
  }
}
