/**
 * World v2 — screen anchors for HTML that tracks a cell.
 *
 * Generalises the one-off in v1: `office.tsx`'s tick projects the hovered
 * building's roof with `vp.toScreen(...)` and publishes it to a store so a DOM
 * popover can follow it through pan and zoom.
 *
 * Two things that version gets wrong and this one does not:
 *
 *  - it writes to the store EVERY frame, so the popover re-renders at 60Hz.
 *    Here the subscription is imperative and only a CSS transform is touched,
 *    so camera tracking costs no React work at all.
 *  - its popover hand-rolls an on-screen clamp in a layout effect. This
 *    exposes a rect instead, which floating-ui can treat as a virtual
 *    reference element and get flip/shift for free.
 */
import { useEffect, useRef, type RefObject } from "react";

import { useWorldStore } from "../../state/world.store";
import { HEIGHT_UNIT, HH, cellToWorld, type Cell } from "../iso";

/** Where a cell's top face sits on screen, in CSS px relative to the canvas. */
export type ScreenAnchor = { x: number; y: number };

/**
 * Project a cell to screen space.
 *
 * `lift` nudges the anchor up by that many height units, so a readout can sit
 * clear of the tile rather than on top of it.
 */
export function projectCell(
  cell: Cell,
  height: number,
  scale: number,
  toScreen: (x: number, y: number) => { x: number; y: number },
  lift = 0,
): ScreenAnchor {
  const { wx, wy } = cellToWorld(cell.x, cell.y, height + lift, scale);
  // top vertex rather than the centre, so a tooltip clears the tile
  return toScreen(wx, wy - HH * scale);
}

/**
 * Drive an element's position from the hovered cell, imperatively.
 *
 * Returns nothing: the element is moved by mutating its transform, never by
 * re-rendering. Reads the store with `subscribe` rather than the hook for the
 * same reason.
 */
export function useCellAnchorFollow(
  ref: RefObject<HTMLElement | null>,
  opts: { lift?: number } = {},
) {
  const lift = opts.lift ?? 0;
  const raf = useRef(0);

  useEffect(() => {
    let alive = true;
    /**
     * WHAT WAS LAST WRITTEN, so that a still mouse over a still camera costs
     * nothing but the arithmetic.
     *
     * This wrote the transform and the visibility on EVERY frame, whether or
     * not either had changed — a string built and two style properties set,
     * sixty times a second, for ever. In a profile of a single pour it came to
     * eleven per cent of the trace, more than the whole of the Pixi tick on
     * the device path. A DOM write is not free just because the value is the
     * same.
     */
    let wasX = NaN, wasY = NaN, shown = false;
    // Hoisted: a closure per frame is a closure per frame.
    let vp: { toScreen: (x: number, y: number) => { x: number; y: number } } | null = null;
    const toScreen = (x: number, y: number) => vp!.toScreen(x, y);

    const place = () => {
      if (!alive) return;
      raf.current = requestAnimationFrame(place);
      const el = ref.current;
      if (!el) return;
      const { hover, viewport, grid, scale } = useWorldStore.getState();
      if (!hover || !viewport) {
        if (shown) { el.style.visibility = "hidden"; shown = false; }
        return;
      }
      const h = grid.height[hover.y * grid.w + hover.x] ?? 0;
      vp = viewport;
      const p = projectCell(hover, h, scale, toScreen, lift);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (!shown) { el.style.visibility = "visible"; shown = true; }
      if (x !== wasX || y !== wasY) {
        wasX = x; wasY = y;
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
    };

    raf.current = requestAnimationFrame(place);
    return () => { alive = false; cancelAnimationFrame(raf.current); };
  }, [ref, lift]);
}

/** Height in world px — shared by the readouts. */
export const heightWorldPx = (units: number, scale = 1) => units * HEIGHT_UNIT * scale;
