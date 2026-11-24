/**
 * THE SCREEN OVER THE MAP WHILE IT FIRST LOADS, so the map is seen whole and not coming in a piece at a time:
 * the ground, then the houses, the trees, the water. It says what is being waited for — each line a thing really
 * under way (@see load-progress) — and lifts when all of it is done and the GPU has drawn what it was handed, its
 * shaders compiled among that. Once lifted it stays lifted for as long as this canvas is up: a sheet fetched an
 * hour in for the first boat does not bring it back.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import { loadBegan, loadProgress, loadStage, onLoadProgress } from "./load-progress";
import { heldGpu } from "./render/device";

/** How long everything must have been done before the screen lifts, ms: the sheets are asked for in the first frames. */
const SETTLE_MS = 350;
/** With nothing moving for this long, ms, the screen lifts anyway: a picture that never comes is not a map never shown. */
const STUCK_MS = 20_000;
/** The fade, ms. */
const FADE_MS = 220;

export function MapLoading() {
  const p = useSyncExternalStore(onLoadProgress, loadProgress, loadProgress);
  const [phase, setPhase] = useState<"up" | "gpu" | "fading" | "gone">("up");
  // (Told once this is up, not while it is being drawn: the telling redraws whoever listens.)
  const [begun, setBegun] = useState(false);
  useEffect(() => { loadBegan(); setBegun(true); }, []);
  const stage = begun ? loadStage(p) : "Building the map";

  // ALL OF IT DONE, and still done a moment later: then the GPU is asked to finish what it has, and the screen lifts.
  useEffect(() => {
    if (phase !== "up" || stage !== null) return;
    const t = setTimeout(() => setPhase("gpu"), SETTLE_MS);
    return () => clearTimeout(t);
  }, [phase, stage, p]);
  useEffect(() => {
    if (phase !== "gpu") return;
    let live = true;
    const lift = () => { if (live) setPhase("fading"); };
    const device = heldGpu()?.device;
    // (Two frames on, where there is no device to ask: WebGL draws as it is told.)
    if (device) void device.queue.onSubmittedWorkDone().then(() => requestAnimationFrame(lift), lift);
    else requestAnimationFrame(() => requestAnimationFrame(lift));
    return () => { live = false; };
  }, [phase]);
  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);
  // NOTHING MOVING: lifted all the same.
  useEffect(() => {
    if (phase === "fading" || phase === "gone") return;
    const t = setTimeout(() => setPhase("fading"), STUCK_MS);
    return () => clearTimeout(t);
  }, [phase, p]);

  if (phase === "gone") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-map-loading
      className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-0 text-fg transition-opacity dark:bg-surface-0 dark:text-fg ${phase === "fading" ? "pointer-events-none opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <div className="boot-bar"><i /></div>
      <div className="font-display text-[10px] uppercase tracking-[0.2em] text-fg-muted dark:text-fg-muted">{stage ?? "Compiling shaders"}</div>
    </div>
  );
}
