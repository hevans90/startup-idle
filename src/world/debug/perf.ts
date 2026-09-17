/**
 * World v2 — where a frame's time went.
 *
 * Four numbers, and it matters which is which, because they answer different
 * questions and only one of them is the renderer's.
 *
 *   SOLVE   the water stepping. On the host path this is the biggest single
 *           cost in the whole frame and it is not drawing; on the device it is
 *           about a tenth of a millisecond, and the render is what is left.
 *   BUILD   turning the simulation into geometry. On the shader path that is
 *           a handful of uniforms and the falls; on `?cpuwater=1` it is a
 *           quarter of a million corners, which is what the shader path was
 *           written to stop paying.
 *   PRESENT the render call — AND THE WAIT INSIDE IT. It walks the scene and
 *           hands the commands over, but it also blocks on the compositor
 *           having a buffer free, so on a quiet frame most of what it reads is
 *           idle. Measured on one map, dry against flooded: solve 0.13 -> 8.94
 *           and present 3.25 -> 1.16. It went DOWN as the frame filled up,
 *           which is the signature of slack and not of work. Called `submit`
 *           at first, which had me chasing a render cost that does not exist
 *           while the real number on a flooded map is the solver.
 *   FRAME   the interval between frames, which is what FPS is made of.
 *
 * THE LAST LINE IS `frame - js`, the time nobody in JavaScript accounted for —
 * vsync when it sits near the refresh interval, the GPU falling behind when it
 * does not. Labelled as the estimate it is rather than as a measurement it is
 * not.
 *
 * It used to say the GPU's own time could not be had at all, because
 * `timestamp-query` must be asked for when a device is created and the device
 * was Pixi's. It is not Pixi's any more — `render/device` makes it, with that
 * feature where it exists, and hands it over. `__gpuTime` reads the real
 * per-pass cost. This estimate is kept because it is the one number available
 * on every path, including WebGL. @see openDevice, holdStamps
 *
 * Rolling averages, because a single frame is mostly noise: a garbage
 * collection or a scheduler hiccup swamps the thing being measured, and what
 * anyone wants off a readout like this is the shape of the cost, not one
 * sample of it.
 */
export type PerfSlot = "solve" | "build" | "present";

const SLOTS: PerfSlot[] = ["solve", "build", "present"];
/** Frames in the average. A third of a second at sixty, which reads steady. */
const WINDOW = 20;

type Ring = { at: number; n: number; of: Float64Array };
const ring = (): Ring => ({ at: 0, n: 0, of: new Float64Array(WINDOW) });

const rings: Record<string, Ring> = {
  solve: ring(), build: ring(), present: ring(), frame: ring(),
};
/** This frame's totals, gathered until `endFrame` files them. */
const now: Record<PerfSlot, number> = { solve: 0, build: 0, present: 0 };
let last = 0;

const put = (r: Ring, v: number) => {
  r.of[r.at] = v;
  r.at = (r.at + 1) % WINDOW;
  if (r.n < WINDOW) r.n++;
};
const mean = (r: Ring) => {
  if (!r.n) return 0;
  let t = 0;
  for (let k = 0; k < r.n; k++) t += r.of[k];
  return t / r.n;
};

/** Add to this frame's tally. Called with a measured span, not a timestamp. */
export function perfAdd(slot: PerfSlot, ms: number) {
  now[slot] += ms;
}

/**
 * Longest a frame can be and still count, in ms — AND ONLY AGAINST THE REST.
 *
 * A frame that follows a STALL is not a frame anyone wants averaged in. The
 * browser parks rAF whenever the page is not visible, so the first frame back
 * carries the whole sleep in its interval and the work of waking up in its
 * spans — re-uploads, pipelines rebuilt. Twenty of those in a rolling window
 * of twenty is a readout made entirely of the atypical, and it is how a submit
 * of half a millisecond came to be shown as nearly four.
 *
 * THIS USED TO BE A FLAT CEILING and that was much worse than the thing it
 * was guarding against. Fifty milliseconds is three frames at sixty, so any
 * app sustained under twenty frames a second had EVERY frame dropped — and
 * the ring keeps whatever it last held, so the readout froze at the last
 * twenty fast frames and stayed there. Not wrong slowly: frozen, silently,
 * for ever, and showing a healthy number while the thing in front of you
 * stuttered. It is exactly when a readout is most needed that it went blind,
 * and it made every measurement taken across a slow patch a measurement of
 * the patch before it.
 *
 * So a frame is dropped when it is long AND OUT OF CHARACTER — several times
 * what the window has been seeing. A wake-up after a second asleep is sixty
 * times the mean and goes; a map that has settled into fifty-five milliseconds
 * a frame is not an outlier by the third one, and is reported.
 */
const STALL = 50;
/** How many times the running mean counts as out of character. @see STALL */
const OUTLIER = 4;

/** Close the frame off and start the next. */
export function perfFrame() {
  const t = performance.now();
  const gap = last ? t - last : 0;
  last = t;
  // Dropped, not counted: see `STALL`. The slots still have to be cleared, or
  // the stalled frame's work lands on the next one's tally.
  const seen = mean(rings.frame);
  const odd = gap > STALL && rings.frame.n >= WINDOW && gap > seen * OUTLIER;
  if (gap > 0 && !odd) {
    put(rings.frame, gap);
    for (const s of SLOTS) put(rings[s], now[s]);
  }
  for (const s of SLOTS) now[s] = 0;
}

export type PerfRead = {
  fps: number;
  frame: number;
  solve: number;
  build: number;
  present: number;
  /** Solve and build: the work this code actually chooses to do. */
  js: number;
};

export function perfRead(): PerfRead {
  const frame = mean(rings.frame);
  const solve = mean(rings.solve), build = mean(rings.build);
  // Present is deliberately NOT in this total: it is mostly waiting, so adding
  // it in would make a quiet frame look busy. @see perf.ts
  return {
    fps: frame > 0 ? 1000 / frame : 0,
    frame, solve, build, present: mean(rings.present), js: solve + build,
  };
}
