/**
 * World v2 — pan/zoom viewport. Deliberately thin: the shared
 * `applyViewportControls` gives it the same feel as the v1 map and the skill
 * tree, and clamping is left to the caller since bounds are grid-derived.
 */
import { extend, useApplication } from "@pixi/react";
import { Viewport } from "pixi-viewport";
import { Text } from "pixi.js";
import { useCallback, useEffect, useRef } from "react";

import { applyViewportControls } from "../utils/viewport-controls";
import { useWorldStore } from "../state/world.store";

extend({ Viewport, Text });

export function WorldViewport({
  children,
  screenSize,
}: {
  children: React.ReactNode;
  screenSize: { width: number; height: number };
}) {
  const ref = useRef<Viewport>(null);
  const setViewport = useWorldStore((s) => s.setViewport);
  const pixiApp = useApplication();
  const events = pixiApp?.app.renderer?.events;
  const ticker = pixiApp?.app.ticker;

  const init = useCallback(() => {
    const vp = ref.current;
    if (!vp) return false;
    // minScale has to be low enough to frame the largest map: a 96² world is
    // ~12,700px wide, so fitting it in a ~600px canvas needs ~0.05. Clamping
    // higher silently blocks the initial fit and leaves the camera stranded.
    applyViewportControls(vp, { minScale: 0.015, maxScale: 8 });
    setViewport(vp);
    console.info("WORLD VIEWPORT: bootstrapped");
    return true;
  }, [setViewport]);

  // The <viewport> element only renders once the app's ticker and events
  // exist, so this effect must re-run when they arrive — otherwise it fires
  // against a null ref and never tries again. A short retry covers the case
  // where @pixi/react attaches the ref a frame later.
  useEffect(() => {
    if (!events || !ticker) return;
    if (init()) return;
    let tries = 0;
    const id = window.setInterval(() => {
      if (init() || ++tries > 20) window.clearInterval(id);
    }, 50);
    return () => window.clearInterval(id);
  }, [init, events, ticker]);

  if (!ticker || !events) return null;

  return (
    // @ts-expect-error pixi-viewport JSX intrinsic, declared in pixi.d.ts
    <viewport
      label="world-viewport"
      screenWidth={screenSize.width}
      screenHeight={screenSize.height}
      events={events}
      ticker={ticker}
      ref={ref}
    >
      {children}
      {/* @ts-expect-error closing the intrinsic */}
    </viewport>
  );
}
