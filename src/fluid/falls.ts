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
import { flowX, flowY, plungeInto, type ColumnField } from "./columns";
import { DROP, dripFrom, dripRoom } from "./drips";

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

/** The lip speed a fall actually gets to use: outward only, and capped. */
export const throwOf = (speed: number) =>
  Math.min(FALL_THROW, Math.max(0, speed));

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

export function createFalls(nx: number, ny: number): FallState {
  const n = nx * ny * 2;
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
    throwX: new Float32Array(nx * ny),
    throwY: new Float32Array(nx * ny),
    cliff: new Int32Array(n),
    cliffN: 0,
    cliffCol: new Uint8Array(nx * ny),
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
export function markCliffs(f: ColumnField) {
  const { nx, ny, ground } = f;
  const s = f.falls;
  const { air, front } = s;
  let n = 0;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      const k = i * 2;
      const was = s.cliffCol[i];
      let own = 0;
      if (x + 1 < nx
        && (ground[i] - ground[i + 1] >= FALL_MIN || air[k] > 0 || front[k] > 0)) {
        s.cliff[n++] = k;
        own = 1;
      }
      if (y + 1 < ny
        && (ground[i] - ground[i + nx] >= FALL_MIN
          || air[k + 1] > 0 || front[k + 1] > 0)) {
        s.cliff[n++] = k + 1;
        own = 1;
      }
      s.cliffCol[i] = own;
      if (own && !was) {
        s.throwX[i] = throwOf(flowX(f, x, y));
        s.throwY[i] = throwOf(flowY(f, x, y));
      }
    }
  }
  s.cliffN = n;
}

/** The smoothed launch at a column, as a pair. @see FallState.throwX */
export const throwAt = (f: ColumnField, i: number) =>
  ({ x: f.falls.throwX[i], y: f.falls.throwY[i] });

/** Where a neighbour's water, or failing that its ground, stands. */
export const besideAt = (f: ColumnField, j: number) =>
  f.depth[j] > f.params.dryDepth ? f.ground[j] + f.depth[j] : f.ground[j];

/**
 * How far water leaving column `i` over one of its edges would fall, or 0
 * where that is a step in a river rather than a cliff.
 *
 * Read off the GROUND on the far side, not its surface: a pool at the foot of
 * a cliff shortens the fall, and once it is deep enough there is no fall left.
 */
export function dropAt(f: ColumnField, i: number, axis: number): number {
  const x = i % f.nx, y = (i / f.nx) | 0;
  const jx = axis === 0 ? x + 1 : x, jy = axis === 0 ? y : y + 1;
  if (jx >= f.nx || jy >= f.ny) return 0;
  const drop = f.ground[i] - besideAt(f, jy * f.nx + jx);
  return drop >= FALL_MIN ? drop : 0;
}

/** Hold `amount` in the air on an edge rather than landing it. */
export function intoAir(f: ColumnField, i: number, axis: number, amount: number) {
  f.falls.air[i * 2 + axis] += amount;
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
  const { nx, depth, params } = f;
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
  let lastCol = -1;
  for (let n = 0; n < s.cliffN; n++) {
      const k = s.cliff[n];
      const i = k >> 1, axis = k & 1;
      const x = i % nx, y = (i / nx) | 0;
      // The box still decides, exactly as it did: a cliff outside it is one
      // the solver is not looking at this step.
      if (x < region.x0 || x > region.x1 || y < region.y0 || y > region.y1) continue;
      // The smoothed launch, followed once per column — see `FallState.throwX`.
      // Every edge of it, the renderer and the spray all read this, so there
      // is one arc and it does not chatter. Once per column and not once per
      // edge: the set is in column order, so a column's two edges are adjacent.
      if (i !== lastCol) {
        s.throwX[i] += (throwOf(flowX(f, x, y)) - s.throwX[i]) * ease;
        s.throwY[i] += (throwOf(flowY(f, x, y)) - s.throwY[i]) * ease;
        lastCol = i;
      }
      {
        const jx = axis === 0 ? x + 1 : x, jy = axis === 0 ? y : y + 1;
        const j = jy * nx + jx;
        const drop = f.ground[i] - besideAt(f, j);
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
          land(f, k, j, i, Math.min(1, dt / DROWN));
          reset(s, k);
          continue;
        }

        const flux = axis === 0 ? f.fx[i] : f.fy[i];
        s.since[k] = flux > 0 && depth[i] > params.dryDepth ? 0 : s.since[k] + dt;

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
        if (s.front[k] > BREAK && s.air[k] > 0) shedSpray(f, k, i, axis, dt, drop);

        // NOTHING lands until the front gets there. After that it leaves the
        // air at the rate it is arriving, which in a steady fall is the rate
        // it went over — the time constant is the time the fall takes.
        if (s.front[k] >= reach && s.air[k] > 0) {
          const fall = Math.sqrt((2 * drop) / FALL_GRAVITY);
          // Where the SHEET gets to, not the column over the edge.
          land(f, k, landsAt(f, i, j, drop), i, Math.min(1, dt / fall), drop);
        }
        // Caught its own front, or fallen past the bottom: nothing is left of
        // it, and anything still in the air has landed by now.
        if (s.head[k] >= s.front[k] || s.head[k] >= reach) {
          land(f, k, j, i, 1);
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

  if (drop > 0) {
    // It arrives at the speed a thing that fell that far arrives at, and what
    // it does with that is `plungeInto`. This is the whole difference between
    // a waterfall and a tap over a bowl.
    plungeInto(
      f, to % f.nx, (to / f.nx) | 0, amount, mat, Math.sqrt(2 * FALL_GRAVITY * drop),
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
  include(f, to % f.nx, (to / f.nx) | 0);
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
  const jx = (j % f.nx) + ox, jy = ((j / f.nx) | 0) + oy;
  if (jx < 0 || jy < 0 || jx >= f.nx || jy >= f.ny) return j;
  const to = jy * f.nx + jx;
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
  f: ColumnField, k: number, i: number, axis: number, dt: number, drop: number,
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
  const lip = (axis === 0 ? f.falls.throwX[i] : f.falls.throwY[i]) / f.cell;
  dropFrom(f, k, take, below, u, lip, f.material[i]);
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
  lip: number, material: number,
) {
  const i = k >> 1, axis = k & 1;
  const x = i % f.nx, y = (i / f.nx) | 0;
  const out = driftAt(lip, below);
  const side = (u - 0.5) * FAN;
  dripFrom(
    f.drips,
    axis === 0 ? x + 0.5 + out : x + side,
    axis === 0 ? y + side : y + 0.5 + out,
    f.ground[i] - below,
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
export const falling = (f: ColumnField, i: number, axis: number) =>
  f.falls.front[i * 2 + axis] > f.falls.head[i * 2 + axis];

/** How far down its wall a fall has got, or null where there is no fall. */
export function fallExtent(f: ColumnField, i: number, axis: number) {
  const k = i * 2 + axis;
  const head = f.falls.head[k], front = f.falls.front[k];
  return front > head ? { head, front } : null;
}
