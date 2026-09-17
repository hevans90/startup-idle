/**
 * Water falling in DROPS, from a pipe or anything else with a mouth.
 *
 * A fall (see `falls.ts`) is a sheet going over a lip: it has a head and a
 * front and it is tied to the edge between two columns. A drip is not that. It
 * is a parcel of water in free flight, with nothing above it and nothing
 * below it, and it exists between leaving a mouth and hitting a surface.
 *
 * WHAT MAKES A DRIP A DRIP. A drop hanging at a nozzle grows until its weight
 * beats the surface tension holding it on, and then it lets go — always at
 * about the same size, because both sides of that balance are fixed by the
 * nozzle. That is Tate's law, `V = pi d sigma / (rho g)`, and the useful part
 * of it here is that the volume is a CONSTANT: a mouth accumulates, and every
 * time it has a drop's worth it releases one. Slow flow gives slow regular
 * dripping; fast flow gives drops faster than they can separate, which is a
 * stream. One rule, and the change between the two is not a mode anyone had to
 * write — it falls out of the rate.
 *
 * The size is a game quantity and it is worth saying so plainly. A real drop
 * is four millimetres across, which over a tile of a couple of metres is a
 * depth of about eight nanometres — invisible, and always would be. What is
 * faithful here is the SHAPE of the behaviour: accumulate, detach at a fixed
 * size, fall freely, land and splash. The size is chosen so you can see it.
 *
 * A DROP IS NOT A BEAD, and this is the part that used to be missing. Four
 * things happen to one between the mouth and the water, and all four are here:
 *
 *   1. It HANGS and grows, and the neck holding it thins as it does, until the
 *      neck cannot carry the weight and pinches. The hanging drop is the
 *      mouth's `held` — the same number Tate's law is counted in — so it costs
 *      nothing to know about; what was missing was anywhere to look it up, and
 *      that is what the mouth list here is for.
 *   2. It RINGS. A drop that has just let go is stretched, not round, and
 *      surface tension is a restoring force: it oscillates prolate to oblate
 *      and back at the Rayleigh frequency, dying away as it goes. See
 *      {@link WOBBLE}.
 *   3. It FALLS, and can be thrown sideways as well as dropped, which is what
 *      makes a crown possible.
 *   4. It LANDS, and what happens then is not this file's business — it is the
 *      solver's, because a drop hitting water displaces it. What comes back
 *      here is the volume the surface threw off as SPRAY, which is the crown,
 *      and those droplets are drops like any other.
 *
 * The water is really in the air while it falls, the same as it is for a fall:
 * it leaves the mouth, it is not in the column below until it arrives, and
 * `totalWater` counts it in between. A drop that vanished for half a second on
 * its way down would be a leak, and a sim that leaks is one you cannot reason
 * about.
 */
import { FALL_GRAVITY } from "./falls";

/**
 * How much water is in one drop, in half steps over a column.
 *
 * The nozzle constant. Everything about how a pipe behaves comes out of this
 * against its rate: a pipe putting out this much per second drips once a
 * second, one putting out ten times as much drips ten times a second and reads
 * as a stream.
 */
export const DROP = 0.25;

/**
 * How many drops may be in the air at once, over the whole map.
 *
 * A cap rather than a growing list, because this runs every frame and a pipe
 * left on for an hour should cost what a pipe left on for a second costs. When
 * it is full a new drop COALESCES into the oldest one rather than replacing
 * it: two drops that meet become one drop, which is a thing drops do, and it
 * is the only option of the three that does not leak. (Replacing the slot lost
 * the water outright — the note here used to claim the old drop landed early,
 * and nothing landed it.)
 */
const MAX_DRIPS = 1024;

/** How many mouths may be hanging a drop at once. */
const MAX_MOUTHS = 256;

/** How white a drop's arrival makes the water, per unit of volume. */
const SPLASH = 3;

/** How long a splash mark lasts before the foam has to have taken it. */
export const SPLASH_LIFE = 0.15;

/**
 * How fast a drop of {@link DROP}'s size rings, in radians a second.
 *
 * A drop that has just pinched off is not a sphere and does not quietly become
 * one: surface tension is a restoring force and the drop OSCILLATES on it,
 * prolate to oblate and back, at the Rayleigh frequency
 * `omega^2 = n(n-1)(n+2) sigma / (rho a^3)` — for the n = 2 mode, the one you
 * can see, `8 sigma / (rho a^3)`. A real four millimetre drop rings at about
 * fifty hertz, which at sixty frames a second is a blur; this is slowed to
 * something the eye can follow, the same bargain {@link DROP} makes about size.
 *
 * What is KEPT is the scaling. The frequency goes as `a^-3/2` and volume goes
 * as `a^3`, so it goes as `1/sqrt(V)` — which is why this is a frequency at a
 * given volume rather than a constant, and why a fleck thrown off a crown
 * visibly shivers faster than the drop that made it without being told to.
 */
const WOBBLE = 2 * Math.PI * 5.5;

/**
 * How fast the ringing dies, as a fraction of critical damping.
 *
 * Real damping scales too — `tau = rho a^2 / ((2n+1)(n-1) mu)` — so a small
 * drop should also settle sooner in absolute time. It nearly does anyway: this
 * is a damping RATIO, so a fleck ringing at three times the frequency dies in
 * a third of the seconds. The remaining `a^2` is not worth another pow() in a
 * per-drop loop for something that lasts a quarter of a second.
 */
const WOBBLE_DAMP = 0.11;

/**
 * The most a drop may turn through in one step, in radians.
 *
 * The semi-implicit integrator is stable while `w * dt` is under about two,
 * and sampling gives out before that: at pi the drop is at the frame rate's
 * Nyquist and there is nothing left to see. Under both, with room.
 *
 * A whole `DROP` at sixty frames sits at 0.58, so nothing ordinary is touched
 * by this — it only ever binds on the small end, where the shape was
 * unrepresentable anyway. @see wobbleOf
 */
const WOBBLE_STEP = 1.5;

/**
 * How stretched a drop is at the moment the neck lets go, as a fraction of its
 * radius.
 *
 * Not a free parameter so much as an observation: the neck pulls the drop long
 * before it breaks, so a drop starts its life prolate and at rest, which is
 * exactly a plucked string. Everything the wobble does follows from releasing
 * it there.
 */
const PINCH = 0.5;

/**
 * How much a drop's shape is dragged out by its own speed.
 *
 * This one is NOT a shape: it is motion blur, drawn. A real drop at these
 * speeds stays round — what makes rain look like lines is a camera's exposure,
 * and the eye's, smearing a moving point over the time it is looked at. With
 * no motion blur in the pipeline the smear has to be geometry, so a fast drop
 * is stretched along its own velocity by this much of the distance it covers
 * in a second. It is kept separate from the ringing above because they are
 * different claims: one is what the drop IS, the other is what it LOOKS like.
 */
export const STREAK = 1 / 45;

/**
 * Air drag on a drop, per second, at {@link DROP}'s size.
 *
 * Only worth having because of the crown. A drop falling straight down reaches
 * the water in well under a second and drag changes nothing anyone can see; a
 * fleck thrown sideways at speed arcs, and without drag it sails. Small drops
 * slow down far faster than big ones — Stokes drag on a sphere is `6 pi mu a v`
 * against a mass going as `a^3`, so the deceleration goes as `a^-2`, and
 * `a^-2` in volume is `V^-2/3`. That is the scaling used, so the crown's
 * finest flecks stop almost at once and the fat ones carry.
 */
const AIR_DRAG = 0.9;

/**
 * The crown: how a landing throws spray, and how much of it there is.
 *
 * A drop hitting deep enough water does not simply merge. It punches a crater,
 * the walls of that crater rise into a ring, and past a threshold the ring's
 * rim is unstable and throws droplets off it — a crown. The threshold is a
 * Weber number, `We = rho v^2 d / sigma`, of about forty; below it you get a
 * ripple and nothing leaves the surface. Here the solver decides how much
 * spray a landing is worth, because only it knows how deep the water is; this
 * end decides what to do with the volume it is handed.
 *
 * `CROWN_MOST` is the ceiling on flecks per landing. A real crown throws a
 * dozen or more, and a dozen parcels of a fifth of a drop each, at this size,
 * is a cloud of specks that reads as noise.
 */
const CROWN_MOST = 5;

/**
 * How fast spray leaves, outward and upward, against the speed that made it.
 *
 * Beware the units, which is what got these wrong the first time. A drop's
 * fall is measured in HALF STEPS a second and its travel across the map in
 * COLUMNS a second, and they are not the same thing: the projection draws a
 * half step at an eighth of a tile, which is half a column, so that is the
 * rate a vertical speed converts to a horizontal one at. Used raw, an impact
 * at fifty threw flecks at fourteen columns a second and the crown came down
 * three tiles away — which on a cliff meant a steady drizzle landing back on
 * top of the cliff, and a puddle growing on the ledge above the waterfall.
 *
 * With the conversion in, a crown lands about a column out, which is what a
 * crown does: its rim is a fraction of the drop's own diameter across, and
 * everything it throws comes down more or less on top of the splash.
 */
export const ACROSS = 0.5;
const CROWN_OUT = 0.09 * ACROSS;
const CROWN_UP = 0.42;

export type DripState = {
  /** Columns across the map, so a splash knows where to be marked. */
  readonly nx: number;
  /** Column the drop is over, and how high it is above the map's floor. */
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  readonly z: Float32Array;
  /** Speed: down, and across, in half steps and columns a second. */
  readonly vz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /**
   * The n = 2 shape ringing: how far from round the drop is, and how fast that
   * is changing. Positive is prolate — long in the direction it is falling.
   */
  readonly shape: Float32Array;
  readonly shaken: Float32Array;
  /** What is in it, and what it is made of. */
  readonly volume: Float32Array;
  readonly material: Uint8Array;
  /** How many of the slots are in use. Live drops are packed at the front. */
  live: number;
  /**
   * The drops that have NOT let go yet: one per mouth with anything hanging.
   *
   * Rebuilt every frame by whatever is running the mouths, because it is a
   * view of them rather than a thing with a life of its own. A hanging drop is
   * the mouth's own pending volume and always was — this is only somewhere for
   * a renderer to find it, which is what it takes for the growing and the
   * necking to be visible rather than implied.
   */
  readonly mcx: Float32Array;
  readonly mcy: Float32Array;
  readonly mz: Float32Array;
  readonly mheld: Float32Array;
  readonly mmaterial: Uint8Array;
  mouths: number;
  /**
   * Where a drop landed since the renderer last looked, and how hard.
   *
   * A splash is not something the solver can work out for itself: a drop
   * arrives through `addWater` rather than through the divergence, so the
   * surface rate the breaking test reads never sees it. Kept here for the foam
   * to pick up, and cleared when it does.
   */
  readonly splash: Float32Array;
  /**
   * WHICH COLUMNS CARRY A MARK, so fading them is not a walk of the map.
   *
   * A mark goes on the list when its column goes from nothing to something and
   * comes off when it fades back to nothing, so the list is exactly the
   * non-zero entries of {@link splash} and can hold every one of them. Fading
   * them used to be sixty five thousand columns every frame to touch the few
   * hundred that had anything on them, and it ran on exactly the frames the
   * map was busiest — a mark only exists while water is arriving.
   */
  readonly lit: Int32Array;
  nlit: number;
  /** Whether there is any mark at all. Kept with {@link lit}, never apart. */
  splashed: boolean;
  /** Turns the next crown by a bit, so two landings do not throw alike. */
  spun: number;
};

export function createDrips(nx: number, ny: number): DripState {
  return {
    nx,
    cx: new Float32Array(MAX_DRIPS),
    cy: new Float32Array(MAX_DRIPS),
    z: new Float32Array(MAX_DRIPS),
    vz: new Float32Array(MAX_DRIPS),
    vx: new Float32Array(MAX_DRIPS),
    vy: new Float32Array(MAX_DRIPS),
    shape: new Float32Array(MAX_DRIPS),
    shaken: new Float32Array(MAX_DRIPS),
    volume: new Float32Array(MAX_DRIPS),
    material: new Uint8Array(MAX_DRIPS),
    live: 0,
    mcx: new Float32Array(MAX_MOUTHS),
    mcy: new Float32Array(MAX_MOUTHS),
    mz: new Float32Array(MAX_MOUTHS),
    mheld: new Float32Array(MAX_MOUTHS),
    mmaterial: new Uint8Array(MAX_MOUTHS),
    mouths: 0,
    splash: new Float32Array(nx * ny),
    lit: new Int32Array(nx * ny),
    nlit: 0,
    splashed: false,
    spun: 0,
  };
}

/**
 * How much room is left for more drops, from one down to nothing.
 *
 * Anything that makes spray has to know. A waterfall sheds along its whole
 * width, so the same rate that gives a four tile fall a convincing amount of
 * it asks for two thousand drops off a fall across the map — and the list is a
 * thousand long, past which a new drop is merged into an existing one and
 * arrives somewhere it never was. Backing the rate off as the list fills means
 * a small fall gets all the detail there is and a huge one thins out, which is
 * the right way round: nobody counts the drops in a curtain sixty tiles wide.
 */
export const dripRoom = (d: DripState) =>
  Math.max(0, 1 - d.live / MAX_DRIPS);

/** Every drop in the air, anywhere — not counting what is still hanging on. */
export function waterInDrips(d: DripState): number {
  let sum = 0;
  for (let k = 0; k < d.live; k++) sum += d.volume[k];
  return sum;
}

/**
 * How fast a drop of this volume rings. See {@link WOBBLE}.
 *
 * Exported because the renderer has to draw the shape this produces and there
 * should be one statement of it, not two that drift.
 */
export const wobbleOf = (volume: number) => WOBBLE * Math.sqrt(DROP / Math.max(1e-6, volume));

/**
 * Let go of a drop at a mouth.
 *
 * `z` is where the mouth is, in half steps, and the drop starts there at rest
 * — a drop does not leave a nozzle with any speed of its own, it simply stops
 * being held. It does not start ROUND, though: the neck stretched it on the
 * way out, so it begins prolate and still, and rings from there.
 */
export function dripFrom(
  d: DripState, cx: number, cy: number, z: number, volume: number, material: number,
  vx = 0, vy = 0, vz = 0, stretch = PINCH,
): void {
  if (volume <= 0) return;
  if (d.live >= MAX_DRIPS) {
    // Full. Two drops that meet become one drop; the alternative is losing it.
    d.volume[0] += volume;
    return;
  }
  const k = d.live++;
  d.cx[k] = cx;
  d.cy[k] = cy;
  d.z[k] = z;
  d.vz[k] = vz;
  d.vx[k] = vx;
  d.vy[k] = vy;
  d.shape[k] = stretch;
  d.shaken[k] = 0;
  d.volume[k] = volume;
  d.material[k] = material;
}

/**
 * Advance every drop, and land the ones that have arrived.
 *
 * Free fall under the same gravity a sheet going over a lip uses, because it
 * is the same gravity — the solver's own is a pressure gradient in tiles and
 * has nothing to say about anything falling.
 *
 * A drop lands when it reaches the SURFACE below it, which is the ground plus
 * whatever water is standing on it, so a pipe over a filling pool has a
 * shorter and shorter fall as the pool comes up to meet it. Ground out of
 * bounds is treated as a floor at the drop's own column, which only matters
 * for a mouth hanging off the edge of the map.
 *
 * `land` is handed in rather than imported so this file knows nothing about
 * columns: it is a bag of parcels and a rule for falling, and where the water
 * goes when it stops is the caller's business. What it hands BACK is the
 * volume the surface refused — the crown — which is spray, which is drops, and
 * so comes straight back here.
 */
export function stepDrips(
  d: DripState, dt: number,
  surfaceAt: (cx: number, cy: number) => number,
  land: (cx: number, cy: number, volume: number, material: number, speed: number) => number,
): void {
  let k = 0;
  while (k < d.live) {
    const volume = d.volume[k];
    // Down, and along, and the drag that only matters to anything thrown.
    d.vz[k] += FALL_GRAVITY * dt;
    const slow = Math.max(0, 1 - AIR_DRAG * Math.pow(DROP / Math.max(1e-6, volume), 2 / 3) * dt);
    d.vx[k] *= slow;
    d.vy[k] *= slow;
    d.z[k] -= d.vz[k] * dt;
    // Sideways, unless there is ROCK sideways. The landing test below asks
    // what the surface is under the drop and puts the water there, so a drop
    // drifting past a cliff at half its height finds the cliff top under it
    // and lands on top of the cliff — water that climbed, out of nothing.
    // A drop that hits a wall has hit a wall: it loses what it was carrying
    // sideways and runs down the face, which is also what one does.
    const ax = d.cx[k] + d.vx[k] * dt, ay = d.cy[k] + d.vy[k] * dt;
    if (surfaceAt(ax, ay) > d.z[k]) {
      d.vx[k] = 0;
      d.vy[k] = 0;
    } else {
      d.cx[k] = ax;
      d.cy[k] = ay;
    }

    // The ringing: a damped harmonic oscillator, integrated semi-implicitly so
    // it cannot gain energy at a long step the way the explicit form does.
    //
    // SEMI-IMPLICIT IS NOT UNCONDITIONALLY STABLE, which is the trap. It holds
    // while `w * dt` stays under about two and comes apart above it, and
    // `wobbleOf` goes as the inverse square root of the volume — so the
    // smaller the drop the faster it rings. A crown fleck at a five-hundredth
    // of `DROP` rings at 773 radians a second, which is `w * dt` of 12.9 at
    // sixty frames: measured, its shape grew by about 167x a step and reached
    // NaN inside forty frames. From there it is NaN in a vertex buffer, and
    // the renderer's own clamp does not stop it — `min` and `max` PASS NaN.
    //
    // Clamped, and not merely for stability. Past `w * dt` of pi there is no
    // oscillation left to sample: the frame rate cannot show a ringing faster
    // than twice its own, so a fleck ringing at 123 Hz drawn at 60 shows
    // aliasing whatever the arithmetic does. Holding it at {@link WOBBLE_STEP}
    // draws the fastest ring the frame can actually carry.
    const w = Math.min(wobbleOf(volume), WOBBLE_STEP / dt);
    d.shaken[k] -= (w * w * d.shape[k] + 2 * WOBBLE_DAMP * w * d.shaken[k]) * dt;
    d.shape[k] += d.shaken[k] * dt;

    const cx = d.cx[k], cy = d.cy[k];
    if (d.z[k] > surfaceAt(cx, cy)) { k++; continue; }

    // Arrived. The water goes in, and the fact that it arrived is left for the
    // foam — it came through the side door and the surface rate never saw it.
    const hit = d.vz[k];
    const mat = d.material[k];
    // Clamped, and deliberately. A landing may keep all of what it was given
    // or throw some of it back, and nothing else: a surface that returned more
    // than it was handed would be making water, and the caller is the only one
    // who could notice.
    const spray = Math.min(volume, Math.max(0, land(cx, cy, volume, mat, hit)));
    // A drop's arrival, left for the foam to pick up. Bigger drops splash
    // harder, up to as white as anything gets.
    markSplash(d, Math.round(cy) * d.nx + Math.round(cx), volume * SPLASH);

    // Swap the last live drop into this slot rather than shuffling the rest;
    // nothing here cares what order they are in.
    d.live--;
    if (k !== d.live) {
      d.cx[k] = d.cx[d.live];
      d.cy[k] = d.cy[d.live];
      d.z[k] = d.z[d.live];
      d.vz[k] = d.vz[d.live];
      d.vx[k] = d.vx[d.live];
      d.vy[k] = d.vy[d.live];
      d.shape[k] = d.shape[d.live];
      d.shaken[k] = d.shaken[d.live];
      d.volume[k] = d.volume[d.live];
      d.material[k] = d.material[d.live];
    }
    // And the crown, AFTER the slot has been closed up, so the flecks go on
    // the end of the list and this loop does not have to walk them again.
    if (spray > 0) crown(d, cx, cy, surfaceAt(cx, cy), spray, mat, hit);
  }
}

/**
 * Throw the spray a landing made, as drops.
 *
 * Evenly round the circle and tilted up, because that is what a crown's rim
 * does — it is a ring of liquid thrown outward and upward, and it breaks into
 * flecks along its length. Turned a little each time so two landings on the
 * same spot do not throw the same star.
 */
export function crown(
  d: DripState, cx: number, cy: number, z: number,
  spray: number, material: number, hit: number,
): void {
  const many = Math.max(1, Math.min(CROWN_MOST, Math.round(spray / (DROP * 0.12))));
  const each = spray / many;
  const turn = (d.spun++ * 2.39996) % (2 * Math.PI);   // the golden angle
  for (let n = 0; n < many; n++) {
    const a = turn + (n * 2 * Math.PI) / many;
    dripFrom(
      d, cx, cy, z + 0.02, each, material,
      Math.cos(a) * hit * CROWN_OUT, Math.sin(a) * hit * CROWN_OUT,
      -hit * CROWN_UP,                          // negative is up: vz is down
      PINCH * 1.6,                              // torn off, so badly out of round
    );
  }
}

/**
 * Fade the splash marks, and say whether any are left.
 *
 * The renderer reads them as foam is BORN, and foam carries and decays on its
 * own clock from there — so these only have to last long enough to be picked
 * up, and a mark that lingered would go on making foam out of a drop that
 * landed a second ago.
 */
export function fadeSplashes(d: DripState, dt: number): void {
  if (d.nlit === 0) return;
  const keep = Math.exp(-dt / SPLASH_LIFE);
  // Compacted in place: the ones still lit are written back over the front of
  // the list as it is read, so a mark that has faded out simply is not carried
  // forward. Reading and writing the same array at the same index is safe
  // because the write never gets ahead of the read.
  let n = 0;
  for (let k = 0; k < d.nlit; k++) {
    const i = d.lit[k];
    const was = d.splash[i] * keep;
    if (was < 0.01) { d.splash[i] = 0; continue; }
    d.splash[i] = was;
    d.lit[n++] = i;
  }
  d.nlit = n;
  d.splashed = n > 0;
}

/**
 * Mark a column where water arrived, at `white` or whatever it already had.
 *
 * THE ONE WAY IN, and the reason it is one: a mark is three things that have
 * to agree — the value, the list it is fading from, and the flag the renderer
 * and the device upload both gate on. Written by hand they did not agree.
 * `plungeInto` set the value and left the flag alone, so the whiteness under
 * every waterfall was invisible to the foam, was never faded because the fade
 * returned early, and then appeared all at once the moment some unrelated drop
 * landed and turned the flag on. A mark placed through here cannot do that.
 */
export function markSplash(d: DripState, i: number, white: number): void {
  if (i < 0 || i >= d.splash.length) return;
  const had = d.splash[i];
  if (white <= had) return;
  if (had <= 0) d.lit[d.nlit++] = i;
  d.splash[i] = white < 1 ? white : 1;
  d.splashed = true;
}

/**
 * A mouth that water comes out of: how much it has pending, and what it does
 * with it.
 *
 * Kept as a plain number by the caller — one per pipe — because the whole of a
 * nozzle's state is how much of a drop it has grown so far.
 */
export type Pending = { held: number };

/** Start a frame's mouths. Whoever runs them rebuilds the list every frame. */
export function resetMouths(d: DripState): void {
  d.mouths = 0;
}

/**
 * Run a mouth for `dt`, letting go of however many drops it has grown.
 *
 * Accumulate, and release while there is a drop's worth. At a low rate that is
 * one drop every few frames and most frames release nothing; at a high rate it
 * is several a frame, which is a stream. The remainder stays hanging for next
 * time, so the average rate out is exactly the rate in — no drop is invented
 * by rounding and none is lost to it.
 *
 * The remainder is also the drop you can SEE hanging there, so the mouth is
 * recorded whether or not it let go of anything this step. That is the whole
 * difference between a pipe that emits beads and a pipe that drips: the second
 * one shows you the drop growing and the neck going before it falls.
 *
 * `MANY` is a ceiling on how many parcels one mouth may put in the air in one
 * step. Past it the rest goes out as ONE fatter drop rather than as a queue of
 * parcels nobody can tell apart: a fire hose is not a thousand drips, and
 * pretending it is costs a thousand slots to draw something that reads as a
 * column of water either way.
 */
const MANY = 4;

export function runMouth(
  d: DripState, pending: Pending, rate: number, dt: number,
  cx: number, cy: number, z: number, material: number,
): void {
  if (rate > 0) {
    pending.held += rate * dt;
    if (pending.held >= DROP) {
      const drops = Math.floor(pending.held / DROP);
      if (drops <= MANY) {
        for (let n = 0; n < drops; n++) dripFrom(d, cx, cy, z, DROP, material);
      } else {
        for (let n = 0; n < MANY - 1; n++) dripFrom(d, cx, cy, z, DROP, material);
        dripFrom(d, cx, cy, z, DROP * (drops - MANY + 1), material);
      }
      pending.held -= drops * DROP;
    }
  }
  if (d.mouths < MAX_MOUTHS) {
    const m = d.mouths++;
    d.mcx[m] = cx;
    d.mcy[m] = cy;
    d.mz[m] = z;
    d.mheld[m] = pending.held;
    d.mmaterial[m] = material;
  }
}
