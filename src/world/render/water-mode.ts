/**
 * World v2 — WHICH WATER. `?water=field` is the water as ONE SMOOTH FIELD: the
 * solver's floor is the ground as it is DRAWN (a surface, not terraces — @see
 * drawn.ts), and the surface is drawn from where a point IS and nothing else
 * (@see water-gpu.ts fieldCorner), so no two columns that share a corner can
 * put it in two places. Off, the water is as it was: a floor a tile, flat, and
 * a mesh joined column to column by rule. One switch, read by the solver's
 * floor and by the drawing, so the two cannot disagree. @see plans/terrain-quality.md
 */
/** What the address bar asks for; nothing, with no address bar (a test, a headless run). */
const asked = (): boolean =>
  typeof location !== "undefined" && new URLSearchParams(location.search).get("water") === "field";
let on = asked();
export const fieldWater = (): boolean => on;
/** For a test that wants it. */
export const setFieldWater = (v: boolean): void => { on = v; };
