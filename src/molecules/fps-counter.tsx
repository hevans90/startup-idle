import { useEffect, useState } from "react";

import { useGlobalSettingsStore } from "../state/global-settings.store";

/** `?fps` in the address shows the counter whatever the setting says. */
const FPS_ASKED = typeof location !== "undefined" && new URLSearchParams(location.search).has("fps");

/** Frames counted over this long, then shown: steady enough to read. */
const WINDOW_MS = 500;

/**
 * THE FRAME RATE, in the bottom right of the screen: frames the browser
 * actually drew in the last half second. Shown by Settings → Show FPS or by
 * `?fps`; nothing runs while it is hidden. For `?perf`'s breakdown of a
 * frame. @see PerfHud
 */
export function FpsCounter() {
  const on = useGlobalSettingsStore((s) => s.showFps) || FPS_ASKED;
  return on ? <FpsReadout /> : null;
}

function FpsReadout() {
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let since = performance.now();
    const frame = (now: number) => {
      frames++;
      if (now - since >= WINDOW_MS) {
        setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      aria-label="Frames per second"
      className="pointer-events-none fixed right-2 bottom-2 z-50 border border-line-quiet bg-surface-3/80 px-1.5 py-0.5 font-mono text-xs tabular-nums text-fg"
    >
      {fps ?? "–"} fps
    </div>
  );
}
