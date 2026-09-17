import type { Viewport } from "pixi-viewport";

/**
 * Shared pan/zoom controls for every pixi-viewport in the app (the city map and
 * the acquisition skill tree), so they feel identical:
 *  - left / middle mouse drag to pan
 *  - trackpad pinch to zoom
 *  - mouse wheel to zoom WITHOUT holding ctrl (`wheelZoom: true`)
 *
 * Only the zoom clamp differs per canvas, so it's passed in.
 */
export function applyViewportControls(
  vp: Viewport,
  {
    minScale,
    maxScale,
    percent = 3,
  }: { minScale: number; maxScale: number; percent?: number },
): void {
  vp.drag({ clampWheel: false, mouseButtons: "left-middle" })
    .pinch({ noDrag: false })
    .wheel({ percent, trackpadPinch: true, wheelZoom: true })
    .clampZoom({ minScale, maxScale });
}

/**
 * Re-bind which mouse buttons pan.
 *
 * A paint tool needs left-drag, which is also the default pan gesture — so
 * while one is active panning moves to middle/right. Pinch and wheel-zoom are
 * untouched, so touch and trackpad behaviour is unchanged.
 *
 * Separate from {@link applyViewportControls} so the shared default (and the
 * skill tree, which also uses it) is never affected.
 */
export function setPanButtons(
  vp: Viewport,
  buttons: "left-middle" | "middle-right",
): void {
  vp.plugins.remove("drag");
  vp.drag({ clampWheel: false, mouseButtons: buttons });
}
