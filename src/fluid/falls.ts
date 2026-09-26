/**
 * Water in the air.
 *
 * The solver moves water across an edge in one step. Over a lip that is wrong
 * in a way you can see: the wave at the top stops, the wave at the bottom
 * starts, and nothing crosses the distance between them. Water that goes over
 * a cliff spends time falling, and while it is falling it is somewhere and it
 * is not anywhere else.
 *
 * So it leaves the column at the top and does not arrive at the one below
 * until it has fallen the distance. In between it is held HERE, on the edge it
 * went over, and `totalWater` counts it — a drop in the air is still a drop.
 *
 * A fall has a FRONT, the leading edge of the water, and a HEAD, the trailing
 * one. Both accelerate under a gravity of their own: the solver's is a pressure
 * gradient measured in tiles and has nothing to say about anything falling.
 * While water is still going over, the head stays at the lip and the front runs
 * away from it; when the supply stops the head lets go and the whole thing
 * drops away. Nothing lands until the front reaches the bottom, and after that
 * water leaves the air at the rate it is arriving.
 */
import { flowX, flowY, planeRegion, plungeInto, type ColumnField } from "./columns";
import { DROP, dripFrom, dripRoom } from "./drips";
import { wetTop } from "./slots";

/**
 * Gravity for a falling sheet, in half steps per second squared.
 *
 * Chosen from how long a drop should take to look right: at 90, a ten half
 * step cliff — five full steps, a serious drop — takes just under half a
 * second from lip to floor, which is about what the eye expects of something
 * that size.
 */
export const FALL_GRAVITY = 90;

/**
 * Below this a drop is a ledge, not a fall, in half steps.
 *
 * Two terrain steps. One is a lip water tumbles over and keeps flowing, and
 * treating it as a fall is worse than useless: at a tenth of this, a steady
 * hillside became a staircase of little cliffs and the water spent its whole
 * journey in the air, arriving nowhere. A fall is a drop you would hesitate to
 * step off.
 */
export const FALL_MIN = 4;

/**
 * How long a fall stays attached to its lip after the last water crosses.
 *
 * The flux over an edge is a real quantity in a real simulation and it crosses
 * zero from one frame to the next. Without this the head lets go and grabs on
 * again several times a second, which is a stutter rather than a waterfall.
 */
export const CLING = 1 / 6;

/**
 * The fastest a lip may throw its water outward, in TILES a second.
 *
 * Physically there is nothing here to clamp: a river doing three tiles a
 * second off a twenty-eight half step drop really is in the air 0.79 seconds
 * and really does land two and a bit tiles out. Drawn, the arc is so flat that
 * the water reads as thrown AT the valley rather than dropping into it, which
 * is a worse lie than the vertical sheet it replaced.
 *
 * So it is a cap adopted for the look of it, and it lives HERE rather than
 * with the drawing because the drawing is no longer the only thing that
 * follows the arc. A sheet that comes apart sheds real drops, and a drop
 * thrown two tiles while the sheet it left is drawn one tile out does not come
 * off the sheet, it comes out of the cliff beside it. One cap, one arc, one
 * place.
 *
 * It was ONE, and one is what made every waterfall read as a corner.
 *
 * The RADIUS of the bend at a lip is `v^2 / g` — it goes as the SQUARE of the
 * launch, while how far the water lands goes only as the first power. A cap
 * of one is a radius of three pixels. Traced off the drawn vertices, the
 * sheet turned 27, 35, 43, 48, 54, 59, 64, 70 degrees over segments 0.7, 1.2,
 * 1.8, 2.4, 3.1, 3.9, 4.9 and 6.1 pixels long: every angle in a smooth
 * sequence, the whole turn finished inside twenty-four pixels, which is less
 * than the length of one quad of the surface feeding it. The curve was the
 * right shape at the wrong SIZE, and cutting it finer cannot make a curve out
 * of a corner.
 *
 * Measured at a lip the water is going 2.0 to 2.6 tiles a second, so three is
 * a cap that rarely binds and the arc is the one the water is really on: it
 * reaches seventy degrees after 133 pixels rather than 38.
 *
 * Bleeding the sideways speed off as it falls was tried, to keep the foot in
 * close. It does the opposite of what it looks like it should — taking the
 * horizontal away while the vertical keeps building makes the sheet go
 * vertical SOONER, and at a fifth of a second it was back to seventy degrees
 * after 45 pixels. There is no version of this where a wide bend is cheap:
 * the arc is as wide as the water's own speed makes it, and the foot goes
 * where the arc goes.
 *
 * So the water goes where the arc goes — see {@link landsAt}. Keeping those
 * two together is what the old cap was really paying for.
 *
 * AND IT IS INERT, which is worth knowing before anybody tunes it. `throwOf`
 * is only ever handed `flowX`/`flowY`, and those are already clamped to
 * {@link MAX_FLOW_SPEED} — the same three — so the `min` below has never once
 * bound. Two independent literals that had to agree and nothing saying so.
 *
 * Kept rather than deleted, because the cap means "a lip throws no faster than
 * the water can flow" and that rule should survive the flow cap moving.
 *
 * AND WRITTEN OUT RATHER THAN IMPORTED, which is the opposite of what it looks
 * like it should be. `columns` and `falls` import each other, and a cycle is
 * harmless while everything crossing it is a FUNCTION — nothing is called
 * until both modules are loaded. A `const` read at module scope is not: set to
 * `MAX_FLOW_SPEED`, this throws "Cannot access before initialization" for any
 * entry point that loads `columns` first, because `columns` runs `falls` to
 * completion before its own body declares anything. The whole suite passed on
 * load-order luck and one new test file was enough to find it.
 *
 * So the relationship is pinned by a test instead of by an import, which is
 * the one place it can be stated without the cycle. @see falls.test
 */
export const FALL_THROW = 3;

/**
 * The lip speed a fall actually gets to use: capped in MAGNITUDE, sign kept.
 *
 * It clamped to nought at the bottom, which is the right rule said in the
 * wrong place. "Outward only" is about the axis the water goes OVER — a sheet
 * thrown back the way it came is a sheet inside the cliff — and it was
 * enforced here, where the axis is not known, by throwing away the sign.
 *
 * That cost two things. A fall facing WEST or NORTH has a negative flow at
 * its lip by definition, so every one of them got a throw of nought and hung
 * dead vertical while every east-facing fall on the same map arced. And the
 * ACROSS component, which is the one that makes a sheet leave a convex corner
 * along the flow rather than square to the rock, was thrown away too whenever
 * the water happened to be going the other way.
 *
 * So the cap is on the magnitude and the outward rule moves to {@link
 * outward}, which is applied where the axis IS known. @see FALL_THROW
 */
export const throwOf = (speed: number) =>
  Math.max(-FALL_THROW, Math.min(FALL_THROW, speed));

/**
 * A lip's throw along the axis it pours over, never back into the rock.
 *
 * `back` is the fall's own direction — west or north rather than east or
 * south, the sign {@link dropAt} carries. Applied to the ALONG component
 * only: the across one is free to be either way round, which is the whole of
 * what makes a sheet leave a corner along the flow.
 */
export const outward = (speed: number, back: boolean) =>
  (back ? Math.min(0, speed) : Math.max(0, speed));

/**
 * How far out of the rock a fall has got, `below` half steps down.
 *
 * Water over a lip is a PROJECTILE and nothing more complicated than one: it
 * leaves at the speed it had and falls at {@link FALL_GRAVITY}, so `below`
 * half steps down it has been in the air `sqrt(2 below / g)` seconds. Whatever
 * unit the speed is in, the answer is in — tiles for the sheet the renderer
 * draws, columns for the drops the sheet sheds.
 */
export const driftAt = (lipSpeed: number, below: number) =>
  lipSpeed * Math.sqrt((2 * Math.max(0, below)) / FALL_GRAVITY);

/**
 * How far a sheet holds together before it starts coming apart, in half steps.
 *
 * A nappe is not stable. Surface waves grow on it, the air drags at it, and it
 * is thinning the whole way down because it is accelerating — past some
 * distance it stops being a sheet with a surface and becomes a great many
 * drops travelling together. That distance is what decides whether a drop
 * reads as a curtain hung off a ledge or as a waterfall, and it is the reason
 * anything here knows about drips at all.
 *
 * Eight half steps: four full steps, about the point at which a fall stops
 * being something water pours over and starts being something it falls down.
 */
export const BREAK = 8;

/**
 * How much a column's width of breaking sheet sheds, per second.
 *
 * A rate per EDGE and not a fraction of what is in the air, because it is the
 * SURFACE of a nappe that comes apart and an edge is one column wide however
 * much is going over it. A fraction of the volume would have a river shedding
 * a hundred times what a trickle does and put ten thousand drops in the air;
 * per edge, a wide fall sheds along its whole width and a narrow one does not,
 * which is both what happens and what keeps the count bounded.
 */
export const SHED = 1.3;

/**
 * How long a DROWNED fall takes to give up what it is holding, in seconds.
 *
 * A fall whose cliff has gone still has water in the air, and that water has
 * to arrive. It used to arrive ALL AT ONCE — one `land` at a full share, the
 * whole column into one cell in one step — and on a real river that is a
 * great deal of water: an edge under a steady pour holds tens of half steps,
 * because it holds everything that went over during the time the fall takes.
 *
 * Measured on a twelve half step cliff, the cell below went from 6.7 half
 * steps deep to 27.7 in a single frame. That is four times the water that was
 * there, dropped in at once, and it is self-sustaining: the spike puts the
 * pool up past the cliff, which is what `drop < FALL_MIN` tests, so the fall
 * stays dead for the ten frames it takes to drain, restarts from nothing, and
 * does the same thing again. The waterfall flickered several times a second
 * and between flickers there was no sheet at all.
 *
 * So it drains over a time instead, and the time is the one a fall of the
 * shortest height there is takes to happen — the drop has just stopped being
 * one, so that is the longest it could still have been in the air for.
 */
export const DROWN = Math.sqrt((2 * FALL_MIN) / FALL_GRAVITY);

/**
 * How far a shed drop is thrown sideways out of the sheet, in columns and
 * columns a second.
 *
 * Without it the drops leave along the sheet's own arc, which is a second
 * sheet drawn as dots. Spray is spray because it does NOT all go the same way.
 */
const FAN = 0.7;


export type FallState = {
  /** Water in the air on each edge, `+x` then `+y` per column. */
  readonly air: Float32Array;
  /** Leading and trailing edges, in half steps below the lip. */
  readonly front: Float32Array;
  readonly head: Float32Array;
  readonly frontSpeed: Float32Array;
  readonly headSpeed: Float32Array;
  /** Seconds since water last went over. */
  readonly since: Float32Array;
  /**
   * Water owed to the spray, banked until it is worth a drop.
   *
   * {@link SHED} is a rate and a drop is a quantity, so at sixty frames a
   * second an edge earns a fortieth of a drop per step. Emitting that would
   * make forty times as many drops, each a fortieth the size, which is fog
   * rather than spray and forty times the cost. So it accumulates here and
   * comes off as a drop when there is a drop's worth of it.
   */
  readonly shed: Float32Array;
  /**
   * The launch velocity a lip throws with, SMOOTHED, per column.
   *
   * One arc, and now one that holds still. The throw is the water's own
   * velocity, and that surges: on a real river the flux over a lip wanders by
   * a column or two's worth of drift from frame to frame. Read raw, the place
   * the water lands hops about with it, and a plunge pool that should be a
   * definite hole comes out as a smear — measured, the scour went from 40%
   * below the pool around it to 23%.
   *
   * A landing point cannot honestly respond faster than the water takes to
   * get there anyway, which for any sensible drop is a good fraction of a
   * second. So it is followed on {@link THROW_EASE} and everything that
   * cares — where the water lands, where the sheet is drawn, where the spray
   * leaves from — reads the same smoothed number.
   */
  readonly throwX: Float32Array;
  readonly throwY: Float32Array;
  /**
   * Every edge the GROUND makes a cliff of, packed as `i * 2 + axis`, and how
   * many of them there are.
   *
   * THE SET A FALL CAN EVER HAPPEN ON, and it is a property of the terrain
   * alone. Water only goes into the air through `intoAir`, which the
   * divergence calls only where `dropAt` is over `FALL_MIN`; `dropAt` measures
   * down to the neighbour's SURFACE, which is never below its ground, so an
   * edge with air on it always has `ground[i] - ground[j] >= FALL_MIN`. The
   * converse does not hold — a pool can fill a cliff in from below and stop
   * the fall — so this is a superset, and a cheap one to keep: the ground is
   * written in exactly one place.
   *
   * Before this, `stepFalls` walked the whole active box every substep. On a
   * flooded flat map, with no cliff anywhere on it, that was 1.18ms of a
   * 1.96ms solver — SIXTY PERCENT of the frame spent establishing, 65,536
   * times over, that there was nothing to do.
   */
  cliff: Int32Array;
  cliffN: number;
  /** Which COLUMNS own one, so the smoothed throw is followed once each. */
  readonly cliffCol: Uint8Array;
  /**
   * Scratch for the rebuild: which slots own a cliff, before it is compared
   * with which ones did. @see markCliffs
   */
  readonly cliffNow: Uint8Array;
  /**
   * WHICH SUBSTEP EACH SLOT LAST EASED ITS THROW ON, and the number of the
   * one running.
   *
   * The launch is followed once per SLOT per substep, and it used to be kept
   * to that by walking the cliff set in column order and noticing when the
   * column changed. The set is not in column order any more — it is grouped
   * by slot PAIR, because that is what makes a field with no decks on it cost
   * what it did — so a slot's edges are no longer adjacent in it and the
   * cheap test would ease some of them several times over.
   *
   * A stamp does not care about order. It costs one compare and one store per
   * cliff edge, against an integer that never has to be cleared.
   */
  readonly eased: Int32Array;
  easedRun: number;
};

/**
 * How quickly a lip's smoothed launch follows the water's own, in seconds.
 *
 * Half a second: longer than the chatter, shorter than a river changing its
 * mind, and about the time water spends in the air off a serious drop — which
 * is the honest floor, since a landing point cannot respond faster than the
 * water takes to arrive.
 */
export const THROW_EASE = 0.5;

/**
 * @param layers how many SLOTS a column has — see `ColumnField.layers`.
 *
 * A fall belongs to an edge between two SLOTS, not between two columns. At
 * the mouth of a bridge the same pair of columns carries two of them at once:
 * the river going under the span, and whatever comes off the deck over it. Run
 * through one accumulator those are one waterfall made of two unrelated
 * sheets, and it lands in one place.
 *
 * So there is a plane of edges per slot pair, exactly as the flux has, and the
 * fall on pair `p` of edge `k` is at `p * cells * 2 + k`. At one layer there
 * is one plane and every index is the index it was.
 */
export function createFalls(nx: number, ny: number, layers = 1): FallState {
  const n = nx * ny * 2 * layers * layers;
  const cols = nx * ny * layers;
  return {
    air: new Float32Array(n),
    front: new Float32Array(n),
    head: new Float32Array(n),
    frontSpeed: new Float32Array(n),
    headSpeed: new Float32Array(n),
    // Long ago: an edge nobody has poured over has no fall on it, and starting
    // at zero put one on every cliff in the world on the first frame.
    since: new Float32Array(n).fill(CLING),
    shed: new Float32Array(n),
    throwX: new Float32Array(cols),
    throwY: new Float32Array(cols),
    cliff: new Int32Array(n),
    cliffN: 0,
    cliffCol: new Uint8Array(cols),
    cliffNow: new Uint8Array(cols),
    eased: new Int32Array(cols).fill(-1),
    easedRun: 0,
  };
}

/**
 * Find every edge the ground makes a cliff of. @see FallState.cliff
 *
 * Called wherever `ground` is written and nowhere else, which is once at
 * creation and once per terrain edit. Everything in `stepFalls` then walks
 * this instead of the map.
 *
 * A column that has just BECOME a cliff has its smoothed throw snapped to the
 * flow rather than eased onto it. While it was not a cliff nothing followed
 * it, so what it holds is whatever it held the last time it was one, which may
 * be from another shape of terrain entirely — easing from that is easing from
 * nothing, and it is the one place this optimisation could have been seen.
 */
/**
 * Does the ground fall away from this slot, over any of its four edges?
 *
 * The question `cliffCol` answers, and the reason it is asked per column
 * rather than accumulated while the edges are claimed: a fall leaves the
 * HIGHER of the two columns an edge joins, so on a westward fall that is not
 * the column that owns the edge. @see markCliffs
 */
function isLip(
  f: ColumnField, x: number, y: number, b: number,
  fa: number, ra: number,
): boolean {
  const { nx, ny, cells, ground, roof } = f;
  const B = b * cells;
  for (let d = 0; d < 4; d++) {
    const jx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
    const jy = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
    if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
    const jb = B + jy * nx + jx;
    const joined = (ra < roof[jb] ? ra : roof[jb]) > (fa > ground[jb] ? fa : ground[jb]);
    if (joined && fa - ground[jb] >= FALL_MIN) return true;
  }
  return false;
}

export function markCliffs(f: ColumnField) {
  const { nx, ny, cells, layers, ground, roof } = f;
  const s = f.falls;
  const { air, front, cliffCol, cliffNow } = s;
  let n = 0;
  cliffNow.fill(0);
  // THE SLOT PAIR OUTSIDE, for the reason `accelerate` sets out: walked
  // inside, the plane's base is two multiplies an edge and the bound is a
  // number the engine cannot see is one, and this pass walks the WHOLE grid
  // every frame rather than the active box. Measured on a field with one
  // plane, 0.066ms a frame became 0.185 with the loop inside it.
  // CLIPPED TO WHERE THE PAIR EXISTS, like every other pass — and it matters
  // more here than anywhere, because this one walks the whole map rather
  // than the active box. @see planeRegion
  const R = { x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let a = 0; a < layers; a++) {
    const A = a * cells;
    for (let b = 0; b < layers; b++) {
      if (!planeRegion(f, a, b, 0, 0, nx - 1, ny - 1, R)) continue;
      const B = b * cells;
      const P = (a * layers + b) * cells;
      for (let y = R.y0; y <= R.y1; y++) {
        for (let x = R.x0; x <= R.x1; x++) {
          const i = y * nx + x;
          const ia = A + i;
          const fa = ground[ia], ra = roof[ia];
          if (ra <= fa) continue;               // no slot, so no lip
          const k = (P + i) * 2;
          // EITHER WAY OVER THE EDGE. An edge belongs to the column on its
          // low-index side whichever way the water goes over it, so claiming
          // it is unchanged and only the TEST widens: a drop of `FALL_MIN`
          // from `ia` to `jb` is a cliff, and so is one the other way. The
          // second half of that was missing, and with it every waterfall on
          // the map that happened to face west or north. @see dropAt
          if (x + 1 < nx) {
            const jb = B + i + 1;
            // A PAIR THAT IS NOT JOINED HAS NO LIP. The deck of a bridge
            // stands a long way over the channel under it and that is not a
            // waterfall, it is a bridge — the two slots do not overlap, so
            // nothing crosses and nothing falls. @see fluid/slots
            const joined = (ra < roof[jb] ? ra : roof[jb])
              > (fa > ground[jb] ? fa : ground[jb]);
            const step = fa - ground[jb];
            if ((joined && (step >= FALL_MIN || -step >= FALL_MIN))
              || air[k] > 0 || front[k] > 0) {
              s.cliff[n++] = k;
            }
          }
          if (y + 1 < ny) {
            const jb = B + i + nx;
            const joined = (ra < roof[jb] ? ra : roof[jb])
              > (fa > ground[jb] ? fa : ground[jb]);
            const step = fa - ground[jb];
            if ((joined && (step >= FALL_MIN || -step >= FALL_MIN))
              || air[k + 1] > 0 || front[k + 1] > 0) {
              s.cliff[n++] = k + 1;
            }
          }
          // AND WHETHER THIS COLUMN IS A LIP IS A QUESTION ABOUT ITS OWN FOUR
          // EDGES, not about the two it happens to own. The smoothed launch
          // is per column and belongs to the column the water LEAVES, which
          // for a westward fall is the one on the high-index side of the
          // edge — and marking that from here would be a write into a
          // neighbour's cell, which the device twin cannot do at all.
          // Asked of itself, both paths get the same answer with no
          // cross-thread write anywhere. @see seedThrow
          if (isLip(f, x, y, b, fa, ra)) cliffNow[ia] = 1;
        }
      }
    }
  }
  s.cliffN = n;
  // A slot that has just BECOME a cliff has its smoothed throw snapped to the
  // flow rather than eased onto it. While it was not a cliff nothing followed
  // it, so what it holds is whatever it held the last time it was one, which
  // may be from another shape of terrain entirely.
  //
  // Its own pass, because whether a slot owns a cliff is only settled once
  // every plane has been looked at.
  for (let ia = 0; ia < cliffNow.length; ia++) {
    const own = cliffNow[ia];
    if (!own && !cliffCol[ia]) continue;
    if (own && !cliffCol[ia]) {
      const i = ia % cells, a = (ia / cells) | 0;
      s.throwX[ia] = throwOf(flowX(f, i % nx, (i / nx) | 0, a));
      s.throwY[ia] = throwOf(flowY(f, i % nx, (i / nx) | 0, a));
    }
    cliffCol[ia] = own;
  }
}

/** The smoothed launch at a column, as a pair. @see FallState.throwX */
export const throwAt = (f: ColumnField, i: number) =>
  ({ x: f.falls.throwX[i], y: f.falls.throwY[i] });

/**
 * Where a neighbour's water, or failing that its ground, stands.
 *
 * `j` is a SLOT index — `b * cells + column` — so a fall onto the deck of a
 * bridge measures to the deck and a fall past the side of one measures to
 * whatever is down there. At one layer a slot index and a column index are
 * the same number and this is the function it was.
 *
 * The water's own top and not its hydraulic surface, because this is asking
 * what a falling sheet will hit: a full culvert is hit at its soffit, not at
 * the level its pressure would imply. @see wetTop
 */
export const besideAt = (f: ColumnField, j: number) =>
  f.depth[j] > f.params.dryDepth ? wetTop(f.ground[j], f.roof[j], f.depth[j]) : f.ground[j];

/**
 * How far water goes over one of a column's edges, SIGNED: positive falls
 * toward `j` — east on axis nought, south on axis one — negative falls back
 * toward `i`, and nought is a step in a river rather than a cliff.
 *
 * THE SIGN IS THE DIRECTION, and that is the whole of what lets a fall face
 * four ways rather than two. An edge was measured one way only, `i` down to
 * `j`, so a drop to the WEST or the NORTH was not a cliff to anything that
 * asked: the solver moved that water across in a single step the way it did
 * everywhere before falls existed, and half the cliffs on any map had no
 * sheet, no spray and no plunge at the foot of them. The sign costs nothing —
 * every caller that tested `dropAt(...) > 0` still means what it meant, and
 * the one that hands water to the air now pairs the sign of the flux with the
 * sign of the drop.
 *
 * AT MOST ONE WAY, always, which is why one number can carry both. The two
 * drops are `ground[i] - beside(j)` and `ground[j] - beside(i)`, and
 * `beside` is never below its own ground — so both being at least `FALL_MIN`
 * would need the ground to be four half steps below itself.
 *
 * Read off the GROUND on the far side, not its surface: a pool at the foot of
 * a cliff shortens the fall, and once it is deep enough there is no fall left.
 */
export function dropAt(
  f: ColumnField, i: number, axis: number, a = 0, b = 0,
): number {
  const x = i % f.nx, y = (i / f.nx) | 0;
  const jx = axis === 0 ? x + 1 : x, jy = axis === 0 ? y : y + 1;
  if (jx >= f.nx || jy >= f.ny) return 0;
  const cells = f.cells;
  const ia = a * cells + i, jb = b * cells + jy * f.nx + jx;
  const there = f.ground[ia] - besideAt(f, jb);
  if (there >= FALL_MIN) return there;
  const back = f.ground[jb] - besideAt(f, ia);
  return back >= FALL_MIN ? -back : 0;
}

/**
 * The edge a fall lives on: a slot pair, an axis and a column. @see createFalls
 *
 * The pair comes FIRST so that pair zero is the `i * 2 + axis` this was, which
 * is what lets a one-layer field keep the indices it had.
 */
export const fallEdge = (f: ColumnField, i: number, axis: number, p = 0) =>
  p * f.cells * 2 + i * 2 + axis;

/** Hold `amount` in the air on an edge rather than landing it. */
export function intoAir(
  f: ColumnField, i: number, axis: number, amount: number, p = 0,
) {
  f.falls.air[fallEdge(f, i, axis, p)] += amount;
}

/**
 * Advance every fall, and land what has finished falling.
 *
 * Called after the depths are applied, so what lands this step is water that
 * left a lip on some earlier one.
 */
export function stepFalls(
  f: ColumnField, dt: number,
  region: { x0: number; y0: number; x1: number; y1: number },
) {
  const { nx, cells, layers, depth, params } = f;
  const s = f.falls;
  // Hoisted because it is a function of `dt` alone. Measured as worth nothing
  // — both engines already lift a pure `Math.exp` of loop invariants out — but
  // it reads as what it is up here.
  const ease = 1 - Math.exp(-dt / THROW_EASE);
  // ONCE, for every fall in this step — see `ColumnField.room`. Read per fall
  // it is what made the falls depend on the order they were walked in.
  f.room = dripRoom(f.drips);
  // ONLY WHERE THE GROUND MAKES A CLIFF — see `FallState.cliff`. Water can
  // only be in the air on one of these, and a fall can only start on one, so
  // every other column in the box had nothing to do here but be walked past.
  //
  // An edge off the map is not in the set at all, and nothing can ever be in
  // the air on one: `dropAt` answers nought past the last column, so `intoAir`
  // is never called there. The drain that used to run for every edge of the
  // last row and column, every substep, was draining nothing.
  const run = ++s.easedRun;
  for (let n = 0; n < s.cliffN; n++) {
      const k = s.cliff[n];
      // A FALL'S EDGE IS A SLOT PAIR, an axis and a column, packed in that
      // order — see `fallEdge`. At one layer the plane is zero and every one
      // of these is the `k >> 1` and `k & 1` it was.
      const pl = (k / (cells * 2)) | 0;
      const rest = k - pl * cells * 2;
      const i = rest >> 1, axis = rest & 1;
      const a = (pl / layers) | 0, b = pl - a * layers;
      const ia = a * cells + i;
      const ex = i % nx, ey = (i / nx) | 0;
      {
        const jx = axis === 0 ? ex + 1 : ex, jy = axis === 0 ? ey : ey + 1;
        const jb = b * cells + jy * nx + jx;
        // WHICH WAY IT GOES OVER, and therefore which of the two slots the
        // water is leaving. Positive is the way this always used to be, out
        // of `ia` and into `jb`; negative is the mirror of it. Everything
        // below reads `from` and `j` rather than the two slot indices, so
        // there is one description of a fall and it faces four ways.
        //
        // ASKED OF `dropAt` rather than measured again here, because that is
        // the rule and this is one of four places that needs it. @see dropAt
        const signed = dropAt(f, i, axis, a, b);
        const back = signed < 0;
        // WITH THE CLIFF GONE, DOWNHILL IS STILL DOWNHILL. `signed` is nought
        // where the step has filled in, and whatever is left in the air has
        // to be put somewhere — the lower of the two, which for a fall that
        // was running back is not the far side.
        const flat = signed === 0 && f.ground[jb] > f.ground[ia];
        const from = back || flat ? jb : ia;
        const j = back || flat ? ia : jb;
        const drop = back ? -signed : signed;
        // THE BOX IS ABOUT THE COLUMN THE WATER LEAVES, which is not always
        // the column that owns the edge. An edge belongs to its low-index
        // side whichever way the water goes over it, so on a westward fall
        // the owner is the DRY side — outside the active box almost by
        // definition. Tested there, every backward fall was skipped every
        // step: its air went in and never came out, and what should have
        // been a waterfall was a slow leak into nowhere. Measured on a
        // plateau spilling all four ways, 0.269 of water stuck in the air on
        // the west lip against 0.065 moving through the east one.
        const sx = back || flat ? jx : ex, sy = back || flat ? jy : ey;
        if (sx < region.x0 || sx > region.x1
          || sy < region.y0 || sy > region.y1) continue;
        // The smoothed launch, followed once per column — see
        // `FallState.throwX`. Every edge of it, the renderer and the spray
        // all read this, so there is one arc and it does not chatter. On the
        // column the water LEAVES, for the same reason the box is.
        if (s.eased[from] !== run) {
          const fa = (from / cells) | 0;
          s.throwX[from] += (throwOf(flowX(f, sx, sy, fa)) - s.throwX[from]) * ease;
          s.throwY[from] += (throwOf(flowY(f, sx, sy, fa)) - s.throwY[from]) * ease;
          s.eased[from] = run;
        }
        // AND THE SAME NUMBER AS AN F32, because `front` and `head` are f32
        // arrays and a sheet arriving is a sheet that has SATURATED at the
        // bottom. Clamp with `Math.min(drop, ...)` and store, and what comes
        // back is `drop` rounded to f32 — which can be a hair BELOW `drop`, so
        // the very next line, `front >= drop`, says no and a fall that has
        // reached the bottom fails its own arrival test for a frame.
        //
        // Found by the device, which does every step of this in f32 and so
        // saturates exactly: it landed two sheets the CPU held back, 0.115 of
        // water on a scene of 529. The device was right. A value a float array
        // cannot hold is not a threshold that array can be tested against.
        const reach = Math.fround(drop);
        if (drop < FALL_MIN) {
          // The cliff has gone — filled in from below, or the ground moved.
          // Whatever was in the air belongs to the cell below it, but it
          // arrives over {@link DROWN} rather than all in one step: dumped,
          // it lands hard enough to put the pool up over the cliff and kill
          // the next fall too, which is a flicker and not a waterfall.
          //
          // `reset` leaves the air alone, so what is left drains through here
          // again next step. The sheet stops being drawn either way.
          land(f, k, j, from, Math.min(1, dt / DROWN));
          reset(s, k);
          continue;
        }

        // STILL POURING, measured with the sign the fall itself has: the flux
        // on an edge is positive toward `jb`, so a westward fall is fed by a
        // NEGATIVE one and reading it unsigned would have every such fall
        // let go of its lip on the frame it started. @see CLING
        const raw = axis === 0 ? f.fx[pl * cells + i] : f.fy[pl * cells + i];
        const flux = back ? -raw : raw;
        s.since[k] = flux > 0 && depth[from] > params.dryDepth ? 0 : s.since[k] + dt;

        if (s.since[k] < CLING) {
          s.head[k] = 0;                        // more is coming over behind it
          s.headSpeed[k] = 0;
        } else {
          s.headSpeed[k] += FALL_GRAVITY * dt;
          s.head[k] += s.headSpeed[k] * dt;
        }
        if (s.front[k] < reach) {
          s.frontSpeed[k] += FALL_GRAVITY * dt;
          s.front[k] = Math.min(reach, s.front[k] + s.frontSpeed[k] * dt);
        }

        // Past the breaking point it starts throwing water off itself, and
        // what it throws is DROPS — real ones, out of its own mass, so the
        // sheet is lighter for it and what lands at the bottom lands twice:
        // most of it through the sheet, some of it a drop at a time.
        if (s.front[k] > BREAK && s.air[k] > 0) shedSpray(f, k, from, axis, back, dt, drop);

        // NOTHING lands until the front gets there. After that it leaves the
        // air at the rate it is arriving, which in a steady fall is the rate
        // it went over — the time constant is the time the fall takes.
        if (s.front[k] >= reach && s.air[k] > 0) {
          const fall = Math.sqrt((2 * drop) / FALL_GRAVITY);
          // Where the SHEET gets to, not the column over the edge.
          land(f, k, landsAt(f, from, j, drop), from, Math.min(1, dt / fall), drop);
        }
        // Caught its own front, or fallen past the bottom: nothing is left of
        // it, and anything still in the air has landed by now.
        if (s.head[k] >= s.front[k] || s.head[k] >= reach) {
          land(f, k, j, from, 1);
          reset(s, k);
        }
      }
  }
}

/**
 * Put a share of what is in the air into the cell below it.
 *
 * `drop` is how far it fell, and is what makes the difference between arriving
 * and LANDING. Water comes in here through the side door — the solver's own
 * breaking test reads the rate the surface is changing, and a sheet delivered
 * straight into the depth never touches it — so the foot of a waterfall was
 * the one piece of water on the map that churned less the harder it was hit.
 * Nought for the tidying-up calls, where nothing fell anywhere.
 */
function land(
  f: ColumnField, k: number, to: number, from: number, share: number, drop = 0,
) {
  const air = f.falls.air[k];
  if (air <= 0) return;
  const amount = air * share;
  f.falls.air[k] = air - amount;
  // A column takes the arriving material only if it had none — the rule
  // `addWater` would otherwise apply is "whatever arrived last", which would
  // let a trickle recolour a lake.
  const mat = f.depth[to] <= f.params.dryDepth ? f.material[from] : 0;

  // `to` is a SLOT and not a column, so the column has to come out of it
  // before anything that thinks in x and y is handed it.
  const col = to % f.cells, slot = (to / f.cells) | 0;
  const tx = col % f.nx, ty = (col / f.nx) | 0;

  if (drop > 0) {
    // It arrives at the speed a thing that fell that far arrives at, and what
    // it does with that is `plungeInto`. This is the whole difference between
    // a waterfall and a tap over a bowl.
    plungeInto(
      f, tx, ty, amount, mat, Math.sqrt(2 * FALL_GRAVITY * drop), slot,
    );
    return;
  }
  // The tidying-up calls: the cliff has gone, or the fall has caught its own
  // front. Nothing fell anywhere, so nothing lands on anything — but it is
  // still BANKED rather than added, for exactly the reason the plunge is. Put
  // straight into the depth it is a depth the NEXT landing reads, both for its
  // own material test and, through `besideAt`, for the drop that decides which
  // branch it takes. See `applyLandings`.
  f.landing[to] += amount;
  if (mat && amount > f.landBest[to]) {
    f.landBest[to] = amount;
    f.landMat[to] = mat;
  }
  include(f, tx, ty);
}

/**
 * The column a sheet off this lip actually reaches, `drop` half steps down.
 *
 * Water thrown off a lip travels while it falls, and it used to arrive in the
 * column immediately over the edge however far out the sheet had been drawn —
 * so the splash, the foam and the scoured pool all happened behind the sheet
 * that made them. Keeping that mismatch small is what held {@link FALL_THROW}
 * down to a tile a second, and a tile a second is what made the bend at every
 * lip too tight to see.
 *
 * Off the SMOOTHED launch, or the landing point hops about with the flux and
 * the pool it digs comes out as a smear rather than a hole.
 *
 * A target off the map, or one standing higher than the lip, falls back to the
 * column over the edge: a sheet that would hit a wall on the way down is not
 * modelled, and inventing it here is worse than landing the water short.
 */
export function landsAt(
  f: ColumnField, i: number, j: number, drop: number,
): number {
  const ox = Math.round(driftAt(f.falls.throwX[i], drop) / f.cell);
  const oy = Math.round(driftAt(f.falls.throwY[i], drop) / f.cell);
  if (ox === 0 && oy === 0) return j;
  // WITHIN THE SLOT IT WAS AIMED AT. A sheet drifting a column further out is
  // still falling into the same storey of the world, and a drift that changed
  // storey would be a sheet passing through a deck.
  const b = (j / f.cells) | 0, jc = j % f.cells;
  const jx = (jc % f.nx) + ox, jy = ((jc / f.nx) | 0) + oy;
  if (jx < 0 || jy < 0 || jx >= f.nx || jy >= f.ny) return j;
  const to = b * f.cells + jy * f.nx + jx;
  // Nor onto a slot that is not there: past the end of a span there is no
  // upper storey, and water aimed at one would arrive inside the hillside.
  if (f.roof[to] <= f.ground[to]) return j;
  return f.ground[to] < f.ground[i] ? to : j;
}

/**
 * THE SPRAY'S SCATTER, as a number both a CPU and a GPU can arrive at.
 *
 * This used to be `fract(sin(frontSpeed * 12.9898 + k * 78.233) * 43758.5453)`,
 * the hash everybody writes in a shader, and it cannot survive the crossing.
 * JavaScript does that arithmetic in f64 and WGSL does it in f32, and the
 * argument alone runs to millions: at edge 100000 it is 7823462.3725 in f64
 * and 7823462.5 exactly in f32, so `u` comes out 0.147 one side and 0.941 the
 * other. Not a rounding difference — a different number, before `sin` is even
 * reached, and `sin` of a few million is its own argument-reduction lottery.
 * It was also quietly degenerate on the CPU: past the point where `k * 78.233`
 * outruns the mantissa the "hash" is sampling a sine at aliased intervals.
 *
 * An INTEGER hash has none of that. A u32 multiply wraps, by definition, in
 * both languages — `Math.imul` here, plain `*` on `u32` there — so every step
 * is exact rather than nearly exact. The seed is the edge and the FLOAT'S OWN
 * BITS, which is the one way to read an f32 identically on both sides: no
 * arithmetic is done on the value, only on its pattern. And 24 bits over 2^24
 * lands exactly on an f32, so even the final division agrees to the last bit.
 *
 * The mixer is murmur3's finalizer. It is not a random number and does not
 * need to be: it needs to be spread out, and to be the same twice.
 */
const bitsF = new Float32Array(1);
const bitsU = new Uint32Array(bitsF.buffer);

export function scatterOf(k: number, speed: number, salt = 0): number {
  bitsF[0] = speed;
  let h = (bitsU[0] ^ Math.imul(k, 0x9e3779b9) ^ Math.imul(salt, 0x632be5ab)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = h ^ (h >>> 16);
  // The top 24, because the low bits of any multiply-shift mixer are the worst
  // ones — and 24 over 2^24 is exact in an f32.
  return (h >>> 8) / 16777216;
}

/**
 * Throw a drop off a breaking sheet.
 *
 * Where it leaves from is the sheet's own arc — {@link driftAt} with the lip's
 * speed, the same call the renderer makes to decide where to put the quad, so
 * the drop starts ON the sheet rather than beside it. What it does next is not
 * the sheet's business: it is a drop, it has the speed it had, and it falls.
 *
 * The scatter is a hash of the fall's own state rather than a random number,
 * so the same scene run twice sheds the same spray.
 *
 * IT DOES NOT CHANGE FROM STEP TO STEP, and this used to say it did — "because
 * `frontSpeed` does". `frontSpeed` is only integrated while the front is still
 * TRAVELLING, and a steady fall's front saturated at the drop long ago.
 * Measured over 200 steps of a fed waterfall, `frontSpeed` and `head` took one
 * distinct value each; `shed` and `air` took 200.
 *
 * So each edge sheds from a point of its own and keeps it. Milder than it
 * sounds — the hash mixes `k`, so a fall 240 edges wide scatters over 240
 * points — but they are 240 FIXED points, and spray that should shimmer
 * instead retraces the same trajectories.
 *
 * SEEDING IT ON `shed` WAS TRIED AND PUT BACK. It works, and it costs more
 * than it buys: the hash is built to turn a one-bit change into a completely
 * different number, so seeding it on a quantity that tracks the water makes
 * the spray a chaos amplifier. `compare.test` has a case that pins exactly
 * this — two solvers seeded one ULP apart must read as DRIFTING and not as
 * different, because a harness that calls a correct port broken gets switched
 * off — and with `shed` as the seed it read as different inside the horizon.
 *
 * What this wants is a seed that advances without tracking the water: a shed
 * counter per edge, or a frame index. Neither path carries one today, and
 * adding one means a new field in the device's fall state. That is the fix;
 * it is not a one-line one.
 */
function shedSpray(
  f: ColumnField, k: number, i: number, axis: number, back: boolean,
  dt: number, drop: number,
) {
  const s = f.falls;
  const loose = Math.min(1, (s.front[k] - BREAK) / BREAK);
  // Backed off as the drip list fills — see `dripRoom`. A fall sheds along
  // its whole width, so a rate that suits one off a notch asks for thousands
  // off one across the map.
  s.shed[k] += SHED * loose * f.room * dt;
  if (s.shed[k] < DROP) return;
  // A DROP, and not whatever has piled up in the bank. The rate puts a
  // fortieth of one in there per step, so the bank crosses the line somewhere
  // past it and letting the whole bank go would throw a drop a few percent
  // over the size anything is allowed to be. The rest stays owed.
  const take = Math.min(s.air[k], DROP);
  if (take <= 0) return;
  s.shed[k] -= take;
  s.air[k] -= take;

  const u = scatterOf(k, s.frontSpeed[k]);
  const v = scatterOf(k, s.frontSpeed[k], 1);
  // Out of the LOWER half of the sheet: the top of a nappe is still a sheet
  // and it is the part that has thinned and sped up that comes apart.
  const below = Math.min(drop, s.head[k] + (s.front[k] - s.head[k]) * (0.5 + 0.5 * v));
  // Tiles a second into columns a second: the arc does not care which, but
  // the drop lives in column space and the lip's speed is read in tiles.
  // The SMOOTHED launch, the same one the sheet is drawn on and the water
  // lands on, so a drop still leaves from where the sheet is.
  const lip = outward(axis === 0 ? f.falls.throwX[i] : f.falls.throwY[i], back) / f.cell;
  dropFrom(f, k, take, below, u, lip, f.material[i], back);
}

/**
 * WHERE A SHED DROP GOES, given what the sheet decided to throw.
 *
 * Its own function because the decision and the arc happen in different
 * places once the falls run on the device: the shader works out `take`,
 * `below`, the scatter and the lip, because all four read state that lives
 * there, and hands them back for the drip list — which is still the host's.
 * This is the half they share, and it is written once. @see drainSpawns
 *
 * `lip` and `material` are passed rather than read off `f` for the same
 * reason: on the device path the host's copies of `throwX` and `material` are
 * a frame behind, and a drop leaving from where the sheet USED to be is the
 * sort of seam that takes an afternoon to see.
 */
export function dropFrom(
  f: ColumnField, k: number, take: number, below: number, u: number,
  lip: number, material: number, back = false,
) {
  // The plane, then the edge inside it — see `fallEdge`. The drop comes off
  // the slot the sheet LEFT, so the height it starts at is that slot's floor.
  //
  // WHICH OF THE EDGE'S TWO COLUMNS THAT IS depends on which way the water
  // went over it: `back` means it left the column on the high-index side,
  // so the drop starts there and the arc runs the other way. @see dropAt
  const pl = (k / (f.cells * 2)) | 0;
  const rest = k - pl * f.cells * 2;
  const e = rest >> 1, axis = rest & 1;
  const step = back ? (axis === 0 ? 1 : f.nx) : 0;
  const i = e + step;
  const ia = ((pl / f.layers) | 0) * f.cells + i;
  const x = i % f.nx, y = (i / f.nx) | 0;
  const out = driftAt(lip, below);
  const side = (u - 0.5) * FAN;
  dripFrom(
    f.drips,
    axis === 0 ? x + 0.5 + out : x + side,
    axis === 0 ? y + side : y + 0.5 + out,
    f.ground[ia] - below,
    take, material,
    axis === 0 ? lip : side * FAN,
    axis === 0 ? side * FAN : lip,
    Math.sqrt(2 * FALL_GRAVITY * below),
  );
}

function reset(s: FallState, k: number) {
  s.front[k] = 0;
  s.head[k] = 0;
  s.frontSpeed[k] = 0;
  s.headSpeed[k] = 0;
  s.since[k] = CLING;
}

/** Widen the active box to cover a column that has just been landed on. */
function include(f: ColumnField, x: number, y: number) {
  const b = f.box;
  if (b.x1 < b.x0) { b.x0 = x; b.x1 = x; b.y0 = y; b.y1 = y; return; }
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
}

/** Every drop in the air, anywhere. */
export function waterInAir(f: ColumnField): number {
  let sum = 0;
  for (let k = 0; k < f.falls.air.length; k++) sum += f.falls.air[k];
  return sum;
}

/**
 * Is anything in the air off this edge?
 *
 * The cheap half of {@link fallExtent}, which allocates to hand back the two
 * numbers. Asking about a NEIGHBOUR is the common case — anything drawing a
 * fall has to know whether the column beside it has one too, to decide what
 * the two of them share along the lip between them — and that asks twice per
 * fall per frame for an answer that is a comparison.
 */
export const falling = (f: ColumnField, i: number, axis: number, p = 0) => {
  const k = fallEdge(f, i, axis, p);
  return f.falls.front[k] > f.falls.head[k];
};

/**
 * How far down its wall a fall has got, or null where there is no fall.
 *
 * `p` is the slot PAIR — see `fallEdge`. A fall off the side of a bridge is
 * on the plane from the deck to the ground beside it, and asking plane zero
 * about it answers about the river underneath instead.
 */
export function fallExtent(f: ColumnField, i: number, axis: number, p = 0) {
  const k = fallEdge(f, i, axis, p);
  const head = f.falls.head[k], front = f.falls.front[k];
  return front > head ? { head, front } : null;
}
