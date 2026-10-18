/**
 * World v2 — A BUILDING THAT CAN BE CLICKED, under the pointer: its ground
 * lit and outlined, and a frame round all of it that it draws, pulsing, in
 * the amber the UI marks what opens with. @see opensSomething
 */
import type { Graphics } from "pixi.js";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import { idx, inBounds, type Grid, type Structure } from "../grid";

export const OPEN_COLOUR = 0xfbbf24;
/** Pulses a second; local pixels the frame stands off what it frames. */
const PULSE = 1.2;
const PAD = 6;

const P = (sc: number, u: number, v: number, z: number): [number, number] =>
  [(u - v) * HW * sc, (u + v) * HH * sc - z * HEIGHT_UNIT * sc];

/**
 * Draw it. `drawn` is what the building drew, in the graphics' own space, or
 * null; `t` seconds, for the pulse.
 */
export function drawOpenHighlight(g: Graphics, grid: Grid, s: Structure, sc: number, drawn: { x: number; y: number; w: number; h: number } | null, t: number) {
  g.clear();
  const k = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * PULSE);
  const z = inBounds(grid, s.x, s.y) ? grid.height[idx(grid, s.x, s.y)] : 0;
  const foot = [
    ...P(sc, s.x - 0.5, s.y - 0.5, z), ...P(sc, s.x + s.w - 0.5, s.y - 0.5, z),
    ...P(sc, s.x + s.w - 0.5, s.y + s.h - 0.5, z), ...P(sc, s.x - 0.5, s.y + s.h - 0.5, z),
  ];
  g.poly(foot).fill({ color: OPEN_COLOUR, alpha: 0.18 + 0.14 * k });
  g.poly(foot).stroke({ color: OPEN_COLOUR, width: 2, alpha: 0.95, pixelLine: true });
  if (!drawn) return;
  const pad = PAD + 2 * k;
  const r = { x: drawn.x - pad, y: drawn.y - pad, w: drawn.w + 2 * pad, h: drawn.h + 2 * pad };
  // A soft glow under a sharp line.
  g.roundRect(r.x, r.y, r.w, r.h, 6).stroke({ color: OPEN_COLOUR, width: 8, alpha: 0.12 + 0.12 * k });
  g.roundRect(r.x, r.y, r.w, r.h, 6).stroke({ color: OPEN_COLOUR, width: 2, alpha: 0.9 });
}
