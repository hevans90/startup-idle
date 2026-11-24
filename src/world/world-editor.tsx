/**
 * World v2 editor — the `?world=1` route.
 *
 * Layout follows the plan's Pixi/React boundary: world space is Pixi, chrome is
 * React. The tool bar and the panels are SIBLINGS of the canvas wrapper, standing over it, rather than a
 * child, because `useDisableDOMZoom` preventDefaults wheel on the wrapper
 * without checking the target, which would kill scrolling in any panel nested
 * inside it.
 */
import { useEffect, useState } from "react";
import { useResizeToWrapper } from "../hooks/use-resize-to-wrapper";
import { useWorldStore } from "../state/world.store";
import { useFoundWorld, WorldCanvas } from "./world-canvas";
import { BuildingLabels } from "./play/building-labels";
import { PortIncome } from "./play/port-income";
import { CellReadout } from "./debug/cell-readout";
import { EditorPanels, type PanelId } from "./debug/editor-panels";
import "./debug/expose-store";
import { GpuCheckHud } from "./debug/gpu-check-hud";
import { GpuWaterToggle } from "./debug/gpu-water-toggle";
import { PerfHud } from "./debug/perf-hud";
import { ToolDock } from "./debug/tool-dock";
import { useEditKeys } from "./edit/use-edit-keys";

/** @see GpuCheckHud — six comparisons and a copy of the field per run. */
const GPU_CHECK =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("gpucheck");

export function WorldEditor() {
  const { ref: wrapperRef, setRef, size } = useResizeToWrapper();
  // The editor's own map, authored freely: no game rules. @see useFoundWorld
  useFoundWorld("editor", false);
  useEditKeys();
  const overlays = useWorldStore((s) => s.overlays);
  // THE LOOK TOOL IN HAND when the editor opens: a first click on the map looks, and changes nothing.
  const setTool = useWorldStore((s) => s.setTool);
  useEffect(() => { setTool("inspect"); }, [setTool]);

  const [panel, setPanel] = useState<PanelId | null>(null);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-surface-0 text-fg">
      {/* canvas — min-width so the flex child can never collapse to zero,
          which is the failure mode that makes v1's map-harness look broken */}
      <div ref={setRef} className="relative min-h-0 min-w-[420px] flex-1">
        <WorldCanvas wrapperRef={wrapperRef} size={size} />
        {/* Off until asked for: they stand over the map being looked at. @see Overlays.labels */}
        {overlays.labels && <BuildingLabels />}
        <PortIncome />
        {/* anchored HTML — inside the wrapper but pointer-events-none, so it
            can never intercept a pick */}
        <PerfHud />
        {/* CPU or device, on the water in front of you. A real switch — see
            `gpu-water-toggle`, and the cost note in `gpu/solver`. */}
        <GpuWaterToggle />
        {/* Which compute passes agree with the CPU, on THIS map — behind
            `?gpucheck`. Not a CPU/GPU switch; see `gpu-check-hud`. */}
        {import.meta.env.DEV && GPU_CHECK && <GpuCheckHud />}
        {/* Hidden with the `readout` overlay or `?readout=0`: it follows the
            cursor, so it sits on top of the tiles you are hovering to look
            at. @see Overlays.readout */}
        {overlays.readout && <CellReadout />}
      </div>

      {/* chrome — siblings of the wrapper, so wheel events are their own. */}
      <EditorPanels open={panel} close={() => setPanel(null)} />
      <ToolDock panel={panel} setPanel={setPanel} />
    </div>
  );
}
