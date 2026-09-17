/**
 * World v2 editor — the `?world=1` route.
 *
 * Layout follows the plan's Pixi/React boundary: world space is Pixi, chrome is
 * React. The control column is a SIBLING of the canvas wrapper rather than a
 * child, because `useDisableDOMZoom` preventDefaults wheel on the wrapper
 * without checking the target, which would kill scrolling in any panel nested
 * inside it.
 */
import { Application } from "@pixi/react";
import { useEffect, useState } from "react";

import { openDevice, type HeldGpu } from "./render/device";

import { useResizeToWrapper } from "../hooks/use-resize-to-wrapper";
import type { Overlays } from "../state/world.store";
import { DEFAULT_SIZE, useWorldStore } from "../state/world.store";
import { useDisableDOMZoom } from "../utils/use-disable-dom-zoom";
import { Calibration } from "./debug/calibration";
import { CellReadout } from "./debug/cell-readout";
import { EditPanel } from "./debug/edit-panel";
import "./debug/expose-store";
import { GpuCheckHud } from "./debug/gpu-check-hud";
import { GpuWaterToggle } from "./debug/gpu-water-toggle";
import { Minimap } from "./debug/minimap";
import { PerfHud } from "./debug/perf-hud";
import { TileBrowser } from "./debug/tile-browser";
import { useEditKeys } from "./edit/use-edit-keys";
import { bandCount } from "./iso";
import { WorldScene } from "./world-scene";
import { WorldViewport } from "./world-viewport";

/** @see GpuCheckHud — six comparisons and a copy of the field per run. */
const GPU_CHECK =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("gpucheck");

/**
 * Which renderer to ask for: WebGPU, unless `?webgl=1` says otherwise.
 *
 * Not a preference so much as a way to LOOK at the other one. Everything here
 * runs on WebGPU in practice, so the WebGL path is the one that rots quietly
 * until somebody opens the page in a browser that has no WebGPU and gets a
 * blank map. This makes it one URL away.
 */
const rendererAsked = (): "webgpu" | "webgl" =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("webgl")
    ? "webgl"
    : "webgpu";

export function WorldEditor() {
  const { ref: wrapperRef, setRef, size } = useResizeToWrapper();
  /**
   * THE DEVICE, MADE BEFORE THE RENDERER RATHER THAN BY IT.
   *
   * `undefined` while the ask is out, then an adapter and device, or `null` on
   * WebGL and anywhere WebGPU is not to be had — in which case Pixi makes its
   * own exactly as it always did. Nothing mounts until the ask has come back,
   * because mounting first and swapping later would build the whole scene on
   * the device we are trying to replace. @see openDevice
   */
  const [gpu, setGpu] = useState<HeldGpu | null | undefined>(undefined);
  useEffect(() => {
    if (rendererAsked() === "webgl") {
      setGpu(null);
      return;
    }
    let live = true;
    void openDevice().then((g) => {
      if (live) setGpu(g);
    });
    return () => {
      live = false;
    };
  }, []);
  useDisableDOMZoom({ wrapperRef });
  useEditKeys();
  const grid = useWorldStore((s) => s.grid);
  const drawnBands = useWorldStore((s) => s.drawnBands);
  const hover = useWorldStore((s) => s.hover);
  const overlays = useWorldStore((s) => s.overlays);
  const toggleOverlay = useWorldStore((s) => s.toggleOverlay);

  const total = bandCount(grid.w, grid.h);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950 text-gray-100">
      {/* canvas — min-width so the flex child can never collapse to zero,
          which is the failure mode that makes v1's map-harness look broken */}
      <div ref={setRef} className="relative min-h-0 min-w-[420px] flex-1">
        {size && gpu !== undefined && (
          <Application
            resizeTo={wrapperRef}
            antialias
            autoDensity
            // Pixi skips its own device when handed one. @see openDevice
            {...(gpu ? { gpu } : {})}
            preference={rendererAsked()}
            resolution={Math.min(window.devicePixelRatio, 2)}
            backgroundColor={0x101418}
            hello={true}
          >
            <WorldViewport screenSize={size}>
              <WorldScene screenSize={size} />
            </WorldViewport>
          </Application>
        )}
        {/* anchored HTML — inside the wrapper but pointer-events-none, so it
            can never intercept a pick */}
        {import.meta.env.DEV && <PerfHud />}
        {/* CPU or device, on the water in front of you. A real switch — see
            `gpu-water-toggle`, and the cost note in `gpu/solver`. */}
        {import.meta.env.DEV && <GpuWaterToggle />}
        {/* Which compute passes agree with the CPU, on THIS map — behind
            `?gpucheck`. Not a CPU/GPU switch; see `gpu-check-hud`. */}
        {import.meta.env.DEV && GPU_CHECK && <GpuCheckHud />}
        <CellReadout />
      </div>

      {/* chrome — sibling of the wrapper, so wheel events are its own */}
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-gray-800 bg-gray-950 p-4 text-xs">
        <p className="mb-3 text-sm font-bold uppercase tracking-wider text-amber-400">
          World v2
        </p>

        <dl className="grid grid-cols-2 gap-y-1 font-mono">
          <dt className="text-gray-400">size</dt>
          <dd>
            {grid.w}×{grid.h}
          </dd>
          <dt className="text-gray-400">cells</dt>
          <dd>{(grid.w * grid.h).toLocaleString()}</dd>
          <dt className="text-gray-400">bands</dt>
          <dd>{total}</dd>
          <dt className="text-gray-400">drawn</dt>
          <dd
            className={
              drawnBands < total ? "text-emerald-400" : "text-gray-100"
            }
          >
            {drawnBands}{" "}
            <span className="text-gray-500">
              ({total ? Math.round((drawnBands / total) * 100) : 0}%)
            </span>
          </dd>
          <dt className="text-gray-400">height</dt>
          <dd>
            {grid.minHeight}…{grid.maxHeight}
          </dd>
          <dt className="text-gray-400">hover</dt>
          <dd className={hover ? "text-emerald-300" : "text-gray-600"}>
            {hover ? `${hover.x},${hover.y}` : "—"}
          </dd>
        </dl>

        <p className="mt-4 mb-1 text-gray-400">overlays</p>
        <div className="flex flex-wrap gap-1">
          {(
            [
              "grid",
              "bands",
              "height",
              "origin",
              "net",
              "mask",
              "gaps",
              "xray",
              "faces",
            ] as (keyof Overlays)[]
          ).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleOverlay(k)}
              className={`cursor-pointer rounded border px-2 py-1 font-mono ${
                overlays[k]
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                  : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <EditPanel />

        <div className="mt-4">
          <TileBrowser />
        </div>

        <p className="mt-4 mb-1 text-gray-400">minimap</p>
        <Minimap />

        <div className="mt-4">
          <Calibration />
        </div>

        <p className="mt-6 leading-relaxed text-gray-500">
          Left-drag paints; while a paint tool is active, pan with middle or
          right button. <span className="font-mono">⌘Z</span> /{" "}
          <span className="font-mono">⇧⌘Z</span> undo and redo — a whole drag is
          one step. Default map is {DEFAULT_SIZE}² of flat grass at height 0.
        </p>
      </aside>
    </div>
  );
}
