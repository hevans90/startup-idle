/**
 * When the GPU started and stopped, pass by pass.
 *
 * THE ONE THING THE FRAME READOUT CANNOT SAY. `perf.ts` offers `frame - js`
 * for the GPU's share, and that number is the GPU's work and the wait for
 * vsync added together: at sixty frames a second it is almost all waiting and
 * at forty it is almost all work, and it looks identical either way. Every
 * claim about where device time goes in this port has been inferred from a
 * bench that serialises the queue, which inflates the absolutes and cannot
 * separate one pass from another at all.
 *
 * A compute pass can be asked directly. `timestampWrites` on the pass
 * descriptor puts the queue's clock into a query set at the start and the end,
 * `resolveQuerySet` turns the set into a buffer, and the difference is
 * nanoseconds of GPU. It costs one requirement: the feature has to be asked
 * for when the DEVICE is made, which is why `render/device` makes it instead
 * of Pixi.
 *
 * COARSER THAN IT LOOKS. Chrome quantises these to a hundred microseconds on
 * purpose — a fine clock shared with a page is a timing attack — so a pass of
 * three hundred microseconds reads as two hundred or four hundred and the
 * answer is only worth reading in aggregate. That is what the rolling mean is
 * for, and why this reports tenths of a millisecond and not microseconds.
 *
 * BRACKETING DOES NOT WORK, and it is worth writing down because it is the
 * obvious idea. An empty timed pass submitted just before the render and
 * another just after ought to put a clock either side of it — the queue runs
 * command buffers in submission order, after all. Measured, the gap reads
 * exactly nought: submission order is about what the work SEES, not about
 * when the hardware runs it, and an empty compute pass that depends on
 * nothing is free to run alongside the render rather than after it. There is
 * no way to time something from outside it. The render pass has to carry its
 * own timestamps, which is what `beginRenderPass` is wrapped for.
 *
 * SLOTS RUN OUT AND THAT IS FINE. A frame with twelve substeps asks for about
 * a hundred passes; the set holds two hundred and fifty six. Past that a pass
 * is simply not timed — it still runs, and the readout is short rather than
 * wrong.
 */

/** Passes a frame may time. Two queries each. */
const PASSES = 256;

/** Frames in the rolling mean, matching the frame readout's window. */
const WINDOW = 20;

export type Stamps = {
  /**
   * The descriptor a pass hands to `beginComputePass`, or nothing when the
   * slots are gone. @see beginPass
   */
  take: (label: string) => GPUComputePassTimestampWrites | undefined;
  /**
   * Whether the NEXT frame's passes are timed at all.
   *
   * Timing a frame is not free: every pass carries two queries, and the frame
   * ends with a resolve, a command buffer of its own, a submit and a mapped
   * readback — all for a readout that asks four times a second. Disarmed,
   * `take` hands back nothing, the passes are encoded without timestamp
   * writes, and there is nothing to resolve or submit. @see flushStamps
   */
  arm: (on: boolean) => void;
  /**
   * Copy the set out, and say whether there was anything to copy.
   *
   * At the TOP of a frame, not the bottom: the marks around the render are
   * taken after the solver has finished encoding, so a resolve at the bottom
   * would miss them and leave their slots to collide with the next frame's
   * first pass. False means nothing was encoded and the caller's buffer need
   * not be submitted.
   */
  resolve: (enc: GPUCommandEncoder) => boolean;
  /** Ask for the last resolve, if the one before it has landed. */
  read: () => void;
  /** Milliseconds of GPU per pass, averaged, plus the total. */
  says: () => { of: Record<string, number>; total: number; frames: number };
  destroy: () => void;
};

export function createStamps(device: GPUDevice): Stamps {
  const set = device.createQuerySet({ type: "timestamp", count: PASSES * 2 });
  const resolved = device.createBuffer({
    size: PASSES * 2 * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    label: "stamps resolved",
  });
  const staging = device.createBuffer({
    size: PASSES * 2 * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    label: "stamps staging",
  });

  type Slot = { label: string };
  /** Which label owns which pair, for the frame being encoded. */
  let names: Slot[] = [];
  /** And for the frame whose resolve is on its way back. */
  let sent: Slot[] = [];
  let used = 0;
  let busy = false;
  let dead = false;
  /** Armed to begin with, so the first frames of a session are timed. */
  let armed = true;

  /** A label's total nanoseconds, summed over the window. */
  const rings = new Map<string, number[]>();
  let frames = 0;

  const take = (label: string) => {
    if (!armed || used >= PASSES) return undefined;
    const n = used++;
    names.push({ label });
    return {
      querySet: set,
      beginningOfPassWriteIndex: n * 2,
      endOfPassWriteIndex: n * 2 + 1,
    };
  };

  const resolve = (enc: GPUCommandEncoder) => {
    if (used === 0 || busy || dead) { names = []; used = 0; return false; }
    enc.resolveQuerySet(set, 0, used * 2, resolved, 0);
    enc.copyBufferToBuffer(resolved, 0, staging, 0, used * 2 * 8);
    sent = names;
    names = [];
    used = 0;
    return true;
  };

  const read = () => {
    if (busy || dead || sent.length === 0) return;
    busy = true;
    const mine = sent;
    sent = [];
    void staging.mapAsync(GPUMapMode.READ).then(() => {
      if (dead) return;
      const raw = new BigInt64Array(staging.getMappedRange().slice(0));
      staging.unmap();
      // SUMMED PER LABEL, not per pass: a substep runs the same eight passes
      // and what anybody wants is what `accelerate` costs a FRAME.
      const frame = new Map<string, number>();
      for (let n = 0; n < mine.length; n++) {
        const ns = Number(raw[n * 2 + 1] - raw[n * 2]);
        // A pair that never got written reads as zero minus zero, and a
        // negative is a set that was resolved across a device reset.
        if (!Number.isFinite(ns) || ns < 0) continue;
        frame.set(mine[n].label, (frame.get(mine[n].label) ?? 0) + ns / 1e6);
      }
      for (const [label, ms] of frame) {
        let r = rings.get(label);
        if (!r) { r = []; rings.set(label, r); }
        r.push(ms);
        if (r.length > WINDOW) r.shift();
      }
      // A label that stopped running this frame still decays out of the mean
      // rather than sticking at its last value for ever.
      for (const [label, r] of rings) {
        if (!frame.has(label)) {
          r.push(0);
          if (r.length > WINDOW) r.shift();
          if (r.every((v) => v === 0)) rings.delete(label);
        }
      }
      frames++;
    }).catch(() => { /* destroyed mid-flight */ })
      .finally(() => { busy = false; });
  };

  const says = () => {
    const of: Record<string, number> = {};
    let total = 0;
    for (const [label, r] of rings) {
      const mean = r.reduce((a, b) => a + b, 0) / Math.max(1, r.length);
      of[label] = Math.round(mean * 1000) / 1000;
      total += mean;
    }
    return { of, total: Math.round(total * 1000) / 1000, frames };
  };

  return {
    take, arm: (on: boolean) => { armed = on; }, resolve, read, says,
    destroy: () => {
      dead = true;
      set.destroy();
      resolved.destroy();
      staging.destroy();
    },
  };
}
