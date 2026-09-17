/**
 * The WebGPU device, made HERE rather than by Pixi.
 *
 * Pixi makes its own and asks for three texture-compression features and
 * nothing else — the list is a literal in `GpuDeviceSystem` with no way in.
 * `timestamp-query` has to be asked for when a device is CREATED, and it is
 * the only way to find out what the GPU actually spends its time on: the frame
 * readout can only offer `frame - js`, which is the GPU's work and the wait
 * for vsync added together and is indistinguishable from either alone.
 *
 * What Pixi does leave open is `options.gpu` — hand it an adapter and a device
 * and it uses them and skips its own. So this makes the device with the
 * feature on where it exists, and the three Pixi wanted so that nothing it
 * relies on goes missing.
 *
 * ONCE, and cached as the PROMISE rather than the result: the editor asks for
 * it while it is mounting and a second ask must not make a second device.
 */

/** What Pixi asks for, so taking the job over does not take these away. */
const PIXI_WANTS = [
  "texture-compression-bc",
  "texture-compression-astc",
  "texture-compression-etc2",
] as const;

/** What this is all for. @see Stamps */
const TIMING = "timestamp-query";

export type HeldGpu = { adapter: GPUAdapter; device: GPUDevice };

let opened: Promise<HeldGpu | null> | null = null;

/**
 * Why the device went, or null while it is still there.
 *
 * A device can be lost at any moment and for reasons that have nothing to do
 * with this program: the driver resets, the GPU is reclaimed while the tab is
 * in the background, the machine sleeps. Every call on a lost device is a
 * silent no-op and every `mapAsync` on it rejects — and those rejections are
 * caught on purpose all over the solver, because teardown makes them too. So
 * the failure mode without this was a map that quietly stopped moving with
 * nothing in the console to say why.
 */
let lost: string | null = null;

/** Whoever wants telling. Called once, on the frame the loss is noticed. */
const mourners = new Set<(why: string) => void>();

/** Whether the device has gone. @see onDeviceLost */
export const deviceLost = () => lost;

/**
 * Ask to be told when the device goes, and get an unsubscribe back.
 *
 * Called immediately if it has ALREADY gone, because a listener that arrives
 * after the event still needs to know — a scene rebuilt on a dead device is
 * the case this exists to prevent.
 */
export function onDeviceLost(fn: (why: string) => void): () => void {
  if (lost !== null) fn(lost);
  else mourners.add(fn);
  return () => mourners.delete(fn);
}

/** Say it once, to everyone, and remember it for whoever asks later. */
function mourn(why: string) {
  if (lost !== null) return;
  lost = why;
  // THE RENDERER IS ON THIS DEVICE TOO, which is the part that is easy to
  // miss and that no amount of solver bookkeeping fixes: Pixi was handed this
  // very device, so when it goes the canvas goes with it and the map is black
  // whatever the water does. What the handover below buys is a consistent
  // state and a message, not a picture. Rebuilding the renderer on a fresh
  // device means rebuilding every texture, buffer and pipeline Pixi holds,
  // and that is a different piece of work.
  console.error(
    "GPU: the device was lost —", why,
    "\nThe water has gone back to the host solver. The CANVAS is on the same "
    + "device and cannot come back without a reload.",
  );
  for (const fn of [...mourners]) {
    try { fn(why); } catch { /* a listener that throws is not the device's problem */ }
  }
  mourners.clear();
}

export function openDevice(): Promise<HeldGpu | null> {
  if (opened) return opened;
  opened = (async () => {
    const gpu = (navigator as unknown as { gpu?: GPU }).gpu;
    if (!gpu) return null;
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) return null;
      const wanted = [TIMING, ...PIXI_WANTS]
        .filter((f) => adapter.features.has(f)) as GPUFeatureName[];
      const device = await adapter.requestDevice({ requiredFeatures: wanted });
      // SUBSCRIBED ONCE, HERE, because this is the only place a device is
      // made. `lost` RESOLVES rather than rejecting, so there is nothing to
      // catch and a `.then` is the whole of it.
      //
      // EVERY REASON COUNTS, INCLUDING "destroyed". The instinct is to treat a
      // destroy as a deliberate teardown and stay quiet, and it would be right
      // in a program that destroys its own device. Nothing here ever does —
      // the device outlives every scene and every solver on purpose — so a
      // destroy can only have come from outside, and the map is just as dead
      // as for any other reason. It is also the only way to stage one, which
      // is how this gets tested at all.
      void device.lost.then((info) => {
        mourn(info.message || info.reason || "no reason given");
      });
      // AND ERRORS NOBODY SCOPED. The solver pushes a validation scope on its
      // first four frames and nothing after, so a pipeline that only goes
      // wrong on the thousandth frame had nowhere to be reported. This is the
      // catch-all: it costs nothing and it is the difference between a bug
      // with a message and a map that stopped drawing.
      device.addEventListener("uncapturederror", (e) => {
        const err = (e as GPUUncapturedErrorEvent).error;
        console.error("GPU:", err.message);
      });
      return { adapter, device };
    } catch {
      // No WebGPU, or an adapter that will not give a device. Pixi makes its
      // own and falls back to WebGL exactly as it did before this existed.
      return null;
    }
  })();
  return opened;
}

/** Whether this device can be asked when the GPU started and stopped. */
export const canTime = (device: GPUDevice | null | undefined) =>
  !!device && device.features.has(TIMING);
