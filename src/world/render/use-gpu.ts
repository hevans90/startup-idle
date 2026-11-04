/**
 * THE ONE WEBGPU DEVICE, for every Pixi canvas: the map's, the skill tree's,
 * the landmark pictures'. Opened once and handed to each renderer, so a second
 * canvas asks for no adapter of its own and runs on WebGPU as the map does.
 * Pixi leaves a device it was handed alone when its renderer goes. @see openDevice
 *
 * Light on purpose: no map code, so the skill tree can use it without pulling
 * in the map engine's chunk.
 */
import { useEffect, useState } from "react";

import { openDevice, type HeldGpu } from "./device";

/**
 * Which renderer to ask for: WebGPU, unless `?webgl=1` says otherwise.
 *
 * Not a preference so much as a way to LOOK at the other one. Everything here
 * runs on WebGPU in practice, so the WebGL path is the one that rots quietly
 * until somebody opens the page in a browser that has no WebGPU and gets a
 * blank map. This makes it one URL away.
 */
export const rendererAsked = (): "webgpu" | "webgl" =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("webgl")
    ? "webgl"
    : "webgpu";

/** The device, for a renderer: null on WebGL or where WebGPU is not to be had (Pixi then makes its own). */
export const gpuForPixi = (): Promise<HeldGpu | null> =>
  rendererAsked() === "webgl" ? Promise.resolve(null) : openDevice();

/**
 * The device as a hook: `undefined` while the ask is out — mount nothing yet —
 * then the device, or null. @see WorldCanvas
 */
export function usePixiGpu(): HeldGpu | null | undefined {
  const [gpu, setGpu] = useState<HeldGpu | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void gpuForPixi().then((g) => {
      if (live) setGpu(g);
    });
    return () => {
      live = false;
    };
  }, []);
  return gpu;
}
