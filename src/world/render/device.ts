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
 * The same thing, synchronously, once it has arrived.
 *
 * `openDevice` is a promise and most callers are happy to await it — but the
 * editor's panels are not: a slider's RANGE depends on what the device can do,
 * and a control cannot be half-rendered while a promise settles. The scene
 * opens the device while it mounts, so by the time anybody is dragging
 * anything this is filled in; before that it is null and callers take the
 * guaranteed minimum, which is the right answer for a machine with no WebGPU
 * anyway.
 */
let held: HeldGpu | null = null;
export const heldGpu = (): HeldGpu | null => held;

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

/**
 * THE FIRST ERROR IS THE ONLY ONE WORTH READING, and it was the one you could
 * never see.
 *
 * WebGPU poisons everything downstream of a mistake: an invalid texture makes
 * an invalid bind group, which makes an invalid command buffer, and each of
 * those reports itself once a frame at sixty frames a second saying only that
 * something earlier went wrong. Within about a second the console holds
 * thousands of them and the one message that named the actual fault has
 * scrolled out of the buffer. Finding a bad texture size this way cost most of
 * an afternoon.
 *
 * So the first real error is kept and shouted, and the cascade after it is
 * counted rather than printed. A cascade is not news — it is the same fault
 * being re-reported by everything that touched it.
 */
let firstError: string | null = null;
let cascade = 0;

/** The first GPU error that was not merely a consequence of another. */
export const gpuFirstError = () => firstError;

/** Whether a message is the API saying "something else went wrong earlier". */
const isCascade = (m: string) => m.includes("is invalid due to a previous error");

function report(message: string) {
  if (firstError !== null && isCascade(message)) {
    cascade++;
    // Once a thousand, so a wall that never stops is still visible as one.
    if (cascade % 1000 === 0) {
      console.warn(`GPU: ${cascade} further errors, all downstream of the first.`);
    }
    return;
  }
  if (firstError === null && !isCascade(message)) {
    firstError = message;
    console.error("GPU: FIRST ERROR —", message);
    return;
  }
  console.error("GPU:", message);
}

/**
 * `?gpuwhy=1` — name the call that went wrong, not the frames that noticed.
 *
 * The cascade above is only half the problem. The other half is that Pixi
 * creates its pipelines inside its OWN error scope, so a pipeline that fails
 * to build is never reported to `uncapturederror` at all: the first thing the
 * program hears is a render pass complaining about an invalid pipeline, an
 * indeterminate time later, with nothing to say which one or why. And it is
 * built once and cached, so it cannot be provoked into failing again.
 *
 * This wraps every creating call on the device in a scope of its own, which
 * catches the failure where it happens and with the descriptor's label still
 * in hand. Off unless asked for: a scope per call is a real cost, and this is
 * a thing you turn on when something has already gone wrong.
 */
const whyWanted = () =>
  typeof location !== "undefined" && new URLSearchParams(location.search).has("gpuwhy");

function watchCreation(device: GPUDevice) {
  const calls = [
    "createShaderModule", "createRenderPipeline", "createComputePipeline",
    "createBindGroup", "createBindGroupLayout", "createTexture", "createBuffer",
  ] as const;
  // THE PROTOTYPE, not the instance. Pixi is handed this device, but anything
  // that made its own would report into the same console with none of its
  // calls watched — and a second device is one of the things worth ruling out.
  const proto = Object.getPrototypeOf(device) as Record<string, unknown>;
  for (const name of calls) {
    const real = proto[name] as (this: GPUDevice, d: unknown) => unknown;
    proto[name] = function (this: GPUDevice, desc: { label?: string }) {
      this.pushErrorScope("validation");
      const made = real.call(this, desc);
      void this.popErrorScope().then((e) => {
        if (e) console.error(`GPU: ${name}(${desc?.label ?? "unlabelled"}) —`, e.message);
      }).catch(() => { /* the device went; nothing to report it to */ });
      return made;
    };
  }
  watchSubmits(device);
  console.info("GPU: watching every creating call (?gpuwhy). This costs a scope per call.");
}

/**
 * AND WHO SUBMITTED IT, which the message cannot say.
 *
 * "[Buffer (unlabeled)] used in submit while destroyed" names neither the
 * buffer nor the caller, and by the time it surfaces the stack is gone: the
 * error is asynchronous and the submit that caused it is several frames back.
 * There are half a dozen things submitting here — the solver, the gathering,
 * the brink pass, Pixi's own render, and any harness that is open — and
 * nothing in the message tells them apart.
 *
 * So under the same switch every submit is scoped, with its own stack captured
 * at the call, and a failure prints the two together. A stack per submit is far
 * too expensive to leave on, which is why this lives behind `?gpuwhy` with the
 * rest.
 */
function watchSubmits(device: GPUDevice) {
  const proto = Object.getPrototypeOf(device.queue) as Record<string, unknown>;
  const real = proto.submit as (this: GPUQueue, b: readonly GPUCommandBuffer[]) => void;
  if (typeof real !== "function") return;
  proto.submit = function (this: GPUQueue, buffers: readonly GPUCommandBuffer[]) {
    const from = new Error("submitted here").stack;
    device.pushErrorScope("validation");
    real.call(this, buffers);
    void device.popErrorScope().then((e) => {
      if (e) console.error(`GPU: a submit was refused — ${e.message}\n${from}`);
    }).catch(() => { /* the device went; nothing to report it to */ });
  };
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
      // AND THE TEXTURE SIZE THE ADAPTER ALREADY HAS.
      //
      // A device gets the GUARANTEED limits unless it asks — 8,192 across for
      // a 2D texture — however much the hardware can actually do. The quad
      // list is a texture as wide as the widest band's worth of quads, eighty
      // per tile, so 8,192 stops at 102 tiles and a 128² map made a texture
      // the device refused. Nothing threw where the map was made: the texture
      // came back invalid, Pixi bound it anyway, and every frame after was a
      // wall of "invalid due to a previous error" with no first error to find.
      // This adapter reports 16,384, which is 204 tiles. Asking for what is
      // there costs nothing and cannot fail — a device may be asked for any
      // limit up to its adapter's.
      const device = await adapter.requestDevice({
        requiredFeatures: wanted,
        requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
      });
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
        report((e as GPUUncapturedErrorEvent).error.message);
      });
      if (whyWanted()) watchCreation(device);
      held = { adapter, device };
      return held;
    } catch {
      // No WebGPU, or an adapter that will not give a device. Pixi makes its
      // own and falls back to WebGL exactly as it did before this existed.
      return null;
    }
  })();
  return opened;
}

/**
 * The widest 2D texture this device will make, or the guaranteed minimum.
 *
 * The guarantee is what a caller gets when there is no device at all — WebGL,
 * or a machine with no WebGPU — because that is the one number that is true
 * everywhere, and a map sized for it works on anything.
 */
export const MIN_TEXTURE_DIMENSION = 8192;
export const textureLimit = (device: GPUDevice | null | undefined): number =>
  device?.limits.maxTextureDimension2D ?? MIN_TEXTURE_DIMENSION;

/** Whether this device can be asked when the GPU started and stopped. */
export const canTime = (device: GPUDevice | null | undefined) =>
  !!device && device.features.has(TIMING);
