import { Viewport } from "pixi-viewport";
import { Rectangle } from "pixi.js";

import { getDefaultMap } from "../map";
import {
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  mapToWorld,
} from "../math-utils";

/** Extra world space around the map AABB so edges are not tight against the clamp. */
const CLAMP_WORLD_PADDING = 400;

/**
 * Axis-aligned bounds in viewport world space (same frame as `office.tsx` sprite positions).
 */
export function getOfficeWorldBounds(wrapperSize: {
  width: number;
  height: number;
}) {
  const mapScale = 1;
  const { cols, rows, tiles } = getDefaultMap();
  const maxZ = tiles.reduce((m, t) => Math.max(m, t.z), 0);
  const corners: [number, number][] = [
    [0, 0],
    [cols - 1, 0],
    [0, rows - 1],
    [cols - 1, rows - 1],
  ];
  const padX = (ISO_TILE_WIDTH * mapScale) / 2;
  const padY = ISO_TILE_HEIGHT * mapScale;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [mx, my] of corners) {
    for (const z of [0, maxZ]) {
      const { x, y } = mapToWorld(mx, my, z, mapScale);
      const wx = x + wrapperSize.width / 2;
      const wy = y + wrapperSize.height / 4;
      minX = Math.min(minX, wx - padX);
      maxX = Math.max(maxX, wx + padX);
      minY = Math.min(minY, wy - padY);
      maxY = Math.max(maxY, wy);
    }
  }

  return {
    minX: minX - CLAMP_WORLD_PADDING,
    maxX: maxX + CLAMP_WORLD_PADDING,
    minY: minY - CLAMP_WORLD_PADDING,
    maxY: maxY + CLAMP_WORLD_PADDING,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Keeps the visible world rectangle inside `[minX,maxX]×[minY,maxY]` (pixi-viewport world coords).
 * When zoomed out so the view is larger than that box, uses the **midpoint** of the feasible
 * `x`/`y` interval (same as centering the map) — updates every frame so zoom stays smooth.
 *
 * Replaces the built-in `viewport.clamp()` plugin, which breaks when both left+right (or top+bottom)
 * constraints apply in one update.
 */
export function constrainViewportToOfficeBounds(
  viewport: Viewport,
  screenSize: Rectangle
) {
  const { minX, maxX, minY, maxY } = getOfficeWorldBounds({
    width: screenSize.width,
    height: screenSize.height,
  });

  const sx = viewport.scale.x;
  const sy = viewport.scale.y;
  const sw = viewport.screenWidth;
  const sh = viewport.screenHeight;

  // Visible world: left = -x/sx, right = left + sw/sx; require minX <= left and right <= maxX.
  const xLo = -maxX * sx + sw;
  const xHi = -minX * sx;
  let x = viewport.x;
  if (xLo <= xHi) {
    x = clamp(viewport.x, xLo, xHi);
  } else {
    x = (xLo + xHi) / 2;
  }

  const yLo = -maxY * sy + sh;
  const yHi = -minY * sy;
  let y = viewport.y;
  if (yLo <= yHi) {
    y = clamp(viewport.y, yLo, yHi);
  } else {
    y = (yLo + yHi) / 2;
  }

  if (viewport.x !== x || viewport.y !== y) {
    viewport.x = x;
    viewport.y = y;
  }
}
