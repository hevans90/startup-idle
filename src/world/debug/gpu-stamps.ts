/**
 * The frame's GPU clocks, held for the RENDERER rather than for the solver.
 *
 * They started out inside `createGpuWater`, which made them useless for the
 * one question they were bought to answer. The render pass costs what it costs
 * whichever solver is running — the water's mesh is built in a vertex shader
 * on both paths — so a number that only exists while the compute solver is on
 * cannot be checked against anything, and a measurement nobody can falsify is
 * a measurement nobody should act on. Held here, the render is timed on the
 * CPU path too and the two can be put side by side.
 *
 * ONE SET, not one per owner. The solver's passes write into this same set
 * when it is running; two sets would be two resolves and two readbacks for one
 * question. It outlives any solver and belongs to the device.
 */
import { createStamps, type Stamps } from "../../fluid/gpu/stamps";

let held: Stamps | null = null;
let owner: GPUDevice | null = null;

/** The set for this device, made on first ask. Null where it cannot be timed. */
export function holdStamps(device: GPUDevice | null): Stamps | null {
  if (!device) return null;
  if (owner === device) return held;
  held?.destroy();
  owner = device;
  held = device.features.has("timestamp-query") ? createStamps(device) : null;
  return held;
}

/** Whatever the last `holdStamps` made, for anything that only reads. */
export const stampsNow = () => held;

/**
 * How often a frame is actually timed, in milliseconds.
 *
 * The readout asks four times a second and averages over a window of frames,
 * so timing every one of sixty bought fifteen samples nobody looked at — each
 * of them two queries per pass, a resolve, a command buffer of its own, a
 * submit and a mapped readback. At this rate the window still fills in a
 * couple of seconds and the mean says the same thing. @see Stamps.arm
 */
const EVERY = 100;

/**
 * Copy the frame's clocks out and ask for them, and arm the next one.
 *
 * AT THE END OF THE TICK, after the renderer has submitted: a resolve is a
 * command like any other and only sees queries the commands before it wrote.
 * Its own little encoder, because by this point in the frame everybody else's
 * has been finished and submitted — and it is only finished and submitted when
 * there was something to resolve, which on most frames there is not.
 *
 * `force` for a harness that drives its own frames and wants every one of them
 * timed: a bench runs a fixed number of steps and a rate limit would leave
 * most of them unmeasured. @see world-scene's `__waterBench`
 */
let armAt = 0;
export function flushStamps(device: GPUDevice | null, force = false) {
  if (!device || !held) return;
  const enc = device.createCommandEncoder({ label: "stamps" });
  if (held.resolve(enc)) {
    device.queue.submit([enc.finish()]);
    held.read();
  }
  // Armed for the NEXT frame, because a frame's passes are encoded long before
  // this runs — there is no arming the one that has already gone by.
  const t = performance.now();
  const due = force || t >= armAt;
  held.arm(due);
  if (due) armAt = t + EVERY;
}
