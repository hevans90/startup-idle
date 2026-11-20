/**
 * SNOW ON WHAT IS BUILT: how much lies on the roofs and the roads, 0–1, the calendar's snow lying (@see weather
 * groundAt) as the scene sets it each frame — and what shows it: each house's baked snow over its roof, faded in
 * by it (@see houses-sheet), the roofs a building is drawn with whitened (@see structures/projects/pen), the roads'
 * snow, each road's over it (@see paved snowPaved). On the continuous surface only, as the ground's snow is.
 */
import type { Container } from "pixi.js";

/** Steps the snow is drawn in, where a change of it means drawing again. */
export const SNOW_STEPS = 6;

let lying = 0, shown = -1;
const faded = new Set<Container>();

/** How much snow lies now, 0–1. */
export const snowLying = () => lying;
/** How much, in {@link SNOW_STEPS}: for what is drawn again when it changes. */
export const snowStep = () => Math.round(lying * SNOW_STEPS);

/** A sprite of snow, faded in by how much lies: kept till it is destroyed. */
export function fadeWithSnow(c: Container): void {
  // (Those gone let go now and then, as well as when the snow changes: a summer's rebuilding keeps none.)
  if (faded.size % 1024 === 1023) for (const d of faded) if (d.destroyed) faded.delete(d);
  faded.add(c);
  c.alpha = shown < 0 ? lying : shown;
}

/** Set how much lies; the snow sprites faded to it (in 64ths, so a slow melt is not every sprite every frame). */
export function setSnowLying(v: number): void {
  lying = Math.max(0, Math.min(1, v));
  const a = Math.round(lying * 64) / 64;
  if (a === shown) return;
  shown = a;
  for (const c of faded) {
    if (c.destroyed) { faded.delete(c); continue; }
    c.alpha = a;
  }
}
