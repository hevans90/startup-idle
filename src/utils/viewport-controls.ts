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
