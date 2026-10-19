/**
 * World v2 — pan/zoom viewport. Deliberately thin: the shared
 * `applyViewportControls` gives it the same feel as the v1 map and the skill
 * tree, and clamping is left to the caller since bounds are grid-derived.
 */
import { extend, useApplication } from "@pixi/react";
import { Viewport } from "pixi-viewport";
import { Text, type Ticker } from "pixi.js";
import { useCallback, useEffect, useRef } from "react";

import { applyViewportControls } from "../utils/viewport-controls";
import { useWorldStore } from "../state/world.store";

extend({ Viewport, Text });

/** How fast the arrow keys pan, in screen pixels a second, at any zoom. */
const KEY_PAN = 900;

/** Which way each arrow pans the camera, on screen. */
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

/** Per second, how quickly the arrow pan takes up the speed asked of it, and lets it go. */
const KEY_EASE = 10;

/**
 * THE ARROW KEYS PAN THE MAP, for as long as they are held: easing up to a steady speed
 * on screen whatever the zoom, so the map moves the same distance under the
 * eye zoomed in or out, and on the ticker rather than on key repeat, which
 * starts after a pause and stutters; and easing to a stop when let go. Not while typing in a field, and not
 * with a modifier held, which leaves the browser's own shortcuts alone.
 */
function useArrowPan(vp: React.RefObject<Viewport | null>, ticker: Ticker | undefined) {
  useEffect(() => {
    if (!ticker) return;
    const held = new Set<string>();
    const typing = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const down = (ev: KeyboardEvent) => {
      if (!(ev.key in ARROWS) || typing(ev) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      ev.preventDefault();
      held.add(ev.key);
    };
    const up = (ev: KeyboardEvent) => held.delete(ev.key);
    // A key let go while the window was not looking would pan for ever.
    const blur = () => held.clear();
    // The pan's speed now, screen pixels a second, eased toward what the keys ask.
    let vx = 0, vy = 0;
    const step = (t: Ticker) => {
      const v = vp.current;
      // Nor while the map is out of sight behind another tab.
      if (!v || v.destroyed || useWorldStore.getState().mapHidden) { vx = vy = 0; return; }
      let dx = 0, dy = 0;
      for (const k of held) { dx += ARROWS[k][0]; dy += ARROWS[k][1]; }
      const len = Math.hypot(dx, dy) || 1;
      const dt = Math.min(t.deltaMS, 100) / 1000;
      const k = 1 - Math.exp(-KEY_EASE * dt);
      vx += ((dx / len) * KEY_PAN - vx) * k;
      vy += ((dy / len) * KEY_PAN - vy) * k;
      if (Math.abs(vx) < 1 && Math.abs(vy) < 1) { vx = vy = 0; return; }
      const c = v.center;
      v.moveCenter(c.x + (vx * dt) / v.scale.x, c.y + (vy * dt) / v.scale.y);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    ticker.add(step);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      ticker.remove(step);
    };
  }, [vp, ticker]);
}

export function WorldViewport({
  children,
  screenSize,
}: {
  children: React.ReactNode;
  screenSize: { width: number; height: number };
}) {
  const ref = useRef<Viewport>(null);
  /** The viewport this put on the store, kept: the ref is detached before an unmount's cleanup runs. */
  const registered = useRef<Viewport | null>(null);
  const setViewport = useWorldStore((s) => s.setViewport);
  const pixiApp = useApplication();
  const events = pixiApp?.app.renderer?.events;
  const ticker = pixiApp?.app.ticker;
  useArrowPan(ref, ticker);

  const init = useCallback(() => {
    const vp = ref.current;
    if (!vp) return false;
    // minScale has to be low enough to frame the largest map: a 96² world is
    // ~12,700px wide, so fitting it in a ~600px canvas needs ~0.05. Clamping
    // higher silently blocks the initial fit and leaves the camera stranded.
    applyViewportControls(vp, { minScale: 0.015, maxScale: 8 });
    setViewport(vp);
    registered.current = vp;
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

  /**
   * AND OFF THE STORE WHEN IT GOES. The store outlives the canvas: the game
   * unmounts the map when a company is sold and mounts it again for the next,
   * and the next scene, finding the destroyed viewport still there, set the
   * scale of something with no scale left and drew nothing at all.
   */
  useEffect(() => () => {
    if (registered.current && useWorldStore.getState().viewport === registered.current) {
      useWorldStore.setState({ viewport: null });
    }
  }, []);

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
