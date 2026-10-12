/**
 * World v2 — DAY AND NIGHT on the map, and the weather: a day every ten minutes, the town a
 * little darker at night and busier at the rush hours. Read off the clock,
 * so every view of the town agrees on the time of day. Only the look of it
 * and the traffic: the economy keeps no hours. @see world-scene, stepTown
 */

import type { Graphics } from "pixi.js";

/** Seconds a day lasts. */
export const DAY_SECONDS = 600;
/** How dark the map gets at midnight: the alpha of the night over it. */
export const NIGHT_DARK = 0.35;
/** The colour of the night. */
export const NIGHT_COLOUR = 0x0b1030;

/** Where in the day it is, 0 to 1: midnight at 0, noon at a half. */
export const dayPhase = (nowMs: number) => ((nowMs / 1000) % DAY_SECONDS) / DAY_SECONDS;

/** How dark the map is, 0 at noon up to NIGHT_DARK at midnight, eased so the day is long. */
export function darkness(phase: number): number {
  const light = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  return NIGHT_DARK * (1 - light) ** 1.5;
}

/** A bump centred on `at`, `width` wide, in day-phase. */
const bump = (phase: number, at: number, width: number) => {
  const d = Math.min(Math.abs(phase - at), 1 - Math.abs(phase - at));
  return Math.exp(-((d / width) ** 2));
};

/**
 * How busy the streets are, against an ordinary hour: half in the dead of
 * night, more at the morning and evening rush. And at the rush, more of the
 * trips are people going to work and home.
 */
export function busyness(phase: number): { traffic: number; commute: number } {
  const rush = Math.max(bump(phase, 8 / 24, 0.05), bump(phase, 18 / 24, 0.05));
  const night = bump(phase, 0, 0.12);
  return { traffic: 1 + 0.6 * rush - 0.5 * night, commute: 0.6 + 0.3 * rush };
}

/** Rain streaks over the whole screen at full strength, and how fast they fall, px a second. */
const DROPS = 140;
const FALL = 900;

/**
 * RAIN, over the map: short slanting streaks in screen space, falling. While
 * a flood is coming at half strength, and in full once it is here — the
 * forecast on the map, not only on its card. @see stepFlood
 */
export function drawRain(g: Graphics, w: number, h: number, t: number, strength: number): void {
  const n = Math.round(DROPS * strength);
  for (let k = 0; k < n; k++) {
    // A drop's own place and speed, the same each frame, so it falls rather than flickers.
    const sx = (k * 0.618034) % 1, sp = 0.7 + ((k * 0.414214) % 1) * 0.6;
    const y = ((t * FALL * sp + k * 97) % (h + 60)) - 30;
    const x = (sx * (w + 80) - 40 + y * 0.25) % (w + 80);
    g.moveTo(x, y).lineTo(x - 4, y + 16);
  }
  if (n) g.stroke({ color: 0xa9c4e0, alpha: 0.35, width: 1 });
}
