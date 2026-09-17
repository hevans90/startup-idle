/**
 * What the device solver's last frame cost, for the readout to pick up.
 *
 * A module-level latch rather than store state, for the same reason `perf.ts`
 * is one: this is written every frame inside a render tick, and putting it
 * through a store would re-render the tree sixty times a second to change a
 * number nobody is laying anything out from.
 */
import type { GpuFrame } from "../../fluid/gpu/solver";

let last: GpuFrame | null = null;

/**
 * THE LEAK ALARM, AND IT LATCHES.
 *
 * The clamp in the apply pass takes `max(0, depth + delta)`, and the limiter's
 * whole job is to make sure that max never has anything to do. When it does,
 * water is destroyed silently — no error, no discontinuity, just a total that
 * sags — and the last one of those cost eight per cent of a pour and a week
 * of looking in the wrong place. @see CLAMP_SLOT
 *
 * Latched because the alternative is useless. A bad frame at sixty a second is
 * a number that flickers past unread, and the fault that prompted this only
 * fired on the frames where a wind-driven depth happened to underflow. Once
 * seen it stays on the readout, with how much and over how many frames, until
 * the solver is torn down and built again.
 */
let clampEver = 0;
let clampFrames = 0;
/** Which readback this is, so the latch can say how long ago it started. */
let reads = 0;
let clampFirst = -1;

export const gpuWaterSaw = (f: GpuFrame | null) => {
  last = f;
  if (!f) { clampEver = 0; clampFrames = 0; reads = 0; clampFirst = -1; return; }
  const r = f.reduce;
  if (!r) return;
  reads++;
  if (r.clamped > 0) {
    clampEver += r.clamped;
    clampFrames++;
    if (clampFirst < 0) clampFirst = reads;
  }
};
export const gpuWaterRead = (): GpuFrame | null => last;

/** The readout's one line, or nothing while there is nothing to say. */
export function gpuWaterNote(): string | null {
  if (!last) return null;
  const r = last.reduce;
  // WHERE THE TIME WENT, not just how much. Nearly all of this path's cost is
  // the round trip rather than the water, and a single number invites the
  // reading that the CPU solver is still running underneath it.
  let out = `${last.substeps} substep${last.substeps === 1 ? "" : "s"}`
    + `  ${last.cliffN} lips  ${last.drops} drops`
    + `\nup ${last.uploadMs.toFixed(1)}  encode ${last.encodeMs.toFixed(1)}`
    + `  back ${last.scatterMs.toFixed(1)}  wait ${last.readMs.toFixed(1)}`
    // `dt` AND NOT "asked Nms of sim", which read like a BACKLOG and was taken
    // for one. It is the tick's own delta — `encodeFrame` submits on every
    // tick, so nothing can queue up behind it — and the only time it is more
    // than that is the rare tick that could not submit and left its time owed.
    // A big number here is a symptom of a slow frame and not a cause of one,
    // though it does amplify: `substepsFor` cuts 35ms into three substeps, so
    // a frame that ran late makes the solver do three times the work in it.
    + `\ndt ${(last.owed * 1000).toFixed(0)}ms`
    + `  back ${last.readMb.toFixed(1)}MB`;
  if (r) {
    // WHAT THE DEVICE HOLDS, and what its own arithmetic did with it.
    //
    // `held` is every depth on the device, summed out of the readback. On a
    // map with nothing pouring into it and no open edge this is a CONSTANT,
    // and anybody watching it drift is watching a bug.
    //
    // `flux` is every delta the divergence wrote, summed. It is nought on a
    // closed map, and on an open or a cliffed one it is the water leaving the
    // columns — over a lip into the air, or off the edge of the world — so it
    // is a reading rather than an alarm.
    out += `\nheld ${last.deviceWater.toFixed(1)}`
      + `  flux ${r.deltaSum.toFixed(2)}`;
  }
  return out;
}

/**
 * THE ALARM ITSELF, separate so the readout can shout it.
 *
 * Its own line and its own colour, because the whole point of this is to be
 * unmissable: the fault it watches for is silent by construction, and a number
 * that goes wrong inside a grey block of eight other numbers is one nobody
 * reads. Null while nothing has gone wrong, which is almost always.
 */
export function gpuWaterAlarm(): string | null {
  if (clampFrames === 0) return null;
  return `clamp ate ${clampEver.toFixed(2)} over ${clampFrames}`
    + ` frame${clampFrames === 1 ? "" : "s"}, from readback ${clampFirst}`;
}
